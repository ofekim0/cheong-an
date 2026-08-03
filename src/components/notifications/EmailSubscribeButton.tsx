'use client';

import { useState } from 'react';

import {
  disableEmailNotification,
  enableEmailNotification,
} from '@/lib/notifications/emailPreferenceClient';

interface EmailSubscribeButtonProps {
  /** 서버에서 조회한 계정의 이메일 알림 상태 (email_enabled) */
  initialEnabled: boolean;
  /** 알림이 발송될 이메일 주소 (표시용) */
  email: string;
}

/**
 * 임시 검증용 이메일 알림 토글 (Step a — ADR 011).
 *
 * 웹 푸시 토글과 달리 브라우저 채널 생성이 없어 단순 on/off다. 계정 단위라
 * 어느 기기에서 켜든 전 기기가 공유한다. 이 컴포넌트는 이메일 주소가 있는
 * 계정에만 렌더된다(게이팅은 서버 컴포넌트가 담당).
 *
 * 본 디자인은 Sprint 2 화면이 모두 잡힌 뒤 일괄 작업한다.
 */
export function EmailSubscribeButton({
  initialEnabled,
  email,
}: EmailSubscribeButtonProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [isPending, setIsPending] = useState(false);
  const [apiError, setApiError] = useState<Error | null>(null);

  const toggle = async () => {
    setIsPending(true);
    setApiError(null);
    try {
      if (enabled) {
        await disableEmailNotification();
        setEnabled(false);
      } else {
        await enableEmailNotification();
        setEnabled(true);
      }
    } catch (err) {
      setApiError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">
        <span className="font-medium">이메일 알림: </span>
        <span className={enabled ? 'text-green-700' : 'text-zinc-600'}>
          {enabled ? `구독 중 (${email})` : '꺼짐'}
        </span>
      </p>

      <button
        type="button"
        onClick={() => void toggle()}
        disabled={isPending}
        className="w-fit rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
      >
        {isPending
          ? '처리 중…'
          : enabled
            ? '이메일 알림 해제 (모든 기기)'
            : '이메일 알림 구독'}
      </button>

      {apiError && (
        <p className="text-sm text-red-600">오류: {apiError.message}</p>
      )}
    </div>
  );
}
