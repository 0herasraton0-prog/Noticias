import { getConnectionString } from "@netlify/database";
import postgres from "postgres";

export default async (request) => {
  const query = (new URL(request.url).searchParams.get("q") || "").trim().slice(0, 120);
  if (query.length < 2) return Response.json({ articles: [] });
  const sql = postgres(getConnectionString(), { max: 1 });
  try {
    const pattern = `%${query}%`;
    const articles = await sql`
      SELECT slug, title, dek, kind, category, region, published_at, cover_url, reading_minutes
      FROM articles WHERE status = 'published' AND published_at <= now()
        AND (title ILIKE ${pattern} OR dek ILIKE ${pattern} OR category ILIKE ${pattern} OR ${query} = ANY(tags))
      ORDER BY published_at DESC LIMIT 40
    `;
    return Response.json({ query, articles });
  } catch (error) {
    console.error("Search query failed", error);
    return Response.json({ articles: [] }, { status: 500 });
  } finally { await sql.end(); }
};

export const config = { path: "/api/search" };
