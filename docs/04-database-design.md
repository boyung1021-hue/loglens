# 04. 데이터베이스 설계 (Database Design)

> DB: **AWS Aurora PostgreSQL**
> 핵심 원칙: **원본 로그를 저장하지 않는다.** 메타데이터 · 패턴 · 집계 통계 · drift 결과만 저장.

---

## 1. 저장 / 비저장 원칙

| 저장한다 ✅ | 저장하지 않는다 ❌ |
|------------|-------------------|
| 배포 메타데이터 | 원본 로그 라인 전체 |
| 정규화된 로그 패턴(템플릿) | 사용자별 페이로드/PII |
| 배포별 패턴 통계(빈도·에러율) | 풀텍스트 검색 인덱스 |
| drift 분석 결과 + AI 요약 | 시계열 raw 메트릭 |
| (옵션) 패턴당 대표 샘플 1개 | |

> 효과: DB 용량이 "로그 양"이 아니라 "고유 패턴 수"에 비례한다. 수백만 라인이 들어와도 패턴은 수백~수천 개 수준이므로 저장량이 폭발하지 않는다.

---

## 2. ER 다이어그램 (개념)

```
┌────────────────┐
│  deployments   │
│────────────────│
│ id (PK)        │
│ service        │
│ version        │
│ environment    │
│ deployed_at    │
│ status         │
└───────┬────────┘
        │ 1
        │
        │ N
┌───────▼─────────────┐        ┌──────────────────────┐
│   pattern_stats     │   N    │     log_patterns      │
│─────────────────────│───────▶│───────────────────────│
│ id (PK)             │   1    │ id (PK)               │
│ deployment_id (FK)  │        │ fingerprint (UNIQUE)  │
│ pattern_id (FK)     │        │ template              │
│ count               │        │ level                 │
│ error_count         │        │ sample (옵션)          │
│ first_seen / last   │        │ created_at            │
└─────────────────────┘        └───────────────────────┘
        ▲
        │ baseline/current 두 배포의 stats를 비교
┌───────┴─────────────┐
│   drift_reports     │
│─────────────────────│
│ id (PK)             │
│ deployment_id (FK)  │  ← current
│ baseline_id (FK)    │  ← 직전 배포
│ drift_score         │
│ severity            │
│ summary (AI)        │
│ details (JSONB)     │
│ created_at          │
└─────────────────────┘
```

---

## 3. 테이블 스키마 (DDL)

### 3.1 `deployments` — 배포 메타데이터

```sql
CREATE TABLE deployments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service       TEXT        NOT NULL,
  version       TEXT        NOT NULL,          -- 커밋 SHA 또는 버전 태그
  environment   TEXT        NOT NULL DEFAULT 'production',
  deployed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  status        TEXT        NOT NULL DEFAULT 'ingesting',
                -- ingesting | analyzed | rolled_back
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_deployments_service_env
  ON deployments (service, environment, deployed_at DESC);
```

### 3.2 `log_patterns` — 정규화된 패턴(템플릿)

```sql
CREATE TABLE log_patterns (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint  TEXT NOT NULL UNIQUE,           -- 정규화 후 해시
  template     TEXT NOT NULL,                  -- 예: "User <NUM> failed in <NUM>ms"
  level        TEXT NOT NULL DEFAULT 'info',   -- info | warn | error
  sample       TEXT,                           -- 대표 원본 1개(옵션, PII 주의)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_patterns_level ON log_patterns (level);
```

> `log_patterns`는 서비스 전체에서 **공유**된다(전역 패턴 사전). 배포별 등장 빈도는 `pattern_stats`가 담당.

### 3.3 `pattern_stats` — 배포별 패턴 집계

```sql
CREATE TABLE pattern_stats (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id  UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  pattern_id     UUID NOT NULL REFERENCES log_patterns(id) ON DELETE CASCADE,
  count          INTEGER NOT NULL DEFAULT 0,
  error_count    INTEGER NOT NULL DEFAULT 0,
  first_seen     TIMESTAMPTZ,
  last_seen      TIMESTAMPTZ,
  UNIQUE (deployment_id, pattern_id)
);

CREATE INDEX idx_stats_deployment ON pattern_stats (deployment_id);
CREATE INDEX idx_stats_pattern    ON pattern_stats (pattern_id);
```

### 3.4 `drift_reports` — drift 분석 결과

```sql
CREATE TABLE drift_reports (
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

CREATE INDEX idx_drift_deployment ON drift_reports (deployment_id);
```

#### `details` JSONB 예시

```json
{
  "newPatterns": [
    { "template": "NullPointerException at <PATH>", "count": 142, "level": "error" }
  ],
  "disappearedPatterns": [
    { "template": "Cache warmed in <NUM>ms", "previousCount": 88 }
  ],
  "spikingPatterns": [
    { "template": "DB timeout after <NUM>ms", "before": 3, "after": 210, "changeRatio": 70.0 }
  ],
  "metrics": {
    "errorRateBefore": 0.04,
    "errorRateAfter": 0.18,
    "newPatternCount": 3,
    "totalPatternsBefore": 120,
    "totalPatternsAfter": 126
  }
}
```

---

## 4. 핵심 쿼리 예시

### 4.1 baseline 배포 찾기 (같은 서비스·환경의 직전 분석 배포)

```sql
SELECT id, version, deployed_at
FROM deployments
WHERE service = $1
  AND environment = $2
  AND deployed_at < $3          -- current 배포 시각
  AND status <> 'rolled_back'
ORDER BY deployed_at DESC
LIMIT 1;
```

### 4.2 두 배포의 패턴 통계 비교 (drift 입력 데이터)

```sql
SELECT
  p.id, p.template, p.level,
  COALESCE(cur.count, 0)  AS current_count,
  COALESCE(base.count, 0) AS baseline_count,
  COALESCE(cur.error_count, 0)  AS current_errors,
  COALESCE(base.error_count, 0) AS baseline_errors
FROM log_patterns p
LEFT JOIN pattern_stats cur  ON cur.pattern_id  = p.id AND cur.deployment_id  = $current
LEFT JOIN pattern_stats base ON base.pattern_id = p.id AND base.deployment_id = $baseline
WHERE cur.id IS NOT NULL OR base.id IS NOT NULL;
```

> 이 한 쿼리 결과만으로 NEW(`baseline_count=0`), DISAPPEARED(`current_count=0`), SPIKE/DROP(비율 변화)을 모두 계산할 수 있다.

### 4.3 ingest 시 패턴 upsert

```sql
-- 패턴 사전에 없으면 추가
INSERT INTO log_patterns (fingerprint, template, level, sample)
VALUES ($1, $2, $3, $4)
ON CONFLICT (fingerprint) DO NOTHING;

-- 배포별 통계 누적
INSERT INTO pattern_stats (deployment_id, pattern_id, count, error_count, first_seen, last_seen)
VALUES ($dep, $pat, $cnt, $err, $first, $last)
ON CONFLICT (deployment_id, pattern_id)
DO UPDATE SET
  count       = pattern_stats.count + EXCLUDED.count,
  error_count = pattern_stats.error_count + EXCLUDED.error_count,
  last_seen   = GREATEST(pattern_stats.last_seen, EXCLUDED.last_seen);
```

---

## 5. ORM / 접근 방식 (해커톤 권장)

- 단순함 우선: **`pg`(node-postgres) + 직접 SQL** 또는 **Drizzle ORM**.
- 마이그레이션은 단일 `schema.sql` 파일 하나로 시작(과한 마이그레이션 도구 지양).
- 타입은 `lib/schema.ts`에 TypeScript 인터페이스로 손으로 정의(또는 Drizzle 추론).

---

## 6. 용량 산정 (왜 raw 미저장이 이기는가)

| 시나리오 | raw 저장 시 | LogLens(패턴) |
|----------|------------|---------------|
| 배포당 100만 로그 라인 | ~수 GB | 고유 패턴 ~500개 → 수십 KB |
| 100회 배포 | 수백 GB | 패턴 사전 공유 → 수 MB |

➡️ 다음 문서: [05. Drift 감지 로직](./05-drift-detection.md)