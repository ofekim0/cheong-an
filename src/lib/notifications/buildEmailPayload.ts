/**
 * 신규 공고 → 이메일 페이로드 순수 함수 (#65, Step b-2 — ADR 011).
 *
 * buildNotificationPayload(웹 푸시)의 이메일 대응물. 채널 특성이 달라 집계
 * 방식이 다르다:
 * - 웹 푸시는 알림 1개에 본문 한 줄이라 N건을 "첫 제목 외 N-1건"으로 뭉치지만,
 *   이메일은 본문 공간이 있으므로 N건 각각의 제목+원문 링크를 나열한다.
 * - 발송 단위는 웹 푸시와 동일하게 크롤 1회당 이메일 1통(공고당 1통이 아님) —
 *   평시 newCount 0~2건이지만 부트스트랩·장애 복구 시 수십 건이 한 번에 올 수
 *   있어, 공고당 1통이면 스팸이 된다.
 *
 * URL은 웹 푸시와 동일하게 내부 상세 페이지로 보낸다 (#96) — 빌더를 공유하므로
 * 두 채널의 링크가 갈라지지 않는다.
 *
 * 공고 제목은 외부 사이트 파싱 결과이므로 html에는 이스케이프해 삽입한다.
 */

import { buildAnnouncementUrl } from '@/lib/announcements/announcementUrl';
import type { AnnouncementDetail } from '@/types/announcement';

/** 이메일 발송에 필요한 페이로드. Resend emails.send의 subject/html/text와 대응. */
export interface EmailPayload {
  subject: string;
  html: string;
  text: string;
}

const SUBJECT_PREFIX = '[청안] 새 청년안심주택 공고';

/** HTML 삽입용 최소 이스케이프 (제목은 신뢰할 수 없는 외부 파싱 값). */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 신규 공고 목록을 이메일 페이로드 하나로 만든다.
 *
 * 발송할 것이 없으면(빈 배열) null — 호출자는 발송을 생략한다.
 */
export function buildEmailPayload(
  details: AnnouncementDetail[],
): EmailPayload | null {
  if (details.length === 0) return null;

  const subject =
    details.length === 1
      ? `${SUBJECT_PREFIX} — ${details[0].title}`
      : `${SUBJECT_PREFIX} ${details.length}건`;

  const htmlItems = details
    .map((detail) => {
      const url = buildAnnouncementUrl(detail.boardId);
      return `<li><a href="${url}">${escapeHtml(detail.title)}</a></li>`;
    })
    .join('\n');

  const html = [
    '<p>새 청년안심주택 모집공고가 올라왔습니다.</p>',
    `<ul>\n${htmlItems}\n</ul>`,
    '<p style="color:#888;font-size:12px;">청안 — 청년안심주택 새 공고 알림</p>',
  ].join('\n');

  const textItems = details
    .map(
      (detail) =>
        `- ${detail.title}\n  ${buildAnnouncementUrl(detail.boardId)}`,
    )
    .join('\n');

  const text = `새 청년안심주택 모집공고가 올라왔습니다.\n\n${textItems}\n`;

  return { subject, html, text };
}
