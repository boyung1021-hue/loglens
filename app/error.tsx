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
      <p className="text-sm font-semibold text-red-600 dark:text-red-400">Error</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Failed to load data. Please check the database connection.
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <button
          onClick={reset}
          className="rounded-lg border px-4 py-2 text-sm transition-colors hover:bg-muted/50"
        >
          Try again
        </button>
        <Link href="/" className="text-sm text-muted-foreground hover:underline">
          Deployments
        </Link>
      </div>
    </div>
  );
}
