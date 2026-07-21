/* Availo service worker — handles Web Push notifications.
   Kept deliberately tiny: it shows the notification the backend sends and, on
   click, focuses an existing Availo tab (or opens one) at the deep-link URL. */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Availo", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Availo — earlier slot found";
  const options = {
    body: data.body || "An earlier driving test just appeared. Open Availo to grab it.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: "availo-slot",
    renotify: true,
    requireInteraction: true,
    data: { url: data.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(targetUrl).catch(() => {});
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
      return undefined;
    }),
  );
});
