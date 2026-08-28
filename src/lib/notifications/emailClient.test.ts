import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EmailPayload } from './buildEmailPayload';

const { sendMock, ResendMock } = vi.hoisted(() => {
  const sendMock = vi.fn();
  // new Resend(key)로 생성되므로 화살표 함수가 아닌 function이어야 한다
  // (화살표 함수는 생성자 호출 불가).
  const ResendMock = vi.fn(function () {
    return { emails: { send: sendMock } };
  });
  return { sendMock, ResendMock };
});

vi.mock('resend', () => ({ Resend: ResendMock }));

import { getEmailConfigFromEnv, sendEmail } from './emailClient';

const PAYLOAD: EmailPayload = {
  subject: '[청안] 새 청년안심주택 공고 — 테스트 공고',
  html: '<p>본문</p>',
  text: '본문',
};

const ORIGINAL_API_KEY = process.env.RESEND_API_KEY;
const ORIGINAL_FROM = process.env.EMAIL_FROM;

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = 're_test_key';
  process.env.EMAIL_FROM = '청안 <noreply@cheong-an.example>';
});

afterEach(() => {
  restoreEnv('RESEND_API_KEY', ORIGINAL_API_KEY);
  restoreEnv('EMAIL_FROM', ORIGINAL_FROM);
});

describe('getEmailConfigFromEnv', () => {
  it('env 2종이 있으면 자격 증명을 돌려준다', () => {
    expect(getEmailConfigFromEnv()).toEqual({
      apiKey: 're_test_key',
      from: '청안 <noreply@cheong-an.example>',
    });
  });

  it.each(['RESEND_API_KEY', 'EMAIL_FROM'])(
    '%s 미설정이면 throw (배포 설정 오류 표면화)',
    (key) => {
      delete process.env[key];

      expect(() => getEmailConfigFromEnv()).toThrow(/이메일 env/);
    },
  );
});

describe('sendEmail', () => {
  it('env 미설정이면 throw — 수신자 단위 결과로 삼키지 않는다', async () => {
    delete process.env.RESEND_API_KEY;

    await expect(sendEmail('user@example.com', PAYLOAD)).rejects.toThrow(
      /이메일 env/,
    );
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('성공 시 { ok: true } — from·to·페이로드를 그대로 전달한다', async () => {
    sendMock.mockResolvedValue({ data: { id: 'email-id' }, error: null });

    const result = await sendEmail('user@example.com', PAYLOAD);

    expect(result).toEqual({ ok: true });
    expect(ResendMock).toHaveBeenCalledWith('re_test_key');
    expect(sendMock).toHaveBeenCalledWith({
      from: '청안 <noreply@cheong-an.example>',
      to: 'user@example.com',
      subject: PAYLOAD.subject,
      html: PAYLOAD.html,
      text: PAYLOAD.text,
    });
  });

  it('Resend가 error 값을 돌려주면 statusCode·message로 정규화한다', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: {
        name: 'validation_error',
        statusCode: 422,
        message: 'Invalid `to` field',
      },
    });

    const result = await sendEmail('broken@example.com', PAYLOAD);

    expect(result).toEqual({
      ok: false,
      statusCode: 422,
      message: 'Invalid `to` field',
    });
  });

  it('error.statusCode가 null이어도 그대로 정규화한다', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: {
        name: 'application_error',
        statusCode: null,
        message: 'Unable to send',
      },
    });

    const result = await sendEmail('user@example.com', PAYLOAD);

    expect(result).toEqual({
      ok: false,
      statusCode: null,
      message: 'Unable to send',
    });
  });

  it('SDK가 throw하면(네트워크 계층) 결과 값으로 정규화한다', async () => {
    sendMock.mockRejectedValue(new Error('fetch failed'));

    const result = await sendEmail('user@example.com', PAYLOAD);

    expect(result).toEqual({
      ok: false,
      statusCode: null,
      message: 'fetch failed',
    });
  });
});
