/**
 * 이메일 채널 어댑터 (#65, Step b-2 — ADR 011 축2).
 *
 * ChannelAdapter의 둘째 구현. 파이프라인: 페이로드 생성(buildEmailPayload) →
 * 수신자 조회(emailRecipientsRepository) → 수신자별 발송(emailClient) → 집계.
 *
 * 웹 푸시 어댑터와의 구조 차이(ADR 011 축3):
 * - 배달 단위가 계정(이메일 주소 1개)이다 — 웹 푸시의 (계정×기기) 채널과 다름.
 * - 만료 정리가 없다: 웹 푸시는 410/404 endpoint를 즉시 삭제하지만, 이메일
 *   반송(bounce)은 비동기라 발송 시점에 알 수 없고 저장된 채널도 없다.
 *   expired는 항상 0.
 *
 * 책임 범위:
 * - 수신자별 격리: 한 명의 발송 실패가 나머지 수신자 발송을 막지 않는다.
 * - 실패는 failed로 집계 + 로그 — 다음 신규 공고 발송에서 자연 재시도.
 *
 * 책임이 아닌 것:
 * - 발송 여부 판단(신규 유무)과 크롤 흐름 (호출자 /api/cron/crawl의 일).
 * - 채널 간 격리·순회 (notificationService의 일).
 * - Resend 프로토콜 (emailClient). DB·auth 조회 (emailRecipientsRepository).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ChannelAdapter, ChannelResult } from './channelAdapter';
import { buildEmailPayload } from './buildEmailPayload';
import { sendEmail, type EmailSender } from './emailClient';
import { getEmailRecipients } from '@/lib/supabase/emailRecipientsRepository';
import type { AnnouncementDetail } from '@/types/announcement';

/** 어댑터 구성 시 주입 가능한 의존성 — 테스트에서 모킹하는 경계. */
export interface EmailAdapterDeps {
  /** 발송 함수. 기본 emailClient.sendEmail. */
  sender?: EmailSender;
  /** 수신자 조회. 기본 emailRecipientsRepository.getEmailRecipients. */
  fetchRecipients?: typeof getEmailRecipients;
}

/**
 * 이메일 채널 어댑터를 만든다. 의존성은 인자로 받아 테스트에서 교체한다.
 *
 * dispatch는 신규 공고를 email_enabled 계정의 이메일 주소로 발송한다.
 * 신규가 없거나 수신자가 없으면 no-op(전부 0). RESEND_API_KEY 미설정 등 전
 * 수신자 공통의 설정 오류는 throw로 전파되며, notificationService가 채널
 * 단위로 격리한다.
 */
export function createEmailAdapter(
  deps: EmailAdapterDeps = {},
): ChannelAdapter {
  const { sender = sendEmail, fetchRecipients = getEmailRecipients } = deps;

  return {
    channel: 'email',
    async dispatch(
      client: SupabaseClient,
      details: AnnouncementDetail[],
    ): Promise<ChannelResult> {
      const payload = buildEmailPayload(details);
      if (payload === null) {
        return { sent: 0, expired: 0, failed: 0 };
      }

      const recipients = await fetchRecipients(client);
      if (recipients.length === 0) {
        return { sent: 0, expired: 0, failed: 0 };
      }

      // sender는 수신자 단위 실패를 결과 객체로 돌려주므로(throw 없음)
      // Promise.all이 안전하다 — 예외는 env 미설정 같은 전 수신자 공통
      // 오류뿐이며 그대로 전파한다.
      const results = await Promise.all(
        recipients.map((recipient) => sender(recipient.email, payload)),
      );

      const result: ChannelResult = { sent: 0, expired: 0, failed: 0 };

      results.forEach((sendResult, index) => {
        if (sendResult.ok) {
          result.sent += 1;
          return;
        }
        result.failed += 1;
        // 주소는 개인정보이므로 로그에는 userId만 남긴다.
        console.warn(
          `[email/dispatch] 발송 실패 (userId ${recipients[index].userId}, status ${sendResult.statusCode ?? 'n/a'}): ${sendResult.message}`,
        );
      });

      return result;
    },
  };
}

/** 기본 의존성으로 구성한 이메일 어댑터 (프로덕션 경로). */
export const emailAdapter = createEmailAdapter();
