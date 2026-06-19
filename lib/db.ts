import { Pool, type QueryResultRow } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL 환경변수가 설정되지 않았습니다.");
}

// dev 환경 HMR에서 Pool이 매번 새로 만들어지는 것을 막기 위해 globalThis에 캐싱한다.
const globalForDb = globalThis as unknown as { pool?: Pool };

export const pool =
  globalForDb.pool ??
  new Pool({
    connectionString,
    // 모든 연결의 search_path를 loglens 스키마로 고정 → 테이블명에 접두사 불필요
    options: "-c search_path=loglens,public",
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.pool = pool;
}

/** 간단한 파라미터 쿼리 헬퍼. */
export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  return pool.query<T>(text, params);
}