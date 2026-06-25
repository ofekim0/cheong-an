import { PushSubscribeButton } from '@/components/push/PushSubscribeButton';

/**
 * 알림 구독 페이지 (임시 검증 단계, Step 9-a).
 *
 * 현재는 subscribe 흐름 검증용 최소 UI만 둔다.
 * 실제 디자인은 Sprint 2 화면이 모두 잡힌 뒤 v0/Lovable 등으로 일괄 작업한다.
 */
export default function SubscribePage() {
  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="mb-4 text-xl font-bold">알림 구독 (임시)</h1>
      <PushSubscribeButton />
    </main>
  );
}
