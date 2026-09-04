import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildEmailPayload } from './buildEmailPayload';
import { createEmailAdapter } from './emailAdapter';
import type { EmailSendResult } from './emailClient';
import type { AnnouncementDetail } from '@/types/announcement';

const CLIENT = {} as SupabaseClient;

const DETAIL: AnnouncementDetail = {
  boardId: 6561,
  title: '강동구 천호동 청년안심주택 입주자 모집공고',
  announcementType: 'private',
  recruitmentType: 'initial',
  complexName: null,
  district: '강동구',
  address: null,
  totalUnits: null,
  postDate: '2026-07-01',
  applicationDate: null,
  attachmentUrl: null,
  attachmentName: null,
  rawContent: '<p>본문</p>',
};

const RECIPIENT_A = {
  userId: 'b7e6a4c2-0000-4000-8000-000000000001',
  email: 'a@example.com',
};
const RECIPIENT_B = {
  userId: 'b7e6a4c2-0000-4000-8000-000000000002',
  email: 'b@example.com',
};

const OK: EmailSendResult = { ok: true };
const FAILED: EmailSendResult = {
  ok: false,
  statusCode: 422,
  message: 'Invalid `to` field',
};

// 페이로드 빌더가 배포 도메인 env를 요구한다(#96 — 알림 링크가 내부 상세로 감).
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://cheong-an.example.com');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('createEmailAdapter', () => {
  it('channel은 email이다 (집계 결과 맵의 키)', () => {
    expect(createEmailAdapter().channel).toBe('email');
  });

  it('신규 공고가 없으면 수신자 조회 없이 no-op', async () => {
    const fetchRecipients = vi.fn();
    const sender = vi.fn();
    const adapter = createEmailAdapter({ sender, fetchRecipients });

    const result = await adapter.dispatch(CLIENT, []);

    expect(result).toEqual({ sent: 0, expired: 0, failed: 0 });
    expect(fetchRecipients).not.toHaveBeenCalled();
    expect(sender).not.toHaveBeenCalled();
  });

  it('수신자가 없으면 no-op', async () => {
    const sender = vi.fn();
    const adapter = createEmailAdapter({
      sender,
      fetchRecipients: vi.fn().mockResolvedValue([]),
    });

    const result = await adapter.dispatch(CLIENT, [DETAIL]);

    expect(result).toEqual({ sent: 0, expired: 0, failed: 0 });
    expect(sender).not.toHaveBeenCalled();
  });

  it('모든 수신자에게 같은 페이로드를 발송하고 성공 수를 집계한다', async () => {
    const sender = vi.fn().mockResolvedValue(OK);
    const adapter = createEmailAdapter({
      sender,
      fetchRecipients: vi.fn().mockResolvedValue([RECIPIENT_A, RECIPIENT_B]),
    });

    const result = await adapter.dispatch(CLIENT, [DETAIL]);

    expect(result).toEqual({ sent: 2, expired: 0, failed: 0 });
    const expectedPayload = buildEmailPayload([DETAIL]);
    expect(sender).toHaveBeenCalledTimes(2);
    expect(sender).toHaveBeenCalledWith('a@example.com', expectedPayload);
    expect(sender).toHaveBeenCalledWith('b@example.com', expectedPayload);
  });

  it('실패는 failed로 집계하고 나머지 수신자 발송을 막지 않는다 (수신자별 격리)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sender = vi
      .fn()
      .mockResolvedValueOnce(FAILED)
      .mockResolvedValueOnce(OK);
    const adapter = createEmailAdapter({
      sender,
      fetchRecipients: vi.fn().mockResolvedValue([RECIPIENT_A, RECIPIENT_B]),
    });

    const result = await adapter.dispatch(CLIENT, [DETAIL]);

    expect(result).toEqual({ sent: 1, expired: 0, failed: 1 });
    expect(sender).toHaveBeenCalledTimes(2);
    // 로그에는 주소 대신 userId만 남긴다 (개인정보)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(RECIPIENT_A.userId),
    );
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining('a@example.com'),
    );
  });

  it('sender가 throw하면(전 수신자 공통 설정 오류) 그대로 전파한다', async () => {
    const sender = vi
      .fn()
      .mockRejectedValue(new Error('이메일 env가 설정되지 않았습니다'));
    const adapter = createEmailAdapter({
      sender,
      fetchRecipients: vi.fn().mockResolvedValue([RECIPIENT_A]),
    });

    await expect(adapter.dispatch(CLIENT, [DETAIL])).rejects.toThrow(
      /이메일 env/,
    );
  });

  it('수신자 조회가 throw하면 그대로 전파한다 (notificationService가 채널 격리)', async () => {
    const adapter = createEmailAdapter({
      sender: vi.fn(),
      fetchRecipients: vi
        .fn()
        .mockRejectedValue(new Error('permission denied')),
    });

    await expect(adapter.dispatch(CLIENT, [DETAIL])).rejects.toThrow(
      /permission denied/,
    );
  });
});
