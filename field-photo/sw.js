'use strict';

// 앱 화면 파일을 휴대폰에 저장해 두어 인터넷이 약한 현장에서도 열리게 해요.
// 앱 파일을 고치면 아래 버전 숫자를 올려 주세요. 그래야 휴대폰이 새 파일을 받아요.
const CACHE = 'field-photo-app-v1';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith('field-photo-app-') && key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

// 인터넷이 되면 새 파일을 받고, 안 되면 저장해 둔 파일로 열어요.
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(request)
    .then(response => {
      if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(request, copy)); }
      return response;
    })
    .catch(() => caches.match(request, { ignoreSearch:true }).then(hit => hit || (request.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
