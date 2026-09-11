/* S-2000 Project Cost Control service worker
   - cache shell และไฟล์ static แบบ stale-while-revalidate
   - หน้า HTML ใช้ network-first ถ้าออฟไลน์ตอบจาก cache หรือหน้า /offline
   - การส่งฟอร์ม offline จัดการใน IndexedDB ฝั่งแอป (src/lib/offline/queue.ts) */
const VERSION = 'v1'
const SHELL_CACHE = `s2000-shell-${VERSION}`
const RUNTIME_CACHE = `s2000-runtime-${VERSION}`
const OFFLINE_URL = '/offline'

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll([OFFLINE_URL, '/manifest.webmanifest', '/icon-192.png', '/icon-512.png']))
  )
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => ![SHELL_CACHE, RUNTIME_CACHE].includes(k)).map(k => caches.delete(k))))
  )
  self.clients.claim()
})

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(res => {
          const copy = res.clone()
          caches.open(RUNTIME_CACHE).then(cache => cache.put(request, copy))
          return res
        })
        .catch(async () => (await caches.match(request)) || (await caches.match(OFFLINE_URL)))
    )
    return
  }

  if (url.pathname.startsWith('/_next/static/') || /\.(png|svg|ico|woff2?|css|js)$/.test(url.pathname)) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async cache => {
        const cached = await cache.match(request)
        const network = fetch(request)
          .then(res => {
            cache.put(request, res.clone())
            return res
          })
          .catch(() => cached)
        return cached || network
      })
    )
  }
})
