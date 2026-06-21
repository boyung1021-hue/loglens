import { query } from "@/lib/db";
import type { DriftItem, DriftResult } from "@/lib/drift-engine";

/**
 * drift 리포트 영속 레이어 — drift_reports 저장 + 배포 상태 전환.
 * AI 요약(summary/recommendation)은 선택값으로, 결정적 단계에서는 비워둔다.
 */

export interface DriftSummary {
  summary: string;
  recommendation: string;
}

export interface SavedDriftReport {
  id: string;
  deploymentId: string;
  baselineId: string | null;
  driftScore: number;
  severity: string;
  summary: string | null;
  recommendation: string | null;
  details: unknown;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** DriftResult를 리포트 details(JSONB)용 구조로 변환한다. 카테고리별로 의미 있는 필드만 남긴다. */
export function buildDetails(drift: DriftResult) {
  const asNew = (i: DriftItem) => ({
    fingerprint: i.fingerprint,
    template: i.template,
    level: i.level,
    count: i.currentCount,
  });
  const asChange = (i: DriftItem) => ({
    fingerprint: i.fingerprint,
    template: i.template,
    level: i.level,
    before: i.baselineCount,
    after: i.currentCount,
    changeRatio: i.ratio === null ? null : round2(i.ratio),
  });
  const asGone = (i: DriftItem) => ({
    fingerprint: i.fingerprint,
    template: i.template,
    level: i.level,
    previousCount: i.baselineCount,
  });

  return {
    newPatterns: drift.newPatterns.map(asNew),
    spikingPatterns: drift.spikingPatterns.map(asChange),
    droppingPatterns: drift.droppingPatterns.map(asChange),
    disappearedPatterns: drift.disappearedPatterns.map(asGone),
    metrics: drift.metrics,
  };
}

/** drift 결과(+선택적 AI 요약)를 drift_reports에 저장하고 저장된 리포트를 반환한다. */
export async function saveDriftReport(
  deploymentId: string,
  baselineId: string | null,
  driftScore: number,
  severity: string,
  details: unknown,
  ai?: DriftSummary | null,
): Promise<SavedDriftReport> {
  const { rows } = await query<SavedDriftReport>(
    `INSERT INTO drift_reports
       (deployment_id, baseline_id, drift_score, severity, summary, recommendation, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     RETURNING id,
               deployment_id  AS "deploymentId",
               baseline_id    AS "baselineId",
               drift_score::float8 AS "driftScore",
               severity, summary, recommendation, details`,
    [
      deploymentId,
      baselineId,
      driftScore,
      severity,
      ai?.summary ?? null,
      ai?.recommendation ?? null,
      JSON.stringify(details),
    ],
  );
  return rows[0];
}

/** 배포 상태를 전환한다 (ingesting | analyzed | rolled_back). 존재하지 않으면 false. */
export async function markDeploymentStatus(
  deploymentId: string,
  status: "ingesting" | "analyzed" | "rolled_back",
): Promise<boolean> {
  const { rowCount } = await query("UPDATE deployments SET status = $2 WHERE id = $1", [
    deploymentId,
    status,
  ]);
  return rowCount === 1;
}