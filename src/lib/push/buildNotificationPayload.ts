/**
 * 신규 공고 → 웹 푸시 알림 페이로드 순수 함수 (9-c).
 *
 * sw.js의 push 핸들러가 기대하는 형태({ title, body, url, tag })를 만든다.
 *
 * - 1건: 공고 제목을 본문으로, 클릭 시 해당 공고의 soco view.do로 이동.
 * - N건: 집계 알림 1개(첫 공고 제목 + "외 N-1건"), 클릭 시 soco 목록으로 이동.
 *   채널당 공고 수만큼 알림을 쏘면 크롤 1회에 여러 개가 쌓여 스팸이 되므로
 *   집계한다 (평시 newCount는 0~2건).
 * - tag: 같은 tag의 미확인 알림은 브라우저가 교체한다 — 단건은 boardId별로
 *   분리해 서로 다른 공고가 덮어쓰지 않게 하고, 집계는 고정 tag로 최신
 *   배치만 남긴다.
 *
 * URL은 내부 상세·목록 페이지로 보낸다 (#96). 빌더는 `lib/announcements/
 * announcementUrl`이 소유한다 — 이메일 채널도 같은 것을 쓰므로 채널 모듈이
 * 아니라 도메인 모듈에 둔다.
 */

import {
  buildAnnouncementListUrl,
  buildAnnouncementUrl,
} from '@/lib/announcements/announcementUrl';
import type { AnnouncementDetail } from '@/types/announcement';

/** sw.js push 핸들러와 합의된 알림 페이로드 형태. */
export interface PushNotificationPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

const TITLE = '청안 — 새 공고';

/**
 * 신규 공고 목록을 알림 페이로드 하나로 만든다.
 *
 * 발송할 것이 없으면(빈 배열) null — 호출자는 발송을 생략한다.
 */
export function buildNotificationPayload(
  details: AnnouncementDetail[],
): PushNotificationPayload | null {
  if (details.length === 0) return null;

  if (details.length === 1) {
    const detail = details[0];
    return {
      title: TITLE,
      body: detail.title,
      url: buildAnnouncementUrl(detail.boardId),
      tag: `cheongan-announcement-${detail.boardId}`,
    };
  }

  return {
    title: `${TITLE} ${details.length}건`,
    body: `${details[0].title} 외 ${details.length - 1}건`,
    url: buildAnnouncementListUrl(),
    tag: 'cheongan-announcements-batch',
  };
}
