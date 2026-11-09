import { citationsFrom, structuredResponse } from "./openai.mjs";
import { findCommercialPhoto } from "./images.mjs";
import { ARTICLE_SCHEMA, CANDIDATES_SCHEMA, DISCOVERY_INSTRUCTIONS, RESEARCH_INSTRUCTIONS, REVIEW_INSTRUCTIONS, REVIEW_SCHEMA, RESEARCH_SCHEMA, WRITER_INSTRUCTIONS } from "./prompts.mjs";

const SOCIAL_HOSTS = new Set(["x.com", "twitter.com", "facebook.com", "instagram.com", "tiktok.com", "youtube.com", "threads.net"]);
const domainOf = (url) => {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
};
const isSocial = (url) => [...SOCIAL_HOSTS].some((host) => domainOf(url) === host || domainOf(url).endsWith(`.${host}`));
const slugify = (value) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
const wordCount = (value) => String(value).replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;

function isRecentEventDate(value, now) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const eventDay = Date.UTC(year, month - 1, day);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (name) => Number(parts.find((item) => item.type === name)?.value);
  const todayDay = Date.UTC(part("year"), part("month") - 1, part("day"));
  const ageInDays = (todayDay - eventDay) / 86400000;
  return Number.isInteger(ageInDays) && ageInDays >= 0 && ageInDays <= 3;
}

export async function withRetries(task, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await task(); }
    catch (error) {
      lastError = error;
      const status = error?.status ?? error?.statusCode;
      const code = error?.code ?? error?.error?.code;
      if (status === 401 || status === 403 || code === "insufficient_quota" || code === "project_spend_limit_exceeded" || code === "credit_balance_exhausted" || /duplicate topic|duplicate article slug|insufficient independent source|discrepancy was not resolved|review blocked article|did not verify an event date|monthly API budget/i.test(error.message)) throw error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 900));
    }
  }
  throw lastError;
}

export async function discoverCandidates(sql, now) {
  const recent = await sql`SELECT title, topic_key FROM articles WHERE created_at > ${new Date(now.getTime() - 14 * 86400000)} ORDER BY created_at DESC LIMIT 80`;
  const brief = recent.map((row) => `${row.title} [${row.topic_key}]`).join("\n");
  const { data } = await structuredResponse({
    name: "editorial_candidates", schema: CANDIDATES_SCHEMA, instructions: DISCOVERY_INSTRUCTIONS, webSearch: true,
    input: `Hora actual: ${now.toISOString()}. Busca temas nuevos. Evita duplicar estos artículos recientes:\n${brief || "(ninguno)"}\nDevuelve como máximo tres temas actuales y tres curiosidades; si no hay suficiente calidad, devuelve menos.`,
  });
  return data.candidates.slice(0, 12);
}

async function research(candidate, now) {
  const minimum = candidate.kind === "current" ? 2 : 1;
  const { data, response } = await structuredResponse({
    name: "editorial_research", schema: RESEARCH_SCHEMA, instructions: RESEARCH_INSTRUCTIONS, webSearch: true,
    input: `Investiga este tema para un artículo. Hora de referencia: ${now.toISOString()}\nCandidato: ${JSON.stringify(candidate)}\nEncuentra al menos ${minimum} fuente(s) fiable(s)${candidate.kind === "current" ? " e independientes, fuera de redes sociales" : ""}. Si hay discrepancia importante, busca una tercera fuente.`,
  });
  const sources = citationsFrom(response).filter((source) => !isSocial(source.url));
  const domains = new Set(sources.map((source) => domainOf(source.url)));
  if (domains.size < minimum) throw new Error(`Insufficient independent source citations (${domains.size}/${minimum})`);
  if (data.discrepancy && domains.size < 3) throw new Error("Important source discrepancy was not resolved by a third source");
  if (candidate.kind === "current" && !isRecentEventDate(data.event_date, now)) {
    throw new Error("Research did not verify an event date within the last three days");
  }
  if (candidate.kind === "curiosity") data.event_date = null;
  return { dossier: data, sources };
}

async function writeAndReview(candidate, researchPack) {
  const { data: article } = await structuredResponse({
    name: "editorial_article", schema: ARTICLE_SCHEMA, instructions: WRITER_INSTRUCTIONS, webSearch: false,
    input: `Candidato:\n${JSON.stringify(candidate)}\nDossier investigado:\n${JSON.stringify(researchPack.dossier)}\nFuentes comprobadas:\n${JSON.stringify(researchPack.sources)}`,
  });
  article.event_date = candidate.kind === "current" ? researchPack.dossier.event_date : null;
  if (article.body.length < 5 || article.body.some((paragraph) => wordCount(paragraph) < 20 || wordCount(paragraph) > 180)) {
    throw new Error("Article paragraph count or length is outside editorial limits");
  }
  if (wordCount(article.body.join(" ")) < 350) throw new Error("Article is too short to provide useful context");
  if (article.kind === "current" && !article.event_date) throw new Error("Current news is missing the event date");

  const { data: review } = await structuredResponse({
    name: "editorial_review", schema: REVIEW_SCHEMA, instructions: REVIEW_INSTRUCTIONS,
    input: `Candidato:\n${JSON.stringify(candidate)}\nDossier:\n${JSON.stringify(researchPack.dossier)}\nArtículo:\n${JSON.stringify(article)}`,
  });
  if (!review.pass) throw new Error(`Editorial review blocked article: ${review.issues.join("; ")}`);
  article.topic_key = slugify(candidate.topic || candidate.title);
  return article;
}

// Cover photo is optional: if no commercially licensed photo is found, the
// article is published without one and the site shows a typographic card.
async function pickCover(candidate) {
  for (const query of [candidate.topic, candidate.title]) {
    if (!query) continue;
    try {
      const image = await findCommercialPhoto(query);
      if (image?.url) return image;
    } catch (error) {
      console.warn("Cover image lookup failed", String(error.message).slice(0, 200));
    }
  }
  return null;
}

async function saveArticle(sql, article, sources, image, cycleId) {
  const duplicate = await sql`SELECT id FROM articles WHERE topic_key = ${article.topic_key} AND created_at > now() - interval '45 days' LIMIT 1`;
  if (duplicate.length) throw new Error("Duplicate topic in the recent archive");

  const inserted = await sql.begin(async (tx) => {
    const rows = await tx`
      INSERT INTO articles (slug, topic_key, title, dek, body, kind, category, region, event_date, published_at, status, cover_url, cover_source_url, cover_credit, cover_license, tags, reading_minutes, cycle_id)
      VALUES (${slugify(article.title)}, ${article.topic_key}, ${article.title}, ${article.dek}, ${tx.json(article.body)}, ${article.kind}, ${article.category}, ${article.region}, ${article.event_date}, now(), 'published', ${image?.url ?? null}, ${image?.sourceUrl ?? null}, ${image?.credit ?? null}, ${image?.license ?? null}, ${tx.array(article.tags)}, ${article.reading_minutes}, ${cycleId})
      ON CONFLICT (slug) DO NOTHING
      RETURNING id
    `;
    if (!rows.length) throw new Error("Duplicate article slug");
    for (const source of sources) {
      await tx`INSERT INTO article_sources (article_id, source_url, title) VALUES (${rows[0].id}, ${source.url}, ${source.title || ""}) ON CONFLICT DO NOTHING`;
    }
    return rows[0];
  });
  return { id: inserted.id, title: article.title, slug: slugify(article.title), photo: Boolean(image) };
}

export async function runEditorialCycle(sql, cycle) {
  const now = new Date(cycle.scheduledAt);
  const candidates = await withRetries(() => discoverCandidates(sql, now));
  const report = { candidates: candidates.length, published: [], failed: [], featuredCuriosities: [] };
  const topicCounts = { current: 0, curiosity: 0 };

  for (const candidate of candidates) {
    if (!["current", "curiosity"].includes(candidate.kind)) continue;
    if (topicCounts[candidate.kind] >= 3) continue;
    topicCounts[candidate.kind] += 1;
    try {
      // Cheap check first: skip stale news before paying for research.
      if (candidate.kind === "current" && !isRecentEventDate(candidate.event_date, now)) {
        throw new Error("Candidate has no recent event date; skipped before research");
      }
      const researchPack = await withRetries(() => research(candidate, now));
      const article = await withRetries(() => writeAndReview(candidate, researchPack));
      if (article.kind !== candidate.kind) throw new Error("Writer changed the article type");
      if (candidate.kind === "current" && article.region !== candidate.region) throw new Error("Writer changed the news region");
      const image = await pickCover(candidate);
      const result = await withRetries(() => saveArticle(sql, article, researchPack.sources, image, cycle.cycleId));
      report.published.push({ ...result, kind: article.kind });
    } catch (error) {
      const failure = { title: candidate.title, kind: candidate.kind, reason: String(error.message).slice(0, 500) };
      console.warn("Editorial candidate failed", JSON.stringify(failure));
      report.failed.push(failure);
      if (/monthly API budget|insufficient_quota|spend_limit|credit_balance/i.test(failure.reason)) break;
    }
  }

  const publishedCuriosities = report.published.filter((item) => item.kind === "curiosity");
  const shortage = Math.max(0, 3 - publishedCuriosities.length);
  const reused = shortage ? await sql`
    SELECT id, title, slug FROM articles
    WHERE kind = 'curiosity' AND status = 'published' AND published_at <= now()
    ORDER BY published_at DESC LIMIT ${shortage + 3}
  ` : [];
  const freshIds = new Set(publishedCuriosities.map((item) => item.id));
  const features = [...publishedCuriosities.map((item) => ({ id: item.id, title: item.title, slug: item.slug })), ...reused.filter((item) => !freshIds.has(item.id))];
  const seen = new Set();
  const uniqueFeatures = features.filter((item) => !seen.has(item.id) && seen.add(item.id)).slice(0, 3);
  if (uniqueFeatures.length) {
    await sql`DELETE FROM homepage_featured_curiosities`;
    for (const [index, item] of uniqueFeatures.entries()) {
      await sql`INSERT INTO homepage_featured_curiosities (article_id, cycle_id, position) VALUES (${item.id}, ${cycle.cycleId}, ${index + 1}) ON CONFLICT (article_id) DO UPDATE SET cycle_id = EXCLUDED.cycle_id, position = EXCLUDED.position, featured_at = now()`;
    }
  }
  report.featuredCuriosities = uniqueFeatures;
  return report;
}
