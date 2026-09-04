import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildAnnouncementListUrl,
  buildAnnouncementUrl,
  buildSourceUrl,
} from './announcementUrl';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('buildAnnouncementUrl', () => {
  it('배포 도메인 + 상세 경로로 절대 URL을 만든다', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://cheong-an.example.com');

    expect(buildAnnouncementUrl(6644)).toBe(
      'https://cheong-an.example.com/announcements/6644',
    );
  });

  it('끝의 슬래시가 있어도 경로가 겹치지 않는다', () => {
    // env에 'https://example.com/'을 넣는 실수가 //announcements를 만들면 안 된다.
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://example.com///');

    expect(buildAnnouncementUrl(1)).toBe('https://example.com/announcements/1');
  });

  it('앞뒤 공백을 무시한다', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '  https://example.com  ');

    expect(buildAnnouncementUrl(1)).toBe('https://example.com/announcements/1');
  });

  it.each([
    ['미설정', undefined],
    ['빈 문자열', ''],
    ['공백만', '   '],
  ])('NEXT_PUBLIC_SITE_URL이 %s이면 throw한다', (_label, value) => {
    // 폴백(soco 원문으로 되돌리기)을 두지 않는다 — 설정 누락이 "그럴싸한 다른
    // 동작"으로 위장되면 잘못된 링크가 조용히 뿌려진다(ADR 013의 가드 판단).
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', value as string);

    expect(() => buildAnnouncementUrl(1)).toThrow(/NEXT_PUBLIC_SITE_URL/);
  });
});

describe('buildAnnouncementListUrl', () => {
  it('배포 도메인 + 목록 경로로 절대 URL을 만든다', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://cheong-an.example.com');

    expect(buildAnnouncementListUrl()).toBe(
      'https://cheong-an.example.com/announcements',
    );
  });

  it('미설정이면 throw한다', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');

    expect(() => buildAnnouncementListUrl()).toThrow(/NEXT_PUBLIC_SITE_URL/);
  });
});

describe('buildSourceUrl', () => {
  it('boardId로 원본 view.do URL을 만든다', () => {
    expect(buildSourceUrl(6644)).toBe(
      'https://soco.seoul.go.kr/youth/bbs/BMSR00015/view.do?boardId=6644&menuNo=400008',
    );
  });

  it('NEXT_PUBLIC_SITE_URL이 없어도 동작한다', () => {
    // 원본 URL은 우리 배포 도메인과 무관하다. 여기서 env를 타면 설정 누락이
    // 알림뿐 아니라 상세 페이지 렌더까지 깨뜨린다 (#98).
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');

    expect(() => buildSourceUrl(6644)).not.toThrow();
    expect(buildSourceUrl(6644)).toContain('soco.seoul.go.kr');
  });
});
