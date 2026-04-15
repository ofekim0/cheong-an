import * as cheerio from 'cheerio';
import type {
  AnnouncementDetail,
  AnnouncementType,
  RecruitmentType,
} from '@/types/announcement';

const BASE_URL = 'https://soco.seoul.go.kr';

/**
 * 상세 페이지 HTML에서 공고 정보를 추출한다.
 */
export function parseDetailPage(
  html: string,
  boardId: number,
): AnnouncementDetail {
  const $ = cheerio.load(html);

  const title = $('p.subject').first().text().trim();
  const announcementType = parseAnnouncementType(title);
  const recruitmentType = parseRecruitmentType(title);

  // view_data에서 메타 정보 추출
  const meta = extractMeta($);

  // 카테고리 option에서 지역구 추출
  const district = extractDistrict($);

  // 첨부파일
  const { attachmentUrl, attachmentName } = extractAttachment($);

  // board_cont에서 본문 텍스트 추출
  const $cont = $('div.board_cont');
  const rawContent = $cont.text().trim();

  // 본문에서 상세 정보 추출
  const complexName = extractField(rawContent, '단지명');
  const address = extractField(rawContent, '주택위치');
  const totalUnits = extractTotalUnits(rawContent);

  return {
    boardId,
    title,
    announcementType,
    recruitmentType,
    complexName,
    district,
    address,
    totalUnits,
    postDate: meta.postDate,
    applicationStartDate: meta.applicationStartDate,
    applicationEndDate: null,
    resultDate: null,
    attachmentUrl,
    attachmentName,
    rawContent,
  };
}

function parseAnnouncementType(title: string): AnnouncementType {
  if (title.includes('공공임대')) return 'public';
  return 'private';
}

function parseRecruitmentType(title: string): RecruitmentType {
  if (title.includes('추가모집')) return 'additional';
  return 'initial';
}

function extractMeta($: cheerio.CheerioAPI) {
  let postDate = '';
  let applicationStartDate: string | null = null;

  $('ul.view_data > li').each((_, el) => {
    const $li = $(el);
    const label = $li.find('span.title').text().trim();
    // span.title 이후의 텍스트 노드를 가져온다
    const value = $li.contents().not('span.title').text().trim();

    if (label === '공고게시일') {
      postDate = value;
    } else if (label === '청약신청일') {
      applicationStartDate = value || null;
    }
  });

  return { postDate, applicationStartDate };
}

function extractDistrict($: cheerio.CheerioAPI): string | null {
  let district: string | null = null;

  $('ul.view_data option').each((_, el) => {
    const text = $(el).text().trim();
    if (text) {
      district = text;
    }
  });

  return district;
}

function extractAttachment($: cheerio.CheerioAPI) {
  const $fileLink = $('a[href*="fileDown.do"]').first();
  if ($fileLink.length === 0) {
    return { attachmentUrl: null, attachmentName: null };
  }

  const href = $fileLink.attr('href') ?? '';
  const attachmentUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;
  const attachmentName = $fileLink.text().trim() || null;

  return { attachmentUrl, attachmentName };
}

function extractField(text: string, fieldName: string): string | null {
  // ■단지명 : 값 또는 ■ 단지명 : 값 패턴 매칭
  const regex = new RegExp(`■\\s*${fieldName}\\s*[:：]\\s*(.+?)(?:\\n|$)`);
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

function extractTotalUnits(text: string): number | null {
  // "총 100세대" 또는 "573세대" 패턴
  const match = text.match(/(?:총\s*)?(\d+)\s*세대/);
  return match ? Number(match[1]) : null;
}
