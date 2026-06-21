"use client";

import { useEffect } from "react";
import Link from "next/link";

// 서버 컴포넌트의 예기치 못한 예외(DB 연결 실패 등)를 스택트레이스 대신 친절히 표시한다.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-4xl px-6 py-24 text-center">
      <p className="text-sm font-semibold text-red-600 dark:text-red-400">오류</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">문제가 발생했습니다</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        데이터를 불러오지 못했습니다. 데이터베이스 연결을 확인하세요.
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <button
          onClick={reset}
          className="rounded-lg border px-4 py-2 text-sm transition-colors hover:bg-muted/50"
        >
          다시 시도
        </button>
        <Link href="/" className="text-sm text-muted-foreground hover:underline">
          배포 목록
        </Link>
      </div>
    </div>
  );
}
