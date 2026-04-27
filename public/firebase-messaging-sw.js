/* eslint-disable no-restricted-globals */
/* Firebase Cloud Messaging — background handler. Must live in public/ so it is served at /firebase-messaging-sw.js */
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyBQA9bc25_7ncjvY75nAtIUv47C3w5jl6c',
  authDomain: 'hrx1-d3beb.firebaseapp.com',
  projectId: 'hrx1-d3beb',
  storageBucket: 'hrx1-d3beb.firebasestorage.app',
  messagingSenderId: '143752240496',
  appId: '1:143752240496:web:e0b584983d4b04cb3983b5',
});

var messaging = firebase.messaging();

messaging.onBackgroundMessage(function (payload) {
  var title = payload.notification && payload.notification.title ? payload.notification.title : 'HRX Notification';
  var options = {
    body: payload.notification && payload.notification.body ? payload.notification.body : '',
    data: payload.data || {},
  };
  return self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var data = event.notification.data || {};
  var deepLink = data.deepLink || data.ctaUrl;
  if (deepLink) {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
        for (var i = 0; i < clientList.length; i++) {
          var client = clientList[i];
          if ('focus' in client) {
            client.navigate(deepLink);
            return client.focus();
          }
        }
        if (clients.openWindow) return clients.openWindow(deepLink);
      })
    );
  }
});
