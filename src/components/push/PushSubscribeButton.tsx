'use client';

import { useEffect, useRef, useState } from 'react';

import { usePushSubscription } from '@/hooks/usePushSubscription';
import {
  disablePushSubscription,
  persistPushSubscription,
} from '@/lib/push/persistPushSubscription';

interface PushSubscribeButtonProps {
  /** 서버에서 조회한 계정 구독 상태 (L1 enabled) */
  initialEnabled: boolean;
}

/**
 * 임시 검증용 구독 토글 (Step 9-a 구독 생성 + 9-b 저장/해제 연결).
 *
 * - 구독: 브라우저 채널 생성(subscribe) → 서버 저장 + 계정 구독 ON.
 * - 해제: 계정 구독 OFF만 — 어느 기기에서 끄든 전 기기가 꺼진다 (ADR 008).
 * - 계정 구독이 켜져 있어도 이 브라우저에 채널이 없으면(다른 기기에서 켠 경우)
 *   이 기기는 알림을 못 받으므로, 채널 등록 버튼을 따로 노출한다
 *   (푸시 권한은 브라우저별 개별 — 계정으로 자동 이전 불가).
 *
 * 본 디자인은 Sprint 2의 화면(구독/목록/상세)이 모두 잡힌 뒤 일괄 작업한다.
 */
export function PushSubscribeButton({
  initialEnabled,
}: PushSubscribeButtonProps) {
  const {
    isSupported,
    permission,
    subscription,
    isSubscribing,
    error,
    subscribe,
  } = usePushSubscription();

  const [enabled, setEnabled] = useState(initialEnabled);
  const [isPending, setIsPending] = useState(false);
  const [apiError, setApiError] = useState<Error | null>(null);

  // 재동기화(ADR 008): 계정 구독이 켜져 있고 이 브라우저에 채널이 있으면
  // 현재 계정의 (user, endpoint) row를 멱등 POST로 보장한다. 브라우저 채널은
  // 계정이 아니라 브라우저에 붙으므로, 채널 존재만으로는 "현재 계정이 이
  // 기기로 수신 가능"이 보장되지 않는다(공유 브라우저 + 다계정). 키 회전
  // 치유도 겸한다. 실패는 치명적이지 않아 무시한다 — 다음 방문·구독 액션에서
  // 재시도된다.
  const didSyncRef = useRef(false);
  useEffect(() => {
    if (didSyncRef.current || !enabled || !subscription) return;
    didSyncRef.current = true;
    persistPushSubscription(subscription).catch(() => {});
  }, [enabled, subscription]);

  const runApiAction = async (action: () => Promise<void>) => {
    setIsPending(true);
    setApiError(null);
    try {
      await action();
    } catch (err) {
      setApiError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsPending(false);
    }
  };

  // 브라우저 채널 생성 + 서버 저장 + 계정 구독 ON
  const handleSubscribe = async () => {
    const next = await subscribe();
    if (!next) return;

    // persist await 전에 동기적으로 표시 — 대기 중 재동기화 이펙트가
    // 발화해도(계정 구독이 이미 켜진 경로) 중복 POST하지 않게 한다
    didSyncRef.current = true;
    await runApiAction(async () => {
      await persistPushSubscription(next);
      setEnabled(true);
    });
  };

  // 계정 구독 OFF (L1만 — 브라우저 채널은 보존)
  const handleDisable = async () => {
    await runApiAction(async () => {
      await disablePushSubscription();
      setEnabled(false);
    });
  };

  const isBusy = isSubscribing || isPending;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        <span className="font-medium">계정 구독 상태: </span>
        <span className={enabled ? 'text-green-700' : 'text-zinc-600'}>
          {enabled ? '구독 중' : '꺼짐'}
        </span>
      </p>

      {enabled ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => void handleDisable()}
            disabled={isBusy}
            className="w-fit rounded bg-zinc-600 px-4 py-2 text-white disabled:opacity-50"
          >
            {isPending ? '해제 중…' : '알림 해제 (모든 기기)'}
          </button>

          {!subscription && (
            <button
              type="button"
              onClick={() => void handleSubscribe()}
              disabled={!isSupported || isBusy}
              className="w-fit rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
            >
              {isBusy ? '등록 중…' : '이 기기에서도 알림 받기'}
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void handleSubscribe()}
          disabled={!isSupported || isBusy}
          className="w-fit rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {isBusy ? '구독 처리 중…' : '알림 구독'}
        </button>
      )}

      <dl className="text-sm">
        <div>
          <dt className="inline font-medium">지원: </dt>
          <dd className="inline">{isSupported ? '예' : '아니오'}</dd>
        </div>
        <div>
          <dt className="inline font-medium">권한: </dt>
          <dd className="inline">{permission ?? '-'}</dd>
        </div>
        <div>
          <dt className="inline font-medium">이 기기 채널: </dt>
          <dd className="inline break-all">
            {subscription ? subscription.endpoint : '없음'}
          </dd>
        </div>
      </dl>

      {error && <p className="text-sm text-red-600">오류: {error.message}</p>}
      {apiError && (
        <p className="text-sm text-red-600">오류: {apiError.message}</p>
      )}
    </div>
  );
}
