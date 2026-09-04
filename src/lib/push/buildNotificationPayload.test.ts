import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildNotificationPayload } from './buildNotificationPayload';
import type { AnnouncementDetail } from '@/types/announcement';

const SITE_URL = 'https://cheong-an.example.com';

// URL 빌더가 배포 도메인 env를 요구한다(#96). 미설정 시 throw는
// announcementUrl.test.ts가 덮으므로, 여기서는 페이로드 형태만 본다.
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', SITE_URL);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function createDetail(
  overrides: Partial<AnnouncementDetail>,
): AnnouncementDetail {
  return {
    boardId: 6561,
    title: '강동구 천호동 청년안심주택 입주자 모집공고',
    announcementType: 'private',
    recruitmentType: 'initial',
    complexName: null,
    district: '강동구',
    address: null,
    totalUnits: null,
    postDate: '2026-07-01',
    applicationDate: null,
    attachmentUrl: null,
    attachmentName: null,
    rawContent: '<p>본문</p>',
    ...overrides,
  };
}

describe('buildNotificationPayload', () => {
  it('빈 배열이면 null을 반환한다 (발송 생략 신호)', () => {
    expect(buildNotificationPayload([])).toBeNull();
  });

  it('1건이면 공고 제목을 본문으로, 해당 공고 URL과 boardId tag를 만든다', () => {
    const detail = createDetail({ boardId: 6561 });

    expect(buildNotificationPayload([detail])).toEqual({
      title: '청안 — 새 공고',
      body: '강동구 천호동 청년안심주택 입주자 모집공고',
      url: `${SITE_URL}/announcements/6561`,
      tag: 'cheongan-announcement-6561',
    });
  });

  it('여러 건이면 집계 알림 1개로 만들고 내부 목록 URL로 보낸다', () => {
    const details = [
      createDetail({ boardId: 6561, title: '첫 번째 공고' }),
      createDetail({ boardId: 6562, title: '두 번째 공고' }),
      createDetail({ boardId: 6563, title: '세 번째 공고' }),
    ];

    expect(buildNotificationPayload(details)).toEqual({
      title: '청안 — 새 공고 3건',
      body: '첫 번째 공고 외 2건',
      url: `${SITE_URL}/announcements`,
      tag: 'cheongan-announcements-batch',
    });
  });
});
