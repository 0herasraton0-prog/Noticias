import { getConnectionString } from "@netlify/database";
import postgres from "postgres";

export default async (request) => {
  const origin = new URL(request.url).origin;
  const sql = postgres(getConnectionString(), { max: 1 });
  try {
    const rows = await sql`SELECT slug, published_at FROM articles WHERE status = 'published' AND published_at <= now() ORDER BY published_at DESC LIMIT 5000`;
    const urls = [`<url><loc>${origin}/</loc></url>`, ...rows.map((row) => `<url><loc>${origin}/articulo/${encodeURIComponent(row.slug)}</loc><lastmod>${new Date(row.published_at).toISOString()}</lastmod></url>`)].join("");
    return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=300" } });
  } catch (error) {
    console.error("Could not build sitemap", error);
    return new Response("Sitemap unavailable", { status: 500 });
  } finally { await sql.end(); }
};

export const config = { path: "/sitemap.xml" };
