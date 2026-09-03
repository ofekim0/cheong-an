import { describe, expect, it } from 'vitest';

import {
  buildAnnouncementUrl,
  buildNotificationPayload,
} from './buildNotificationPayload';
import type { AnnouncementDetail } from '@/types/announcement';

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

describe('buildAnnouncementUrl', () => {
  it('boardId로 soco view.do URL을 만든다', () => {
    expect(buildAnnouncementUrl(6561)).toBe(
      'https://soco.seoul.go.kr/youth/bbs/BMSR00015/view.do?boardId=6561&menuNo=400008',
    );
  });
});

describe('buildNotificationPayload', () => {
  it('빈 배열이면 null을 반환한다 (발송 생략 신호)', () => {
    expect(buildNotificationPayload([])).toBeNull();
  });

  it('1건이면 공고 제목을 본문으로, 해당 공고 URL과 boardId tag를 만든다', () => {
    const detail = createDetail({ boardId: 6561 });

    expect(buildNotificationPayload([detail])).toEqual({
      title: '청안 — 새 공고',
      body: '강동구 천호동 청년안심주택 입주자 모집공고',
      url: buildAnnouncementUrl(6561),
      tag: 'cheongan-announcement-6561',
    });
  });

  it('여러 건이면 집계 알림 1개로 만들고 목록 URL로 보낸다', () => {
    const details = [
      createDetail({ boardId: 6561, title: '첫 번째 공고' }),
      createDetail({ boardId: 6562, title: '두 번째 공고' }),
      createDetail({ boardId: 6563, title: '세 번째 공고' }),
    ];

    expect(buildNotificationPayload(details)).toEqual({
      title: '청안 — 새 공고 3건',
      body: '첫 번째 공고 외 2건',
      url: 'https://soco.seoul.go.kr/youth/bbs/BMSR00015/list.do?menuNo=400008',
      tag: 'cheongan-announcements-batch',
    });
  });
});
