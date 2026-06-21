import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getDeploymentDetail, type DriftDetails } from "@/lib/deployments";
import { SeverityBadge } from "@/components/severity";

export const dynamic = "force-dynamic";

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

const levelClass = (level: string) =>
  level === "error"
    ? "text-red-600 dark:text-red-400"
    : level === "warn"
      ? "text-amber-600 dark:text-amber-400"
      : "text-muted-foreground";

function Template({ level, children }: { level: string; children: string }) {
  return (
    <span className="font-mono text-sm">
      <span className={`mr-2 text-[10px] font-semibold uppercase ${levelClass(level)}`}>{level}</span>
      {children}
    </span>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <section className="rounded-xl border bg-card">
      <h3 className="border-b px-5 py-3 text-sm font-semibold">
        {title} <span className="text-muted-foreground">({count})</span>
      </h3>
      <ul className="divide-y">{children}</ul>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export default async function DeploymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // 잘못된 UUID는 DB 쿼리 전에 404로 처리한다 (UUID 컬럼에 직접 넣으면 22P02로 크래시).
  if (!z.uuid().safeParse(id).success) notFound();
  const dep = await getDeploymentDetail(id);
  if (!dep) notFound();

  const report = dep.report;
  const details: DriftDetails = report?.details ?? {};
  const m = details.metrics;

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <Link href="/" className="text-sm text-muted-foreground hover:underline">
        ← 배포 목록
      </Link>

      {/* 헤더 */}
      <header className="mt-4 mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-baseline gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{dep.service}</h1>
            <span className="font-mono text-sm text-muted-foreground">@{dep.version}</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {dep.environment} · {dep.patternCount} patterns · {dep.status}
            {report?.baselineVersion && (
              <>
                {" "}
                · baseline <span className="font-mono">@{report.baselineVersion}</span>
              </>
            )}
          </p>
        </div>
        {report && <SeverityBadge severity={report.severity} className="text-sm" />}
      </header>

      {!report ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
          아직 분석되지 않았습니다.
        </div>
      ) : details.note ? (
        <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">{details.note}</div>
      ) : (
        <div className="space-y-6">
          {/* Verdict + 지표 */}
          <div className="rounded-xl border bg-card p-5">
            <div className="flex items-center gap-4">
              <div className="text-4xl font-bold tabular-nums">{Math.round(report.driftScore)}</div>
              <div className="text-sm text-muted-foreground">
                drift score
                <br />
                (0–100)
              </div>
            </div>
            {m && (
              <div className="mt-5 grid grid-cols-2 gap-4 border-t pt-4 sm:grid-cols-4">
                <Metric label="에러율" value={`${pct(m.errorRateBefore)} ▶ ${pct(m.errorRateAfter)}`} />
                <Metric label="총 로그" value={`${m.totalBefore} ▶ ${m.totalAfter}`} />
                <Metric label="패턴 수" value={`${m.patternsBefore} ▶ ${m.patternsAfter}`} />
              </div>
            )}
          </div>

          {/* AI 요약 + 권고 */}
          {(report.summary || report.recommendation) && (
            <div className="rounded-xl border bg-card p-5">
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-sm font-semibold">AI 요약</h2>
                {details.aiFallback && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    fallback
                  </span>
                )}
              </div>
              {report.summary && <p className="text-sm leading-relaxed">{report.summary}</p>}
              {details.keyChanges && details.keyChanges.length > 0 && (
                <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-muted-foreground">
                  {details.keyChanges.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              )}
              {report.recommendation && (
                <p className="mt-4 rounded-lg bg-muted/60 px-4 py-3 text-sm font-medium">
                  💡 {report.recommendation}
                </p>
              )}
            </div>
          )}

          {/* 변경 패턴 diff */}
          <Section title="신규 패턴 (NEW)" count={details.newPatterns?.length ?? 0}>
            {details.newPatterns?.map((p) => (
              <li key={p.fingerprint} className="flex items-center justify-between gap-4 px-5 py-3">
                <Template level={p.level}>{p.template}</Template>
                <span className="shrink-0 font-mono text-sm tabular-nums text-emerald-600 dark:text-emerald-400">
                  +{p.count}
                </span>
              </li>
            ))}
          </Section>

          <Section title="급증 (SPIKE)" count={details.spikingPatterns?.length ?? 0}>
            {details.spikingPatterns?.map((p) => (
              <li key={p.fingerprint} className="flex items-center justify-between gap-4 px-5 py-3">
                <Template level={p.level}>{p.template}</Template>
                <span className="shrink-0 font-mono text-sm tabular-nums">
                  {p.before} ▶ {p.after}
                  {p.changeRatio !== null && <span className="ml-1 text-red-500">({p.changeRatio}×)</span>}
                </span>
              </li>
            ))}
          </Section>

          <Section title="급감 (DROP)" count={details.droppingPatterns?.length ?? 0}>
            {details.droppingPatterns?.map((p) => (
              <li key={p.fingerprint} className="flex items-center justify-between gap-4 px-5 py-3">
                <Template level={p.level}>{p.template}</Template>
                <span className="shrink-0 font-mono text-sm tabular-nums text-muted-foreground">
                  {p.before} ▶ {p.after}
                </span>
              </li>
            ))}
          </Section>

          <Section title="소멸 (DISAPPEARED)" count={details.disappearedPatterns?.length ?? 0}>
            {details.disappearedPatterns?.map((p) => (
              <li key={p.fingerprint} className="flex items-center justify-between gap-4 px-5 py-3">
                <Template level={p.level}>{p.template}</Template>
                <span className="shrink-0 font-mono text-sm tabular-nums text-muted-foreground">
                  {p.previousCount} ▶ 0
                </span>
              </li>
            ))}
          </Section>
        </div>
      )}
    </div>
  );
}