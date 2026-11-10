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
const TARGET_PER_KIND = 3;
const MAX_CANDIDATES_PER_KIND = 6;
const MAX_EDITORIAL_REPAIRS = 1;

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
      if (status === 401 || status === 403 || (status >= 400 && status < 500 && ![408, 409, 429].includes(status)) || code === "insufficient_quota" || code === "project_spend_limit_exceeded" || code === "credit_balance_exhausted" || /duplicate topic|duplicate article slug|insufficient independent source|discrepancy was not resolved|review blocked article|did not verify an event date|monthly API budget/i.test(error.message)) throw error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 900));
    }
  }
  throw lastError;
}

function isFatalCycleError(error) {
  const status = error?.status ?? error?.statusCode;
  const code = error?.code ?? error?.error?.code;
  if (Number.isFinite(status) && status >= 400) return true;
  if (["usage_accounting_failed", "insufficient_quota", "project_spend_limit_exceeded", "credit_balance_exhausted"].includes(code)) return true;
  return /monthly API budget|OPENAI_API_KEY|invalid api key|model.*not found|database|connection|ECONN|ETIMEDOUT|fetch failed|network error/i.test(String(error?.message || ""));
}

export async function discoverCandidates(sql, now) {
  const recent = await sql`SELECT title, topic_key FROM articles WHERE created_at > ${new Date(now.getTime() - 14 * 86400000)} ORDER BY created_at DESC LIMIT 80`;
  const brief = recent.map((row) => `${row.title} [${row.topic_key}]`).join("\n");
  const { data } = await structuredResponse({
    name: "editorial_candidates", schema: CANDIDATES_SCHEMA, instructions: DISCOVERY_INSTRUCTIONS, webSearch: true,
    input: `Hora actual: ${now.toISOString()}. Busca temas nuevos. Evita duplicar estos artículos recientes:\n${brief || "(ninguno)"}\nDevuelve hasta seis noticias y seis curiosidades, ordenadas por relevancia. Los primeros tres temas válidos de cada tipo son los principales; los restantes son reservas para sustituir fallos. Si no hay calidad suficiente, devuelve menos.`,
  });
  const counts = { current: 0, curiosity: 0 };
  return data.candidates.filter((candidate) => {
    if (!["current", "curiosity"].includes(candidate.kind) || counts[candidate.kind] >= MAX_CANDIDATES_PER_KIND) return false;
    counts[candidate.kind] += 1;
    return true;
  }).slice(0, MAX_CANDIDATES_PER_KIND * 2);
}

async function research(candidate, now) {
  const minimum = candidate.kind === "current" ? 2 : 1;
  const { data, response } = await withRetries(() => structuredResponse({
    name: "editorial_research", schema: RESEARCH_SCHEMA, instructions: RESEARCH_INSTRUCTIONS, webSearch: true,
    input: `Investiga este tema para un artículo. Hora de referencia: ${now.toISOString()}\nCandidato: ${JSON.stringify(candidate)}\nEncuentra al menos ${minimum} fuente(s) fiable(s)${candidate.kind === "current" ? " e independientes, fuera de redes sociales" : ""}. Si hay discrepancia importante, busca una tercera fuente.`,
  }));
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
  let feedback = [];
  let previousDraft = null;

  for (let revision = 0; revision <= MAX_EDITORIAL_REPAIRS; revision += 1) {
    const { data: article } = await withRetries(() => structuredResponse({
      name: "editorial_article", schema: ARTICLE_SCHEMA, instructions: WRITER_INSTRUCTIONS, webSearch: false,
      input: `Candidato:\n${JSON.stringify(candidate)}\nDossier investigado:\n${JSON.stringify(researchPack.dossier)}\nFuentes comprobadas:\n${JSON.stringify(researchPack.sources)}\n${revision ? `Corrige este borrador siguiendo estos fallos: ${feedback.join("; ")}\nBorrador anterior: ${JSON.stringify(previousDraft)}` : "Escribe el artículo desde cero."}`,
    }));

    article.event_date = candidate.kind === "current" ? researchPack.dossier.event_date : null;
    const issues = [];
    if (!Array.isArray(article.body) || article.body.length < 5 || article.body.some((paragraph) => wordCount(paragraph) < 20 || wordCount(paragraph) > 180)) {
      issues.push("El artículo debe tener al menos cinco párrafos de 20 a 180 palabras.");
    }
    if (Array.isArray(article.body) && wordCount(article.body.join(" ")) < 350) {
      issues.push("El artículo debe tener al menos 350 palabras.");
    }
    if (article.kind !== candidate.kind) issues.push("Mantén el tipo de artículo indicado.");
    if (candidate.kind === "current" && article.region !== candidate.region) issues.push("Mantén la región indicada para la noticia.");
    if (candidate.kind === "current" && !article.event_date) issues.push("Incluye la fecha del hecho verificada en el dossier.");

    if (issues.length) {
      if (revision < MAX_EDITORIAL_REPAIRS) {
        feedback = issues;
        previousDraft = article;
        continue;
      }
      throw new Error(`Article repair limit reached: ${issues.join("; ")}`);
    }

    const { data: review } = await withRetries(() => structuredResponse({
      name: "editorial_review", schema: REVIEW_SCHEMA, instructions: REVIEW_INSTRUCTIONS,
      input: `Candidato:\n${JSON.stringify(candidate)}\nDossier:\n${JSON.stringify(researchPack.dossier)}\nArtículo:\n${JSON.stringify(article)}`,
    }));
    if (review.pass) {
      article.topic_key = slugify(candidate.topic || candidate.title);
      return article;
    }
    feedback = review.issues.length ? review.issues : ["La revisión editorial rechazó el borrador."];
    previousDraft = article;
    if (revision === MAX_EDITORIAL_REPAIRS) {
      throw new Error(`Editorial review blocked after one repair: ${feedback.join("; ")}`);
    }
  }
  throw new Error("Editorial repair limit reached");
}
// Every published article must have a commercially licensed cover photo.
 // Search topic and title before spending tokens on research and writing.
async function pickCover(candidate) {
  const queries = [...new Set([candidate.topic, candidate.title, candidate.category].map((value) => String(value || "").trim()).filter(Boolean))];
  for (const query of queries) {
    if (!query) continue;
    try {
      const image = await findCommercialPhoto(query);
      if (image?.url) return image;
    } catch (error) {
      console.warn("Cover image lookup failed", { query, error: String(error.message).slice(0, 200) });
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
      VALUES (${slugify(article.title)}, ${article.topic_key}, ${article.title}, ${article.dek}, ${tx.json(article.body)}, ${article.kind}, ${article.category}, ${article.region}, ${article.event_date}, now(), 'published', ${image.url}, ${image.sourceUrl}, ${image.credit}, ${image.license}, ${tx.array(article.tags)}, ${article.reading_minutes}, ${cycleId})
      ON CONFLICT (slug) DO NOTHING
      RETURNING id
    `;
    if (!rows.length) throw new Error("Duplicate article slug");
    for (const source of sources) {
      await tx`INSERT INTO article_sources (article_id, source_url, title) VALUES (${rows[0].id}, ${source.url}, ${source.title || ""}) ON CONFLICT DO NOTHING`;
    }
    return rows[0];
  });
  return { id: inserted.id, title: article.title, slug: slugify(article.title), photo: true };
}

export async function runEditorialCycle(sql, cycle) {
  const now = new Date(cycle.scheduledAt);
  const candidates = await withRetries(() => discoverCandidates(sql, now));
  const report = {
    candidates: candidates.length,
    attempted: { current: 0, curiosity: 0 },
    published: [],
    failed: [],
    featuredCuriosities: [],
  };
  const publishedCounts = { current: 0, curiosity: 0 };

  for (const candidate of candidates) {
    if (publishedCounts[candidate.kind] >= TARGET_PER_KIND) continue;
    if (report.attempted[candidate.kind] >= MAX_CANDIDATES_PER_KIND) continue;
    report.attempted[candidate.kind] += 1;

    try {
      // Reject stale news and find a commercially reusable, relevant cover before making more model calls.
      if (candidate.kind === "current" && !isRecentEventDate(candidate.event_date, now)) {
        throw new Error("Candidate has no recent event date; skipped before research");
      }
      const image = await pickCover(candidate);
      if (!image?.url) throw new Error("No relevant commercially reusable cover image found after topic, title, and category searches; candidate skipped");

      const researchPack = await research(candidate, now);
      const article = await writeAndReview(candidate, researchPack);
      const result = await withRetries(() => saveArticle(sql, article, researchPack.sources, image, cycle.cycleId));
      report.published.push({ ...result, kind: article.kind });
      publishedCounts[article.kind] += 1;
    } catch (error) {
      const failure = { title: candidate.title, kind: candidate.kind, reason: String(error.message).slice(0, 500) };
      console.warn("Editorial candidate failed", JSON.stringify(failure));
      report.failed.push(failure);
      if (isFatalCycleError(error)) {
        console.error("Editorial cycle stopped after a system-level error", JSON.stringify(failure));
        break;
      }
    }
  }

  const publishedCuriosities = report.published.filter((item) => item.kind === "curiosity");
  const shortage = Math.max(0, TARGET_PER_KIND - publishedCuriosities.length);
  const reused = shortage ? await sql`
    SELECT id, title, slug FROM articles
    WHERE kind = 'curiosity' AND status = 'published' AND published_at <= now()
    ORDER BY published_at DESC LIMIT ${shortage + 3}
  ` : [];
  const freshIds = new Set(publishedCuriosities.map((item) => item.id));
  const features = [...publishedCuriosities.map((item) => ({ id: item.id, title: item.title, slug: item.slug })), ...reused.filter((item) => !freshIds.has(item.id))];
  const seen = new Set();
  const uniqueFeatures = features.filter((item) => !seen.has(item.id) && seen.add(item.id)).slice(0, TARGET_PER_KIND);
  if (uniqueFeatures.length) {
    await sql`DELETE FROM homepage_featured_curiosities`;
    for (const [index, item] of uniqueFeatures.entries()) {
      await sql`INSERT INTO homepage_featured_curiosities (article_id, cycle_id, position) VALUES (${item.id}, ${cycle.cycleId}, ${index + 1}) ON CONFLICT (article_id) DO UPDATE SET cycle_id = EXCLUDED.cycle_id, position = EXCLUDED.position, featured_at = now()`;
    }
  }
  report.featuredCuriosities = uniqueFeatures;
  return report;
}
