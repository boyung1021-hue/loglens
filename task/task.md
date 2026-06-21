# Task List

> 출처: [09. 개발 계획](../docs/09-development-plan.md)

---

## 📅 Day 1 — 기반 + Walking Skeleton

> **종료 기준**: 로컬에서 curl로 배포 등록 → 로그 ingest → 로컬 DB에 패턴/통계가 쌓인다.

### 🌅 오전 (셋업 — 전부 로컬)

- [x] **Next.js 15 앱 생성 + Tailwind·shadcn/ui 설치**
  - Next.js 15(App Router) 앱 생성, Tailwind CSS + shadcn/ui 설치·초기화. pnpm 사용.
  - ✅ 완료: Next.js `15.5.19` (App Router, TypeScript, no `src/`, alias `@/*`, Turbopack), Tailwind CSS `v4`, shadcn/ui (`components.json`, `components/ui/button.tsx`, `lib/utils.ts`). pnpm `11.6.0`(corepack). `pnpm run build` 통과.
- [x] **로컬 PostgreSQL을 Docker로 기동**
  - `docker compose up -d db`. 클라우드 DB(Aurora)는 데모 직전에만. Aurora와 동일한 PG라 `DATABASE_URL`만 교체하면 호환.
- [x] **schema.sql 작성 + 로컬 DB 적용**
  - `deployments`, `log_patterns`, `pattern_stats`, `drift_reports` 4개 테이블 DDL 작성 후 로컬 DB에 적용.
  - ✅ 완료: `db/schema.md`에 4개 테이블 DDL 작성(전용 `loglens` 스키마). 로컬 PG 16.14에 적용 완료.
- [x] **lib/db.ts 연결 확인**
  - 로컬 `DATABASE_URL`로 PG 연결 생성, 간단한 SELECT로 검증. `pg`(node-postgres) 또는 Drizzle.
  - ✅ 완료: `pg` 8.21.0 설치, `lib/db.ts`에 `search_path=loglens` 고정 싱글톤 `Pool` + `query()` 헬퍼. SELECT로 연결 및 4개 테이블 확인.
- [x] **환경변수 설정 + .gitignore 확인**
  - `.env.local`에 `DATABASE_URL`(로컬 PG)·`OPENAI_API_KEY` 설정. 레포 커밋 금지 — `.gitignore`에 `.env.local` 포함 확인. (실제 키 값은 직접 입력)
  - ✅ 완료: `.gitignore`에 `.env*` 포함 → 모든 env 파일 커밋 차단 확인. `DATABASE_URL`은 `.env.development`에 설정됨. `OPENAI_API_KEY`는 AI 작업 단계에서 직접 입력.

### 🌆 오후 (Ingest 파이프라인)

- [x] **lib/pattern-engine.ts: normalize/fingerprint/aggregate 구현**
  - 로그 정규화, fingerprint 해싱, fingerprint별 집계. 순수 함수 위주로 작성해 테스트 용이하게.
  - ✅ 완료: `lib/pattern-engine.ts`에 순수 함수 `normalize`/`fingerprint`/`aggregate` + 타입(`LogLine`, `PatternAgg`) 구현. DB/네트워크 의존 없음.
- [x] **POST /api/deployments (배포 등록)**
  - service/version 필수 검증, `deployments` 레코드 생성 후 201 반환.
  - ✅ 완료: `app/api/deployments/route.ts`(zod 검증, Node 런타임) + `lib/deployments.ts`(`createDeployment`). curl 검증 — 정상 201, 검증 실패/깨진 JSON 400. deps: zod.
- [x] **POST /api/ingest (정규화→집계→upsert, 원본 미저장)**
  - 로그 batch 수신 → 정규화→fingerprint→집계 → `log_patterns`/`pattern_stats` upsert. 원본 로그는 메모리에서 버린다.
  - ✅ 완료: `app/api/ingest/route.ts`(zod 검증, 404/400 처리) + `lib/patterns.ts`(`persistPatterns` 트랜잭션 upsert, `deploymentExists`). `aggregate`에 first/last seen 추가. E2E curl 검증 — 신규/누적/404/400 정상, DB 통계 누적 확인.
- [x] **정규화 단위 테스트 작성**
  - `normalize()`의 핵심 케이스(타임스탬프/UUID/IP/경로/숫자 토큰화) 테스트. drift 정확도의 핵심이자 가장 버그 나기 쉬운 곳.
  - ✅ 완료: Vitest 셋업(`vitest.config.ts`, `test`/`test:watch` 스크립트). `lib/pattern-engine.test.ts` 20개 테스트 전부 통과.

---

## 📅 Day 2 — Drift 엔진 + AI + 화면

> **종료 기준**: 로컬 테스트 앱이 보낸 로그로 분석이 돌고, 브라우저에서 문제 배포를 열면 CRITICAL + AI 요약 + 변경 패턴이 보인다.

### 🌅 오전 (Drift 엔진)

- [x] **lib/drift-engine.ts: computeDrift() 구현**
  - 현재 배포 패턴 집계 vs baseline 집계를 비교해 패턴별 변화를 분류: `NEW`(신규 등장) / `DISAPPEARED`(사라짐) / `SPIKE`(급증) / `DROP`(급감).
  - DB/네트워크 의존 없는 순수 함수로 작성(입력: 두 `PatternAgg[]`, 출력: `DriftResult`). 테스트 용이하게.
  - ✅ 완료: `lib/drift-engine.ts`에 순수 함수 `computeDrift(PatternPair[])` + 타입(`PatternPair`/`DriftItem`/`DriftMetrics`/`DriftResult`/`Severity`). 임계값 `SPIKE_RATIO=3`/`DROP_RATIO=0.33`/`MIN_COUNT=5`. fingerprint가 level을 포함하므로 errorCount는 level에서 파생(인터페이스 단순화). 분류 상호배타. `tsc --noEmit` 통과.
- [x] **drift 점수 / severity 산정**
  - 패턴별 변화량·레벨(error 가중치)·신규 error 패턴 등을 종합해 `driftScore` 계산, `SAFE`/`WARNING`/`CRITICAL` severity로 매핑.
  - 문제 배포가 확실히 CRITICAL이 되도록 가중치/임계값은 Day 3에서 튜닝(여기선 기본값).
  - ✅ 완료: 가중합 score(신규에러 25 / 신규비에러 5 / 급증에러 20 / 소멸정상 8 / 에러율 상승분 ×100), 0~100 clamp. severity: ≥60 critical / ≥25 warning / else safe. `metrics`(총량·에러율·패턴 다양성) 포함.
  - ✅ 추가: `lib/drift-engine.test.ts` 16개 테스트 통과(분류·MIN_COUNT 노이즈컷·metrics·score/severity 경계·문제배포 critical).
- [x] **baseline 자동 선택 쿼리 + 패턴 비교 쿼리**
  - 같은 service의 직전 정상 배포를 baseline으로 자동 선택하는 쿼리. baseline·current의 `pattern_stats`를 fingerprint 기준으로 비교해 집계 로드.
  - baseline 없을 때(첫 배포) 처리 방식 정의.
  - ✅ 완료: `lib/baseline.ts`에 `selectBaseline(currentId)` + `loadPatternPairs(currentId, baselineId|null)`. baseline 규칙 = 같은 service·environment, current보다 먼저, `rolled_back` 제외, 과거 `critical` 제외, 패턴 통계 있는 것 중 최근(deployed_at→created_at 동률 결정). 비교는 양쪽 `pattern_stats`를 pattern_id로 UNION+LEFT JOIN → `PatternPair[]`. baseline 없으면 `null` → 같은 쿼리에서 `deployment_id=NULL` 미매칭으로 baselineCount 전부 0(전부 신규 후보).
  - ✅ 검증: 로컬 PG에 임시 데이터 삽입 후 트랜잭션 ROLLBACK으로 3케이스 확인 — baseline 선택(critical 제외), 패턴 비교(NEW 0→142), 첫 배포(NULL) baseline 전부 0. `tsc --noEmit` 통과.
- [ ] **POST /api/deployments/:id/analyze (AI 제외, 결정적 결과까지)**
  - 배포 ID로 baseline 선택 → 패턴 비교 → `computeDrift()` → severity 산정까지. AI 요약은 아직 붙이지 않고 결정적 결과(JSON)만 반환.
  - 없는 배포(404), baseline 없음 등 에러 처리.

### 🌆 오후 (AI + UI + 로컬 테스트 앱)

- [ ] **lib/openai.ts: summarizeDrift() + fallback**
  - drift 결과를 입력받아 `gpt-4o-mini`로 사람이 읽는 요약 + 롤백 권고 생성. API 실패/지연 시 결정적 fallback 요약으로 대체.
  - ⚠️ `OPENAI_API_KEY`는 환경변수로만 사용(레포·문서·코드에 키 값 미기재). 키 입력은 사용자가 직접.
- [ ] **analyze에 AI 요약 연결 + drift_reports 저장**
  - `/api/deployments/:id/analyze`에 `summarizeDrift()` 연결, 결과(severity/score/summary/recommendation/diff)를 `drift_reports`에 저장.
- [ ] **배포 목록 페이지 (app/page.tsx) — severity 신호등**
  - 배포 목록을 severity 신호등(SAFE/WARNING/CRITICAL 색상)으로 표시. shadcn 컴포넌트 사용.
- [ ] **배포 상세 페이지 (app/deployments/[id]/page.tsx) — verdict + 요약 + diff**
  - verdict(severity), AI 요약·롤백 권고, 변경 패턴 diff(before ▶ after) 표시.
- [ ] **로컬 테스트 앱(test-app/)으로 end-to-end 확인**
  - `test-app/`(index/scenarios/generator/client) 작성. 시나리오별 로그 생성 → `/api/deployments` 등록 → `/api/ingest` batch 전송 → `--analyze`로 분석 트리거까지 실제 HTTP 경로 검증. (개발계획서 §9 참고)
