-- 공고 유형 ENUM
CREATE TYPE announcement_type AS ENUM ('public', 'private');

-- 모집 구분 ENUM
CREATE TYPE recruitment_type AS ENUM ('initial', 'additional');

-- 공고 테이블
CREATE TABLE announcements (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  board_id      INTEGER NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  announcement_type announcement_type NOT NULL,
  recruitment_type  recruitment_type NOT NULL,
  complex_name  TEXT,
  district      TEXT,
  address       TEXT,
  total_units   INTEGER,
  post_date     DATE NOT NULL,
  application_start_date DATE,
  application_end_date   DATE,
  result_date   DATE,
  attachment_url  TEXT,
  attachment_name TEXT,
  raw_content   TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- boardId로 빠른 조회
CREATE INDEX idx_announcements_board_id ON announcements (board_id);

-- 최신 공고 조회용
CREATE INDEX idx_announcements_post_date ON announcements (post_date DESC);

-- 지역구 필터용
CREATE INDEX idx_announcements_district ON announcements (district);

-- 크롤링 상태 추적 테이블
CREATE TABLE crawl_state (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  last_board_id   INTEGER NOT NULL DEFAULT 0,
  last_crawled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 초기 크롤링 상태 삽입
INSERT INTO crawl_state (last_board_id) VALUES (0);

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER announcements_updated_at
  BEFORE UPDATE ON announcements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER crawl_state_updated_at
  BEFORE UPDATE ON crawl_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
