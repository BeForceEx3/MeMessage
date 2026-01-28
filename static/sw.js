// Service Worker для Dark Chat
const CACHE_NAME = 'dark-chat-v10';
const STATIC_CACHE = 'dark-chat-static-v10';
const DYNAMIC_CACHE = 'dark-chat-dynamic-v10';

// Статические ресурсы для кэширования
const STATIC_ASSETS = [
  '/',
  '/static/style.css',
  '/static/script.js',
  '/static/performance.js',
  '/static/manifest.json'
];

// Устанавливаем Service Worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('Кэшируем статические ресурсы');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Активация
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== STATIC_CACHE && cacheName !== DYNAMIC_CACHE) {
            console.log('Удаляем старый кэш:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Стратегия кэширования: сначала сеть, потом кэш
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Для API запросов не используем кэш
  if (url.pathname.startsWith('/api/') || 
      url.pathname.startsWith('/poll') ||
      url.pathname.startsWith('/online') ||
      url.pathname.startsWith('/send') ||
      url.pathname.startsWith('/voice') ||
      url.pathname.startsWith('/video') ||
      url.pathname.startsWith('/media')) {
    return fetch(event.request);
  }
  
  // Для статических ресурсов используем кэш
  if (url.pathname.startsWith('/static/')) {
    event.respondWith(
      caches.match(event.request).then(response => {
        return response || fetch(event.request).then(fetchResponse => {
          return caches.open(DYNAMIC_CACHE).then(cache => {
            cache.put(event.request.url, fetchResponse.clone());
            return fetchResponse;
          });
        });
      })
    );
  } else {
    // Для остальных запросов пробуем сеть, потом кэш
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Клонируем ответ для кэширования
          const responseClone = response.clone();
          caches.open(DYNAMIC_CACHE).then(cache => {
            cache.put(event.request, responseClone);
          });
          return response;
        })
        .catch(() => {
          return caches.match(event.request);
        })
    );
  }
});

// Фоновая синхронизация
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-messages') {
    event.waitUntil(syncMessages());
  }
});

// Периодическая синхронизация
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'update-messages') {
    event.waitUntil(updateMessages());
  }
});

async function syncMessages() {
  console.log('Фоновая синхронизация сообщений');
  // Здесь можно добавить логику синхронизации
}

async function updateMessages() {
  console.log('Периодическое обновление сообщений');
  // Здесь можно добавить логику периодического обновления
}

// Обработка push уведомлений
self.addEventListener('push', (event) => {
  const options = {
    body: event.data ? event.data.text() : 'Новое сообщение в чате',
    icon: '/static/icon-192.png',
    badge: '/static/icon-96.png',
    vibrate: [200, 100, 200],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    },
    actions: [
      {
        action: 'open',
        title: 'Открыть чат'
      },
      {
        action: 'close',
        title: 'Закрыть'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification('Dark Chat', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'open') {
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});
