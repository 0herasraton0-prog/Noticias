import { getConnectionString } from "@netlify/database";
import postgres from "postgres";
import { normalizeEditorialCategory } from "../../src/server/categories.mjs";
import { repairDuplicateCovers } from "../../src/server/article-maintenance.mjs";

export default async () => {
  const sql = postgres(getConnectionString(), { max: 1 });
  try {
    const articles = await sql`
      SELECT id, slug, title, dek, kind, category, region, event_date,
             published_at, cover_url, cover_source_url, cover_credit, cover_license, tags, reading_minutes
      FROM articles
      WHERE status = 'published' AND published_at <= now()
      ORDER BY CASE WHEN kind = 'current' AND published_at > now() - interval '3 days' THEN 0 ELSE 1 END,
               published_at DESC
      LIMIT 60
    `;
    let featuredCuriosities = [];
    try { featuredCuriosities = await sql`
      SELECT a.id, a.slug, a.title, a.dek, a.kind, a.category, a.region, a.event_date,
             a.published_at, a.cover_url, a.cover_source_url, a.cover_credit, a.cover_license, a.tags, a.reading_minutes
      FROM homepage_featured_curiosities f JOIN articles a ON a.id = f.article_id
      WHERE a.status = 'published' AND a.published_at <= now()
      ORDER BY f.position ASC
    `; } catch (error) { console.error("Could not load featured curiosities", error); }
    const normalize = (article) => ({
      ...article,
      category: normalizeEditorialCategory(article.category, article),
      ...(/^(true|false)$/i.test(String(article.cover_credit || "").trim()) ? { cover_url: null } : {}),
    });
    const normalizedArticles = articles.map(normalize);
    const normalizedFeatures = featuredCuriosities.map(normalize);
    const currentFront = normalizedArticles.filter((article) => article.kind === "current" && Date.now() - Date.parse(article.published_at) <= 3 * 86400000).slice(0, 3);
    const featureIds = new Set(normalizedFeatures.map((article) => article.id));
    const curiosityFront = [...normalizedFeatures, ...normalizedArticles.filter((article) => article.kind === "curiosity" && !featureIds.has(article.id))].slice(0, 3);
    const visible = [...new Map([...currentFront, ...curiosityFront].map((article) => [article.id, article])).values()];
    try { await repairDuplicateCovers(sql, visible); }
    catch (error) { console.warn("Could not audit repeated front-page covers", String(error.message).slice(0, 180)); }
    return Response.json({ articles: normalizedArticles, featuredCuriosities: normalizedFeatures }, { headers: { "Netlify-CDN-Cache-Control": "public, max-age=60, stale-while-revalidate=120, durable" } });
  } catch (error) {
    console.error("Could not load articles", error);
    return Response.json({ articles: [] }, { status: 200 });
  } finally {
    await sql.end();
  }
};
