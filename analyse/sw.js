// Service Worker: Push-Benachrichtigungen der Immo-Analyse
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Immo-Analyse", {
    body: d.body || "", icon: "icon-192.png", badge: "icon-192.png", data: { url: d.url || "/" }, tag: d.url || "immo",
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const ziel = new URL(e.notification.data?.url || "/", self.location.origin).href;
  e.waitUntil((async () => {
    const fenster = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const f of fenster) { if ("focus" in f) { await f.navigate(ziel).catch(() => {}); return f.focus(); } }
    return self.clients.openWindow(ziel);
  })());
});
