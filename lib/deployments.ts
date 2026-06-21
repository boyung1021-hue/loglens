import { query } from "@/lib/db";

export interface Deployment {
  id: string;
  service: string;
  version: string;
  environment: string;
  deployedAt: string;
  status: string;
}

export interface CreateDeploymentInput {
  service: string;
  version: string;
  environment?: string;
  deployedAt?: string;
}

/**
 * 배포 메타데이터를 한 건 등록한다.
 * environment 미지정 시 'production', deployedAt 미지정 시 now()로 기본 처리.
 */
export async function createDeployment(input: CreateDeploymentInput): Promise<Deployment> {
  const { rows } = await query<Deployment>(
    `INSERT INTO deployments (service, version, environment, deployed_at)
     VALUES ($1, $2, COALESCE($3, 'production'), COALESCE($4::timestamptz, now()))
     RETURNING id, service, version, environment,
               deployed_at AS "deployedAt", status`,
    [input.service, input.version, input.environment ?? null, input.deployedAt ?? null],
  );
  return rows[0];
}

export interface DeploymentListItem extends Deployment {
  /** 최신 drift 리포트의 severity/점수. 아직 분석 전이면 null. */
  severity: string | null;
  driftScore: number | null;
}

/** 배포 목록을 최신 배포순으로 조회한다(각 배포의 최신 drift 리포트 포함). */
export async function listDeployments(limit = 100): Promise<DeploymentListItem[]> {
  const { rows } = await query<DeploymentListItem>(
    `SELECT d.id, d.service, d.version, d.environment,
            d.deployed_at AS "deployedAt", d.status,
            r.severity, r.drift_score::float8 AS "driftScore"
       FROM deployments d
       LEFT JOIN LATERAL (
              SELECT severity, drift_score
                FROM drift_reports
               WHERE deployment_id = d.id
               ORDER BY created_at DESC
               LIMIT 1
            ) r ON true
      ORDER BY d.deployed_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows;
}

/** drift 리포트 details(JSONB)의 구조. 패턴 비교 결과 + 지표 + AI 핵심 변화. */
export interface DriftDetails {
  newPatterns?: { fingerprint: string; template: string; level: string; count: number }[];
  spikingPatterns?: { fingerprint: string; template: string; level: string; before: number; after: number; changeRatio: number | null }[];
  droppingPatterns?: { fingerprint: string; template: string; level: string; before: number; after: number; changeRatio: number | null }[];
  disappearedPatterns?: { fingerprint: string; template: string; level: string; previousCount: number }[];
  metrics?: {
    totalBefore: number;
    totalAfter: number;
    errorRateBefore: number;
    errorRateAfter: number;
    patternsBefore: number;
    patternsAfter: number;
  };
  keyChanges?: string[];
  aiFallback?: boolean;
  /** baseline 없는 첫 배포일 때만. */
  note?: string;
}

export interface DeploymentReport {
  baselineId: string | null;
  baselineVersion: string | null;
  driftScore: number;
  severity: string;
  summary: string | null;
  recommendation: string | null;
  details: DriftDetails;
  createdAt: string;
}

export interface DeploymentDetail extends Deployment {
  patternCount: number;
  report: DeploymentReport | null;
}

/** 배포 상세 + 최신 drift 리포트(baseline 버전 포함)를 조회한다. 없으면 null. */
export async function getDeploymentDetail(id: string): Promise<DeploymentDetail | null> {
  const dep = await query<Deployment & { patternCount: number }>(
    `SELECT d.id, d.service, d.version, d.environment,
            d.deployed_at AS "deployedAt", d.status,
            (SELECT count(*)::int FROM pattern_stats ps WHERE ps.deployment_id = d.id) AS "patternCount"
       FROM deployments d
      WHERE d.id = $1`,
    [id],
  );
  if (dep.rowCount === 0) return null;

  const rep = await query<DeploymentReport>(
    `SELECT r.baseline_id AS "baselineId",
            b.version      AS "baselineVersion",
            r.drift_score::float8 AS "driftScore",
            r.severity, r.summary, r.recommendation, r.details,
            r.created_at AS "createdAt"
       FROM drift_reports r
       LEFT JOIN deployments b ON b.id = r.baseline_id
      WHERE r.deployment_id = $1
      ORDER BY r.created_at DESC
      LIMIT 1`,
    [id],
  );

  return { ...dep.rows[0], report: rep.rows[0] ?? null };
}