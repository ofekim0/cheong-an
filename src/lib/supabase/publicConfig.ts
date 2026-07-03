/**
 * 브라우저/SSR Supabase 클라이언트가 공유하는 공개 환경 변수 읽기.
 *
 * admin 클라이언트(client.ts)의 service role key와 달리, 이 값들은
 * 클라이언트 번들에 노출되어도 안전한 공개 키(anon)다. 데이터 접근은
 * RLS로 제어된다. (ADR 009)
 *
 * 환경 변수:
 * - NEXT_PUBLIC_SUPABASE_URL
 * - NEXT_PUBLIC_SUPABASE_ANON_KEY
 */

export interface SupabasePublicConfig {
  url: string;
  anonKey: string;
}

export function getSupabasePublicConfig(): SupabasePublicConfig {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL environment variable is not set. ' +
        'Supabase Auth (browser/server client) requires this variable.',
    );
  }
  if (!anonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable is not set. ' +
        'Supabase Auth (browser/server client) requires this variable.',
    );
  }

  return { url, anonKey };
}
