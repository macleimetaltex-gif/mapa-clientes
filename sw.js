// Service worker do Mapa de Clientes: faz o app abrir sem internet (desde 08/10/2026).
// Guarda no aparelho uma cópia da página, das bibliotecas e das partes do mapa já vistas.
// - Página: sempre tenta a internet primeiro (cada versão publicada aparece na hora); sem sinal,
//   ou se a rede demorar mais de 4 s, entrega a cópia guardada.
// - Bibliotecas e fontes (endereços com versão, nunca mudam): cópia guardada primeiro.
// - Mapa (OpenFreeMap): as partes já vistas ficam guardadas, até MAX_MAPA arquivos.
// - Nuvem (Supabase), rotas (OSRM), endereços (Nominatim) e satélite: nunca passam por aqui.
// Para descartar todas as cópias numa mudança grande, troque o número de VERSAO.
const VERSAO = 'v1';
const C_APP = 'mapa-app-' + VERSAO, C_LIBS = 'mapa-libs-' + VERSAO, C_MAPA = 'mapa-mapa-' + VERSAO;
const MAX_MAPA = 1500;
const ESPERA_REDE = 4000;

const LOCAIS = ['manifest.webmanifest', 'icone-192.png', 'icone-512.png', 'icone-180.png', 'icone-maskable-512.png'];
const LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.js',
  'https://cdn.jsdelivr.net/npm/@maplibre/maplibre-gl-leaflet@0.1.4/leaflet-maplibre-gl.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js'
];
const HOSTS_LIBS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const HOST_MAPA = 'tiles.openfreemap.org';

const pagina = () => self.registration.scope; // endereço do app, sem ?parametros
const cors = url => fetch(url, {mode:'cors', credentials:'omit'});

// Ao instalar: já baixa a página, os ícones e as bibliotecas, para a próxima abertura funcionar sem sinal
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil((async () => {
    const app = await caches.open(C_APP), libs = await caches.open(C_LIBS);
    await Promise.allSettled([
      fetch(pagina(), {cache:'no-cache'}).then(r => r.ok && app.put(pagina(), r)),
      ...LOCAIS.map(u => fetch(u, {cache:'no-cache'}).then(r => r.ok && app.put(new URL(u, pagina()).href, r))),
      ...LIBS.map(u => cors(u).then(r => r.ok && libs.put(u, r)))
    ]);
  })());
});

// Ao ativar: apaga cópias de versões antigas deste arquivo
self.addEventListener('activate', e => e.waitUntil((async () => {
  const nomes = await caches.keys();
  await Promise.all(nomes.filter(n => n.startsWith('mapa-') && ![C_APP, C_LIBS, C_MAPA].includes(n)).map(n => caches.delete(n)));
  await self.clients.claim();
})()));

// Página: internet primeiro; cópia guardada sem sinal ou se a rede passar de ESPERA_REDE
async function daPagina(e){
  const cache = await caches.open(C_APP), guardada = await cache.match(pagina());
  const rede = fetch(pagina(), {cache:'no-cache'}).then(r => { if(r.ok) cache.put(pagina(), r.clone()); return r; });
  if(!guardada) return rede;
  e.waitUntil(rede.catch(() => {})); // mesmo perdendo a corrida, a versão nova fica guardada
  return Promise.race([rede.then(r => r.ok ? r : guardada).catch(() => guardada), new Promise(ok => setTimeout(() => ok(guardada), ESPERA_REDE))]);
}
// Cópia guardada primeiro; se não houver, busca e guarda
async function daCopia(url, nomeCache, depois){
  const cache = await caches.open(nomeCache), guardada = await cache.match(url);
  if(guardada) return guardada;
  const r = await cors(url);
  if(r.ok){ await cache.put(url, r.clone()); if(depois) depois(cache); }
  return r;
}
// Cópia guardada na hora, e atualiza por trás (o que muda de vez em quando)
async function copiaEAtualiza(e, url, nomeCache, buscar){
  const cache = await caches.open(nomeCache), guardada = await cache.match(url);
  const rede = buscar(url).then(r => { if(r.ok) cache.put(url, r.clone()); return r; });
  if(!guardada) return rede;
  e.waitUntil(rede.catch(() => {}));
  return guardada;
}
// Mapa: passou do limite, apaga os arquivos mais antigos (confere a cada 60 arquivos novos)
let novosNoMapa = 0;
async function apararMapa(cache){
  if(++novosNoMapa % 60) return;
  const chaves = await cache.keys();
  for(let i = 0; i < chaves.length - MAX_MAPA; i++) await cache.delete(chaves[i]);
}

self.addEventListener('fetch', e => {
  const req = e.request; if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(url.origin === self.location.origin){
    if(req.mode === 'navigate'){ e.respondWith(daPagina(e)); return; }
    if(url.pathname.endsWith('/sw.js')) return;
    e.respondWith(copiaEAtualiza(e, url.origin + url.pathname, C_APP, u => fetch(u, {cache:'no-cache'})));
    return;
  }
  if(HOSTS_LIBS.includes(url.hostname)){ e.respondWith(daCopia(req.url, C_LIBS)); return; }
  if(url.hostname === HOST_MAPA){
    // Estilo e índice do mapa mudam de vez em quando; as partes do mapa têm a versão no endereço
    const muda = url.pathname.startsWith('/styles/') || url.pathname === '/planet';
    e.respondWith(muda ? copiaEAtualiza(e, req.url, C_MAPA, cors) : daCopia(req.url, C_MAPA, apararMapa));
  }
});
