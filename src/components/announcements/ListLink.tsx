'use client';

import Link from 'next/link';
import type { ComponentProps, MouseEvent } from 'react';

/**
 * 목록 안에서 URL 쿼리만 바꾸는 링크 (#106, ADR 015 세부 판단 2).
 *
 * 필터·페이지 이동은 같은 라우트(`/announcements`)의 쿼리 변경이고, 데이터는 이미
 * 브라우저에 있다. `Link`의 기본 네비게이션에 맡기면 라우터가 RSC 페이로드를 다시
 * 요청할 수 있어(CDN 히트라 빠르지만 0은 아니다) 서버 요청 0을 보장하지 못한다.
 * 그래서 좌클릭이면 기본 동작을 막고 `window.history.pushState`로 URL만 바꾼다 —
 * Next가 공식 지원하는 shallow routing이라 라우터가 이를 감지해 `useSearchParams`를
 * 갱신하고, 클라이언트 컴포넌트가 새 URL로 다시 고른다.
 *
 * `href`를 남기고 `<button>`으로 바꾸지 않는 이유: JS가 꺼져도 전체 로드로 동작하고,
 * 새 탭 열기·링크 복사 같은 브라우저 기본 동작이 유지된다. 그래서 수정키(⌘·Ctrl·
 * Shift·Alt)나 가운데 클릭은 가로채지 않는다 — 그건 사용자가 "다른 곳에 열겠다"고
 * 말한 것이다.
 *
 * `prefetch={false}`: 같은 라우트의 shell은 이미 화면에 있고 동적 구간은 prefetch
 * 대상이 아니라 얻는 것이 없다. 마우스를 올릴 때마다 나가는 빈 요청만 줄인다.
 */
export function ListLink({
  href,
  scrollToTop = false,
  onClick,
  ...rest
}: Omit<ComponentProps<typeof Link>, 'href' | 'prefetch'> & {
  href: string;
  /** 이동 후 맨 위로 스크롤한다. 페이지네이션은 켜고 필터는 끈다(필터 바는 이미 맨 위다). */
  scrollToTop?: boolean;
}) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (!isPlainLeftClick(event)) return;

    event.preventDefault();
    window.history.pushState(null, '', href);
    if (scrollToTop) {
      window.scrollTo({ top: 0 });
    }
  };

  return <Link href={href} prefetch={false} onClick={handleClick} {...rest} />;
}

/** 수정키 없는 좌클릭인가. 그 외는 브라우저 기본 동작(새 탭 등)에 맡긴다. */
function isPlainLeftClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}
