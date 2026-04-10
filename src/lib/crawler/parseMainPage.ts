import * as cheerio from 'cheerio';
import type { AnnouncementSummary } from '@/types/announcement';

/**
 * 메인 페이지 HTML에서 모집공고 목록의 boardId, 제목, 날짜를 추출한다.
 * 선택자: ul.mainBoard_list > li > a[href*=boardId]
 */
export function parseMainPage(html: string): AnnouncementSummary[] {
  const $ = cheerio.load(html);
  const results: AnnouncementSummary[] = [];

  $('ul.mainBoard_list > li').each((_, el) => {
    const $li = $(el);

    // "전체보기" 링크는 건너뛴다
    if ($li.hasClass('more_w')) return;

    const $a = $li.find('a');
    const href = $a.attr('href') ?? '';
    const boardIdMatch = href.match(/boardId=(\d+)/);
    if (!boardIdMatch) return;

    const boardId = Number(boardIdMatch[1]);
    const title = $a.text().trim();
    const postDate = $li.find('span.txDate').text().trim();

    results.push({ boardId, title, postDate });
  });

  return results;
}
