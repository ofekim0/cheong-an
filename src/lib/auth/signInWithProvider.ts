/**
 * 소셜 로그인 개시 로직(클라이언트). 버튼 JSX에서 분리해 테스트 가능하게 둔다.
 *
 * provider 인증 페이지로 보내며, 인증 후 `/auth/callback`으로 돌아와 세션을
 * 교환한 뒤 `next` 경로로 복귀한다(콜백 라우트가 open-redirect를 방어). (ADR 009)
 */

import { getSupabaseBrowserClient } from '@/lib/supabase/browserClient';

/** ADR 009: 구글·카카오만 도입(YAGNI) */
export type SocialProvider = 'google' | 'kakao';

export async function signInWithProvider(
  provider: SocialProvider,
  next = '/',
): Promise<{ error: Error | null }> {
  const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(
    next,
  )}`;

  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo },
  });

  return { error };
}
