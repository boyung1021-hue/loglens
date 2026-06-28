import { isDbConfigured, query } from "@/lib/db";
import { getDemoDeployments, getDemoDeploymentDetail } from "@/lib/demo-data";

/**
 * DB 연결 자체가 안 되는 상황인지 판단한다(쿼리 문법 오류 등은 제외).
 * 연결 거부/호스트 못 찾음/타임아웃 등 → 데모 데이터로 폴백한다.
 */
function isConnectionError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  if (code && ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EHOSTUNREACH", "ECONNRESET"].includes(code)) {
    return true;
  }
  const msg = err instanceof Error ? err.message.toLowerCase() : "";
  return (
    msg.includes("connect") ||
    msg.includes("timeout") ||
    msg.includes("database_url") ||
    msg.includes("getaddrinfo")
  );
}

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
  // DB 미연결(.env 없음 / Vercel에 DB 연결 전)이면 데모 데이터로 폴백한다.
  if (!isDbConfigured()) return getDemoDeployments();
  try {
    return await listDeploymentsFromDb(limit);
  } catch (err) {
    if (isConnectionError(err)) {
      console.warn("DB 연결 실패 → 데모 데이터로 폴백:", err instanceof Error ? err.message : err);
      return getDemoDeployments();
    }
    throw err;
  }
}

async function listDeploymentsFromDb(limit: number): Promise<DeploymentListItem[]> {
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
  // DB 미연결(.env 없음 / Vercel에 DB 연결 전)이면 데모 데이터로 폴백한다.
  if (!isDbConfigured()) return getDemoDeploymentDetail(id);
  try {
    return await getDeploymentDetailFromDb(id);
  } catch (err) {
    if (isConnectionError(err)) {
      console.warn("DB 연결 실패 → 데모 데이터로 폴백:", err instanceof Error ? err.message : err);
      return getDemoDeploymentDetail(id);
    }
    throw err;
  }
}

async function getDeploymentDetailFromDb(id: string): Promise<DeploymentDetail | null> {
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