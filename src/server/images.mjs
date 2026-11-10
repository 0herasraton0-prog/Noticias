const COMMERCIAL_LICENSES = new Map([
  ["cc0", "CC0"],
  ["public domain", "Public domain"],
  ["pd", "Public domain"],
  ["cc by 4.0", "CC BY 4.0"],
  ["cc by 3.0", "CC BY 3.0"],
  ["cc by 2.0", "CC BY 2.0"],
  ["cc by 1.0", "CC BY 1.0"],
  ["cc by-sa 4.0", "CC BY-SA 4.0"],
  ["cc by-sa 3.0", "CC BY-SA 3.0"],
  ["cc by-sa 2.0", "CC BY-SA 2.0"],
  ["cc by-sa 1.0", "CC BY-SA 1.0"],
  ["cc by 4.0 international", "CC BY 4.0"],
  ["cc by-sa 4.0 international", "CC BY-SA 4.0"],
]);

function cleanHtml(value = "") {
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function commercialLicense(value = "") {
  const normalized = cleanHtml(value).toLowerCase().replace(/\s+/g, " ").trim();
  if (/\b(nc|non.?commercial)\b/.test(normalized)) return null;
  for (const [label, display] of COMMERCIAL_LICENSES) {
    if (normalized === label || normalized.startsWith(label + " ")) return display;
  }
  if (/^cc by-sa-nd(?:\s|$)/i.test(normalized)) return "CC BY-SA-ND";
  if (/^cc by-nd(?:\s|$)/i.test(normalized)) return "CC BY-ND";
  return null;
}

export async function findCommercialPhoto(query) {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6",
    gsrlimit: "30",
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: "1000",
    format: "json",
    origin: "*",
  });
  const response = await fetch(url, { headers: { "user-agent": "EditorialWeb/0.1 (image-rights metadata lookup)" } });
  if (!response.ok) throw new Error(`Wikimedia Commons returned ${response.status}`);
  const payload = await response.json();
  const pages = Object.values(payload.query?.pages ?? {});
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    const meta = info?.extmetadata ?? {};
    const license = commercialLicense(meta.LicenseShortName?.value ?? meta.License?.value ?? "");
    if (!info?.thumburl || !license) continue;
    const artist = cleanHtml(meta.Artist?.value ?? "Wikimedia Commons contributor");
    const attribution = cleanHtml(meta.AttributionRequired?.value ?? "");
    const credit = [artist, page.title, license, info.descriptionurl].filter(Boolean).join(" — ");
    return { url: info.thumburl, sourceUrl: info.descriptionurl, license, credit: attribution || credit };
  }
  return null;
}
