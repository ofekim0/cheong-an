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
 * URL은 당분간 soco.seoul.go.kr 원문 공고로 보낸다(A안 — 내부 상세 페이지가
 * 아직 없음). Sprint 2에서 `/announcements/[boardId]`가 생기면 이 모듈의
 * URL 빌더만 교체한다.
 */

import type { AnnouncementDetail } from '@/types/announcement';

/** sw.js push 핸들러와 합의된 알림 페이로드 형태. */
export interface PushNotificationPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

const TITLE = '청안 — 새 공고';

const LIST_URL =
  'https://soco.seoul.go.kr/youth/bbs/BMSR00015/list.do?menuNo=400008';

/** 공고 1건의 사용자용 원문 링크 (Sprint 2 내부 상세 페이지로 교체 예정). */
export function buildAnnouncementUrl(boardId: number): string {
  return `https://soco.seoul.go.kr/youth/bbs/BMSR00015/view.do?boardId=${boardId}&menuNo=400008`;
}

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
    url: LIST_URL,
    tag: 'cheongan-announcements-batch',
  };
}
