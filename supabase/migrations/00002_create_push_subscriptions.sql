-- 웹 푸시 구독 (ADR 008: 구독 의사 L1 / 배달 채널 L2 분리)
--
-- L1 push_preferences: "이 계정이 알림을 원한다" — 계정당 1 row.
--   어느 기기에서 끄든 계정 차원에서 꺼진다(전 기기 공유 토글).
--   Sprint 3의 지역구·유형 필터 조건이 이 테이블에 붙는다.
-- L2 push_subscriptions: endpoint + keys — (계정, 기기) 단위 배달 채널.
--   UNIQUE(user_id, endpoint)로 같은 기기를 여러 계정이 독립적으로 쓸 수 있다
--   (endpoint 단독 UNIQUE였다면 계정 간 소유권 충돌이 생긴다).

-- L1: 계정 단위 구독 의사
CREATE TABLE push_preferences (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     UUID NOT NULL UNIQUE REFERENCES auth.users (id) ON DELETE CASCADE,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- L2: (계정, 기기) 단위 배달 채널
CREATE TABLE push_subscriptions (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);

-- 발송(9-c)의 사용자별 채널 조회(WHERE user_id = ?)와 FK 참조 확인은
-- UNIQUE(user_id, endpoint)가 만든 복합 인덱스의 선두 컬럼이 커버하므로
-- (leftmost prefix) user_id 단독 인덱스는 두지 않는다.

-- updated_at 자동 갱신 (00001의 update_updated_at() 재사용)
CREATE TRIGGER push_preferences_updated_at
  BEFORE UPDATE ON push_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER push_subscriptions_updated_at
  BEFORE UPDATE ON push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: 사용자 소유 데이터이므로 본인 row만 접근 (ADR 008).
-- UPDATE 정책은 UPSERT가 충돌 시 내부적으로 UPDATE를 실행하기 때문에 필요하다
-- (없으면 재구독 키 갱신·enabled 토글이 실패한다).
ALTER TABLE push_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY push_preferences_select_own ON push_preferences
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY push_preferences_insert_own ON push_preferences
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY push_preferences_update_own ON push_preferences
  FOR UPDATE USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY push_preferences_delete_own ON push_preferences
  FOR DELETE USING (user_id = (SELECT auth.uid()));

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY push_subscriptions_select_own ON push_subscriptions
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY push_subscriptions_insert_own ON push_subscriptions
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY push_subscriptions_update_own ON push_subscriptions
  FOR UPDATE USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY push_subscriptions_delete_own ON push_subscriptions
  FOR DELETE USING (user_id = (SELECT auth.uid()));
