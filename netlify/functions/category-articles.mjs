import { getConnectionString } from "@netlify/database";
import postgres from "postgres";
import { EDITORIAL_CATEGORIES } from "../../src/server/categories.mjs";
import { repairLegacyArchive } from "../../src/server/article-maintenance.mjs";


export default async (request) => {
  const category = new URL(request.url).searchParams.get("category") || "";
  if (!EDITORIAL_CATEGORIES.includes(category)) return Response.json({ articles: [] }, { status: 404 });
  const sql = postgres(getConnectionString(), { max: 1 });
  try {
    await repairLegacyArchive(sql);
    const articles = await sql`
      SELECT id, slug, title, dek, kind, category, region, event_date, published_at, cover_url, cover_source_url, cover_credit, cover_license, tags, reading_minutes
      FROM articles WHERE category = ${category} AND status = 'published' AND published_at <= now()
      ORDER BY published_at DESC LIMIT 60
    `;
    return Response.json({ category, articles });
  } catch (error) {
    console.error("Category query failed", error);
    return Response.json({ articles: [] }, { status: 500 });
  } finally { await sql.end(); }
};

