// Offline support: app shell is cached on install; map tiles and fonts are cached as you view them.
const VERSION = "111195a674";
const SHELL = "shell-" + VERSION;
const RUNTIME = "runtime-v1";
const TILES = "tiles-v1";
const MAX_TILES = 3000;
const SHELL_FILES = [
  "./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./icon-180.png", "./icon-192.png", "./icon-512.png",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => Promise.all(SHELL_FILES.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("shell-") && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trimTiles() {
  const c = await caches.open(TILES);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Page: network first so updates arrive, cached copy when offline
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(SHELL).then(c => c.put("./index.html", copy)); return r; })
      .catch(() => caches.match("./index.html").then(r => r || caches.match("./"))));
    return;
  }
  // Map tiles: cache first, store every tile you look at
  if (url.hostname === "tile.openstreetmap.org") {
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      try { const r = await fetch(req); if (r.ok || r.type === "opaque") { c.put(req, r.clone()); trimTiles(); } return r; }
      catch (err) { return new Response("", { status: 504 }); }
    }));
    return;
  }
  // Fonts, Leaflet, icons: stale-while-revalidate
  if (url.hostname.includes("fonts.g") || url.hostname === "cdnjs.cloudflare.com" || url.origin === location.origin) {
    e.respondWith(caches.match(req).then(hit => {
      const net = fetch(req).then(r => { if (r.ok || r.type === "opaque") caches.open(RUNTIME).then(c => c.put(req, r.clone())); return r; }).catch(() => hit);
      return hit || net;
    }));
  }
});

// Push reminders
self.addEventListener("push", e => {
  let d = {}; try { d = e.data.json(); } catch (err) { d = { title: "Trip reminder", body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Trip reminder", { body: d.body || "", tag: d.tag, icon: "icon-192.png", badge: "icon-192.png", data: { url: d.url || "./" } }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) { if ("focus" in c) { c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
