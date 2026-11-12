const ALLOWED_LICENSES = new Map([
  ["cc0", "CC0"],
  ["pdm", "Dominio público"],
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
  return String(value).replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function terms(value) {
  return plainText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").split(/\s+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

function normalizedUrl(value) {
  try { const url = new URL(value); url.hash = ""; url.search = ""; return url.toString().replace(/\/$/, "").toLowerCase(); }
  catch { return String(value || "").trim().toLowerCase(); }
}

function isExcluded(result, excluded) {
  return [result.id, result.url, result.thumbnail, result.sourceUrl, result.foreign_landing_url]
    .filter(Boolean).some((value) => excluded.has(normalizedUrl(value)));
}

function scoreFor(query, title, tags = []) {
  const q = [...new Set(terms(query))];
  const available = new Set([...terms(title), ...tags.flatMap((tag) => terms(tag.name || tag))]);
  const matched = q.filter((term) => available.has(term)).length;
  if (!matched || (q.length >= 5 && matched < 2)) return 0;
  return matched / Math.max(1, q.length);
}

function attribution(creator, title, license) {
  return [plainText(creator || "Autor no identificado"), plainText(title || "Fotografía"), license].filter(Boolean).join(" — ");
}

async function searchOpenverse(query, excluded) {
  const endpoint = new URL("https://api.openverse.org/v1/images/");
  endpoint.search = new URLSearchParams({
    q: query, license_type: "commercial", category: "photograph",
    extension: "jpg,jpeg,png,webp", filter_dead: "true", mature: "false", page_size: "40",
  });
  const response = await fetch(endpoint, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("Openverse " + response.status);
  const payload = await response.json();
  const candidates = [];
  for (const item of payload.results || []) {
    const license = ALLOWED_LICENSES.get(String(item.license || "").toLowerCase());
    if (!license || item.mature || isExcluded(item, excluded) || (item.width && item.width < 500)) continue;
    const url = item.thumbnail || item.url;
    if (!url || !/^https:\/\//i.test(url)) continue;
    const score = scoreFor(query, item.title, item.tags || []);
    if (!score) continue;
    candidates.push({
      score,
      image: {
        id: item.id, url, sourceUrl: item.foreign_landing_url,
        license: license + (item.license_version ? " " + item.license_version : ""),
        credit: attribution(item.creator, item.title, license), title: plainText(item.title || ""),
      },
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.image || null;
}

function metadataValue(metadata, key) {
  return plainText(metadata?.[key]?.value || "");
}

async function searchWikimedia(query, excluded) {
  const endpoint = new URL("https://commons.wikimedia.org/w/api.php");
  endpoint.search = new URLSearchParams({
    action: "query", generator: "search", gsrsearch: query, gsrnamespace: "6", gsrlimit: "30",
    prop: "imageinfo", iiprop: "url|extmetadata|size", iiurlwidth: "1600", format: "json",
    origin: "*",
  });
  const response = await fetch(endpoint, {
    headers: { accept: "application/json", "user-agent": "Curioynoticias24h/1.0 (free photo attribution; contact: privacidad@curioynoticias24h.com)" },
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) throw new Error("Wikimedia Commons " + response.status);
  const payload = await response.json();
  const candidates = [];
  for (const page of Object.values(payload.query?.pages || {})) {
    const info = page.imageinfo?.[0];
    const meta = info?.extmetadata || {};
    const licenseText = metadataValue(meta, "LicenseShortName");
    const lower = licenseText.toLowerCase();
    if (!info || (info.width || 0) < 500 || /non.?commercial|no.?derivative|gfdl/.test(lower)) continue;
    const isOpen = /public domain|cc0|cc by(?:-sa)?(?:-|$| )/i.test(licenseText);
    if (!isOpen) continue;
    const url = info.thumburl || info.url;
    const sourceUrl = page.canonicalurl || "https://commons.wikimedia.org/wiki/" + encodeURIComponent(page.title.replaceAll(" ", "_"));
    if (!url || !/^https:\/\//i.test(url) || isExcluded({ id: page.title, url, sourceUrl }, excluded)) continue;
    const title = plainText(page.title.replace(/^File:/, "").replace(/\.[^.]+$/, "").replaceAll("_", " "));
    const score = scoreFor(query, title);
    if (!score) continue;
    const license = /public domain/i.test(licenseText) ? "Dominio público" : licenseText;
    const creator = metadataValue(meta, "Artist");
    candidates.push({
      score,
      image: { id: page.title, url, sourceUrl, license, credit: attribution(creator, title, license), title },
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.image || null;
}

/** Finds a relevant photo with a reusable license, trying two independent indexes. */
export async function findCommercialPhoto(query, options = {}) {
  if (!terms(query).length) return null;
  const excluded = new Set([...(options.excludeUrls || [])].map(normalizedUrl));
  try {
    const photo = await searchOpenverse(query, excluded);
    if (photo) return photo;
  } catch (error) {
    console.warn("Openverse image search failed", String(error.message).slice(0, 160));
  }
  try {
    return await searchWikimedia(query, excluded);
  } catch (error) {
    console.warn("Wikimedia Commons image search failed", String(error.message).slice(0, 160));
    return null;
  }
}
