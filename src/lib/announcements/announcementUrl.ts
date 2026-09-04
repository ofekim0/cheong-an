/**
 * 알림이 보내는 공고 링크의 절대 URL 빌더 (#96).
 *
 * 9-c 시점에는 soco 원문(view.do)으로 보냈다 — 내부 상세 페이지가 없었기
 * 때문이다. `/announcements/[boardId]`가 생기면서 내부 경로로 교체했고, 목록
 * 카드도 같은 시점에 함께 바꿨다(알림과 목록이 같은 곳을 가리켜야 한다는 당시
 * 판단). 경로 문자열은 `buildAnnouncementPath`로 공유한다.
 *
 * 이 모듈이 `lib/push`가 아니라 `lib/announcements`에 있는 이유: 웹 푸시와
 * 이메일이 모두 쓴다. 이전에는 `buildEmailPayload`가 `lib/push/`에서 URL 빌더를
 * 가져와 채널 간 방향이 어긋나 있었다.
 *
 * 절대 URL이 필요한 이유: 알림은 메일 클라이언트·서비스 워커에서 열리므로
 * 상대 경로가 의미를 갖지 못한다. 그래서 배포 도메인을 env로 받는다.
 */

import {
  ANNOUNCEMENTS_PATH,
  buildAnnouncementPath,
} from '@/constants/announcements';

/**
 * 배포 도메인. 없으면 throw한다.
 *
 * 폴백(예: soco 원문으로 되돌리기)을 두지 않는 이유는 ADR 013이 자격 증명 가드에
 * 대해 내린 판단과 같다 — 근거 없는 폴백은 설정이 빠진 배포를 에러 대신 "그럴싸한
 * 다른 동작"으로 위장한다. throw하면 `dispatchNotifications`가 채널 단위로 격리해
 * 크롤은 200을 유지하고, 응답의 `notifications.<channel>.error`와 로그에 즉시
 * 드러난다. 발송 1회 유실이 잘못된 링크를 조용히 뿌리는 것보다 낫다.
 *
 * 끝의 `/`는 제거한다 — env에 `https://example.com/`을 넣어도 `//announcements`가
 * 되지 않게 한다.
 */
function getSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL;
  if (!raw || raw.trim().length === 0) {
    throw new Error(
      'NEXT_PUBLIC_SITE_URL is not configured (required to build absolute announcement URLs)',
    );
  }
  return raw.trim().replace(/\/+$/, '');
}

/** 공고 1건의 상세 페이지 절대 URL. */
export function buildAnnouncementUrl(boardId: number): string {
  return `${getSiteUrl()}${buildAnnouncementPath(boardId)}`;
}

/** 공고 목록 페이지 절대 URL. 집계 알림이 쓴다. */
export function buildAnnouncementListUrl(): string {
  return `${getSiteUrl()}${ANNOUNCEMENTS_PATH}`;
}
