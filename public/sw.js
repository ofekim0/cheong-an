/**
 * 청안 웹 푸시 Service Worker
 *
 * - push 이벤트: 서버가 보낸 페이로드(JSON)를 받아 알림으로 표시한다.
 * - notificationclick 이벤트: 알림을 클릭하면 해당 공고(또는 기본 경로)로 이동한다.
 *
 * 이 파일은 번들러를 거치지 않고 정적 자산으로 그대로 서빙되므로
 * import/모듈 문법 없이 순수 self 스코프 API만 사용한다.
 */

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: '청안 알림', body: event.data.text() };
  }

  const { title = '청안 — 새 공고', body = '', url = '/', tag } = payload ?? {};

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl =
    (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url === targetUrl && 'focus' in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      }),
  );
});
