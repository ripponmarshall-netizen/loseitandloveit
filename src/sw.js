// Offline app. vite.config.js fills in the list of built files and a build
// stamp, so every deploy installs a fresh cache with the whole app in it.
const ASSETS = self.__ASSETS
const CACHE = `lili-${self.__BUILD}`
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/apple-touch-icon.png', ...ASSETS]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // One missing file must not stop the rest from being stored.
      .then((c) => Promise.all([...new Set(SHELL)].map((url) => c.add(url).catch(() => {}))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  // Only handle same-origin GETs. Supabase and API calls go straight to the network.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return

  // Pages: network first so deploys show up, cached copy when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Never let a 404/500 page replace the good offline copy.
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put('./index.html', copy))
          }
          return res
        })
        .catch(() => caches.match('./index.html', { ignoreVary: true })),
    )
    return
  }

  // Unhashed files (manifest, icons): network first so updates show, cache offline.
  if (!url.pathname.includes('/assets/')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy))
          }
          return res
        })
        .catch(() => caches.match(req, { ignoreVary: true })),
    )
    return
  }

  // Hashed build assets: the name changes with the content, so cache first.
  event.respondWith(
    caches.match(req, { ignoreVary: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy))
          }
          return res
        }),
    ),
  )
})
