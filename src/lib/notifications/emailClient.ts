/**
 * Resend SDK 얇은 어댑터 (#65, Step b-2 — ADR 011).
 *
 * webPushClient와 같은 철학의 채널 클라이언트:
 * - 발송 env 2종(RESEND_API_KEY, EMAIL_FROM)을 읽어 자격 증명을 구성한다
 *   (미설정은 throw로 표면화 — 발송 경로에 들어온 시점에 없으면 배포 설정 오류).
 * - 발송 결과를 라이브러리 중립 형태(EmailSendResult)로 정규화한다 —
 *   호출자(emailAdapter)가 Resend 타입에 의존하지 않게 한다.
 * - 수신자 단위 실패는 throw하지 않고 결과 값으로 돌려준다 — 수신자별
 *   격리(한 명의 실패가 배치를 죽이지 않음)는 emailAdapter가 수행한다.
 *
 * Resend SDK는 실패를 throw 대신 { data, error } 값으로 돌려주고
 * error.statusCode를 포함하므로 매핑이 그대로 대응된다. 네트워크 계층의
 * 예외만 방어적으로 잡아 같은 형태로 정규화한다.
 *
 * 클라이언트 인스턴스는 호출마다 생성한다(키 보관뿐이라 비용 무시 가능) —
 * webPushClient의 "전역 상태 없음 → 테스트 격리·초기화 순서 문제 없음"과 동일.
 */

import { Resend } from 'resend';

import type { EmailPayload } from './buildEmailPayload';

/** 발송 1건의 정규화된 결과. */
export type EmailSendResult =
  | { ok: true }
  | {
      ok: false;
      /** Resend HTTP 응답 코드. 네트워크 등 비HTTP 실패면 null. */
      statusCode: number | null;
      message: string;
    };

/** 발송 함수 시그니처 — emailAdapter가 테스트에서 모킹하는 경계. */
export type EmailSender = (
  to: string,
  payload: EmailPayload,
) => Promise<EmailSendResult>;

interface EmailConfig {
  apiKey: string;
  from: string;
}

/**
 * 이메일 발송 env 2종을 읽어 자격 증명을 만든다. 하나라도 없으면 throw —
 * 조용히 스킵하지 않고 표면화한다 (webPushClient의 VAPID 처리와 동일).
 */
export function getEmailConfigFromEnv(): EmailConfig {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    throw new Error(
      '이메일 env가 설정되지 않았습니다: RESEND_API_KEY, EMAIL_FROM 필요',
    );
  }

  return { apiKey, from };
}

/**
 * 수신자 한 명에게 이메일 페이로드를 발송한다.
 *
 * 실패는 throw하지 않고 결과 객체로 돌려준다. 단, env 미설정은 던진다
 * (모든 수신자가 실패할 설정 오류).
 */
export const sendEmail: EmailSender = async (to, payload) => {
  const { apiKey, from } = getEmailConfigFromEnv();
  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from,
      to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    });

    if (error) {
      return {
        ok: false,
        statusCode: error.statusCode ?? null,
        message: error.message,
      };
    }
    return { ok: true };
  } catch (err) {
    // SDK는 실패를 값으로 돌려주지만, 네트워크 계층 예외는 던질 수 있어
    // 방어적으로 같은 형태로 정규화한다.
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { ok: false, statusCode: null, message };
  }
};
