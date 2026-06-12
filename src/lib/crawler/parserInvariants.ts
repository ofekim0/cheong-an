/**
 * 파서 출력 불변식 검증 (ADR 006).
 *
 * 책임 범위:
 * - parseListJson / parseDetailPage 출력이 "사이트가 우리 밑에서 바뀌지 않았다"는
 *   구조적 불변식을 만족하는지 검사한다.
 * - 위반을 구조화된 InvariantViolation[]로 반환한다. throw 하지 않는다 —
 *   위반 시 무엇을 할지는 호출자가 정한다(라이브 카나리는 cron 500, 테스트는 expect).
 * - 같은 함수를 CI 픽스처 계약 테스트와 운영 중 라이브 카나리가 공유한다.
 *
 * 책임이 아닌 것:
 * - HTTP / 파싱 자체 (parseListJson, parseDetailPage).
 * - 위반 시 동작 (호출자의 일).
 * - 확률적 드리프트 추적 (ADR 006에서 보류한 선택지 C).
 *
 * 불변식은 모두 "이진(binary)"이다 — 정상 응답이면 반드시 만족, 위반이면 사이트
 * 구조 변경. 카운트 기반 휴리스틱(연속 0건 등)은 부트스트랩·한산한 시기와 구분
 * 불가하므로 의도적으로 쓰지 않는다(ADR 006 근거).
 */

import type {
  AnnouncementDetail,
  AnnouncementListItem,
} from '@/types/announcement';

export type InvariantCode =
  | 'LIST_EMPTY'
  | 'LIST_ITEM_INVALID_BOARD_ID'
  | 'LIST_ITEM_EMPTY_TITLE'
  | 'DETAIL_EMPTY_TITLE_AND_CONTENT'
  | 'DETAIL_INVALID_POST_DATE';

export interface InvariantViolation {
  code: InvariantCode;
  message: string;
}

/** detail.postDate / listItem.postDate가 따르는 KST 날짜 형식. */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 리스트 JSON 파서 출력 불변식 (ADR 006 S1).
 *
 * 게시판 1페이지 API는 항상 최신 N건을 반환하므로 빈 배열은 "신규 0건"이 아니라
 * 빈 resultList·키 소실(= 사이트 변경)을 뜻한다. parseListJson은 `resultList ?? []`로
 * 키 소실도 throw 없이 통과시키므로, 여기서 빈 배열을 위반으로 잡는다.
 */
export function checkListInvariants(
  items: AnnouncementListItem[],
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];

  if (items.length === 0) {
    violations.push({
      code: 'LIST_EMPTY',
      message:
        'list parser returned 0 items — empty resultList or missing key (site shape changed)',
    });
    // 배열이 비면 item별 검사는 의미 없으므로 조기 반환.
    return violations;
  }

  items.forEach((item, index) => {
    if (!Number.isInteger(item.boardId) || item.boardId <= 0) {
      violations.push({
        code: 'LIST_ITEM_INVALID_BOARD_ID',
        message: `resultList[${index}].boardId is not a positive integer: ${JSON.stringify(item.boardId)}`,
      });
    }
    if (item.title.trim().length === 0) {
      violations.push({
        code: 'LIST_ITEM_EMPTY_TITLE',
        message: `resultList[${index}].title is empty after trim`,
      });
    }
  });

  return violations;
}

/**
 * 상세 페이지 파서 출력 불변식 (ADR 006 S2).
 *
 * 에러 페이지(isViewErrorPage)가 아닌 정상 응답에만 적용한다. title과 rawContent가
 * 동시에 비면 view.do 셀렉터가 전멸한 것(= 페이지 구조 변경). 한쪽만 비는 건 정상일
 * 수 있어 AND로 판단한다.
 */
export function checkDetailInvariants(
  detail: AnnouncementDetail,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];

  if (
    detail.title.trim().length === 0 &&
    detail.rawContent.trim().length === 0
  ) {
    violations.push({
      code: 'DETAIL_EMPTY_TITLE_AND_CONTENT',
      message: `boardId ${detail.boardId}: both title and rawContent empty — detail selectors matched nothing (site shape changed)`,
    });
  }

  if (!DATE_PATTERN.test(detail.postDate)) {
    violations.push({
      code: 'DETAIL_INVALID_POST_DATE',
      message: `boardId ${detail.boardId}: postDate is not YYYY-MM-DD: ${JSON.stringify(detail.postDate)}`,
    });
  }

  return violations;
}
