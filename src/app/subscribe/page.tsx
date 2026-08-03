import { LoginButtons } from '@/components/auth/LoginButtons';
import { LogoutButton } from '@/components/auth/LogoutButton';
import { EmailSubscribeButton } from '@/components/notifications/EmailSubscribeButton';
import { PushSubscribeButton } from '@/components/push/PushSubscribeButton';
import { getSessionUser } from '@/lib/auth/getSessionUser';
import { getChannelPreference } from '@/lib/supabase/notificationPreferencesRepository';
import { getSupabaseServerClient } from '@/lib/supabase/serverClient';

/**
 * 알림 구독 페이지 (임시 검증 단계, Step 9-a + 50-b 게이팅 + Step a 이메일).
 *
 * 구독은 로그인 사용자 기준으로 동작하므로(ADR 009), 비로그인 시 로그인 유도만
 * 보여주고 구독 UI는 가린다. 공고 열람은 공개지만 구독 액션은 인증을 요구한다.
 *
 * 채널은 역량 기반으로 노출한다(ADR 011): 이메일 토글은 계정에 이메일 주소가
 * 있을 때만 보인다(카카오처럼 주소 없는 계정엔 웹 푸시만 노출).
 *
 * 현재는 흐름 검증용 최소 UI다. 실제 디자인은 Sprint 2 화면이 모두 잡힌 뒤
 * v0/Lovable 등으로 일괄 작업한다.
 */
export default async function SubscribePage() {
  const user = await getSessionUser();

  // 채널 선호(계정 단위, ADR 008/011)는 어느 기기에서 보든 같다.
  const client = user ? await getSupabaseServerClient() : null;
  const webPushEnabled =
    user && client
      ? await getChannelPreference(client, user.userId, 'web_push')
      : false;
  const emailEnabled =
    user && client
      ? await getChannelPreference(client, user.userId, 'email')
      : false;

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="mb-4 text-xl font-bold">알림 구독 (임시)</h1>

      {user ? (
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-zinc-600">
              {user.email ?? '로그인됨'}
            </span>
            <LogoutButton />
          </div>

          <PushSubscribeButton initialEnabled={webPushEnabled} />

          {/* 역량 게이팅: 이메일 주소가 있는 계정에만 이메일 채널을 노출 */}
          {user.email && (
            <EmailSubscribeButton
              initialEnabled={emailEnabled}
              email={user.email}
            />
          )}
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
