self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
// Kein fetch handler => kein Caching, keine “toten Klicks”
