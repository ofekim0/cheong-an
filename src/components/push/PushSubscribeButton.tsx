'use client';

import { usePushSubscription } from '@/hooks/usePushSubscription';

/**
 * 임시 검증용 구독 버튼 (Step 9-a).
 *
 * 9-a의 subscribe 흐름(SW 등록 → 알림 권한 → PushManager.subscribe)이
 * 실제 브라우저에서 동작하는지 눈으로 확인하기 위한 최소 UI다.
 * 본 디자인은 Sprint 2의 화면(구독/목록/상세)이 모두 잡힌 뒤 일괄 작업한다.
 */
export function PushSubscribeButton() {
  const {
    isSupported,
    permission,
    subscription,
    isSubscribing,
    error,
    subscribe,
  } = usePushSubscription();

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => void subscribe()}
        disabled={!isSupported || isSubscribing}
        className="w-fit rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
      >
        {isSubscribing ? '구독 처리 중…' : '알림 구독'}
      </button>

      <dl className="text-sm">
        <div>
          <dt className="inline font-medium">지원: </dt>
          <dd className="inline">{isSupported ? '예' : '아니오'}</dd>
        </div>
        <div>
          <dt className="inline font-medium">권한: </dt>
          <dd className="inline">{permission ?? '-'}</dd>
        </div>
      </dl>

      {error && <p className="text-sm text-red-600">오류: {error.message}</p>}

      {subscription && (
        <p className="text-sm break-all text-green-700">
          구독 생성됨 — endpoint: {subscription.endpoint}
        </p>
      )}
    </div>
  );
}
