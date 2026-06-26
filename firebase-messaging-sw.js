// Firebase Messaging Service Worker — Yalla Mart
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCbjKf6aTvIFqyvxzCn7QlkU14azRviaRM",
  authDomain: "toko-kita-d6267.firebaseapp.com",
  projectId: "toko-kita-d6267",
  storageBucket: "toko-kita-d6267.firebasestorage.app",
  messagingSenderId: "753019750559",
  appId: "1:753019750559:web:65435712e7d563b0b87aaa"
});

const messaging = firebase.messaging();

// Tangkap notifikasi saat app di background / tertutup
messaging.onBackgroundMessage((payload) => {
  console.log('[FCM SW] Background message:', payload);

  const { title, body, image } = payload.notification || {};

  self.registration.showNotification(title || 'Yalla Mart', {
    body: body || '',
    icon: image || 'https://res.cloudinary.com/dsy4hjc7a/image/upload/w_192,h_192,c_fill,f_png/v1777071286/file_00000000061071f4a2bf027d7ff5df98_gaknb3.png',
    image: image || null,
    badge: 'https://res.cloudinary.com/dsy4hjc7a/image/upload/w_96,h_96,c_fill,f_png/v1777071286/file_00000000061071f4a2bf027d7ff5df98_gaknb3.png',
    data: payload.data || {},
    vibrate: [200, 100, 200],
    requireInteraction: false,
  });
});

// Klik notifikasi → buka app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
