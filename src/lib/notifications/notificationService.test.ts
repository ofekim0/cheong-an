import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChannelAdapter, ChannelResult } from './channelAdapter';
import { dispatchNotifications } from './notificationService';
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
  applicationStartDate: null,
  applicationEndDate: null,
  resultDate: null,
  attachmentUrl: null,
  attachmentName: null,
  rawContent: '<p>본문</p>',
};

function createAdapter(
  channel: ChannelAdapter['channel'],
  dispatch: ChannelAdapter['dispatch'],
): ChannelAdapter {
  return { channel, dispatch };
}

const WEB_PUSH_RESULT: ChannelResult = { sent: 2, expired: 1, failed: 0 };
const EMAIL_RESULT: ChannelResult = { sent: 1, expired: 0, failed: 1 };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('dispatchNotifications', () => {
  it('어댑터별 집계를 channel 키로 맵에 담는다', async () => {
    const result = await dispatchNotifications({
      client: CLIENT,
      details: [DETAIL],
      adapters: [
        createAdapter('web_push', vi.fn().mockResolvedValue(WEB_PUSH_RESULT)),
        createAdapter('email', vi.fn().mockResolvedValue(EMAIL_RESULT)),
      ],
    });

    expect(result).toEqual({
      web_push: WEB_PUSH_RESULT,
      email: EMAIL_RESULT,
    });
  });

  it('모든 어댑터에 같은 client와 details를 전달한다', async () => {
    const dispatchA = vi.fn().mockResolvedValue(WEB_PUSH_RESULT);
    const dispatchB = vi.fn().mockResolvedValue(EMAIL_RESULT);

    await dispatchNotifications({
      client: CLIENT,
      details: [DETAIL],
      adapters: [
        createAdapter('web_push', dispatchA),
        createAdapter('email', dispatchB),
      ],
    });

    expect(dispatchA).toHaveBeenCalledWith(CLIENT, [DETAIL]);
    expect(dispatchB).toHaveBeenCalledWith(CLIENT, [DETAIL]);
  });

  it('어댑터가 throw하면 그 채널만 error로 기록하고 나머지는 정상 집계한다 (채널 간 격리)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await dispatchNotifications({
      client: CLIENT,
      details: [DETAIL],
      adapters: [
        createAdapter(
          'web_push',
          vi
            .fn()
            .mockRejectedValue(new Error('VAPID env가 설정되지 않았습니다')),
        ),
        createAdapter('email', vi.fn().mockResolvedValue(EMAIL_RESULT)),
      ],
    });

    expect(result).toEqual({
      web_push: { error: 'VAPID env가 설정되지 않았습니다' },
      email: EMAIL_RESULT,
    });
    expect(error).toHaveBeenCalledWith(
      '[notifications] web_push 발송 실패:',
      expect.any(Error),
    );
  });

  it('모든 어댑터가 throw해도 함수 자체는 throw하지 않는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await dispatchNotifications({
      client: CLIENT,
      details: [DETAIL],
      adapters: [
        createAdapter('web_push', vi.fn().mockRejectedValue(new Error('a'))),
        createAdapter('email', vi.fn().mockRejectedValue(new Error('b'))),
      ],
    });

    expect(result).toEqual({
      web_push: { error: 'a' },
      email: { error: 'b' },
    });
  });

  it('Error가 아닌 throw는 Unknown error로 정규화한다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await dispatchNotifications({
      client: CLIENT,
      details: [DETAIL],
      adapters: [
        createAdapter('web_push', vi.fn().mockRejectedValue('string throw')),
      ],
    });

    expect(result).toEqual({ web_push: { error: 'Unknown error' } });
  });

  it('어댑터가 없으면 빈 맵을 돌려준다', async () => {
    const result = await dispatchNotifications({
      client: CLIENT,
      details: [DETAIL],
      adapters: [],
    });

    expect(result).toEqual({});
  });
});
