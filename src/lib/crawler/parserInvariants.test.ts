import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseListJson } from './parseListJson';
import { parseDetailPage } from './parseDetailPage';
import { checkListInvariants, checkDetailInvariants } from './parserInvariants';
import type {
  AnnouncementDetail,
  AnnouncementListItem,
} from '@/types/announcement';

const fixtureJson = readFileSync(
  join(__dirname, '__fixtures__', 'listJson.json'),
  'utf-8',
);
const fixtureHtml = readFileSync(
  join(__dirname, '__fixtures__', 'detailPage.html'),
  'utf-8',
);
const FIXTURE_BOARD_ID = 6539;

/** 정상 baseline에서 override만 바꿔 위반 케이스를 만든다. */
function makeListItem(
  overrides: Partial<AnnouncementListItem> = {},
): AnnouncementListItem {
  return {
    boardId: 6539,
    title: '[민간임대] 샘플 공고',
    announcementType: 'private',
    recruitmentType: 'initial',
    agency: null,
    postDate: '2026-05-14',
    applicationDate: null,
    attachmentId: null,
    rawContent: 'x',
    ...overrides,
  };
}

function makeDetail(
  overrides: Partial<AnnouncementDetail> = {},
): AnnouncementDetail {
  return {
    boardId: 6539,
    title: '샘플 제목',
    announcementType: 'private',
    recruitmentType: 'initial',
    complexName: null,
    district: null,
    address: null,
    totalUnits: null,
    postDate: '2026-05-14',
    applicationDate: null,
    attachmentUrl: null,
    attachmentName: null,
    rawContent: '본문 내용',
    ...overrides,
  };
}

const codesOf = (violations: { code: string }[]) =>
  violations.map((v) => v.code);

describe('checkListInvariants', () => {
  it('실 응답 픽스처는 위반 0건 (정상 계약)', () => {
    expect(checkListInvariants(parseListJson(fixtureJson).items)).toEqual([]);
  });

  // 사이트가 응답 형태를 바꾸면 parseListJson은 throw 없이 빈 items를 반환한다
  // (resultList ?? []). 불변식이 그 침묵을 잡아내는 것이 이 테스트의 핵심.
  describe('사이트 변경 시뮬레이션 — 파서는 조용히 통과, 불변식이 잡는다', () => {
    it('S1: resultList가 빈 응답 → 파서는 빈 items, LIST_EMPTY', () => {
      const { items } = parseListJson(JSON.stringify({ resultList: [] }));
      expect(items).toEqual([]); // 파서는 throw 없이 통과
      expect(codesOf(checkListInvariants(items))).toEqual(['LIST_EMPTY']);
    });

    it('S1: resultList 키 누락 → 파서는 빈 items, LIST_EMPTY', () => {
      const { items } = parseListJson(JSON.stringify({ pagingInfo: {} }));
      expect(items).toEqual([]);
      expect(codesOf(checkListInvariants(items))).toEqual(['LIST_EMPTY']);
    });

    // ADR 012 경계: 전 항목이 row 격리되면 유효 items가 비고, 같은 LIST_EMPTY가
    // 잡는다 — 국지적 오입력은 격리, 전면 붕괴는 중단.
    it('전 항목 row 격리 → 유효 items가 비어 LIST_EMPTY', () => {
      const allBad = JSON.stringify({
        resultList: [
          { boardId: 1, nttSj: 'A', optn2: '9', optn5: '1', regDate: 0 },
          { boardId: 2, nttSj: 'B', optn2: '9', optn5: '1', regDate: 0 },
        ],
      });
      const { items, isolated } = parseListJson(allBad);
      expect(isolated).toHaveLength(2);
      expect(codesOf(checkListInvariants(items))).toEqual(['LIST_EMPTY']);
    });
  });

  it('boardId가 양의 정수가 아니면 LIST_ITEM_INVALID_BOARD_ID', () => {
    for (const boardId of [0, -1, 1.5, NaN]) {
      expect(
        codesOf(checkListInvariants([makeListItem({ boardId })])),
      ).toContain('LIST_ITEM_INVALID_BOARD_ID');
    }
  });

  it('title이 trim 후 비면 LIST_ITEM_EMPTY_TITLE', () => {
    expect(
      codesOf(checkListInvariants([makeListItem({ title: '   ' })])),
    ).toContain('LIST_ITEM_EMPTY_TITLE');
  });

  it('위반 메시지에 어느 item인지 인덱스를 포함한다', () => {
    const [violation] = checkListInvariants([
      makeListItem(),
      makeListItem({ title: '' }),
    ]);
    expect(violation.message).toContain('[1]');
  });
});

describe('checkDetailInvariants', () => {
  it('실 응답 픽스처는 위반 0건 (정상 계약)', () => {
    expect(
      checkDetailInvariants(parseDetailPage(fixtureHtml, FIXTURE_BOARD_ID)),
    ).toEqual([]);
  });

  describe('사이트 변경 시뮬레이션 — 파서는 조용히 통과, 불변식이 잡는다', () => {
    it('S2: 셀렉터가 다 빗나간 재디자인 페이지 → 빈 값으로 통과, DETAIL_EMPTY_TITLE_AND_CONTENT', () => {
      // 내용은 있지만 우리 셀렉터(p.subject, div.board_cont)와 다른 마크업.
      const redesigned =
        '<html><body><h1>새 디자인 제목</h1><div class="content">본문 내용</div></body></html>';
      const detail = parseDetailPage(redesigned, 9999);
      expect(detail.title).toBe(''); // 파서는 throw 없이 빈 값
      expect(detail.rawContent).toBe('');
      expect(codesOf(checkDetailInvariants(detail))).toContain(
        'DETAIL_EMPTY_TITLE_AND_CONTENT',
      );
    });
  });

  it('postDate가 YYYY-MM-DD가 아니면 DETAIL_INVALID_POST_DATE', () => {
    for (const postDate of ['2026.05.14', '2026/05/14', '', '날짜미정']) {
      expect(
        codesOf(checkDetailInvariants(makeDetail({ postDate }))),
      ).toContain('DETAIL_INVALID_POST_DATE');
    }
  });

  it('title만 비고 rawContent가 있으면 위반 아님 (AND 조건)', () => {
    // 한쪽만 비는 건 정상일 수 있어 AND로 판단 (ADR 006).
    expect(checkDetailInvariants(makeDetail({ title: '' }))).toEqual([]);
  });

  it('nullable 필드(totalUnits·complexName·district)가 null이어도 위반 아님', () => {
    // null이 정상인 선택적 필드엔 이진 불변식을 걸지 않는다 (ADR 006).
    expect(
      checkDetailInvariants(
        makeDetail({ totalUnits: null, complexName: null, district: null }),
      ),
    ).toEqual([]);
  });
});
