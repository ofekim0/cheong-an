/**
 * 공고 목록 → 상세 이동 E2E (#101, ADR 010).
 *
 * #96이 상세 페이지를 추가하고 목록 카드 링크를 내부로 돌렸는데 회귀 방어가
 * 없었다(머지 후 curl 스모크 1회뿐). 목록→상세는 우리가 소유한 표면이고 외부
 * 의존(실 OAuth·실 FCM)이 없어 ADR 010의 자동화 범위에 든다. ADR 015(목록 데이터
 * 전달 모델 전환)가 이 경로를 건드리기 전에 안전망으로 먼저 둔다.
 *
 * 열람은 공개다(ADR 009) — 비로그인 상태로 돌려 그 사실까지 함께 방어한다.
 *
 * 없는 boardId의 HTTP 상태 코드는 단언하지 않는다 — #100(soft 404)이 열려 있다.
 */

import { expect, test } from '@playwright/test';

import {
  deleteAnnouncement,
  SEED_ANNOUNCEMENT,
  seedAnnouncement,
} from './helpers/announcements';

const DETAIL_PATH = `/announcements/${SEED_ANNOUNCEMENT.board_id}`;

test.describe('공고 목록 → 상세 이동 (비로그인)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  // 두 테스트가 같은 시드 row를 공유하므로 직렬 실행한다 — fullyParallel에서 워커가
  // 갈리면 beforeAll/afterAll이 워커마다 돌아, 한쪽의 afterAll이 시드를 지우는 사이
  // 다른 쪽 상세 페이지가 404가 되는 race가 난다(sendChannels.spec.ts와 같은 이유).
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    await seedAnnouncement();
  });

  test.afterAll(async () => {
    await deleteAnnouncement(SEED_ANNOUNCEMENT.board_id);
  });

  test('카드를 클릭하면 내부 상세로 이동하고 제목·날짜·본문·원본 링크가 렌더된다', async ({
    page,
  }) => {
    await page.goto('/announcements');

    // 카드 링크는 내부 경로여야 한다 — soco(view.do)로 나가면 #96 회귀다.
    const card = page.getByRole('link', { name: SEED_ANNOUNCEMENT.title });
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('href', DETAIL_PATH);

    await card.click();
    await expect(page).toHaveURL(new RegExp(`${DETAIL_PATH}$`));

    // 상세 본문은 `article` 안에 있다. 범위를 좁히는 이유: 클라이언트 내비게이션
    // 직후에는 목록 카드의 날짜 `<dd>`가 아직 DOM에 남아 같은 문자열이 둘이 된다.
    const article = page.getByRole('article');

    // 제목·날짜·본문. 날짜 포맷은 formatDate(`YYYY. MM. DD.`)를 따른다.
    await expect(
      article.getByRole('heading', { level: 1, name: SEED_ANNOUNCEMENT.title }),
    ).toBeVisible();
    await expect(article.getByText('2026. 01. 15.')).toBeVisible();
    await expect(article.getByText('2026. 02. 01.')).toBeVisible();
    await expect(
      article.getByText('E2E 시드 본문 첫 줄입니다.', { exact: false }),
    ).toBeVisible();

    // 원본 링크(#98): 첨부가 없어도 항상 노출되고 soco의 해당 boardId를 가리킨다.
    const sourceLink = article.getByRole('link', { name: /원본 공고 보기/ });
    await expect(sourceLink).toHaveAttribute(
      'href',
      `https://soco.seoul.go.kr/youth/bbs/BMSR00015/view.do?boardId=${SEED_ANNOUNCEMENT.board_id}&menuNo=400008`,
    );
    await expect(sourceLink).toHaveAttribute('target', '_blank');
  });

  /**
   * 필터 클릭은 서버 왕복 없이 URL만 바꾼다(ADR 015, #106). 시드가 민간 1건이므로
   * "공공"을 걸면 0건, 다시 "전체"로 돌리면 1건이다 — 건수 문구와 URL이 함께 움직이는지,
   * 그리고 그 사이에 문서 요청(RSC 페이로드 포함)이 발생하지 않는지를 본다.
   */
  test('필터 칩을 누르면 서버 요청 없이 URL과 건수가 바뀐다', async ({
    page,
  }) => {
    await page.goto('/announcements');
    const count = page.locator('main > p').first();
    await expect(count).toHaveText(/전체 \d+건/);

    // 클릭 이후 발생하는 document·fetch 요청을 잡는다. 정적 자산은 제외한다.
    const requests: string[] = [];
    page.on('request', (request) => {
      const type = request.resourceType();
      if (type === 'document' || type === 'fetch' || type === 'xhr') {
        requests.push(request.url());
      }
    });

    await page.getByRole('link', { name: '공공', exact: true }).click();
    await expect(page).toHaveURL(/\?type=public$/);
    await expect(count).toHaveText('조건에 맞는 공고 0건');
    await expect(page.getByText('조건에 맞는 공고가 없습니다.')).toBeVisible();

    // 유형 필터의 "전체"로 되돌린다(모집 필터의 "전체"는 선택 상태라 링크가 아니다).
    await page
      .getByRole('navigation', { name: '유형 필터' })
      .getByRole('link', { name: '전체', exact: true })
      .click();
    await expect(page).toHaveURL(/\/announcements$/);
    await expect(count).toHaveText(/전체 \d+건/);
    await expect(
      page.getByRole('link', { name: SEED_ANNOUNCEMENT.title }),
    ).toBeVisible();

    expect(requests, '필터 클릭이 서버 요청을 유발했다').toEqual([]);
  });
});
