import { query } from "@/lib/db";
import type { LogLevel } from "@/lib/pattern-engine";
import type { PatternPair } from "@/lib/drift-engine";

/**
 * Baseline 선택 + 패턴 비교 로드 — drift 분석의 DB 입력 레이어.
 *
 *   selectBaseline()    : current 배포의 직전 "정상" 배포를 자동 선택
 *   loadPatternPairs()  : baseline·current의 pattern_stats를 fingerprint 기준으로 짝지어 PatternPair[] 생성
 *
 * 두 결과를 lib/drift-engine.ts의 computeDrift()에 그대로 넘긴다.
 */

export interface BaselineDeployment {
  id: string;
  version: string;
  deployedAt: string;
}

/**
 * current 배포의 baseline(비교 기준)을 자동 선택한다.
 *
 * 규칙 — 같은 service·environment에서 current보다 먼저 배포된 것 중 가장 최근의 "정상" 배포:
 *   - rolled_back 상태 제외
 *   - 과거에 critical로 분석된 적 있는 배포 제외
 *   - 실제 패턴 통계가 쌓인 배포만 (빈 배포를 baseline으로 잡으면 전부 NEW로 오판)
 *
 * 첫 배포 등 비교 대상이 없으면 null을 반환한다(호출 측에서 "baseline 없음"으로 처리).
 * deployed_at 동률은 created_at으로 결정해 선택을 결정적으로 만든다.
 */
export async function selectBaseline(currentDeploymentId: string): Promise<BaselineDeployment | null> {
  const { rows } = await query<BaselineDeployment>(
    `SELECT d.id, d.version, d.deployed_at AS "deployedAt"
       FROM deployments d
       JOIN deployments cur ON cur.id = $1
      WHERE d.service = cur.service
        AND d.environment = cur.environment
        AND d.id <> cur.id
        AND (d.deployed_at < cur.deployed_at
             OR (d.deployed_at = cur.deployed_at AND d.created_at < cur.created_at))
        AND d.status <> 'rolled_back'
        AND EXISTS (SELECT 1 FROM pattern_stats ps WHERE ps.deployment_id = d.id)
        AND NOT EXISTS (
              SELECT 1 FROM drift_reports r
               WHERE r.deployment_id = d.id AND r.severity = 'critical')
      ORDER BY d.deployed_at DESC, d.created_at DESC
      LIMIT 1`,
    [currentDeploymentId],
  );
  return rows[0] ?? null;
}

interface PairRow {
  fingerprint: string;
  template: string;
  level: string;
  baselineCount: number;
  currentCount: number;
}

/**
 * baseline·current 두 배포에 등장한 모든 패턴을 fingerprint 기준으로 짝지어 반환한다.
 * 한쪽에만 있는 패턴은 반대쪽 count를 0으로 채운다(NEW/DISAPPEARED 판정의 기반).
 *
 * baselineId가 null이면(첫 배포) baselineCount는 전부 0 → current의 모든 패턴이 신규 후보가 된다.
 * 같은 쿼리로 처리된다: deployment_id = NULL 비교는 매칭되는 행이 없어 자연히 0으로 떨어진다.
 */
export async function loadPatternPairs(
  currentDeploymentId: string,
  baselineDeploymentId: string | null,
): Promise<PatternPair[]> {
  const { rows } = await query<PairRow>(
    `SELECT lp.fingerprint,
            lp.template,
            lp.level,
            COALESCE(b.count, 0)::int AS "baselineCount",
            COALESCE(c.count, 0)::int AS "currentCount"
       FROM log_patterns lp
       JOIN (
              SELECT pattern_id FROM pattern_stats WHERE deployment_id = $1
              UNION
              SELECT pattern_id FROM pattern_stats WHERE deployment_id = $2
            ) ids ON ids.pattern_id = lp.id
       LEFT JOIN pattern_stats b ON b.pattern_id = lp.id AND b.deployment_id = $2
       LEFT JOIN pattern_stats c ON c.pattern_id = lp.id AND c.deployment_id = $1`,
    [currentDeploymentId, baselineDeploymentId],
  );

  return rows.map((r) => ({
    fingerprint: r.fingerprint,
    template: r.template,
    level: r.level as LogLevel,
    baselineCount: r.baselineCount,
    currentCount: r.currentCount,
  }));
}