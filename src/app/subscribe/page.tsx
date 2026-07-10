import { LoginButtons } from '@/components/auth/LoginButtons';
import { LogoutButton } from '@/components/auth/LogoutButton';
import { PushSubscribeButton } from '@/components/push/PushSubscribeButton';
import { getSessionUser } from '@/lib/auth/getSessionUser';
import { getPushPreference } from '@/lib/supabase/pushPreferencesRepository';
import { getSupabaseServerClient } from '@/lib/supabase/serverClient';

/**
 * 알림 구독 페이지 (임시 검증 단계, Step 9-a + 50-b 게이팅).
 *
 * 구독은 로그인 사용자 기준으로 동작하므로(ADR 009), 비로그인 시 로그인 유도만
 * 보여주고 구독 UI는 가린다. 공고 열람은 공개지만 구독 액션은 인증을 요구한다.
 *
 * 현재는 흐름 검증용 최소 UI다. 실제 디자인은 Sprint 2 화면이 모두 잡힌 뒤
 * v0/Lovable 등으로 일괄 작업한다.
 */
export default async function SubscribePage() {
  const user = await getSessionUser();

  // 계정 구독 상태(L1)는 계정 단위라 어느 기기에서 보든 같다 (ADR 008).
  const enabled = user
    ? await getPushPreference(await getSupabaseServerClient(), user.userId)
    : false;

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="mb-4 text-xl font-bold">알림 구독 (임시)</h1>

      {user ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-zinc-600">
              {user.email ?? '로그인됨'}
            </span>
            <LogoutButton />
          </div>
          <PushSubscribeButton initialEnabled={enabled} />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-zinc-600">
            알림을 구독하려면 먼저 로그인하세요.
          </p>
          <LoginButtons next="/subscribe" />
        </div>
      )}
    </main>
  );
}
