import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseListJson, ParseListJsonError } from './parseListJson';

const fixtureJson = readFileSync(
  join(__dirname, '__fixtures__', 'listJson.json'),
  'utf-8',
);

describe('parseListJson', () => {
  it('실 응답의 첫 페이지 10건을 모두 파싱한다', () => {
    const items = parseListJson(fixtureJson);
    expect(items).toHaveLength(10);
  });

  it('첫 번째 item을 정확히 매핑한다', () => {
    const [first] = parseListJson(fixtureJson);
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
    const ids = parseListJson(fixtureJson).map((i) => i.boardId);
    const sorted = [...ids].sort((a, b) => b - a);
    expect(ids).toEqual(sorted);
  });

  it('resultList가 빈 응답은 빈 배열을 반환한다', () => {
    const empty = JSON.stringify({
      pagingInfo: { totRow: 0 },
      resultList: [],
    });
    expect(parseListJson(empty)).toEqual([]);
  });

  it('resultList 키가 누락된 응답도 빈 배열을 반환한다', () => {
    const noKey = JSON.stringify({ pagingInfo: { totRow: 0 } });
    expect(parseListJson(noKey)).toEqual([]);
  });

  it('빈 optn1/optn4/optn3/atchFileId를 null로 변환한다', () => {
    const minimal = JSON.stringify({
      resultList: [
        {
          boardId: 1,
          nttSj: 'X',
          content: '',
          optn1: '',
          optn2: '1',
          optn3: '   ',
          optn4: '',
          optn5: '1',
          atchFileId: '',
          regDate: 0,
        },
      ],
    });
    const [item] = parseListJson(minimal);
    expect(item.applicationStartDate).toBeNull();
    expect(item.applicationEndDate).toBeNull();
    expect(item.agency).toBeNull();
    expect(item.attachmentId).toBeNull();
  });

  it('알 수 없는 optn2 값은 ParseListJsonError로 던진다', () => {
    const bad = JSON.stringify({
      resultList: [
        {
          boardId: 1,
          nttSj: 'X',
          content: '',
          optn1: '',
          optn2: '9',
          optn3: '',
          optn4: '',
          optn5: '1',
          atchFileId: '',
          regDate: 0,
        },
      ],
    });
    expect(() => parseListJson(bad)).toThrow(ParseListJsonError);
  });

  it('알 수 없는 optn5 값은 ParseListJsonError로 던진다', () => {
    const bad = JSON.stringify({
      resultList: [
        {
          boardId: 1,
          nttSj: 'X',
          content: '',
          optn1: '',
          optn2: '1',
          optn3: '',
          optn4: '',
          optn5: '9',
          atchFileId: '',
          regDate: 0,
        },
      ],
    });
    expect(() => parseListJson(bad)).toThrow(ParseListJsonError);
  });

  it('optn2가 null이면 제목으로 폴백한다 — 공공임대 포함은 public (#71)', () => {
    const missing = JSON.stringify({
      resultList: [
        {
          boardId: 1,
          nttSj: '[공공임대] 2026년 3차 청년안심주택 모집공고',
          content: '',
          optn1: '',
          optn2: null,
          optn3: '',
          optn4: '',
          optn5: '1',
          atchFileId: '',
          regDate: 0,
        },
      ],
    });
    const [item] = parseListJson(missing);
    expect(item.announcementType).toBe('public');
  });

  it('optn2가 null이고 제목에 공공임대가 없으면 private으로 폴백한다', () => {
    const missing = JSON.stringify({
      resultList: [
        {
          boardId: 1,
          nttSj: '[민간임대] 어딘가역 최초모집공고',
          content: '',
          optn1: '',
          optn2: null,
          optn3: '',
          optn4: '',
          optn5: '1',
          atchFileId: '',
          regDate: 0,
        },
      ],
    });
    const [item] = parseListJson(missing);
    expect(item.announcementType).toBe('private');
  });

  it('optn2가 빈 문자열이어도 제목 폴백을 태운다', () => {
    const blank = JSON.stringify({
      resultList: [
        {
          boardId: 1,
          nttSj: 'X',
          content: '',
          optn1: '',
          optn2: '  ',
          optn3: '',
          optn4: '',
          optn5: '1',
          atchFileId: '',
          regDate: 0,
        },
      ],
    });
    const [item] = parseListJson(blank);
    expect(item.announcementType).toBe('private');
  });

  it('optn5가 null이면 제목으로 폴백한다 — 추가모집 미포함은 initial (#68, boardId 6624 재현)', () => {
    const missing = JSON.stringify({
      resultList: [
        {
          boardId: 6624,
          nttSj: '[공공임대] 2026년 2차 청년안심주택 모집공고',
          content: '',
          optn1: '',
          optn2: '1',
          optn3: '',
          optn4: '',
          optn5: null,
          atchFileId: '',
          regDate: 0,
        },
      ],
    });
    const [item] = parseListJson(missing);
    expect(item.recruitmentType).toBe('initial');
  });

  it('optn5가 null이고 제목에 추가모집이 있으면 additional로 폴백한다', () => {
    const missing = JSON.stringify({
      resultList: [
        {
          boardId: 1,
          nttSj: '[민간임대] 어딘가역 추가모집공고',
          content: '',
          optn1: '',
          optn2: '2',
          optn3: '',
          optn4: '',
          optn5: null,
          atchFileId: '',
          regDate: 0,
        },
      ],
    });
    const [item] = parseListJson(missing);
    expect(item.recruitmentType).toBe('additional');
  });

  it('optn5가 빈 문자열이어도 제목 폴백을 태운다', () => {
    const blank = JSON.stringify({
      resultList: [
        {
          boardId: 1,
          nttSj: 'X',
          content: '',
          optn1: '',
          optn2: '1',
          optn3: '',
          optn4: '',
          optn5: '  ',
          atchFileId: '',
          regDate: 0,
        },
      ],
    });
    const [item] = parseListJson(blank);
    expect(item.recruitmentType).toBe('initial');
  });

  it('잘못된 JSON은 ParseListJsonError로 던진다', () => {
    expect(() => parseListJson('not json')).toThrow(ParseListJsonError);
  });

  it('regDate(epoch ms)를 KST 기준 YYYY-MM-DD로 변환한다', () => {
    // KST 2026-01-01 00:00 == 2025-12-31T15:00:00Z
    const ms = Date.UTC(2025, 11, 31, 15, 0, 0);
    const sample = JSON.stringify({
      resultList: [
        {
          boardId: 1,
          nttSj: 'X',
          content: '',
          optn1: '',
          optn2: '1',
          optn3: '',
          optn4: '',
          optn5: '1',
          atchFileId: '',
          regDate: ms,
        },
      ],
    });
    const [item] = parseListJson(sample);
    expect(item.postDate).toBe('2026-01-01');
  });
});
