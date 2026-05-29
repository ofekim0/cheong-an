import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { AnnouncementDetail } from '@/types/announcement';

import { detailToRow, upsertAnnouncements } from './announcementsRepository';

function buildDetail(
  overrides: Partial<AnnouncementDetail> = {},
): AnnouncementDetail {
  return {
    boardId: 1001,
    title: '청년안심주택 ○○ 단지 입주자 모집공고',
    announcementType: 'public',
    recruitmentType: 'initial',
    complexName: '○○ 청년안심주택',
    district: '강남구',
    address: '서울특별시 강남구 ...',
    totalUnits: 100,
    postDate: '2026-05-01',
    applicationStartDate: '2026-05-10',
    applicationEndDate: '2026-05-20',
    resultDate: '2026-06-01',
    attachmentUrl: 'https://example.com/file.pdf',
    attachmentName: '모집공고문.pdf',
    rawContent: '<div>raw html</div>',
    ...overrides,
  };
}

/**
 * Supabase 메서드 체이닝(`from().upsert()`)을 위한 mock 헬퍼.
 * - upsert는 `await` 대상이므로 Promise를 반환.
 */
function createMockClient(result: { error: { message: string } | null }) {
  const upsert = vi.fn().mockResolvedValue(result);
  const from = vi.fn().mockReturnValue({ upsert });
  const client = { from } as unknown as SupabaseClient;
  return { client, from, upsert };
}

describe('detailToRow', () => {
  it('모든 필드를 camelCase → snake_case로 매핑한다', () => {
    const detail = buildDetail();
    const row = detailToRow(detail);

    expect(row).toEqual({
      board_id: 1001,
      title: '청년안심주택 ○○ 단지 입주자 모집공고',
      announcement_type: 'public',
      recruitment_type: 'initial',
      complex_name: '○○ 청년안심주택',
      district: '강남구',
      address: '서울특별시 강남구 ...',
      total_units: 100,
      post_date: '2026-05-01',
      application_start_date: '2026-05-10',
      application_end_date: '2026-05-20',
      result_date: '2026-06-01',
      attachment_url: 'https://example.com/file.pdf',
      attachment_name: '모집공고문.pdf',
      raw_content: '<div>raw html</div>',
    });
  });

  it('nullable 필드의 null 값을 그대로 전달한다', () => {
    const detail = buildDetail({
      complexName: null,
      district: null,
      address: null,
      totalUnits: null,
      applicationStartDate: null,
      applicationEndDate: null,
      resultDate: null,
      attachmentUrl: null,
      attachmentName: null,
    });
    const row = detailToRow(detail);

    expect(row.complex_name).toBeNull();
    expect(row.district).toBeNull();
    expect(row.address).toBeNull();
    expect(row.total_units).toBeNull();
    expect(row.application_start_date).toBeNull();
    expect(row.application_end_date).toBeNull();
    expect(row.result_date).toBeNull();
    expect(row.attachment_url).toBeNull();
    expect(row.attachment_name).toBeNull();
  });
});

describe('upsertAnnouncements', () => {
  it('빈 배열이면 Supabase를 호출하지 않는다', async () => {
    const { client, from } = createMockClient({ error: null });

    await upsertAnnouncements(client, []);

    expect(from).not.toHaveBeenCalled();
  });

  it('announcements 테이블에 board_id 기준 UPSERT를 호출한다', async () => {
    const { client, from, upsert } = createMockClient({ error: null });
    const details = [
      buildDetail({ boardId: 1001 }),
      buildDetail({ boardId: 1002 }),
    ];

    await upsertAnnouncements(client, details);

    expect(from).toHaveBeenCalledWith('announcements');
    expect(upsert).toHaveBeenCalledTimes(1);
    const [rows, options] = upsert.mock.calls[0];
    expect(rows).toHaveLength(2);
    expect(rows[0].board_id).toBe(1001);
    expect(rows[1].board_id).toBe(1002);
    expect(options).toEqual({ onConflict: 'board_id' });
  });

  it('Supabase가 에러를 반환하면 throw + 메시지에 건수 포함', async () => {
    const { client } = createMockClient({
      error: { message: 'duplicate key' },
    });

    await expect(
      upsertAnnouncements(client, [
        buildDetail(),
        buildDetail({ boardId: 1002 }),
      ]),
    ).rejects.toThrow(/Failed to upsert 2 announcement\(s\): duplicate key/);
  });
});
