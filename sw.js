// Copyright (c) 2026 Mahesh Reddy. All rights reserved. Proprietary — see LICENSE.
// BTBU v27 service worker — app shell cache-first, everything else network.
const CACHE = "btbu-v27.1";
const SHELL = ["./", "index.html", "styles.css?v=27.1", "sync.js?v=27.1", "community.js?v=27.1", "app.js?v=27.1", "manifest.json", "icon-180.png", "icon-192.png", "icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;            // Supabase + Google stay network-only
  if (url.pathname.endsWith("/config.js")) return;      // per-deploy config: never serve stale
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match("index.html"))));
});

// Reminders (dormant until the Supabase function is deployed — see README).
self.addEventListener("push", e => {
  const d = e.data ? e.data.json() : {};
  e.waitUntil(self.registration.showNotification(d.title || "BTBU", {
    body: d.body || "Your habits are waiting.", icon: "icon-192.png", badge: "icon-192.png", tag: "btbu-daily"
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then(list =>
    list.length ? list[0].focus() : self.clients.openWindow("./")));
});
