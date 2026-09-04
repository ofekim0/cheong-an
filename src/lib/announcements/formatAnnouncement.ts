/**
 * 공고 요약을 화면 표시용 문자열로 바꾸는 순수 함수 모음 (#83, Step b).
 *
 * 컴포넌트가 아니라 별도 모듈로 두는 이유: 이 프로젝트는 컴포넌트 테스트 도구를
 * 두지 않고 UI 스타일링을 테스트 대상에서 제외한다(CLAUDE.md 테스트 원칙).
 * 그러나 날짜 표기에는 nullable 필드가 만드는 실제 분기가 있으므로, 분기를 순수
 * 함수로 분리해 유닛으로 덮고 컴포넌트는 배치만 담당하게 한다.
 *
 * 날짜는 Date로 파싱하지 않고 문자열로 다룬다 — DB의 post_date·application_*_date는
 * DATE(일 단위)라 시각 정보가 없는데, `new Date('2026-08-31')`은 UTC 자정으로
 * 해석돼 렌더 환경의 타임존에 따라 하루가 밀릴 수 있다. 표시에 필요한 건 자릿수
 * 정리뿐이므로 파싱 자체를 하지 않는 편이 안전하다.
 */

import type { AnnouncementType, RecruitmentType } from '@/types/announcement';

/** 공고 유형 표시 라벨. */
export const ANNOUNCEMENT_TYPE_LABEL: Record<AnnouncementType, string> = {
  public: '공공',
  private: '민간',
};

/** 모집 구분 표시 라벨. */
export const RECRUITMENT_TYPE_LABEL: Record<RecruitmentType, string> = {
  initial: '최초모집',
  additional: '추가모집',
};

/** 날짜가 비어 있는 자리에 쓰는 표기. */
const UNKNOWN_DATE = '미정';

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * 'YYYY-MM-DD' → 'YYYY. MM. DD.'
 *
 * 형식에 맞지 않는 값은 throw하지 않고 원본을 그대로 돌려준다 — 표시 함수가
 * 페이지 렌더를 중단시켜서는 안 되고, 이상값은 화면에 그대로 드러나는 편이
 * 조용히 감춰지는 것보다 낫다.
 */
export function formatDate(date: string): string {
  const matched = ISO_DATE_PATTERN.exec(date);
  if (!matched) return date;

  const [, year, month, day] = matched;
  return `${year}. ${month}. ${day}.`;
}

/**
 * 청약신청일을 표기한다.
 *
 * 기간(시작 ~ 마감)이 아니라 단일 날짜인 이유: 원본 view.do의 메타 영역이 노출하는
 * 날짜는 '공고게시일'과 '청약신청일' 둘뿐이고, 모집 마감일·발표일 항목은 존재하지
 * 않는다(2026-09-01 boardId 6644로 확인, ADR 014).
 *
 * 없으면 '미정' — 없는 마감일을 기다리게 만드는 '○○ ~ 미정' 표기를 쓰지 않는다.
 */
export function formatApplicationDate(date: string | null): string {
  return date === null ? UNKNOWN_DATE : formatDate(date);
}

/**
 * 목록이 빈 이유를 구분해 알린다 (#83 c-3 → #106에서 이 모듈로 이동).
 *
 * "공고가 하나도 없다"와 "필터에 걸리는 게 없다"와 "이 페이지 번호가 범위를
 * 넘었다"는 사용자가 취할 행동이 다르다 — 각각 기다리기, 필터 풀기, 앞 페이지로
 * 돌아가기다. 한 문구로 뭉치면 필터가 걸린 걸 잊은 방문자가 서비스가 비었다고
 * 오해한다.
 *
 * `total`은 필터 적용 후 전체 건수다(현재 페이지 항목 수가 아니다). total > 0인데
 * 이 함수가 호출됐다면 현재 페이지에 항목이 없다는 뜻 = 범위 초과다.
 */
export function listEmptyMessage(total: number, hasFilters: boolean): string {
  if (total > 0) {
    return '이 페이지에는 공고가 없습니다.';
  }
  return hasFilters
    ? '조건에 맞는 공고가 없습니다.'
    : '아직 등록된 공고가 없습니다.';
}

/** 건수 문구의 머리말. 필터가 걸려 있으면 "전체"라고 말하지 않는다. */
export function listCountLabel(total: number, hasFilters: boolean): string {
  return `${hasFilters ? '조건에 맞는 공고' : '전체'} ${total}건`;
}
