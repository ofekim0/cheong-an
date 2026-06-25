'use client';

import { useCallback, useEffect, useState } from 'react';

import { urlBase64ToUint8Array } from '@/lib/push/urlBase64ToUint8Array';

const SERVICE_WORKER_URL = '/sw.js';

/**
 * 현재 브라우저가 웹 푸시에 필요한 API를 모두 지원하는지 확인한다.
 * SSR 환경(window 부재)에서도 안전하게 false를 반환한다.
 */
function detectSupport(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export interface UsePushSubscriptionResult {
  /** 브라우저가 웹 푸시를 지원하는지 여부 */
  isSupported: boolean;
  /** 현재 알림 권한 상태. 미지원/SSR 시 null */
  permission: NotificationPermission | null;
  /** 활성 푸시 구독. 없으면 null */
  subscription: PushSubscription | null;
  /** subscribe() 진행 중 여부 */
  isSubscribing: boolean;
  /** 마지막 subscribe() 실패 원인. 성공 시 null */
  error: Error | null;
  /**
   * Service Worker 등록 → 알림 권한 요청 → 푸시 구독을 수행하고
   * 생성된 PushSubscription을 반환한다. 실패 시 null.
   * (구독을 서버에 저장하는 것은 별도 단계의 책임이다.)
   */
  subscribe: () => Promise<PushSubscription | null>;
}

/**
 * 웹 푸시 구독 생성을 담당하는 클라이언트 훅.
 *
 * 마운트 시 지원 여부·권한·기존 구독을 복원하고,
 * subscribe()로 신규 구독을 생성한다. 서버 저장(persist)은
 * 호출 측 또는 후속 단계(9-b)에서 반환된 subscription으로 처리한다.
 */
export function usePushSubscription(): UsePushSubscriptionResult {
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | null>(
    null,
  );
  const [subscription, setSubscription] = useState<PushSubscription | null>(
    null,
  );
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const supported = detectSupport();
    setIsSupported(supported);
    if (!supported) return;

    setPermission(Notification.permission);

    // 이미 활성 구독이 있으면 복원한다. 실패는 치명적이지 않다.
    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((existing) => {
        if (existing) setSubscription(existing);
      })
      .catch(() => {
        // 복원 실패 시 subscribe()로 재시도 가능하므로 무시한다.
      });
  }, []);

  const subscribe = useCallback(async (): Promise<PushSubscription | null> => {
    if (!detectSupport()) {
      setError(new Error('이 브라우저는 웹 푸시를 지원하지 않습니다.'));
      return null;
    }

    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidPublicKey) {
      setError(
        new Error('NEXT_PUBLIC_VAPID_PUBLIC_KEY가 설정되지 않았습니다.'),
      );
      return null;
    }

    setIsSubscribing(true);
    setError(null);

    try {
      const registration =
        await navigator.serviceWorker.register(SERVICE_WORKER_URL);
      await navigator.serviceWorker.ready;

      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') {
        throw new Error('알림 권한이 거부되었습니다.');
      }

      const existing = await registration.pushManager.getSubscription();
      const next =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        }));

      setSubscription(next);
      return next;
    } catch (err) {
      const normalized = err instanceof Error ? err : new Error(String(err));
      setError(normalized);
      return null;
    } finally {
      setIsSubscribing(false);
    }
  }, []);

  return {
    isSupported,
    permission,
    subscription,
    isSubscribing,
    error,
    subscribe,
  };
}
