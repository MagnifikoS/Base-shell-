/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PUSH NOTIFICATION SERVICE WORKER — Isolated (does NOT interfere with any
 * existing service workers). Scope: /sw-push-scope/
 * ═══════════════════════════════════════════════════════════════════════════
 */

/* eslint-disable no-restricted-globals */

// Listen for push events
self.addEventListener("push", (event) => {
  let data = { title: "Notification", body: "", url: "/" };

  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    // If not JSON, use text as body
    data.body = event.data ? event.data.text() : "";
  }

  const options = {
    body: data.body || "",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    data: { url: data.url || "/" },
    vibrate: [200, 100, 200],
    // NO tag/renotify: each notification stays in iOS Notification Center
    // Using unique tag would cause collapse; omitting preserves history
  };

  event.waitUntil(
    self.registration.showNotification(data.title || "Notification", options)
  );
});

// Handle notification click — open the URL
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // If a window is already open, focus it and navigate
        for (const client of clientList) {
          if ("focus" in client) {
            client.focus();
            client.navigate(url);
            return;
          }
        }
        // Otherwise open a new window
        return self.clients.openWindow(url);
      })
  );
});
