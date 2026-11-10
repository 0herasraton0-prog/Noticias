import { openDatabase } from "../../src/server/db.mjs";
import { repairLegacyArticle, repairLegacyArticles } from "../../src/server/article-maintenance.mjs";

const esc = (value = "") => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dateEs = (value) => value ? new Date(value).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Madrid" }) : "";
const regionEs = { Spain: "España", "Latin America": "Latinoamérica", International: "Internacional" };
const markdown = (value) => esc(value).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>");

function card(item) {
  const label = item.kind === "current" ? regionEs[item.region] ?? "Actualidad" : item.category ?? "Curiosidades";
  const image = item.cover_url ? `<img src="${esc(item.cover_url)}" alt="" loading="lazy">` : `<div class="card-placeholder"><span>${esc(label)}</span></div>`;
  return `<article class="related-card"><a class="related-image" href="/articulo/${encodeURIComponent(item.slug)}">${image}<span class="related-image-title">${esc(item.title)}</span></a><div><span class="story-label">${esc(label)}</span><h3><a href="/articulo/${encodeURIComponent(item.slug)}">${esc(item.title)}</a></h3><p>${esc(item.dek)}</p></div></article>`;
}

export default async (request) => {
  const requestUrl = new URL(request.url);
  const pathSlug = requestUrl.pathname.match(/^\\/articulo\\/([^/]+)\\/?$/i)?.[1];
  const rawSlug = requestUrl.searchParams.get("slug") || pathSlug || "";
  let slug = rawSlug;
  if (!requestUrl.searchParams.has("slug") && pathSlug) {
    try { slug = decodeURIComponent(pathSlug); } catch { slug = pathSlug; }
  }
  slug = slug.slice(0, 100);
  if (!slug) return new Response("Artículo no encontrado", { status: 404 });
  const sql = openDatabase();
  try {
    const rows = await sql`SELECT * FROM articles WHERE slug = ${slug} AND status = 'published' AND published_at <= now() LIMIT 1`;
    if (!rows.length) return new Response("Artículo no encontrado", { status: 404 });
    const article = await repairLegacyArticle(sql, rows[0]);
    const related = await sql`
      SELECT id, slug, title, dek, kind, category, region, cover_url, cover_source_url, cover_credit, cover_license, tags
      FROM articles WHERE id <> ${article.id} AND status = 'published' AND published_at <= now()
      ORDER BY (category = ${article.category}) DESC, published_at DESC LIMIT 4
    `;
    const safeRelated = await repairLegacyArticles(sql, related);
    const region = article.kind === "current" ? `<span class="story-label">${esc(regionEs[article.region] ?? "Internacional")}</span>` : `<span class="story-label">${esc(article.category ?? "Curiosidades")}</span>`;
    const factDate = article.kind === "current" && article.event_date ? `<span>Hecho: ${esc(dateEs(article.event_date))}</span>` : "";
    const cover = article.cover_url ? `<figure class="article-cover"><img src="${esc(article.cover_url)}" alt="${esc(article.title)}"/><figcaption>Foto: ${esc(article.cover_credit ?? "Licencia comercial")}</figcaption></figure>` : `<div class="article-cover no-cover"><span>${esc(article.category ?? "Actualidad")}</span></div>`;
    const body = (Array.isArray(article.body) ? article.body : []).map((paragraph) => `<p>${markdown(paragraph)}</p>`).join("\n");
    const creditEnd = article.cover_url && article.cover_credit ? `<p class="cover-credit-end">Crédito de imagen: ${esc(article.cover_credit)}${article.cover_source_url ? ` · <a href="${esc(article.cover_source_url)}" rel="noopener noreferrer">Detalles de licencia</a>` : ""}</p>` : "";
    const structuredData = JSON.stringify({ "@context": "https://schema.org", "@type": article.kind === "current" ? "NewsArticle" : "Article", headline: article.title, description: article.dek, datePublished: article.published_at, dateModified: article.updated_at, image: article.cover_url ? [article.cover_url] : undefined, articleSection: article.category, mainEntityOfPage: `${new URL(request.url).origin}/articulo/${encodeURIComponent(article.slug)}` }).replace(/</g, "\\u003c");
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(article.title)}</title><meta name="description" content="${esc(article.dek)}"><meta property="og:title" content="${esc(article.title)}"><meta property="og:description" content="${esc(article.dek)}">${article.cover_url ? `<meta property="og:image" content="${esc(article.cover_url)}">` : ""}<meta property="og:type" content="article"><link rel="canonical" href="${esc(new URL(request.url).origin)}/articulo/${encodeURIComponent(article.slug)}"><script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-2848391197328644" crossorigin="anonymous"></script><link rel="icon" type="image/webp" href="/logo-curioynoticias.webp"><link rel="stylesheet" href="/styles.css"><script type="application/ld+json">${structuredData}</script></head><body><header class="topbar"><a class="brand" href="/"><img class="brand-logo" src="/logo-curioynoticias.webp" alt=""><span>Curioynoticias 24h</span></a><nav aria-label="Navegación principal"><a href="/">Inicio</a><a href="/#actualidad">Actualidad</a><a href="/#categorias">Categorías</a><a href="/#mas-leido">Lo más leído</a></nav><a class="back-link" href="/">← Volver a portada</a></header><main class="article-layout"><article class="article-main"><div class="article-head">${region}<h1>${esc(article.title)}</h1><p class="article-dek">${esc(article.dek)}</p><div class="article-meta"><span>Publicado el ${esc(dateEs(article.published_at))}</span>${factDate}${article.reading_minutes ? `<span>${esc(article.reading_minutes)} min de lectura</span>` : ""}</div></div>${cover}<div class="article-body">${body}</div>${creditEnd}<div class="share-row"><strong>Compartir</strong><a href="https://wa.me/?text=${encodeURIComponent(article.title + " " + new URL(request.url).href)}" rel="noopener noreferrer">WhatsApp</a><button data-share>Más opciones</button></div><section class="related-section"><h2>Te puede interesar</h2><div class="related-grid">${safeRelated.map(card).join("")}</div></section></article><aside class="article-aside"><div class="ad-slot"><span>PUBLICIDAD</span><div>Espacio para anuncios</div></div><section class="side-card"><div class="section-heading compact"><h2>Relacionado</h2></div>${safeRelated.slice(0, 3).map((item) => `<div class="aside-related"><span>${esc(item.category ?? regionEs[item.region] ?? "Lectura")}</span><a href="/articulo/${encodeURIComponent(item.slug)}">${esc(item.title)}</a></div>`).join("")}</section></aside></main><footer><a class="brand footer-brand" href="/"><img class="brand-logo" src="/logo-curioynoticias.webp" alt=""><span>Curioynoticias 24h</span></a><span>Actualidad y curiosidades para lectores curiosos.</span><div><a href="/privacidad">Privacidad</a><a href="/cookies">Cookies</a><a href="/aviso-legal">Aviso legal</a><button id="cookie-settings">Preferencias de cookies</button></div></footer><script src="/article.js" defer></script></body></html>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60, s-maxage=300" } });
  } catch (error) {
    console.error("Article page error", error);
    return new Response("No se pudo cargar el artículo", { status: 500 });
  } finally {
    await sql.end();
  }
};

