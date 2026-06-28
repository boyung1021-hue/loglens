import { getPool } from "@/lib/db";
import type { PatternAgg } from "@/lib/pattern-engine";

export interface PersistResult {
  /** 패턴 사전(log_patterns)에 이번에 새로 추가된 패턴 수. */
  newPatternCount: number;
}

/**
 * 집계된 패턴들을 DB에 반영한다.
 *   1) log_patterns  — 전역 패턴 사전에 upsert (없으면 추가)
 *   2) pattern_stats — 배포별 통계에 누적 upsert
 * 하나의 트랜잭션으로 처리한다. 원본 로그는 저장하지 않는다(대표 sample 1줄만).
 */
export async function persistPatterns(
  deploymentId: string,
  aggs: PatternAgg[],
): Promise<PersistResult> {
  if (aggs.length === 0) return { newPatternCount: 0 };

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    let newPatternCount = 0;

    for (const a of aggs) {
      // 1) 패턴 사전 upsert. xmax=0 이면 이번에 INSERT된 신규 행이라는 의미.
      const { rows } = await client.query<{ id: string; inserted: boolean }>(
        `INSERT INTO log_patterns (fingerprint, template, level, sample)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (fingerprint) DO UPDATE SET fingerprint = EXCLUDED.fingerprint
         RETURNING id, (xmax = 0) AS inserted`,
        [a.fingerprint, a.template, a.level, a.sample ?? null],
      );
      const { id: patternId, inserted } = rows[0];
      if (inserted) newPatternCount += 1;

      // 2) 배포별 통계 누적 upsert
      await client.query(
        `INSERT INTO pattern_stats
           (deployment_id, pattern_id, count, error_count, first_seen, last_seen)
         VALUES ($1, $2, $3, $4,
                 COALESCE($5::timestamptz, now()), COALESCE($6::timestamptz, now()))
         ON CONFLICT (deployment_id, pattern_id) DO UPDATE SET
           count       = pattern_stats.count + EXCLUDED.count,
           error_count = pattern_stats.error_count + EXCLUDED.error_count,
           first_seen  = LEAST(pattern_stats.first_seen, EXCLUDED.first_seen),
           last_seen   = GREATEST(pattern_stats.last_seen, EXCLUDED.last_seen)`,
        [deploymentId, patternId, a.count, a.errorCount, a.firstSeen ?? null, a.lastSeen ?? null],
      );
    }

    await client.query("COMMIT");
    return { newPatternCount };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** 배포가 존재하는지 확인한다. */
export async function deploymentExists(deploymentId: string): Promise<boolean> {
  const { rowCount } = await getPool().query("SELECT 1 FROM deployments WHERE id = $1", [deploymentId]);
  return rowCount === 1;
}
