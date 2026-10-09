// Service worker de nettoyage. L'ancienne version 1 de Tsundoku, publiée à cette adresse, avait enregistré un
// service worker qui garde l'ancien site en cache : sans lui, ses visiteurs resteraient bloqués sur la V1.
// Il supprime le cache de la V1 (et seulement lui : ni les données de l'utilisateur, ni la nouvelle application)
// puis se désinscrit. Les données saisies dans la V1 (« tsundoku-data » du navigateur) ne sont pas touchées.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    await caches.delete("tsundoku-v2");
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: "window" });
    // La nouvelle application (/app/) a son propre service worker : on ne la recharge pas.
    for (const client of clients) if (!new URL(client.url).pathname.includes("/app/")) client.navigate(client.url);
  })());
});
