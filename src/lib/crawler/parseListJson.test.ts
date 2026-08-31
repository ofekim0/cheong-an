import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseListJson, ParseListJsonError } from './parseListJson';

const fixtureJson = readFileSync(
  join(__dirname, '__fixtures__', 'listJson.json'),
  'utf-8',
);

/** 유효한 항목 1건. 격리 테스트에서 필드 하나씩 어긋내는 베이스로 쓴다. */
const validRow = {
  boardId: 1,
  nttSj: 'X',
  content: '',
  optn1: '',
  optn2: '1',
  optn3: '',
  optn4: '',
  optn5: '1',
  atchFileId: '',
  regDate: 0,
};

const listOf = (...rows: unknown[]) => JSON.stringify({ resultList: rows });

describe('parseListJson', () => {
  it('실 응답의 첫 페이지 10건을 모두 파싱하고 격리는 없다', () => {
    const { items, isolated } = parseListJson(fixtureJson);
    expect(items).toHaveLength(10);
    expect(isolated).toEqual([]);
  });

  it('첫 번째 item을 정확히 매핑한다', () => {
    const [first] = parseListJson(fixtureJson).items;
    expect(first.boardId).toBe(6539);
    expect(first.title).toBe('[민간임대] 태릉입구역 와이엔타워 추가모집공고');
    expect(first.announcementType).toBe('private');
    expect(first.recruitmentType).toBe('additional');
    expect(first.agency).toBe('태운산업개발(주)');
    expect(first.applicationStartDate).toBe('2026-05-14');
    expect(first.applicationEndDate).toBe('2026-05-18');
    expect(first.attachmentId).toBe('5f6e0d6f9a9748fca37ed0bb2b949ff5');
    expect(first.postDate).toBe('2026-05-14');
    expect(first.rawContent.length).toBeGreaterThan(0);
  });

  it('boardId는 내림차순(최신이 앞)으로 들어 있다', () => {
    const ids = parseListJson(fixtureJson).items.map((i) => i.boardId);
    const sorted = [...ids].sort((a, b) => b - a);
    expect(ids).toEqual(sorted);
  });

  it('resultList가 빈 응답은 빈 결과를 반환한다', () => {
    const empty = JSON.stringify({
      pagingInfo: { totRow: 0 },
      resultList: [],
    });
    expect(parseListJson(empty)).toEqual({ items: [], isolated: [] });
  });

  it('resultList 키가 누락된 응답도 빈 결과를 반환한다', () => {
    const noKey = JSON.stringify({ pagingInfo: { totRow: 0 } });
    expect(parseListJson(noKey)).toEqual({ items: [], isolated: [] });
  });

  it('빈 optn1/optn4/optn3/atchFileId를 null로 변환한다', () => {
    const [item] = parseListJson(listOf({ ...validRow, optn3: '   ' })).items;
    expect(item.applicationStartDate).toBeNull();
    expect(item.applicationEndDate).toBeNull();
    expect(item.agency).toBeNull();
    expect(item.attachmentId).toBeNull();
  });

  // --- row 격리 (ADR 012, #72) ---

  it('알 수 없는 optn2 값은 해당 row만 격리한다', () => {
    const { items, isolated } = parseListJson(
      listOf({ ...validRow, optn2: '9' }),
    );
    expect(items).toEqual([]);
    expect(isolated).toHaveLength(1);
    expect(isolated[0].boardId).toBe(1);
    expect(isolated[0].reason).toContain('optn2');
    expect(isolated[0].reason).toContain('"9"');
  });

  it('알 수 없는 optn5 값은 해당 row만 격리한다', () => {
    const { items, isolated } = parseListJson(
      listOf({ ...validRow, optn5: '9' }),
    );
    expect(items).toEqual([]);
    expect(isolated).toHaveLength(1);
    expect(isolated[0].boardId).toBe(1);
    expect(isolated[0].reason).toContain('optn5');
  });

  it('nttSj 누락 row를 격리한다', () => {
    const { items, isolated } = parseListJson(
      listOf({ ...validRow, nttSj: undefined }),
    );
    expect(items).toEqual([]);
    expect(isolated).toHaveLength(1);
    expect(isolated[0].boardId).toBe(1);
    expect(isolated[0].reason).toContain('nttSj');
  });

  it('nttSj가 공백뿐인 row를 격리한다', () => {
    const { isolated } = parseListJson(listOf({ ...validRow, nttSj: '  ' }));
    expect(isolated).toHaveLength(1);
    expect(isolated[0].reason).toContain('nttSj');
  });

  it('regDate가 숫자가 아닌 row를 격리한다', () => {
    const { items, isolated } = parseListJson(
      listOf({ ...validRow, regDate: '2026-08-01' }),
    );
    expect(items).toEqual([]);
    expect(isolated).toHaveLength(1);
    expect(isolated[0].reason).toContain('regDate');
  });

  it('boardId가 양의 정수가 아닌 row는 boardId null로 격리한다', () => {
    const { isolated } = parseListJson(listOf({ ...validRow, boardId: 'abc' }));
    expect(isolated).toHaveLength(1);
    expect(isolated[0].boardId).toBeNull();
    expect(isolated[0].reason).toContain('boardId');
  });

  it('불량 row가 섞여 있어도 유효 row는 살아남는다 — #68 시나리오', () => {
    const { items, isolated } = parseListJson(
      listOf(
        { ...validRow, boardId: 6625 },
        { ...validRow, boardId: 6624, optn5: '9' },
        { ...validRow, boardId: 6623 },
      ),
    );
    expect(items.map((i) => i.boardId)).toEqual([6625, 6623]);
    expect(isolated).toEqual([
      { boardId: 6624, reason: expect.stringContaining('optn5') },
    ]);
  });

  it('전 항목 격리 시 items가 빈다 — LIST_EMPTY 불변식이 잡는 경계 (ADR 012)', () => {
    const { items, isolated } = parseListJson(
      listOf({ ...validRow, optn2: '3' }, { ...validRow, optn2: '3' }),
    );
    expect(items).toEqual([]);
    expect(isolated).toHaveLength(2);
  });

  // --- 폴백 (#68/#71) — 미기재는 격리가 아니라 데이터로 살린다 ---

  it('optn2가 null이면 제목으로 폴백한다 — 공공임대 포함은 public (#71)', () => {
    const [item] = parseListJson(
      listOf({
        ...validRow,
        nttSj: '[공공임대] 2026년 3차 청년안심주택 모집공고',
        optn2: null,
      }),
    ).items;
    expect(item.announcementType).toBe('public');
  });

  it('optn2가 null이고 제목에 공공임대가 없으면 private으로 폴백한다', () => {
    const [item] = parseListJson(
      listOf({
        ...validRow,
        nttSj: '[민간임대] 어딘가역 최초모집공고',
        optn2: null,
      }),
    ).items;
    expect(item.announcementType).toBe('private');
  });

  it('optn2가 빈 문자열이어도 제목 폴백을 태운다', () => {
    const [item] = parseListJson(listOf({ ...validRow, optn2: '  ' })).items;
    expect(item.announcementType).toBe('private');
  });

  it('optn5가 null이면 제목으로 폴백한다 — 추가모집 미포함은 initial (#68, boardId 6624 재현)', () => {
    const [item] = parseListJson(
      listOf({
        ...validRow,
        boardId: 6624,
        nttSj: '[공공임대] 2026년 2차 청년안심주택 모집공고',
        optn5: null,
      }),
    ).items;
    expect(item.recruitmentType).toBe('initial');
  });

  it('optn5가 null이고 제목에 추가모집이 있으면 additional로 폴백한다', () => {
    const [item] = parseListJson(
      listOf({
        ...validRow,
        nttSj: '[민간임대] 어딘가역 추가모집공고',
        optn5: null,
      }),
    ).items;
    expect(item.recruitmentType).toBe('additional');
  });

  it('optn5가 빈 문자열이어도 제목 폴백을 태운다', () => {
    const [item] = parseListJson(listOf({ ...validRow, optn5: '  ' })).items;
    expect(item.recruitmentType).toBe('initial');
  });

  // --- 응답 전체 이상은 격리가 아니라 throw (ADR 012 경계) ---

  it('잘못된 JSON은 ParseListJsonError로 던진다', () => {
    expect(() => parseListJson('not json')).toThrow(ParseListJsonError);
  });

  it('regDate(epoch ms)를 KST 기준 YYYY-MM-DD로 변환한다', () => {
    // KST 2026-01-01 00:00 == 2025-12-31T15:00:00Z
    const ms = Date.UTC(2025, 11, 31, 15, 0, 0);
    const [item] = parseListJson(listOf({ ...validRow, regDate: ms })).items;
    expect(item.postDate).toBe('2026-01-01');
  });
});
