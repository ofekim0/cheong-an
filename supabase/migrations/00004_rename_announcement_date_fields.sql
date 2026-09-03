-- 공고 날짜 필드 정정 (ADR 014, #86).
--
-- 원본 view.do 메타 영역이 노출하는 날짜 항목은 '공고게시일'과 '청약신청일'
-- 둘뿐이고, '모집 마감일'·'발표일' 항목은 존재하지 않는다. 그래서:
--
-- - application_start_date → application_date: 담기는 값은 기간의 시작일이
--   아니라 단일 지정일('청약신청일')이다. 짝인 application_end_date를 함께
--   없애므로 Start/End 쌍이라는 잘못된 함의도 사라진다.
-- - application_end_date / result_date DROP: parseDetailPage가 하드코딩 null을
--   반환하고 저장 경로는 detail 출력만 쓰므로(ADR 003 옵션 B) 값이 들어올
--   경로가 구조적으로 없다. 적용 시점 68건 전부 null이므로 무손실이다.
--
-- 적용 전 아래 쿼리로 무손실을 확인한다 — 파서 추론이 아니라 데이터로 확인한다.
--
--   SELECT count(*) AS total,
--          count(application_end_date) AS end_filled,
--          count(result_date) AS result_filled
--   FROM announcements;
--
--   -- end_filled = 0 AND result_filled = 0 이어야 DROP을 진행한다.
--
-- 되살리는 비용: 사이트가 마감일·발표일을 노출하기 시작하면 그 시점의 실제
-- 응답 형태를 보고 ADD COLUMN 한다(ADR 014 축 2 근거).
--
-- RENAME은 인덱스·제약·트리거를 승계한다(00003 선례). 이 세 컬럼에는 인덱스가
-- 없다 — announcements의 인덱스는 board_id · post_date · district뿐이다.

ALTER TABLE announcements RENAME COLUMN application_start_date TO application_date;

ALTER TABLE announcements DROP COLUMN application_end_date;
ALTER TABLE announcements DROP COLUMN result_date;
