import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  getSupabaseAdminClient,
  resetSupabaseAdminClientCache,
} from './client';

describe('getSupabaseAdminClient', () => {
  beforeEach(() => {
    resetSupabaseAdminClientCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetSupabaseAdminClientCache();
  });

  it('SUPABASE_URL이 없으면 에러를 던진다', () => {
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'svc-key');

    expect(() => getSupabaseAdminClient()).toThrow(/SUPABASE_URL/);
  });

  it('SUPABASE_SERVICE_ROLE_KEY가 없으면 에러를 던진다', () => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');

    expect(() => getSupabaseAdminClient()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('env가 모두 있으면 클라이언트 인스턴스를 반환한다', () => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'svc-key');

    const client = getSupabaseAdminClient();
    expect(client).toBeDefined();
    expect(typeof client.from).toBe('function');
  });

  it('두 번 호출하면 같은 인스턴스를 반환한다(싱글톤)', () => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'svc-key');

    const first = getSupabaseAdminClient();
    const second = getSupabaseAdminClient();
    expect(first).toBe(second);
  });
});
