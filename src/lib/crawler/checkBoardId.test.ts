import { describe, it, expect } from 'vitest';
import { findNewBoardIds, separateKnownAndUnknown } from './checkBoardId';

describe('findNewBoardIds', () => {
  it('lastBoardId보다 큰 boardId만 새 공고로 감지한다', () => {
    const result = findNewBoardIds([6485, 6479, 6478, 6477, 6474], 6477);

    expect(result).toContain(6478);
    expect(result).toContain(6479);
    expect(result).toContain(6485);
    expect(result).not.toContain(6477);
    expect(result).not.toContain(6474);
  });

  it('범위 내 빈 번호를 후보에 포함한다', () => {
    // lastBoardId=6477, max=6485 → 6478~6485 범위
    // 6480, 6481, 6482, 6483, 6484는 메인에 없지만 후보에 포함
    const result = findNewBoardIds([6485, 6479, 6478, 6477, 6474], 6477);

    expect(result).toContain(6480);
    expect(result).toContain(6481);
    expect(result).toContain(6482);
    expect(result).toContain(6483);
    expect(result).toContain(6484);
  });

  it('새 공고가 없으면 빈 배열을 반환한다', () => {
    const result = findNewBoardIds([6485, 6479, 6478], 6485);

    expect(result).toEqual([]);
  });

  it('빈 배열이 입력되면 빈 배열을 반환한다', () => {
    const result = findNewBoardIds([], 6000);

    expect(result).toEqual([]);
  });

  it('후보를 오름차순으로 정렬한다', () => {
    const result = findNewBoardIds([6485, 6479, 6478], 6477);

    for (let i = 1; i < result.length; i++) {
      expect(result[i]).toBeGreaterThan(result[i - 1]);
    }
  });

  it('연속된 boardId에서는 빈 번호가 없다', () => {
    const result = findNewBoardIds([103, 102, 101], 100);

    expect(result).toEqual([101, 102, 103]);
  });
});

describe('separateKnownAndUnknown', () => {
  it('알려진 ID와 검증 필요한 ID를 분리한다', () => {
    const candidates = [6478, 6479, 6480, 6481, 6485];
    const knownBoardIds = [6478, 6479, 6485];

    const { confirmed, needsVerification } = separateKnownAndUnknown(
      candidates,
      knownBoardIds,
    );

    expect(confirmed).toEqual([6478, 6479, 6485]);
    expect(needsVerification).toEqual([6480, 6481]);
  });

  it('모든 ID가 알려진 경우 검증 필요한 목록이 비어있다', () => {
    const candidates = [101, 102, 103];
    const knownBoardIds = [101, 102, 103];

    const { needsVerification } = separateKnownAndUnknown(
      candidates,
      knownBoardIds,
    );

    expect(needsVerification).toEqual([]);
  });

  it('알려진 ID가 없으면 모두 검증 필요하다', () => {
    const candidates = [101, 102, 103];

    const { confirmed, needsVerification } = separateKnownAndUnknown(
      candidates,
      [],
    );

    expect(confirmed).toEqual([]);
    expect(needsVerification).toEqual([101, 102, 103]);
  });
});
