// network-first for navigation, cache-first for hashed build assets
const CACHE = "cooltools-v2";

function buildAssets(html) {
  const assets = new Set();
  const tags = html.match(/<(?:script|link)\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const isScript = /^<script\b/i.test(tag);
    const isStylesheet =
      /^<link\b/i.test(tag) && /\brel=["'][^"']*\bstylesheet\b[^"']*["']/i.test(tag);
    if (!isScript && !isStylesheet) continue;
    const attr = isScript ? "src" : "href";
    const match = tag.match(new RegExp(`\\b${attr}=["']([^"']+)["']`, "i"));
    if (!match) continue;
    const url = new URL(match[1], self.location.origin);
    if (url.origin === self.location.origin && url.pathname.startsWith("/assets/")) {
      assets.add(url.pathname + url.search);
    }
  }
  return [...assets];
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    (async () => {
      const shell = await fetch("/", { cache: "reload" });
      if (!shell.ok) throw new Error(`shell fetch failed: ${shell.status}`);
      const html = await shell.clone().text();
      const cache = await caches.open(CACHE);
      await cache.put("/", shell);
      await Promise.all(
        buildAssets(html).map(async (path) => {
          const response = await fetch(path, { cache: "reload" });
          if (!response.ok) throw new Error(`asset fetch failed: ${response.status}`);
          await cache.put(path, response);
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("cooltools-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  if (e.request.mode === "navigate") {
    e.respondWith(
      (async () => {
        try {
          const response = await fetch(e.request);
          if (response.ok) {
            const cache = await caches.open(CACHE);
            await cache.put("/", response.clone());
          }
          return response;
        } catch {
          return (await caches.match("/")) || Response.error();
        }
      })(),
    );
    return;
  }

  e.respondWith(
    (async () => {
      const hit = await caches.match(
        e.request,
        url.pathname.startsWith("/assets/") ? { ignoreVary: true } : undefined,
      );
      if (hit) return hit;
      const response = await fetch(e.request);
      if (response.ok && url.pathname.startsWith("/assets/")) {
        const cache = await caches.open(CACHE);
        await cache.put(e.request, response.clone());
      }
      return response;
    })(),
  );
});
