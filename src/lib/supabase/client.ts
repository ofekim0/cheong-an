/**
 * Supabase 서버 전용 admin 클라이언트(DB에 접속하려면 "연결 객체 - 클라이언트"가 필요함).
 *
 * service role key를 사용하므로 RLS를 우회한다.
 * 절대 클라이언트 번들(브라우저)에 노출되어서는 안 된다.
 * Route Handler / 서버 액션 / 크론 잡 등 서버 컨텍스트에서만 import할 것.
 *
 * 환경 변수:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cachedClient: SupabaseClient | null = null;

export function getSupabaseAdminClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error(
      'SUPABASE_URL environment variable is not set. ' +
        'Server-side Supabase access requires this variable.',
    );
  }
  if (!serviceRoleKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY environment variable is not set. ' +
        'Server-side Supabase access requires this variable.',
    );
  }

  cachedClient = createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cachedClient;
}

/** 테스트에서 모듈 레벨 캐시를 초기화하기 위한 헬퍼. */
export function resetSupabaseAdminClientCache(): void {
  cachedClient = null;
}
