import {
  ANNOUNCEMENT_TYPE_LABEL,
  RECRUITMENT_TYPE_LABEL,
  formatApplicationDate,
  formatDate,
} from '@/lib/announcements/formatAnnouncement';
import { buildAnnouncementUrl } from '@/lib/push/buildNotificationPayload';
import type { AnnouncementSummary } from '@/types/announcement';

/**
 * 공고 목록의 항목 1건 (#83, Step b).
 *
 * 서버 컴포넌트 — 표시 전용이라 상태도 이벤트 핸들러도 없다.
 *
 * 링크는 soco 원문(view.do)으로 내보낸다. 내부 상세 페이지(`/announcements/[boardId]`)가
 * 아직 없기 때문이며, 생기는 시점에 알림 URL 빌더(buildNotificationPayload·
 * buildEmailPayload)와 함께 한 번에 내부 경로로 교체한다 — 지금은 알림이 보내는
 * 링크와 목록이 거는 링크가 같은 곳을 가리키게 두는 편이 일관적이다.
 *
 * 외부로 나가므로 target="_blank" + rel="noreferrer"를 붙인다.
 *
 * 스타일은 흐름 검증 수준의 최소 형태다. 실제 디자인은 Sprint 2 화면이 모두
 * 잡힌 뒤 일괄 작업한다(/subscribe와 동일한 방침).
 */
export function AnnouncementCard({
  announcement,
}: {
  announcement: AnnouncementSummary;
}) {
  const {
    boardId,
    title,
    announcementType,
    recruitmentType,
    complexName,
    district,
    postDate,
    applicationDate,
  } = announcement;

  // 자치구·단지명은 각각 nullable이라 있는 것만 모아 구분자로 잇는다.
  const location = [district, complexName].filter(Boolean).join(' · ');

  return (
    <li className="rounded-lg border border-zinc-200 transition-colors hover:border-zinc-400">
      <a
        href={buildAnnouncementUrl(boardId)}
        target="_blank"
        rel="noreferrer"
        className="flex flex-col gap-2 p-4"
      >
        <div className="flex gap-2 text-xs">
          <span className="rounded bg-zinc-100 px-2 py-0.5 text-zinc-700">
            {ANNOUNCEMENT_TYPE_LABEL[announcementType]}
          </span>
          <span className="rounded bg-zinc-100 px-2 py-0.5 text-zinc-700">
            {RECRUITMENT_TYPE_LABEL[recruitmentType]}
          </span>
        </div>

        <h2 className="font-medium text-zinc-900">{title}</h2>

        {location && <p className="text-sm text-zinc-600">{location}</p>}

        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-500">
          {/*
            원본이 노출하는 날짜는 '공고게시일'과 '청약신청일' 둘뿐이다 —
            모집 마감일 항목이 없어 기간(○○ ~ ○○)으로 표기하지 않는다 (ADR 014).
          */}
          <div className="flex gap-1">
            <dt>청약신청</dt>
            <dd>{formatApplicationDate(applicationDate)}</dd>
          </div>
          <div className="flex gap-1">
            <dt>게시</dt>
            <dd>{formatDate(postDate)}</dd>
          </div>
        </dl>
      </a>
    </li>
  );
}
