const COMMERCIAL_LICENSES = new Map([
  ["cc0", "CC0"],
  ["public domain", "Public domain"],
  ["pd", "Public domain"],
  ["cc by 4.0", "CC BY 4.0"],
  ["cc by 3.0", "CC BY 3.0"],
  ["cc by 2.5", "CC BY 2.5"],
  ["cc by 2.0", "CC BY 2.0"],
  ["cc by 1.0", "CC BY 1.0"],
  ["cc by-sa 4.0", "CC BY-SA 4.0"],
  ["cc by-sa 3.0", "CC BY-SA 3.0"],
  ["cc by-sa 2.5", "CC BY-SA 2.5"],
  ["cc by-sa 2.0", "CC BY-SA 2.0"],
  ["cc by-sa 1.0", "CC BY-SA 1.0"],
  ["cc by-nd 4.0", "CC BY-ND 4.0"],
  ["cc by-nd 3.0", "CC BY-ND 3.0"],
  ["cc by-nd 2.0", "CC BY-ND 2.0"],
  ["cc by-nd 1.0", "CC BY-ND 1.0"],
  ["cc by-sa-nd 4.0", "CC BY-SA-ND 4.0"],
  ["cc by 4.0 international", "CC BY 4.0"],
  ["cc by-sa 4.0 international", "CC BY-SA 4.0"],
]);

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "into", "over", "under", "near",
  "una", "uno", "unos", "unas", "sobre", "entre", "desde", "para", "con", "por", "del",
  "las", "los", "que", "como", "una", "unos", "este", "esta", "estos", "estas", "foto",
  "image", "photo", "photograph", "picture", "file", "commons", "wikipedia",
]);

function cleanHtml(value = "") {
  return String(value).replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function commercialLicense(value = "") {
  const normalized = cleanHtml(value).toLowerCase().replace(/\s+/g, " ").trim();
  if (/\b(nc|non.?commercial)\b/.test(normalized)) return null;
  for (const [label, display] of COMMERCIAL_LICENSES) {
    if (normalized === label || normalized.startsWith(label + " ")) return display;
  }
  if (/^cc by-sa-nd(?:\s|$)/i.test(normalized)) return "CC BY-SA-ND";
  if (/^cc by-nd(?:\s|$)/i.test(normalized)) return "CC BY-ND";
  if (/^gfdl(?:\s|$)/i.test(normalized)) return "GFDL";
  return null;
}

function terms(value) {
  return cleanHtml(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

function relevance(queryTerms, page, metadata) {
  if (!queryTerms.length) return 0;
  const content = new Set(terms([
    page.title,
    metadata.ImageDescription?.value,
    metadata.ObjectName?.value,
    metadata.Categories?.value,
    metadata.Subject?.value,
  ].join(" ")));
  const matches = queryTerms.filter((term) => content.has(term)).length;
  const minimum = queryTerms.length <= 2 ? 1 : Math.min(3, Math.max(1, Math.ceil(queryTerms.length * 0.25)));
  return matches >= minimum ? matches / queryTerms.length : 0;
}

function isPhotoFile(page, info) {
  if (!info?.thumburl) return false;
  if (/\.(?:djvu|pdf|svg|xcf|psd)$/i.test(page.title || "")) return false;
  if (info.mime && !/^image\/(?:jpeg|png|webp|tiff|gif)$/i.test(info.mime)) return false;
  return true;
}

export async function findCommercialPhoto(query) {
  const queryTerms = [...new Set(terms(query))];
  if (!queryTerms.length) return null;

  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6",
    gsrlimit: "40",
    prop: "imageinfo",
    iiprop: "url|extmetadata|mime",
    iiurlwidth: "1400",
    format: "json",
    origin: "*",
  });
  const response = await fetch(url, { headers: { "user-agent": "EditorialWeb/0.2 (image rights and relevance lookup)" } });
  if (!response.ok) throw new Error(`Wikimedia Commons returned ${response.status}`);
  const payload = await response.json();
  const pages = Object.values(payload.query?.pages ?? {});
  let best = null;
  let bestScore = 0;

  for (const page of pages) {
    const info = page.imageinfo?.[0];
    const metadata = info?.extmetadata ?? {};
    const license = commercialLicense(metadata.LicenseShortName?.value ?? metadata.License?.value ?? "");
    if (!isPhotoFile(page, info) || !license) continue;
    const score = relevance(queryTerms, page, metadata);
    if (score <= bestScore) continue;

    const artist = cleanHtml(metadata.Artist?.value ?? "Wikimedia Commons contributor");
    const credit = [artist, page.title, license, info.descriptionurl].filter(Boolean).join(" — ");
    best = { url: info.thumburl, sourceUrl: info.descriptionurl, license, credit };
    bestScore = score;
  }
  return best;
}
