function isCommercialLicense(value = "") {
  const license = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (/\b(nc|non.?commercial)\b/.test(license)) return false;
  return /^(cc0|public domain|public-domain|cc by(?:-sa|-nd)?(?:\s|$)|cc by-sa-nd(?:\s|$))/i.test(license);
}

function cleanHtml(value = "") {
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

export async function findCommercialPhoto(query) {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: `${query} filetype:bitmap` ,
    gsrnamespace: "6",
    gsrlimit: "6",
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
    const license = cleanHtml(meta.LicenseShortName?.value ?? "");
    if (!info?.thumburl || !isCommercialLicense(license)) continue;
    const artist = cleanHtml(meta.Artist?.value ?? "Wikimedia Commons contributor");
    const attribution = cleanHtml(meta.AttributionRequired?.value ?? "");
    const credit = [artist, page.title, license, info.descriptionurl].filter(Boolean).join(" — ");
    return {
      url: info.thumburl,
      sourceUrl: info.descriptionurl,
      license,
      credit: attribution || credit,
    };
  }
  return null;
}
