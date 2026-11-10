import { getConnectionString } from "@netlify/database";
import postgres from "postgres";

export default async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let payload;
  try { payload = await request.json(); } catch { return new Response("Invalid payload", { status: 400 }); }
  const slug = String(payload.slug || "").slice(0, 100);
  const seconds = Math.max(0, Math.min(1800, Number(payload.engagedSeconds) || 0));
  const nextClick = Boolean(payload.nextArticleClick);
  const view = Boolean(payload.view);
  if (!/^[a-z0-9-]{1,100}$/.test(slug) || (!view && !nextClick && seconds === 0)) return new Response("Invalid article", { status: 400 });
  const sql = postgres(getConnectionString(), { max: 1 });
  try {
    const rows = await sql`SELECT id FROM articles WHERE slug = ${slug} AND status = 'published' AND published_at <= now() LIMIT 1`;
    if (!rows.length) return new Response("Not found", { status: 404 });
    await sql`
      INSERT INTO site_metrics_daily (day, article_id, views, engaged_seconds, next_article_clicks)
      VALUES (current_date, ${rows[0].id}, ${view ? 1 : 0}, ${seconds}, ${nextClick ? 1 : 0})
      ON CONFLICT (day, article_id) DO UPDATE SET
        views = site_metrics_daily.views + 1,
        engaged_seconds = site_metrics_daily.engaged_seconds + EXCLUDED.engaged_seconds,
        next_article_clicks = site_metrics_daily.next_article_clicks + EXCLUDED.next_article_clicks
    `;
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Could not record article engagement", error);
    return new Response("Could not record engagement", { status: 500 });
  } finally { await sql.end(); }
};

