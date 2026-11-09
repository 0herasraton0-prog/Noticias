document.querySelector("[data-share]")?.addEventListener("click", async () => {
  const payload = { title: document.title, url: window.location.href };
  if (navigator.share) await navigator.share(payload);
  else if (navigator.clipboard) {
    await navigator.clipboard.writeText(payload.url);
    document.querySelector("[data-share]").textContent = "Enlace copiado";
  }
});
document.querySelector("#cookie-settings")?.addEventListener("click", () => {
  window.dispatchEvent(new CustomEvent("open-cookie-preferences"));
});

const slug = decodeURIComponent(window.location.pathname.split("/").filter(Boolean).pop() || "");
const startedAt = Date.now();
if (slug) {
  const viewPayload = JSON.stringify({ slug, view: true });
  if (navigator.sendBeacon) navigator.sendBeacon("/api/engagement", new Blob([viewPayload], { type: "application/json" }));
  else fetch("/api/engagement", { method: "POST", headers: { "content-type": "application/json" }, body: viewPayload, keepalive: true }).catch(() => {});
}
function recordEngagement(nextArticleClick = false) {
  if (!slug) return;
  const engagedSeconds = Math.floor(Math.min(1800, Math.max(0, Date.now() - startedAt) / 1000));
  const payload = JSON.stringify({ slug, engagedSeconds, nextArticleClick });
  if (navigator.sendBeacon) navigator.sendBeacon("/api/engagement", new Blob([payload], { type: "application/json" }));
  else fetch("/api/engagement", { method: "POST", headers: { "content-type": "application/json" }, body: payload, keepalive: true }).catch(() => {});
}
document.querySelectorAll('a[href^="/articulo/"]').forEach((link) => link.addEventListener("click", () => recordEngagement(true)));
window.addEventListener("pagehide", () => recordEngagement(false), { once: true });
