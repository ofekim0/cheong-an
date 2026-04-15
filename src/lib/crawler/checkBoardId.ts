/**
 * 마지막으로 확인한 boardId와 새로 추출한 목록을 비교하여
 * 새 공고 boardId 목록을 반환한다.
 *
 * 메인 페이지에는 최신 5건만 표시되므로, 5건 초과 동시 등록 시
 * boardId 범위 내 빈 번호도 후보로 포함한다.
 */
export function findNewBoardIds(
  currentBoardIds: number[],
  lastBoardId: number,
): number[] {
  if (currentBoardIds.length === 0) return [];

  // lastBoardId보다 큰 것만 새 공고
  const newFromMain = currentBoardIds.filter((id) => id > lastBoardId);

  if (newFromMain.length === 0) return [];

  // 범위 내 빈 번호 찾기 (누락 방지)
  const maxId = Math.max(...currentBoardIds);
  const candidates = fillGaps(lastBoardId, maxId);

  return candidates;
}

/**
 * lastBoardId+1 ~ maxId 범위에서 currentBoardIds에 없는 빈 번호를 포함하여
 * 전체 새 공고 후보 목록을 반환한다.
 */
function fillGaps(lastBoardId: number, maxId: number): number[] {
  const candidates: number[] = [];

  for (let id = lastBoardId + 1; id <= maxId; id++) {
    candidates.push(id);
  }

  return candidates;
}

/**
 * 후보 boardId 중 실제로 존재하는지 확인이 필요한 것들을 분리한다.
 */
export function separateKnownAndUnknown(
  candidates: number[],
  knownBoardIds: number[],
): { confirmed: number[]; needsVerification: number[] } {
  const knownSet = new Set(knownBoardIds);

  const confirmed = candidates.filter((id) => knownSet.has(id));
  const needsVerification = candidates.filter((id) => !knownSet.has(id));

  return { confirmed, needsVerification };
}
