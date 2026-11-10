import { getConnectionString } from "@netlify/database";
import postgres from "postgres";

export default async () => {
  const sql = postgres(getConnectionString(), { max: 1 });
  try {
    const articles = await sql`
      SELECT a.slug, a.title, a.dek, a.kind, a.category, a.region, a.published_at, a.cover_url,
             m.views, m.engaged_seconds, m.next_article_clicks
      FROM article_metrics_daily m JOIN articles a ON a.id = m.article_id
      WHERE m.day = current_date AND a.status = 'published' AND a.published_at <= now()
      ORDER BY m.views DESC, m.engaged_seconds DESC LIMIT 10
    `;
    return Response.json({ articles });
  } catch (error) {
    console.error("Could not load popular articles", error);
    return Response.json({ articles: [] }, { status: 500 });
  } finally { await sql.end(); }
};

