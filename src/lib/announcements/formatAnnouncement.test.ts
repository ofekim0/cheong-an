import { describe, expect, it } from 'vitest';

import {
  ANNOUNCEMENT_TYPE_LABEL,
  formatApplicationDate,
  formatDate,
  listCountLabel,
  listEmptyMessage,
  RECRUITMENT_TYPE_LABEL,
} from './formatAnnouncement';

describe('라벨 맵', () => {
  it('공고 유형을 한글 라벨로 매핑한다', () => {
    expect(ANNOUNCEMENT_TYPE_LABEL.public).toBe('공공');
    expect(ANNOUNCEMENT_TYPE_LABEL.private).toBe('민간');
  });

  it('모집 구분을 한글 라벨로 매핑한다', () => {
    expect(RECRUITMENT_TYPE_LABEL.initial).toBe('최초모집');
    expect(RECRUITMENT_TYPE_LABEL.additional).toBe('추가모집');
  });
});

describe('formatDate', () => {
  it('YYYY-MM-DD를 표시 형식으로 바꾼다', () => {
    expect(formatDate('2026-08-31')).toBe('2026. 08. 31.');
  });

  it('월·일의 0을 유지한다 (자릿수 정렬 목적)', () => {
    expect(formatDate('2026-01-05')).toBe('2026. 01. 05.');
  });

  it('형식에 맞지 않는 값은 원본을 그대로 돌려준다', () => {
    // 표시 함수가 페이지 렌더를 중단시키지 않아야 한다.
    expect(formatDate('2026-8-31')).toBe('2026-8-31');
    expect(formatDate('')).toBe('');
  });

  it('타임존과 무관하게 입력 문자열의 날짜를 그대로 표기한다', () => {
    // Date로 파싱하면 UTC 자정 해석으로 하루가 밀릴 수 있는 경계값.
    expect(formatDate('2026-01-01')).toBe('2026. 01. 01.');
    expect(formatDate('2026-12-31')).toBe('2026. 12. 31.');
  });
});

describe('formatApplicationDate', () => {
  it('청약신청일을 표시 형식으로 바꾼다', () => {
    expect(formatApplicationDate('2026-08-31')).toBe('2026. 08. 31.');
  });

  it('값이 없으면 미정으로 표기한다', () => {
    // 원본에 마감일 항목 자체가 없으므로 '○○ ~ 미정' 같은 기간 표기를 쓰지 않는다.
    expect(formatApplicationDate(null)).toBe('미정');
  });
});

describe('listEmptyMessage', () => {
  // 세 문구는 사용자가 취할 행동이 다르다: 기다리기 / 필터 풀기 / 앞 페이지로.
  it('전체 0건·필터 없음 → 아직 등록된 공고 없음', () => {
    expect(listEmptyMessage(0, false)).toBe('아직 등록된 공고가 없습니다.');
  });

  it('전체 0건·필터 있음 → 조건에 맞는 공고 없음', () => {
    expect(listEmptyMessage(0, true)).toBe('조건에 맞는 공고가 없습니다.');
  });

  it('전체는 있는데 이 페이지가 비면 → 범위 초과 안내 (필터 유무 무관)', () => {
    expect(listEmptyMessage(68, false)).toBe('이 페이지에는 공고가 없습니다.');
    expect(listEmptyMessage(3, true)).toBe('이 페이지에는 공고가 없습니다.');
  });
});

describe('listCountLabel', () => {
  it('필터가 없으면 전체 건수', () => {
    expect(listCountLabel(69, false)).toBe('전체 69건');
  });

  it('필터가 있으면 조건에 맞는 건수', () => {
    expect(listCountLabel(13, true)).toBe('조건에 맞는 공고 13건');
  });
});
