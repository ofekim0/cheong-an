/**
 * 이메일 알림 opt-in API 클라이언트 헬퍼 (ADR 011).
 *
 * 이메일은 웹 푸시와 달리 브라우저 채널 생성 과정이 없다 — 계정의 의사를
 * 켜고 끄는 단순 토글이다(수신 주소는 발송 시 auth.users.email에서 조회).
 * 그래서 PushManager 없이 fetch만으로 충분하다.
 *
 * 실패는 throw로 표면화해 호출 측 UI가 상태로 노출하게 한다.
 */

const EMAIL_ENDPOINT = '/api/notifications/email';

/** 이메일 알림을 켠다 (POST). */
export async function enableEmailNotification(): Promise<void> {
  const response = await fetch(EMAIL_ENDPOINT, { method: 'POST' });

  if (!response.ok) {
    const message = await extractErrorMessage(response);
    throw new Error(`이메일 알림 설정 실패 (${response.status}): ${message}`);
  }
}

/** 이메일 알림을 끈다 (DELETE). */
export async function disableEmailNotification(): Promise<void> {
  const response = await fetch(EMAIL_ENDPOINT, { method: 'DELETE' });

  if (!response.ok) {
    const message = await extractErrorMessage(response);
    throw new Error(`이메일 알림 해제 실패 (${response.status}): ${message}`);
  }
}

async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : 'Unknown error';
  } catch {
    return 'Unknown error';
  }
}
