import Link from "next/link";
import { listDeployments } from "@/lib/deployments";
import { isDbConfigured } from "@/lib/db";
import { SeverityBadge } from "@/components/severity";

// 항상 최신 DB 상태를 보여준다(캐시 비활성).
export const dynamic = "force-dynamic";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export default async function Home() {
  const deployments = await listDeployments();
  const demoMode = !isDbConfigured();

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">LogLens</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          배포 전후 로그 패턴 변화(drift)를 감지합니다.
        </p>
      </header>

      {demoMode && (
        <div className="mb-6 rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-950/40 dark:text-amber-200">
          🧪 데모 모드 — 데이터베이스가 연결되지 않아 예시 데이터를 보여주고 있습니다.
          <code className="ml-1 font-mono">DATABASE_URL</code>을 설정하면 실제 데이터로 전환됩니다.
        </div>
      )}

      {deployments.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
          아직 배포가 없습니다. <code className="font-mono">pnpm seed</code> 로 데모 데이터를 채우거나{" "}
          <code className="font-mono">pnpm testapp:problem</code> 으로 로그를 보내보세요.
        </div>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {deployments.map((d) => (
            <li key={d.id}>
              <Link
                href={`/deployments/${d.id}`}
                className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/50"
              >
                <SeverityBadge severity={d.severity} className="w-28 justify-center" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium">{d.service}</span>
                    <span className="font-mono text-xs text-muted-foreground">@{d.version}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {d.environment} · {timeAgo(d.deployedAt)} · {d.status}
                  </div>
                </div>
                {d.driftScore !== null && (
                  <div className="text-right">
                    <div className="text-lg font-semibold tabular-nums">{Math.round(d.driftScore)}</div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">drift</div>
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}