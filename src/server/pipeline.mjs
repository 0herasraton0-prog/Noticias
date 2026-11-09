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

export async function withRetries(task, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await task(); }
    catch (error) {
      lastError = error;
      const status = error?.status ?? error?.statusCode;
      const code = error?.code ?? error?.error?.code;
      if (status === 401 || status === 403 || code === "insufficient_quota" || code === "project_spend_limit_exceeded" || code === "credit_balance_exhausted" || /duplicate topic|duplicate article slug|insufficient independent source|discrepancy was not resolved|review blocked article/i.test(error.message)) throw error;
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
  return { dossier: data, sources };
}

async function writeAndReview(candidate, researchPack) {
  const { data: article } = await structuredResponse({
    name: "editorial_article", schema: ARTICLE_SCHEMA, instructions: WRITER_INSTRUCTIONS, webSearch: false,
    input: `Candidato:\n${JSON.stringify(candidate)}\nDossier investigado:\n${JSON.stringify(researchPack.dossier)}\nFuentes comprobadas:\n${JSON.stringify(researchPack.sources)}`,
  });
  if (article.body.length < 5 || article.body.some((paragraph) => wordCount(paragraph) < 20 || wordCount(paragraph) > 180)) {
    throw new Error("Article paragraph count or length is outside editorial limits");
  }
  if (wordCount(article.body.join(" ")) < 350) throw new Error("Article is too short to provide useful context");
  if (article.kind === "current" && !article.event_date) throw new Error("Current news is missing the event date");
  if (article.kind === "curiosity" && article.event_date) throw new Error("Curiosity article must not show an event date");
  const { data: review } = await structuredResponse({
    name: "editorial_review", schema: REVIEW_SCHEMA, instructions: REVIEW_INSTRUCTIONS,
    input: `Candidato:\n${JSON.stringify(candidate)}\nDossier:\n${JSON.stringify(researchPack.dossier)}\nArtículo:\n${JSON.stringify(article)}`,
  });
  if (!review.pass) throw new Error(`Editorial review blocked article: ${review.issues.join("; ")}`);
  article.topic_key = slugify(candidate.topic || candidate.title);
  return article;
}

async function saveArticle(sql, article, candidate, sources, image, cycleId) {
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
  return { id: inserted.id, title: article.title, photo: true };
}

export async function runEditorialCycle(sql, cycle) {
  const now = new Date(cycle.scheduledAt);
  const candidates = await withRetries(() => discoverCandidates(sql, now));
  const report = { candidates: candidates.length, published: [], failed: [], featuredCuriosities: [] };
  const successes = { current: 0, curiosity: 0 };
  const topicCounts = { current: 0, curiosity: 0 };

  for (const candidate of candidates) {
    if (!["current", "curiosity"].includes(candidate.kind)) continue;
    if (topicCounts[candidate.kind] >= 3) continue;
    topicCounts[candidate.kind] += 1;
    try {
      // Check that a suitable cover exists before spending tokens on research and writing.
      let image;
      try { image = await findCommercialPhoto(`${candidate.topic} ${candidate.category}`); }
      catch (error) { throw new Error(`Cover image lookup failed: ${error.message}`); }
      if (!image?.url) throw new Error("No commercially licensed cover image found");

      const researchPack = await withRetries(() => research(candidate, now));
      const article = await withRetries(() => writeAndReview(candidate, researchPack));
      if (article.kind !== candidate.kind) throw new Error("Writer changed the article type");
      if (candidate.kind === "current" && article.region !== candidate.region) throw new Error("Writer changed the news region");
      if (candidate.kind === "current" && (!candidate.event_date || new Date(candidate.event_date) < new Date(now.getTime() - 3 * 86400000))) throw new Error("Current news is missing a recent event date");
      const result = await withRetries(() => saveArticle(sql, article, candidate, researchPack.sources, image, cycle.cycleId));
      report.published.push({ ...result, kind: article.kind });
      successes[article.kind] += 1;
    } catch (error) {
      const failure = { title: candidate.title, kind: candidate.kind, reason: String(error.message).slice(0, 500) };
      console.warn("Editorial candidate failed", failure);
      report.failed.push(failure);
    }
  }

  // Choose up to three fresh curiosities first, then evergreen fallbacks.
  const publishedCuriosities = report.published.filter((item) => item.kind === "curiosity");
  const shortage = Math.max(0, 3 - publishedCuriosities.length);
  const reused = shortage ? await sql`
    SELECT id, title, slug FROM articles
    WHERE kind = 'curiosity' AND status = 'published' AND published_at <= now()
      ORDER BY published_at DESC LIMIT ${shortage}
  ` : [];
  const freshIds = new Set(publishedCuriosities.map((item) => item.id));
  const features = [...publishedCuriosities.map((item) => ({ id: item.id, title: item.title, slug: item.slug })), ...reused.filter((item) => !freshIds.has(item.id))];
  const seen = new Set();
  const uniqueFeatures = features.filter((item) => !seen.has(item.id) && seen.add(item.id));
  await sql`DELETE FROM homepage_featured_curiosities`;
  for (const [index, item] of uniqueFeatures.slice(0, 3).entries()) {
    await sql`INSERT INTO homepage_featured_curiosities (article_id, cycle_id, position) VALUES (${item.id}, ${cycle.cycleId}, ${index + 1}) ON CONFLICT (article_id) DO UPDATE SET cycle_id = EXCLUDED.cycle_id, position = EXCLUDED.position, featured_at = now()`;
  }
  report.featuredCuriosities = uniqueFeatures.slice(0, 3);
  return report;
}
