import { getConnectionString } from "@netlify/database";
import postgres from "postgres";

const CATEGORIES = new Set([
  "Ciencia", "Naturaleza y animales", "Geografía y lugares", "Historia y arqueología", "Espacio y universo",
  "Tecnología e inventos", "Cultura y tradiciones", "Cuerpo y mente", "Famosos y entretenimiento", "Datos sorprendentes y vida cotidiana",
]);

export default async (request) => {
  const category = new URL(request.url).searchParams.get("category") || "";
  if (!CATEGORIES.has(category)) return Response.json({ articles: [] }, { status: 404 });
  const sql = postgres(getConnectionString(), { max: 1 });
  try {
    const articles = await sql`
      SELECT slug, title, dek, kind, category, region, event_date, published_at, cover_url, reading_minutes
      FROM articles WHERE category = ${category} AND status = 'published' AND published_at <= now()
      ORDER BY published_at DESC LIMIT 60
    `;
    return Response.json({ category, articles });
  } catch (error) {
    console.error("Category query failed", error);
    return Response.json({ articles: [] }, { status: 500 });
  } finally { await sql.end(); }
};

export const config = { path: "/api/category/*" };
