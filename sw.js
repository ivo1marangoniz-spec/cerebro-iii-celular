// Service worker: guarda os arquivos do app no celular para ele abrir SEM internet.
// As ideias não passam por aqui (ficam no IndexedDB). Ao mudar qualquer arquivo do app, aumente VERSAO.
const VERSAO = 'cerebro-iii-v4';
const ARQUIVOS = [
  './',
  './index.html',
  './estilo.css',
  './app.js',
  './armazenamento.js',
  './manifest.webmanifest',
  './icones/icone-180.png',
  './icones/icone-192.png',
  './icones/icone-512.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' busca no servidor, nunca na memória do navegador (senão uma versão nova
  // poderia guardar arquivos antigos, já que o GitHub Pages deixa arquivos em cache por 10 minutos).
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const nome of await caches.keys()) if (nome !== VERSAO) await caches.delete(nome);
    await self.clients.claim();
  })());
});

// Nova versão só entra quando o usuário toca em "Atualizar" (nunca no meio de uma digitação).
self.addEventListener('message', (e) => { if (e.data === 'ativar') self.skipWaiting(); });

// Primeiro o que está guardado no celular; se não tiver, busca na internet.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const guardado = await caches.match(req, { ignoreSearch: true });
    if (guardado) return guardado;
    try {
      return await fetch(req);
    } catch (err) {
      if (req.mode === 'navigate') return (await caches.match('./index.html')) || Response.error();
      throw err;
    }
  })());
});
