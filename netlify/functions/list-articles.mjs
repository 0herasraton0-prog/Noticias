import { getConnectionString } from "@netlify/database";
import postgres from "postgres";
import { normalizeEditorialCategory } from "../../src/server/categories.mjs";

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
             a.published_at, a.cover_url, a.cover_credit, a.tags, a.reading_minutes
      FROM homepage_featured_curiosities f JOIN articles a ON a.id = f.article_id
      WHERE a.status = 'published' AND a.published_at <= now()
      ORDER BY f.position ASC
    `; } catch (error) { console.error("Could not load featured curiosities", error); }
    const normalize = (article) => ({
      ...article,
      category: normalizeEditorialCategory(article.category, article),
      ...(/^(true|false)$/i.test(String(article.cover_credit || "").trim()) ? { cover_url: null } : {}),
    });
    return Response.json({ articles: articles.map(normalize), featuredCuriosities: featuredCuriosities.map(normalize) }, { headers: { "Netlify-CDN-Cache-Control": "public, max-age=60, stale-while-revalidate=120, durable" } });
  } catch (error) {
    console.error("Could not load articles", error);
    return Response.json({ articles: [] }, { status: 200 });
  } finally {
    await sql.end();
  }
};
