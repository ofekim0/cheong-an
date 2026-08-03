-- 멀티채널 알림 (ADR 011): 웹 푸시 전용이던 구독 의사 테이블(L1)을
-- 계정 단위 notification_preferences로 일반화하고, 단일 enabled를 채널별
-- 플래그로 분리한다.
--
-- - web_push_enabled: 기존 enabled를 그대로 이어받는다(값 보존).
-- - email_enabled: 이메일 알림 opt-in. 이메일 배달 주소는 발송 시점에
--   auth.users.email에서 조회하므로 별도 배달-채널 테이블(L2)이 없다
--   (ADR 011 축3 — 웹 푸시의 push_subscriptions와 대비되는 비대칭).
-- - 알림톡(Phase 4)은 여기에 alimtalk_enabled 컬럼을 더하면 된다.
--
-- RENAME은 정책·트리거·GRANT·인덱스·제약을 그대로 승계한다(재생성 불필요).
-- push_subscriptions(L2)는 무변경. 정책/트리거명만 새 테이블명에 맞춰 rename해
-- 스키마를 자기 일관되게 유지한다(동작 무관).

ALTER TABLE push_preferences RENAME TO notification_preferences;
ALTER TABLE notification_preferences RENAME COLUMN enabled TO web_push_enabled;
ALTER TABLE notification_preferences
  ADD COLUMN email_enabled BOOLEAN NOT NULL DEFAULT false;

-- updated_at 트리거명 갱신 (update_updated_at() 함수는 그대로 재사용)
ALTER TRIGGER push_preferences_updated_at ON notification_preferences
  RENAME TO notification_preferences_updated_at;

-- RLS 정책명 갱신 (정책 정의·효과는 rename으로 그대로 승계)
ALTER POLICY push_preferences_select_own ON notification_preferences
  RENAME TO notification_preferences_select_own;
ALTER POLICY push_preferences_insert_own ON notification_preferences
  RENAME TO notification_preferences_insert_own;
ALTER POLICY push_preferences_update_own ON notification_preferences
  RENAME TO notification_preferences_update_own;
ALTER POLICY push_preferences_delete_own ON notification_preferences
  RENAME TO notification_preferences_delete_own;
