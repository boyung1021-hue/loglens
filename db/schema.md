# LogLens DB Schema

> 출처: [docs/04-database-design.md](../docs/04-database-design.md)
> 핵심 원칙: **원본 로그는 저장하지 않는다.** 메타데이터·패턴·집계 통계·drift 결과만 저장.

아래 DDL을 복사해 직접 DB에 테이블을 생성하세요. 모든 테이블은 `loglens` 스키마에 생성됩니다.

> **앱 연결 시 주의**: `lib/db.ts`에서 PG 연결할 때 `search_path`를 `loglens`로 잡아야 테이블명에 접두사 없이 접근할 수 있습니다. 방법 두 가지 중 하나:
> - 연결 문자열에 옵션 추가: `DATABASE_URL=...?options=-c%20search_path%3Dloglens`
> - 연결 직후 쿼리 실행: `SET search_path TO loglens;`

```sql
-- 0. 전용 스키마 생성 + search_path 설정
CREATE SCHEMA IF NOT EXISTS loglens;
SET search_path TO loglens, public;

-- 1. deployments — 배포 메타데이터
CREATE TABLE IF NOT EXISTS deployments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service       TEXT        NOT NULL,
  version       TEXT        NOT NULL,          -- 커밋 SHA 또는 버전 태그
  environment   TEXT        NOT NULL DEFAULT 'production',
  deployed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  status        TEXT        NOT NULL DEFAULT 'ingesting',
                -- ingesting | analyzed | rolled_back
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deployments_service_env
  ON deployments (service, environment, deployed_at DESC);

-- 2. log_patterns — 정규화된 패턴(템플릿). 서비스 전체에서 공유되는 전역 패턴 사전.
CREATE TABLE IF NOT EXISTS log_patterns (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint  TEXT NOT NULL UNIQUE,           -- 정규화 후 해시
  template     TEXT NOT NULL,                  -- 예: "User <NUM> failed in <NUM>ms"
  level        TEXT NOT NULL DEFAULT 'info',   -- info | warn | error
  sample       TEXT,                           -- 대표 원본 1개(옵션, PII 주의)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patterns_level ON log_patterns (level);

-- 3. pattern_stats — 배포별 패턴 집계
CREATE TABLE IF NOT EXISTS pattern_stats (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id  UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  pattern_id     UUID NOT NULL REFERENCES log_patterns(id) ON DELETE CASCADE,
  count          INTEGER NOT NULL DEFAULT 0,
  error_count    INTEGER NOT NULL DEFAULT 0,
  first_seen     TIMESTAMPTZ,
  last_seen      TIMESTAMPTZ,
  UNIQUE (deployment_id, pattern_id)
);

CREATE INDEX IF NOT EXISTS idx_stats_deployment ON pattern_stats (deployment_id);
CREATE INDEX IF NOT EXISTS idx_stats_pattern    ON pattern_stats (pattern_id);

-- 4. drift_reports — drift 분석 결과
CREATE TABLE IF NOT EXISTS drift_reports (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id  UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE, -- current
  baseline_id    UUID          REFERENCES deployments(id) ON DELETE SET NULL, -- 직전
  drift_score    NUMERIC(5,2) NOT NULL DEFAULT 0,    -- 0 ~ 100
  severity       TEXT NOT NULL DEFAULT 'safe',       -- safe | warning | critical
  summary        TEXT,                               -- AI 자연어 요약
  recommendation TEXT,                               -- 롤백 권고 문구
  details        JSONB NOT NULL DEFAULT '{}'::jsonb, -- 변경 패턴 목록 등 구조화 데이터
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drift_deployment ON drift_reports (deployment_id);
```