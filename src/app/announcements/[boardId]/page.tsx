import type { Metadata } from 'next';
import { cacheLife, cacheTag } from 'next/cache';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import {
  ANNOUNCEMENTS_CACHE_TAG,
  ANNOUNCEMENTS_PATH,
} from '@/constants/announcements';
import { buildSourceUrl } from '@/lib/announcements/announcementUrl';
import {
  ANNOUNCEMENT_TYPE_LABEL,
  RECRUITMENT_TYPE_LABEL,
  formatApplicationDate,
  formatDate,
} from '@/lib/announcements/formatAnnouncement';
import { getAnnouncementByBoardId } from '@/lib/supabase/announcementsRepository';
import { getSupabaseAdminClient } from '@/lib/supabase/client';
import type { AnnouncementRow } from '@/types/announcement';

/**
 * 공고 상세 페이지 (#96) — 동적 라우트 `/announcements/[boardId]`.
 *
 * 열람은 공개다(비로그인 허용, ADR 009). 조회는 service role 클라이언트로
 * 서버에서만 한다 — `announcements`는 GRANT도 RLS도 없어 anon 키 직접 조회가
 * 401이다(#83 선결 확인).
 *
 * 렌더링 모델은 목록과 같은 Cache Components(PPR, ADR 013)다. 페이지 컴포넌트는
 * async가 아니고 `params`를 await하지 않는다 — promise를 Suspense 하위로 내려보내
 * 거기서 읽어 헤더를 static shell에 남긴다.
 *
 * 목록과 달리 `generateStaticParams`를 쓰지 않는다: 공고가 매시간 추가되므로
 * 프리렌더 집합이 곧 낡고 결국 온디맨드로 떨어진다. 캐시는 아래 조회 함수가 맡는다.
 */

/** 목록에 없는 필드까지 렌더하므로 전체 레코드를 읽는다. */
type DetailParams = Promise<{ boardId: string }>;

/**
 * boardId 1건을 조회한다. 결과는 boardId를 키로 캐시된다.
 *
 * `remote`인 이유는 목록과 같다(ADR 013 세부 판단 1): 이 함수는 `params`를 읽은
 * 뒤에 호출되므로 결과가 static shell에 못 들어가고 요청 시점으로 밀린다. 그냥
 * `'use cache'`면 인스턴스별 인메모리라 서버리스에서 적중률이 낮고, 그러면 크롤이
 * 태그를 무효화하는 설계 자체가 무의미해진다.
 *
 * 태그는 목록과 같은 `ANNOUNCEMENTS_CACHE_TAG`를 공유한다. boardId별 태그
 * (`announcement:${boardId}`)를 두지 않는 이유: 크롤은 `last_board_id` 이후만
 * 저장하므로 기존 공고의 상세는 사실상 변하지 않고, 새 공고는 캐시 항목이 아직
 * 없어 무효화할 대상도 없다. boardId별 태그를 도입하면 크롤 라우트에 무효화 코드가
 * 늘어나는데, 태그 문자열이 어긋나면 조용히 실패하는 표면만 넓어진다(ADR 013).
 * 공유 태그는 새 공고 등장 시 상세 캐시까지 함께 버려 약간 낭비지만 정확하고,
 * `cacheLife('hours')`가 상한을 잡는다.
 */
async function fetchAnnouncement(
  boardId: number,
): Promise<AnnouncementRow | null> {
  'use cache: remote';
  cacheLife('hours');
  cacheTag(ANNOUNCEMENTS_CACHE_TAG);

  return getAnnouncementByBoardId(getSupabaseAdminClient(), boardId);
}

/**
 * 경로 세그먼트를 boardId로 해석한다.
 *
 * 공개 페이지의 경로는 누구나 바꿀 수 있으므로 "잘못된 입력을 어떻게 다루는가"가
 * 곧 방어선이다(#83 c-3의 쿼리 파싱과 같은 원칙). 양의 정수가 아니면 null —
 * 호출자가 404를 낸다. 리포지토리에 이상값을 넘겨 RangeError로 500이 나는 경로를
 * 만들지 않는다.
 *
 * `Number()`가 아니라 정규식으로 먼저 거르는 이유: `Number('6644abc')`는 NaN이지만
 * `Number(' 6644 ')`나 `Number('6.644e3')`는 숫자가 되어 URL과 다른 값이 된다.
 */
function parseBoardId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const boardId = Number(raw);
  return Number.isSafeInteger(boardId) && boardId > 0 ? boardId : null;
}

export const metadata: Metadata = {
  title: '공고 상세 — 청안',
  description: '청년안심주택 모집공고 상세 정보',
};

/** 상세 로딩 중 static shell에 실려 나가는 자리표시자. */
function AnnouncementDetailFallback() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <div className="h-8 w-3/4 animate-pulse rounded bg-zinc-100" />
      <div className="h-20 animate-pulse rounded bg-zinc-100" />
      <div className="h-64 animate-pulse rounded bg-zinc-100" />
    </div>
  );
}

/** 라벨 · 값 한 줄. 값이 없으면 렌더하지 않는다. */
function Field({ label, value }: { label: string; value: string | null }) {
  if (value === null) return null;
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-zinc-500">{label}</dt>
      <dd className="text-zinc-900">{value}</dd>
    </div>
  );
}

/**
 * `params`를 여기서 읽는다 — Suspense 경계 안이라 헤더는 static shell로 남는다.
 */
async function AnnouncementDetailView({ params }: { params: DetailParams }) {
  const { boardId: rawBoardId } = await params;
  const boardId = parseBoardId(rawBoardId);
  if (boardId === null) notFound();

  const announcement = await fetchAnnouncement(boardId);
  // 크롤이 아직 잡지 않은 boardId와 원본에 없는 boardId를 구분하지 않는다 —
  // 우리가 알 수 없는 구분이고, 어느 쪽이든 지금 보여줄 것이 없다.
  if (announcement === null) notFound();

  const {
    title,
    announcementType,
    recruitmentType,
    complexName,
    district,
    address,
    totalUnits,
    postDate,
    applicationDate,
    attachmentUrl,
    attachmentName,
    rawContent,
  } = announcement;

  return (
    <article className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex gap-2 text-xs">
          <span className="rounded bg-zinc-100 px-2 py-0.5 text-zinc-700">
            {ANNOUNCEMENT_TYPE_LABEL[announcementType]}
          </span>
          <span className="rounded bg-zinc-100 px-2 py-0.5 text-zinc-700">
            {RECRUITMENT_TYPE_LABEL[recruitmentType]}
          </span>
        </div>
        <h1 className="text-2xl font-bold text-zinc-900">{title}</h1>
      </div>

      <dl className="flex flex-col gap-1 text-sm">
        <Field label="단지명" value={complexName} />
        <Field label="자치구" value={district} />
        <Field label="주택위치" value={address} />
        <Field
          label="세대수"
          value={totalUnits === null ? null : `${totalUnits}세대`}
        />
        <Field label="공고게시일" value={formatDate(postDate)} />
        <Field
          label="청약신청일"
          value={formatApplicationDate(applicationDate)}
        />
      </dl>

      {attachmentUrl && (
        <p className="text-sm">
          {/* 첨부는 soco의 fileDown.do를 가리키므로 외부 링크로 내보낸다. */}
          <a
            href={attachmentUrl}
            target="_blank"
            rel="noreferrer"
            className="text-blue-700 underline"
          >
            {attachmentName ?? '첨부파일 내려받기'}
          </a>
        </p>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-500">공고 본문</h2>
        {/*
          rawContent는 HTML이 아니라 평문이다 — parseDetailPage가
          $('div.board_cont').text()로 뽑고, 저장 경로는 detail 출력만 쓴다
          (ADR 003 옵션 B). 그래서 sanitize가 아니라 줄바꿈·공백 보존이 과제다.
        */}
        <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-zinc-800">
          {rawContent}
        </p>

        {/*
          원본으로 나가는 문. 첨부 유무와 무관하게 항상 노출한다 (#98) —
          attachment_url이 null인 공고는 이 링크가 없으면 원본에 닿을 경로가
          아예 없어진다. 무엇을 얻으러 가는지 함께 밝혀 클릭 이유를 남긴다.
        */}
        <p className="text-sm text-zinc-500">
          원문에는 표·이미지 등 서식이 포함돼 있습니다.{' '}
          <a
            href={buildSourceUrl(boardId)}
            target="_blank"
            rel="noreferrer"
            className="text-blue-700 underline"
          >
            원본 공고 보기 ↗
          </a>
        </p>
      </section>
    </article>
  );
}

export default function AnnouncementDetailPage({
  params,
}: {
  params: DetailParams;
}) {
  return (
    <main className="mx-auto w-full max-w-2xl p-8">
      <nav className="mb-6">
        <Link
          href={ANNOUNCEMENTS_PATH}
          className="text-sm text-zinc-600 underline"
        >
          ← 공고 목록
        </Link>
      </nav>

      <Suspense fallback={<AnnouncementDetailFallback />}>
        <AnnouncementDetailView params={params} />
      </Suspense>
    </main>
  );
}
