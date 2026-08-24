const CACHE='reader-v27';
const CORE=['./','./index.html','./styles.css?v=27','./app.js?v=27','./manifest.webmanifest','./icon.svg?v=27','./favicon-32.png?v=27','./apple-touch-icon.png?v=27','./icon-192.png?v=27','./icon-512.png?v=27'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE&&k!=='reader-images-v1').map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(fetch(e.request).then(r=>{if(e.request.url.startsWith(location.origin)){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy))}return r}).catch(async()=>{const img=await caches.open('reader-images-v1').then(c=>c.match(e.request));if(img)return img;return caches.match(e.request).then(r=>r||caches.match('./index.html'))}))});
