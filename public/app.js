const themeButton = document.querySelector("#theme-toggle");
const savedTheme = localStorage.getItem("editorial-theme");
if (savedTheme === "dark") document.body.classList.add("dark");
themeButton?.addEventListener("click", () => {
  document.body.classList.toggle("dark");
  localStorage.setItem("editorial-theme", document.body.classList.contains("dark") ? "dark" : "light");
});

const search = document.querySelector("#search-input");
search?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && search.value.trim()) {
    window.location.href = `/buscar?q=${encodeURIComponent(search.value.trim())}`;
  }
});

document.querySelector("#cookie-settings")?.addEventListener("click", () => {
  window.dispatchEvent(new CustomEvent("open-cookie-preferences"));
});

const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

function card(article, index, extraClass = "") {
  const label = article.kind === "current" ? (article.region || "Actualidad") : (article.category || "Curiosidad");
  const visual = article.cover_url
    ? `<img src="${escapeHtml(article.cover_url)}" alt="" loading="lazy">`
    : `<div class="card-placeholder"><span>${escapeHtml(label)}</span></div>`;
  return `<article class="story-card ${extraClass}">
    <a href="/articulo/${encodeURIComponent(article.slug)}" class="story-image">${visual}</a>
    <div class="story-copy"><span class="story-label">${escapeHtml(label)}</span>
      <h3><a href="/articulo/${encodeURIComponent(article.slug)}">${escapeHtml(article.title)}</a></h3>
      <p>${escapeHtml(article.dek)}</p><div class="story-meta">${escapeHtml(article.published_at ? new Date(article.published_at).toLocaleDateString("es-ES", { day: "numeric", month: "short" }) : "")}${article.reading_minutes ? ` · ${article.reading_minutes} min de lectura` : ""}</div>
    </div>
  </article>`;
}

async function loadFeed() {
  try {
    const response = await fetch("/api/articles", { headers: { accept: "application/json" } });
    if (!response.ok) return;
    const { articles = [], featuredCuriosities = [] } = await response.json();
    const current = articles.filter((article) => article.kind === "current" && Date.now() - Date.parse(article.published_at) <= 3 * 86400000).slice(0, 3);
    const curiosities = featuredCuriosities.length ? featuredCuriosities : articles.filter((article) => article.kind === "curiosity").slice(0, 3);
    if (current.length) document.querySelector("#latest-list").innerHTML = current.map((article, index) => card(article, index, "current-card")).join("");
    if (curiosities.length) document.querySelector("#curiosity-list").innerHTML = curiosities.map((article, index) => card(article, index, "curiosity-card")).join("");
  } catch {
    // Keep the editorial shell visible if the database is not provisioned yet.
  }
}

loadFeed();

const popularList = document.querySelector("#mas-leido .empty-small");
if (popularList) fetch("/api/popular").then((response) => response.json()).then(({ articles = [] }) => {
  if (articles.length) popularList.innerHTML = articles.slice(0, 5).map((article, index) => `<div class="popular-item"><span>${String(index + 1).padStart(2, "0")}</span><a href="/articulo/${encodeURIComponent(article.slug)}">${escapeHtml(article.title)}</a></div>`).join("");
}).catch(() => {});

const legalPage = window.location.pathname.replace(/^\//, "").replace(/\/$/, "");
if (["privacidad", "cookies", "aviso-legal"].includes(legalPage)) {
  document.querySelector("main")?.setAttribute("hidden", "");
  document.querySelector(`[data-legal="${legalPage}"]`)?.removeAttribute("hidden");
}
if (new URLSearchParams(window.location.search).has("q") || window.location.pathname.startsWith("/categoria/")) {
  document.querySelector("main")?.setAttribute("hidden", "");
  document.querySelector(".results-shell")?.removeAttribute("hidden");
}
if (document.querySelector("[data-results]") && !document.querySelector(".results-shell")?.hidden) {
  const params = new URLSearchParams(window.location.search);
  const query = params.get("q") || "";
  const category = window.location.pathname.startsWith("/categoria/") ? decodeURIComponent(window.location.pathname.split("/categoria/")[1] || "") : "";
  const title = document.querySelector("[data-results-title]");
  const list = document.querySelector("[data-results]");
  if (title) title.textContent = query ? `Resultados para «${query}»` : category || "Explorar artículos";
  const endpoint = category ? `/api/category/${encodeURIComponent(category)}` : `/api/search?q=${encodeURIComponent(query)}`;
  fetch(endpoint).then((response) => response.json()).then(({ articles = [] }) => {
    list.innerHTML = articles.length ? articles.map((article, index) => card(article, index, "current-card")).join("") : `<div class="empty-state"><strong>No encontramos artículos</strong><p>Prueba con otras palabras o explora una categoría.</p></div>`;
  }).catch(() => { list.innerHTML = `<p>No se pudieron cargar los artículos.</p>`; });
}
