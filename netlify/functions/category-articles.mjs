import { getConnectionString } from "@netlify/database";
import postgres from "postgres";
import { EDITORIAL_CATEGORIES, normalizeEditorialCategory } from "../../src/server/categories.mjs";
import { repairLegacyArchive } from "../../src/server/article-maintenance.mjs";


export default async (request) => {
  const category = new URL(request.url).searchParams.get("category") || "";
  if (!EDITORIAL_CATEGORIES.includes(category)) return Response.json({ articles: [] }, { status: 404 });
  const sql = postgres(getConnectionString(), { max: 1 });
  try {
    try { await repairLegacyArchive(sql); } catch (error) { console.warn("Legacy archive repair skipped; serving category results", String(error.message).slice(0, 180)); }
    const archive = await sql`
      SELECT id, slug, title, dek, kind, category, region, event_date, published_at,
             cover_url, cover_source_url, cover_credit, cover_license, tags, reading_minutes
      FROM articles
      WHERE status = 'published' AND published_at <= now()
      ORDER BY published_at DESC LIMIT 1000
    `;
    const articles = archive
      .map((article) => ({ ...article, category: normalizeEditorialCategory(article.category, article) }))
      .filter((article) => article.category === category)
      .slice(0, 60);
    return Response.json({ category, articles });
  } catch (error) {
    console.error("Category query failed", error);
    return Response.json({ articles: [] }, { status: 500 });
  } finally { await sql.end(); }
};

