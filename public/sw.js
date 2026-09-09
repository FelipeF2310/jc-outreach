/* Only a generic, resident-free shell and same-origin immutable assets are cached. */
const CACHE = "jco-shell-v1";
async function prepare() {
  const response = await fetch("/field", { cache: "reload" });
  if (!response.ok) throw new Error("Shell unavailable");
  const html = await response.clone().text();
  const paths = [
    ...new Set(
      [...html.matchAll(/(?:src|href)="([^"<>]+)"/g)]
        .map((match) => match[1].replaceAll("&amp;", "&"))
        .filter(
          (path) =>
            path.startsWith("/_next/static/") &&
            /\.(?:js|css)(?:\?|$)/.test(path),
        ),
    ),
  ];
  if (!paths.some((path) => path.includes(".js")))
    throw new Error("Shell scripts missing");
  const cache = await caches.open(CACHE);
  await cache.addAll(paths);
  await cache.put("/field", response);
}
self.addEventListener("install", (event) => event.waitUntil(prepare()));
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("message", (event) => {
  if (event.data?.type === "PREPARE_OFFLINE") {
    event.waitUntil(
      prepare()
        .then(() => event.ports[0]?.postMessage({ ready: true }))
        .catch(() => event.ports[0]?.postMessage({ ready: false })),
    );
  }
});
self.addEventListener("fetch", (event) => {
  const request = event.request,
    url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate" && url.pathname === "/field") {
    // Cache-first keeps shell/chunks at one known working version during a walk.
    event.respondWith(
      caches
        .open(CACHE)
        .then(async (cache) => (await cache.match("/field")) || fetch(request)),
    );
  } else if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      }),
    );
  }
  // Never intercept or cache assignment, operation, or administrator endpoints.
});
