/* Service worker do sistema Ecco Prime: só notificações push.
   De propósito NÃO intercepta requisições nem guarda páginas: o sistema
   continua sempre buscando tudo do servidor. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Ecco Prime", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag || undefined,
      data: { url: typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/avisos" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/avisos", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Já há uma janela do sistema aberta: leva ela ao destino e traz para a frente.
      for (const client of windows) {
        if ("navigate" in client && "focus" in client) {
          await client.navigate(url).catch(() => null);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
