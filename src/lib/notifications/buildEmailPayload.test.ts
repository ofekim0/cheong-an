import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildEmailPayload } from './buildEmailPayload';
import type { AnnouncementDetail } from '@/types/announcement';

function buildDetail(
  boardId: number,
  title = `공고 ${boardId}`,
): AnnouncementDetail {
  return {
    boardId,
    title,
    announcementType: 'private',
    recruitmentType: 'initial',
    complexName: null,
    district: null,
    address: null,
    totalUnits: null,
    postDate: '2026-08-01',
    applicationDate: null,
    attachmentUrl: null,
    attachmentName: null,
    rawContent: '',
  };
}

const SITE_URL = 'https://cheong-an.example.com';
const DETAIL_URL_6561 = `${SITE_URL}/announcements/6561`;

// URL 빌더가 배포 도메인 env를 요구한다(#96). 웹 푸시와 같은 빌더를 쓰므로
// 두 채널의 링크가 갈라지지 않는다.
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', SITE_URL);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('buildEmailPayload', () => {
  it('신규 공고가 없으면 null — 호출자는 발송을 생략한다', () => {
    expect(buildEmailPayload([])).toBeNull();
  });

  it('1건이면 제목을 subject에 싣고 본문에 내부 상세 링크를 넣는다', () => {
    const detail = buildDetail(6561, '강동구 천호동 청년안심주택 모집공고');

    const payload = buildEmailPayload([detail]);

    expect(payload).not.toBeNull();
    expect(payload?.subject).toBe(
      '[청안] 새 청년안심주택 공고 — 강동구 천호동 청년안심주택 모집공고',
    );
    expect(payload?.html).toContain(DETAIL_URL_6561);
    expect(payload?.html).toContain('강동구 천호동 청년안심주택 모집공고');
    expect(payload?.text).toContain(DETAIL_URL_6561);
    expect(payload?.text).toContain('강동구 천호동 청년안심주택 모집공고');
  });

  it('N건이면 subject는 건수 집계, 본문에는 공고별 제목+링크를 전부 나열한다', () => {
    const details = [
      buildDetail(6561, '첫째 공고'),
      buildDetail(6562, '둘째 공고'),
      buildDetail(6563, '셋째 공고'),
    ];

    const payload = buildEmailPayload(details);

    expect(payload?.subject).toBe('[청안] 새 청년안심주택 공고 3건');
    for (const detail of details) {
      const url = `${SITE_URL}/announcements/${detail.boardId}`;
      expect(payload?.html).toContain(detail.title);
      expect(payload?.html).toContain(url);
      expect(payload?.text).toContain(detail.title);
      expect(payload?.text).toContain(url);
    }
  });

  it('제목의 HTML 특수문자를 이스케이프한다 (외부 파싱 값)', () => {
    const detail = buildDetail(6561, '<script>공고 & "제목"</script>');

    const payload = buildEmailPayload([detail]);

    expect(payload?.html).not.toContain('<script>');
    expect(payload?.html).toContain(
      '&lt;script&gt;공고 &amp; &quot;제목&quot;&lt;/script&gt;',
    );
    // text는 HTML이 아니므로 원문 유지
    expect(payload?.text).toContain('<script>공고 & "제목"</script>');
  });
});
