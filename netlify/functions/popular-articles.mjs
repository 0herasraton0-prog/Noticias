import { getConnectionString } from "@netlify/database";
import postgres from "postgres";

export default async () => {
  const sql = postgres(getConnectionString(), { max: 1 });
  try {
    const articles = await sql`
      SELECT a.slug, a.title, a.dek, a.kind, a.category, a.region, a.published_at, a.cover_url,
             COALESCE(SUM(m.views), 0) AS views
      FROM articles a
      LEFT JOIN article_metrics_daily m
        ON m.article_id = a.id AND m.day >= current_date - 5 AND m.day <= current_date
      WHERE a.status = 'published' AND a.published_at <= now() - interval '3 days'
        AND a.published_at > now() - interval '5 days'
      GROUP BY a.id
      ORDER BY views DESC, a.published_at DESC
      LIMIT 5
    `;
    return Response.json({ articles }, { headers: { "Netlify-CDN-Cache-Control": "public, max-age=60, stale-while-revalidate=120, durable" } });
  } catch (error) {
    console.error("Could not load popular articles", error);
    return Response.json({ articles: [] }, { status: 500 });
  } finally { await sql.end(); }
};

