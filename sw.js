// Service worker mínimo: existe para o Chrome permitir "Instalar app".
// Não guarda nada em cache, para que cada versão publicada apareça na hora.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
// Só a abertura da página passa por aqui, sempre buscando da internet
self.addEventListener('fetch', e => {
  if (e.request.mode === 'navigate') e.respondWith(fetch(e.request));
});
