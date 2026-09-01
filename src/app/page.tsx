import Link from 'next/link';

import { ANNOUNCEMENTS_PATH } from '@/constants/announcements';

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center">
      <h1 className="text-4xl font-bold">청안</h1>
      <p className="mt-4 text-lg text-zinc-600">
        청년안심주택 새 공고 알림 서비스
      </p>
      <Link
        href={ANNOUNCEMENTS_PATH}
        className="mt-8 rounded-lg border border-zinc-300 px-4 py-2 text-sm transition-colors hover:border-zinc-500"
      >
        공고 목록 보기
      </Link>
    </main>
  );
}
