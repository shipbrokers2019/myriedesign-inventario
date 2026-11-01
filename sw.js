/* Service worker: permite instalar la app y abrirla rápido.
   Archivos propios: primero internet (siempre la versión nueva); si falla, reintenta una vez
   y luego usa la copia guardada. Solo las páginas (no los scripts) caen en index.html.
   Los datos y las fotos de Supabase nunca se guardan aquí: siempre vienen en vivo. */
const CACHE = "myriedesign-v2";
const SHELL = ["./", "index.html", "styles.css", "app.js", "config.js", "vendor/supabase.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function fromNetwork(req) {
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(req, { cache: "no-cache" });
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; }
      if (res.status < 500) return res;           // 404 y similares: no reintentar
    } catch (e) {}
    await new Promise(r => setTimeout(r, 600));    // fallo de red o 5xx: un reintento
  }
  return null;
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const res = await fromNetwork(req);
    if (res) return res;
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    if (req.mode === "navigate") return (await caches.match("index.html")) || Response.error();
    return Response.error();
  })());
});
