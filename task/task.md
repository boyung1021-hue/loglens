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
- [ ] **환경변수 설정 + .gitignore 확인**
  - `.env.local`에 `DATABASE_URL`(로컬 PG)·`OPENAI_API_KEY` 설정. 레포 커밋 금지 — `.gitignore`에 `.env.local` 포함 확인. (실제 키 값은 직접 입력)

### 🌆 오후 (Ingest 파이프라인)

- [ ] **lib/pattern-engine.ts: normalize/fingerprint/aggregate 구현**
  - 로그 정규화, fingerprint 해싱, fingerprint별 집계. 순수 함수 위주로 작성해 테스트 용이하게.
- [ ] **POST /api/deployments (배포 등록)**
  - service/version 필수 검증, `deployments` 레코드 생성 후 201 반환.
- [ ] **POST /api/ingest (정규화→집계→upsert, 원본 미저장)**
  - 로그 batch 수신 → 정규화→fingerprint→집계 → `log_patterns`/`pattern_stats` upsert. 원본 로그는 메모리에서 버린다.
- [ ] **정규화 단위 테스트 작성**
  - `normalize()`의 핵심 케이스(타임스탬프/UUID/IP/경로/숫자 토큰화) 테스트. drift 정확도의 핵심이자 가장 버그 나기 쉬운 곳.
