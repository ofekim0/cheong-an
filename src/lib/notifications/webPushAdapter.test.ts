import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWebPushAdapter } from './webPushAdapter';
import { buildNotificationPayload } from '@/lib/push/buildNotificationPayload';
import type { WebPushSendResult } from '@/lib/push/webPushClient';
import type { AnnouncementDetail } from '@/types/announcement';
import type { PushDeliveryChannel } from '@/types/push';

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
  applicationStartDate: null,
  applicationEndDate: null,
  resultDate: null,
  attachmentUrl: null,
  attachmentName: null,
  rawContent: '<p>본문</p>',
};

function createChannel(
  overrides: Partial<PushDeliveryChannel>,
): PushDeliveryChannel {
  return {
    userId: 'b7e6a4c2-0000-4000-8000-000000000001',
    endpoint: 'https://fcm.googleapis.com/fcm/send/aaa',
    p256dh: 'p256dh-a',
    auth: 'auth-a',
    ...overrides,
  };
}

const OK: WebPushSendResult = { ok: true };
const GONE: WebPushSendResult = {
  ok: false,
  statusCode: 410,
  message: 'Gone',
};
const NOT_FOUND: WebPushSendResult = {
  ok: false,
  statusCode: 404,
  message: 'Not Found',
};
const SERVER_ERROR: WebPushSendResult = {
  ok: false,
  statusCode: 500,
  message: 'Internal Server Error',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createWebPushAdapter', () => {
  it('channel은 web_push다 (집계 결과 맵의 키)', () => {
    expect(createWebPushAdapter().channel).toBe('web_push');
  });

  it('신규 공고가 없으면 채널 조회 없이 no-op', async () => {
    const fetchChannels = vi.fn();
    const sender = vi.fn();
    const adapter = createWebPushAdapter({
      sender,
      fetchChannels,
      removeChannelsByEndpoint: vi.fn(),
    });

    const result = await adapter.dispatch(CLIENT, []);

    expect(result).toEqual({ sent: 0, expired: 0, failed: 0 });
    expect(fetchChannels).not.toHaveBeenCalled();
    expect(sender).not.toHaveBeenCalled();
  });

  it('발송 대상 채널이 없으면 no-op', async () => {
    const sender = vi.fn();
    const adapter = createWebPushAdapter({
      sender,
      fetchChannels: vi.fn().mockResolvedValue([]),
      removeChannelsByEndpoint: vi.fn(),
    });

    const result = await adapter.dispatch(CLIENT, [DETAIL]);

    expect(result).toEqual({ sent: 0, expired: 0, failed: 0 });
    expect(sender).not.toHaveBeenCalled();
  });

  it('모든 채널에 같은 페이로드를 발송하고 성공 수를 집계한다', async () => {
    const channels = [
      createChannel({ endpoint: 'https://push/aaa' }),
      createChannel({
        userId: 'b7e6a4c2-0000-4000-8000-000000000002',
        endpoint: 'https://push/bbb',
      }),
    ];
    const sender = vi.fn().mockResolvedValue(OK);
    const removeChannelsByEndpoint = vi.fn();
    const adapter = createWebPushAdapter({
      sender,
      fetchChannels: vi.fn().mockResolvedValue(channels),
      removeChannelsByEndpoint,
    });

    const result = await adapter.dispatch(CLIENT, [DETAIL]);

    expect(result).toEqual({ sent: 2, expired: 0, failed: 0 });
    const expectedPayload = buildNotificationPayload([DETAIL]);
    expect(sender).toHaveBeenCalledTimes(2);
    expect(sender).toHaveBeenCalledWith(channels[0], expectedPayload);
    expect(sender).toHaveBeenCalledWith(channels[1], expectedPayload);
    expect(removeChannelsByEndpoint).not.toHaveBeenCalled();
  });

  it('410 응답 채널은 expired로 집계하고 endpoint를 삭제한다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const channels = [
      createChannel({ endpoint: 'https://push/live' }),
      createChannel({ endpoint: 'https://push/gone' }),
    ];
    const sender = vi
      .fn()
      .mockResolvedValueOnce(OK)
      .mockResolvedValueOnce(GONE);
    const removeChannelsByEndpoint = vi.fn().mockResolvedValue(undefined);
    const adapter = createWebPushAdapter({
      sender,
      fetchChannels: vi.fn().mockResolvedValue(channels),
      removeChannelsByEndpoint,
    });

    const result = await adapter.dispatch(CLIENT, [DETAIL]);

    expect(result).toEqual({ sent: 1, expired: 1, failed: 0 });
    expect(removeChannelsByEndpoint).toHaveBeenCalledTimes(1);
    expect(removeChannelsByEndpoint).toHaveBeenCalledWith(
      CLIENT,
      'https://push/gone',
    );
  });

  it('404도 만료로 간주해 정리한다 (FCM 만료 응답)', async () => {
    const sender = vi.fn().mockResolvedValue(NOT_FOUND);
    const removeChannelsByEndpoint = vi.fn().mockResolvedValue(undefined);
    const adapter = createWebPushAdapter({
      sender,
      fetchChannels: vi
        .fn()
        .mockResolvedValue([createChannel({ endpoint: 'https://push/aaa' })]),
      removeChannelsByEndpoint,
    });

    const result = await adapter.dispatch(CLIENT, [DETAIL]);

    expect(result).toEqual({ sent: 0, expired: 1, failed: 0 });
    expect(removeChannelsByEndpoint).toHaveBeenCalledWith(
      CLIENT,
      'https://push/aaa',
    );
  });

  it('일반 실패는 failed로 집계하고 나머지 채널 발송을 막지 않는다 (채널별 격리)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const channels = [
      createChannel({ endpoint: 'https://push/broken' }),
      createChannel({ endpoint: 'https://push/live' }),
    ];
    const sender = vi
      .fn()
      .mockResolvedValueOnce(SERVER_ERROR)
      .mockResolvedValueOnce(OK);
    const removeChannelsByEndpoint = vi.fn();
    const adapter = createWebPushAdapter({
      sender,
      fetchChannels: vi.fn().mockResolvedValue(channels),
      removeChannelsByEndpoint,
    });

    const result = await adapter.dispatch(CLIENT, [DETAIL]);

    expect(result).toEqual({ sent: 1, expired: 0, failed: 1 });
    expect(sender).toHaveBeenCalledTimes(2);
    expect(removeChannelsByEndpoint).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('같은 만료 endpoint가 여러 계정 row로 있으면 삭제는 1회만 호출한다', async () => {
    const channels = [
      createChannel({ endpoint: 'https://push/shared' }),
      createChannel({
        userId: 'b7e6a4c2-0000-4000-8000-000000000002',
        endpoint: 'https://push/shared',
      }),
    ];
    const sender = vi.fn().mockResolvedValue(GONE);
    const removeChannelsByEndpoint = vi.fn().mockResolvedValue(undefined);
    const adapter = createWebPushAdapter({
      sender,
      fetchChannels: vi.fn().mockResolvedValue(channels),
      removeChannelsByEndpoint,
    });

    const result = await adapter.dispatch(CLIENT, [DETAIL]);

    expect(result).toEqual({ sent: 0, expired: 2, failed: 0 });
    expect(removeChannelsByEndpoint).toHaveBeenCalledTimes(1);
  });

  it('만료 채널 정리 실패는 로그만 남기고 발송 결과를 유지한다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sender = vi.fn().mockResolvedValue(GONE);
    const removeChannelsByEndpoint = vi
      .fn()
      .mockRejectedValue(new Error('connection refused'));
    const adapter = createWebPushAdapter({
      sender,
      fetchChannels: vi
        .fn()
        .mockResolvedValue([createChannel({ endpoint: 'https://push/gone' })]),
      removeChannelsByEndpoint,
    });

    const result = await adapter.dispatch(CLIENT, [DETAIL]);

    expect(result).toEqual({ sent: 0, expired: 1, failed: 0 });
    expect(warn).toHaveBeenCalledWith(
      '[push/dispatch] 만료 채널 정리 실패:',
      expect.any(Error),
    );
  });

  it('sender가 throw하면(전 채널 공통 설정 오류) 그대로 전파한다', async () => {
    const sender = vi
      .fn()
      .mockRejectedValue(new Error('VAPID env가 설정되지 않았습니다'));
    const adapter = createWebPushAdapter({
      sender,
      fetchChannels: vi.fn().mockResolvedValue([createChannel({})]),
      removeChannelsByEndpoint: vi.fn(),
    });

    await expect(adapter.dispatch(CLIENT, [DETAIL])).rejects.toThrow(
      /VAPID env/,
    );
  });
});
