// Service Worker minimal Jolyne — sert uniquement à recevoir les Web
// Push notifications. Pas de cache offline pour l'instant (PWA shell à
// venir). Le payload est un JSON envoyé par le backend :
//   { title, body, icon?, url, friend_id, tag? }

self.addEventListener("install", (event) => {
  // Active immédiatement, pas besoin d'attendre la fermeture d'onglet.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    data = { title: "Jolyne", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Jolyne";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icon1.png",
    badge: "/icon1.png",
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetURL = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Si une fenêtre Jolyne est déjà ouverte, on la focus et on navigue.
      for (const client of clients) {
        if ("focus" in client) {
          client.focus();
          if ("navigate" in client) {
            return client.navigate(targetURL);
          }
        }
      }
      // Sinon, on ouvre une nouvelle fenêtre.
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetURL);
      }
    }),
  );
});
