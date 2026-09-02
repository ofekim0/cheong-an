import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * Cache Components (PPR) — ADR 013.
   *
   * 목록 페이지가 `searchParams`(page·필터)를 읽어야 하는데, 이는 request-time
   * API라 읽는 순간 라우트 전체가 동적 렌더링이 된다. 이 플래그를 켜야 캐시된
   * 조회를 static shell에 남기고 `searchParams` 접근만 Suspense 경계 안으로
   * 격리할 수 있다.
   */
  cacheComponents: true,
};

export default nextConfig;
