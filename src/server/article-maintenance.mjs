import { CATEGORY_VISUAL_QUERIES, EDITORIAL_CATEGORIES, LEGACY_VISUAL_QUERIES, normalizeEditorialCategory } from "./categories.mjs";
import { findCommercialPhoto } from "./images.mjs";

const badCredit = (value) => /^(true|false)$/i.test(String(value || "").trim());

export async function repairLegacyArticle(sql, article) {
  if (!article?.id) return article;
  const category = normalizeEditorialCategory(article.category, article);
  const categoryIsValid = EDITORIAL_CATEGORIES.includes(article.category);
  const needsImageRepair = badCredit(article.cover_credit) || !article.cover_url;
  if (categoryIsValid && !needsImageRepair) return article;

  let image = null;
  if (needsImageRepair) {
    const normalizedOldCategory = String(article.category || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
    const queries = [
      article.title,
      ...(Array.isArray(article.tags) ? article.tags.slice(0, 3) : []),
      ...(LEGACY_VISUAL_QUERIES[normalizedOldCategory] || []),
      CATEGORY_VISUAL_QUERIES[category],
    ].filter(Boolean);
    for (const query of [...new Set(queries)]) {
      try {
        image = await findCommercialPhoto(query);
        if (image?.url) break;
      } catch (error) {
        console.warn("Legacy image repair lookup failed", { id: article.id, error: String(error.message).slice(0, 180) });
      }
    }
  }

  const nextArticle = {
    ...article,
    category,
    ...(needsImageRepair ? {
      cover_url: image?.url ?? null,
      cover_source_url: image?.sourceUrl ?? null,
      cover_credit: image?.credit ?? null,
      cover_license: image?.license ?? null,
    } : {}),
  };

  try {
    const rows = await sql`
      UPDATE articles
      SET category = ${category},
          cover_url = ${nextArticle.cover_url ?? null},
          cover_source_url = ${nextArticle.cover_source_url ?? null},
          cover_credit = ${nextArticle.cover_credit ?? null},
          cover_license = ${nextArticle.cover_license ?? null}
      WHERE id = ${article.id}
      RETURNING id
    `;
    if (!rows.length) return nextArticle;
  } catch (error) {
    console.error("Could not repair legacy article fields", { id: article.id, error: String(error.message).slice(0, 250) });
  }
  return nextArticle;
}

export async function repairLegacyArticles(sql, articles) {
  return Promise.all((articles || []).map((article) => repairLegacyArticle(sql, article)));
}
