import { Pool, type QueryResultRow } from "pg";

const connectionString = process.env.DATABASE_URL;

/**
 * DATABASE_URL이 설정돼 있는지 여부.
 * 미설정(예: .env 없음 / Vercel에 DB 연결 전)이면 데이터 레이어가 데모 데이터로 폴백한다.
 */
export function isDbConfigured(): boolean {
  return Boolean(connectionString);
}

// dev 환경 HMR에서 Pool이 매번 새로 만들어지는 것을 막기 위해 globalThis에 캐싱한다.
const globalForDb = globalThis as unknown as { pool?: Pool };

/**
 * Pool을 지연 생성한다. import 시점이 아니라 실제 쿼리 시점에 만들어지므로,
 * DATABASE_URL이 없어도 모듈 로드만으로는 크래시하지 않는다(데모 폴백 가능).
 * DATABASE_URL이 없는데 호출되면 명시적으로 throw → 호출부가 폴백을 결정한다.
 */
export function getPool(): Pool {
  if (!connectionString) {
    throw new Error("DATABASE_URL 환경변수가 설정되지 않았습니다.");
  }
  if (globalForDb.pool) return globalForDb.pool;

  const pool = new Pool({
    connectionString,
    // 모든 연결의 search_path를 loglens 스키마로 고정 → 테이블명에 접두사 불필요
    options: "-c search_path=loglens,public",
  });

  if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;
  return pool;
}

/** 간단한 파라미터 쿼리 헬퍼. */
export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  return getPool().query<T>(text, params);
}