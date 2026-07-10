/**
 * 웹 푸시 구독 API(9-b) 클라이언트 헬퍼.
 *
 * usePushSubscription 훅은 브라우저 구독(배달 채널) 생성까지만 책임지므로(9-a),
 * 서버 저장/해제는 이 모듈이 담당한다. 실패는 throw로 표면화해
 * 호출 측 UI가 상태로 노출하게 한다.
 */

const SUBSCRIBE_ENDPOINT = '/api/push/subscribe';

/** 생성된 브라우저 구독을 서버에 저장하고 계정 구독을 켠다 (POST). */
export async function persistPushSubscription(
  subscription: PushSubscription,
): Promise<void> {
  const response = await fetch(SUBSCRIBE_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(subscription.toJSON()),
  });

  if (!response.ok) {
    const message = await extractErrorMessage(response);
    throw new Error(`구독 저장 실패 (${response.status}): ${message}`);
  }
}

/**
 * 계정 구독을 끈다 (DELETE) — 어느 기기에서 호출하든 계정 차원에서 꺼진다.
 * 브라우저 쪽 배달 채널은 건드리지 않는다 (ADR 008).
 */
export async function disablePushSubscription(): Promise<void> {
  const response = await fetch(SUBSCRIBE_ENDPOINT, { method: 'DELETE' });

  if (!response.ok) {
    const message = await extractErrorMessage(response);
    throw new Error(`구독 해제 실패 (${response.status}): ${message}`);
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
