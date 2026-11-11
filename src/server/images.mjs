const ALLOWED_LICENSES = new Map([
  ["cc0", "CC0"],
  ["pdm", "Public domain"],
  ["by", "CC BY"],
  ["by-sa", "CC BY-SA"],
]);

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "into", "over", "under", "near",
  "una", "uno", "unos", "unas", "sobre", "entre", "desde", "para", "con", "por", "del",
  "las", "los", "que", "como", "este", "esta", "estos", "estas", "foto", "image", "photo",
  "photograph", "picture", "commons", "wikipedia", "free", "license", "licensed",
]);

function plainText(value = "") {
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function terms(value) {
  return plainText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

function normalizedUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return String(value || "").trim().toLowerCase();
  }
}

function isExcluded(result, excluded) {
  const candidates = [result.id, result.url, result.thumbnail, result.foreign_landing_url]
    .filter(Boolean)
    .map(normalizedUrl);
  return candidates.some((value) => excluded.has(value));
}

function rankResult(queryTerms, result) {
  const titleTerms = new Set(terms(result.title));
  const tagTerms = new Set((result.tags || []).flatMap((tag) => terms(tag.name || "")));
  const allTerms = new Set([...titleTerms, ...tagTerms]);
  const matches = queryTerms.filter((term) => allTerms.has(term)).length;
  const minimum = queryTerms.length === 1 ? 1 : queryTerms.length <= 3 ? 2 : 3;
  const coverage = matches / queryTerms.length;
  if (matches < minimum || (queryTerms.length >= 4 && coverage < 0.35)) return 0;

  const titleMatches = queryTerms.filter((term) => titleTerms.has(term)).length;
  const license = String(result.license || "").toLowerCase();
  const licenseBonus = license === "cc0" || license === "pdm" ? 0.08 : 0;
  return coverage + (titleMatches / queryTerms.length) * 0.25 + licenseBonus;
}

function attributionFor(result, licenseLabel) {
  const parts = [
    plainText(result.creator || "Autor no identificado"),
    plainText(result.title || "Fotografía"),
    licenseLabel,
  ].filter(Boolean);
  return parts.join(" — ");
}

/**
 * Search Openverse for distinct, commercially reusable photographs.
 * Results are filtered to CC0, public domain, CC BY and CC BY-SA; non-commercial
 * and no-derivatives licences are never accepted.
 */
export async function findCommercialPhoto(query, options = {}) {
  const queryTerms = [...new Set(terms(query))];
  if (!queryTerms.length) return null;

  const excluded = new Set([...(options.excludeUrls || [])].map(normalizedUrl));
  const endpoint = new URL("https://api.openverse.org/v1/images/");
  endpoint.search = new URLSearchParams({
    q: query,
    license_type: "commercial",
    category: "photograph",
    extension: "jpg,jpeg,png,webp",
    filter_dead: "true",
    mature: "false",
    page_size: "40",
  });

  const response = await fetch(endpoint, {
    headers: { accept: "application/json", "user-agent": "Curioynoticias24h/1.0 (openly licensed photo search)" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("Openverse returned " + response.status);
  const payload = await response.json();
  const candidates = [];

  for (const result of payload.results || []) {
    const licenseKey = String(result.license || "").toLowerCase();
    const licenseLabel = ALLOWED_LICENSES.get(licenseKey);
    if (!licenseLabel || result.mature || isExcluded(result, excluded)) continue;
    if (result.category && result.category !== "photograph") continue;
    if ((result.width || 0) > 0 && result.width < 600) continue;

    const imageUrl = result.url;
    // Use the original image URL for crisp, large article covers; thumbnails are often tiny.
    if (!imageUrl || !result.foreign_landing_url || !/^https:\/\//i.test(imageUrl)) continue;
    const score = rankResult(queryTerms, result);
    if (!score) continue;

    candidates.push({
      score,
      licenseBonus: licenseKey === "cc0" || licenseKey === "pdm" ? 1 : 0,
      image: {
        id: result.id,
        url: imageUrl,
        sourceUrl: result.foreign_landing_url,
        license: licenseLabel + (result.license_version ? " " + result.license_version : ""),
        credit: attributionFor(result, licenseLabel),
        title: plainText(result.title || ""),
      },
    });
  }

  candidates.sort((a, b) => b.score - a.score || b.licenseBonus - a.licenseBonus);
  return candidates[0]?.image || null;
}
