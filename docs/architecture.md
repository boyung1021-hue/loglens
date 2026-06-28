# LogLens — Architecture

LogLens detects **log pattern drift** between deployments. Raw logs are normalized into
patterns, the "before" (baseline) and "after" (current) deployments are compared by a
deterministic engine, scored 0–100, and an AI layer turns the result into a human-readable
summary with a rollback recommendation.

---

## 1. System overview

```mermaid
flowchart TB
    subgraph SRC["Log sources"]
        APP["Your service / test-app<br/>(generates logs)"]
    end

    subgraph NEXT["Next.js 15 (App Router) — single deployable"]
        direction TB
        subgraph API["API routes (write path)"]
            R1["POST /api/deployments<br/>register a deploy"]
            R2["POST /api/ingest<br/>send logs"]
            R3["POST /api/deployments/[id]/analyze<br/>run drift analysis"]
        end
        subgraph UI["Server Components (read path)"]
            P1["/  → deployment list"]
            P2["/deployments/[id] → detail"]
        end
        subgraph LIB["lib/ — pipeline"]
            PE["pattern-engine<br/>normalize → fingerprint → aggregate<br/>(pure)"]
            DE["drift-engine<br/>computeDrift → score → severity<br/>(pure)"]
            BL["baseline<br/>selectBaseline / loadPatternPairs"]
            RP["reports<br/>buildDetails / saveDriftReport"]
            DEP["deployments<br/>list / detail (+ demo fallback)"]
            AI["openai<br/>summarizeDrift (+ rule-based fallback)"]
            DB["db<br/>lazy Pool · isDbConfigured()"]
            DEMO["demo-data<br/>fallback when no DB"]
        end
    end

    PG[("PostgreSQL<br/>schema: loglens")]
    OAI["OpenAI API<br/>(gpt-4o-mini, optional)"]

    APP -->|"1 register"| R1
    APP -->|"2 logs"| R2
    APP -->|"3 analyze"| R3

    R1 --> DEP
    R2 --> PE --> DB
    R3 --> BL --> DE --> AI --> RP --> DB
    AI -.->|"if key set"| OAI
    AI -.->|"offline / no key"| AI

    P1 --> DEP
    P2 --> DEP
    DEP -->|"DATABASE_URL set"| DB --> PG
    DEP -.->|"no DB → demo mode"| DEMO

    DB <--> PG

    classDef pure fill:#eef7ee,stroke:#5a5;
    classDef io fill:#eef2fb,stroke:#56a;
    class PE,DE pure;
    class DB,DEP,RP,BL io;
```

> **Read path fallback:** when `DATABASE_URL` is unset or the DB is unreachable,
> `deployments.ts` serves deterministic **demo data** (same `payment-api` scenario as the
> seed) instead of querying Postgres — so the app renders even with no database
> (e.g. on Vercel before a DB is attached). A 🧪 *Demo mode* banner is shown.

---

## 2. Ingest → Analyze pipeline

```mermaid
sequenceDiagram
    autonumber
    participant C as Client (service/test-app)
    participant API as Next.js API
    participant ENG as Pattern/Drift engine (pure)
    participant AI as OpenAI / fallback
    participant DB as PostgreSQL

    C->>API: POST /api/deployments {service, version}
    API->>DB: INSERT deployments
    DB-->>C: deployment id

    C->>API: POST /api/ingest {deploymentId, logs[]}
    API->>ENG: aggregate(logs) → normalize+fingerprint
    ENG-->>API: PatternAgg[]
    API->>DB: upsert log_patterns + pattern_stats

    C->>API: POST /api/deployments/[id]/analyze
    API->>DB: selectBaseline(id) (previous deploy)
    API->>DB: loadPatternPairs(current, baseline)
    API->>ENG: computeDrift(pairs) → score, severity
    ENG-->>API: DriftResult
    API->>AI: summarizeDrift(drift)
    AI-->>API: {summary, keyChanges, recommendation}
    API->>DB: saveDriftReport + status=analyzed
```

**Drift classification (per pattern):** `NEW` · `SPIKE` · `DROP` · `DISAPPEARED`
**Score (0–100):** weights new error patterns and rising error rate most heavily.
**Severity:** `safe` < 25 ≤ `warning` < 60 ≤ `critical`.

---

## 3. Data model

```mermaid
erDiagram
    deployments ||--o{ pattern_stats : has
    log_patterns ||--o{ pattern_stats : "counted in"
    deployments ||--o{ drift_reports : "current"
    deployments |o--o{ drift_reports : "baseline"

    deployments {
        uuid id PK
        text service
        text version
        text environment
        timestamptz deployed_at
        text status
    }
    log_patterns {
        uuid id PK
        text fingerprint UK
        text template
        text level
        text sample
    }
    pattern_stats {
        uuid deployment_id FK
        uuid pattern_id FK
        int count
        int error_count
        timestamptz first_seen
        timestamptz last_seen
    }
    drift_reports {
        uuid id PK
        uuid deployment_id FK
        uuid baseline_id FK
        numeric drift_score
        text severity
        text summary
        text recommendation
        jsonb details
        timestamptz created_at
    }
```

- **`log_patterns`** is a global pattern dictionary (one row per unique `fingerprint`);
  raw log lines are **not** stored — only a representative `sample`.
- **`pattern_stats`** holds per-deployment counts (this is what gets diffed).
- **`drift_reports.details`** (JSONB) stores the classified pattern diff + metrics + AI key changes.

---

## 4. Design principles

| Principle | How it shows up |
|-----------|-----------------|
| **Deterministic core, AI on top** | `pattern-engine` & `drift-engine` are pure functions; OpenAI only *summarizes*. |
| **Never breaks the demo** | No AI key / API failure → rule-based `fallbackSummary`. No DB → `demo-data`. |
| **Privacy / lightweight** | Original logs discarded after aggregation; only pattern stats persist. |
| **Same engine everywhere** | `seed`, test-app, and demo-data all reuse the exact `lib/` pipeline. |
| **Swap-only environments** | Local Docker PG ↔ cloud Postgres by changing `DATABASE_URL` only. |
