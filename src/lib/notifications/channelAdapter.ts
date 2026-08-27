/**
 * 알림 채널 어댑터 인터페이스 (Step b-1, ADR 011 축2).
 *
 * 채널 플러그형 발송의 계약: 각 채널(웹 푸시·이메일·향후 알림톡)은
 * "대상 조회 → 발송 → (필요 시) 정리 → 집계"라는 자기 파이프라인 전체를
 * 어댑터 안에 소유한다. notificationService는 이 어댑터들을 격리 순회할 뿐,
 * 채널별 세부(엔드포인트 만료 정리, 이메일 주소 조회 등)를 알지 못한다.
 *
 * 채널 추가 = 어댑터 하나 구현 + opt-in 불리언 컬럼 하나(ADR 011). 발송
 * 서비스·cron 배선·집계 골격은 재사용된다.
 *
 * 웹 푸시와 이메일은 형태가 비대칭이다(ADR 011 축3):
 * - 웹 푸시: 배달 채널이 L2 테이블(계정×기기), 발송 실패 시 410/404 endpoint 정리.
 * - 이메일: 배달 채널이 계정 속성(auth.users.email), 정리 대상 없음(반송은 비동기).
 * 이 비대칭을 ChannelResult가 흡수한다 — `expired`는 정리 개념이 있는 채널만
 * 채우고(웹 푸시), 없는 채널은 0으로 둔다(이메일).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { NotificationChannel } from '@/lib/supabase/notificationPreferencesRepository';
import type { AnnouncementDetail } from '@/types/announcement';

/**
 * 채널 1개의 발송 1회 집계. sent + expired + failed = 시도한 배달 단위 수.
 *
 * - sent: 발송 성공 단위 수.
 * - failed: 그 외 실패 단위 수 (다음 신규 공고 발송에서 자연 재시도).
 * - expired: 만료로 판정돼 정리된 배달 단위 수. 정리 개념이 없는 채널은 항상 0.
 */
export interface ChannelResult {
  sent: number;
  failed: number;
  expired: number;
}

/**
 * 한 알림 채널의 발송 파이프라인 전체를 캡슐화한 어댑터.
 *
 * dispatch는 신규 공고 목록을 받아 이 채널의 대상 전부에게 발송하고 집계를
 * 돌려준다. 신규가 없거나 대상이 없으면 no-op(전부 0)이어야 한다. 전 대상
 * 공통 설정 오류(예: 발송 자격 증명 미설정)는 throw로 전파하며,
 * notificationService가 채널 단위로 격리해 다른 채널을 막지 않게 처리한다.
 */
export interface ChannelAdapter {
  /** 이 어댑터가 담당하는 채널. 집계 결과 맵의 키가 된다. */
  readonly channel: NotificationChannel;
  dispatch(
    client: SupabaseClient,
    details: AnnouncementDetail[],
  ): Promise<ChannelResult>;
}
