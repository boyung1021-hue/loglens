# 09. 개발 계획 (Development Plan)

> 기간: **2~3일 해커톤**. 목표: 동작하는 MVP + 안정적인 데모.
> 전략: 데모 경로(배포→ingest→분석→리포트)를 가장 먼저 관통시키고(end-to-end), 그 다음 완성도를 올린다.

---

## 1. 우선순위 원칙

1. **데모 경로 우선(Walking Skeleton)**: 못생겨도 좋으니 전체 흐름이 먼저 돌게 한다.
2. **결정적 로직 먼저, AI는 나중**: drift 계산이 먼저. AI 요약은 그 위에 얹는다.
3. **시드로 데이터 리스크 제거**: 실시간 데이터 의존을 없앤다.
4. **P0만 사수**: 보너스 기능(Slack 등)은 시간 남을 때만.
5. **로컬 우선(Local-first) 개발**: 개발·테스트는 전부 로컬에서 한다. DB는 로컬 PostgreSQL(Docker), 로그를 보내는 테스트 애플리케이션도 로컬에서 돌린다. Aurora / Vercel 등 클라우드 배포는 데모 직전에만 맞춘다. 같은 `DATABASE_URL` 인터페이스만 쓰면 로컬 PG ↔ Aurora 교체는 환경변수 한 줄로 끝난다.

---

## 2. 일정 (Day-by-Day)

### 📅 Day 1 — 기반 + Walking Skeleton

**오전 (셋업 — 전부 로컬)**
- [x] Next.js 15 앱 생성, Tailwind + shadcn/ui 설치
- [x] **로컬 PostgreSQL을 Docker로 기동** (`docker compose up -d db`) — 클라우드 DB는 데모 직전에만
- [x] `schema.sql` 작성 + 로컬 DB에 적용 (deployments, log_patterns, pattern_stats, drift_reports)
- [x] `lib/db.ts` 연결 확인 (로컬 `DATABASE_URL`로 간단 SELECT)
- [x] 환경변수 설정: 로컬은 `.env.local`에 `DATABASE_URL`(로컬 PG)·`OPENAI_API_KEY` 작성 (레포에 커밋 금지, `.gitignore` 확인)

**오후 (Ingest 파이프라인)**
- [x] `lib/pattern-engine.ts`: `normalize()` + `fingerprint()` + `aggregate()`
- [x] `POST /api/deployments` (등록)
- [x] `POST /api/ingest` (정규화→집계→upsert, 원본 미저장)
- [x] 정규화 단위 테스트 몇 개 (가장 버그 나기 쉬운 곳)

**Day 1 종료 기준**: 로컬에서 curl로 배포 등록 → 로그 ingest → 로컬 DB에 패턴/통계가 쌓인다.

---

### 📅 Day 2 — Drift 엔진 + AI + 화면

**오전 (Drift 엔진)**
- [ ] `lib/drift-engine.ts`: `computeDrift()` (NEW/DISAPPEARED/SPIKE/DROP)
- [ ] drift 점수/severity 산정
- [ ] baseline 자동 선택 쿼리 + 패턴 비교 쿼리
- [ ] `POST /api/deployments/:id/analyze` (AI 제외, 결정적 결과까지)

**오후 (AI + UI + 로컬 테스트 앱)**
- [ ] `lib/openai.ts`: `summarizeDrift()` + fallback
- [ ] analyze에 AI 요약 연결, `drift_reports` 저장
- [ ] 배포 목록 페이지(`app/page.tsx`) — severity 신호등
- [ ] 배포 상세 페이지(`app/deployments/[id]/page.tsx`) — verdict + 요약 + diff
- [ ] **로컬 테스트 애플리케이션(`test-app/`)** 으로 실제 로그를 `/api/ingest`에 흘려보내 end-to-end 확인 (§9 참고)

**Day 2 종료 기준**: 로컬 테스트 앱이 보낸 로그로 분석이 돌고, 브라우저에서 문제 배포를 열면 CRITICAL + AI 요약 + 변경 패턴이 보인다.

---

### 📅 Day 3 — 시드 + 완성도 + 리허설

**오전 (데모 안정화)**
- [ ] `scripts/seed.ts`: 정상 배포 2~3개 + 문제 배포 1개 데이터
- [ ] 임계값/가중치 튜닝 → 문제 배포가 확실히 CRITICAL
- [ ] AI fallback / 오프라인 스텁 플래그
- [ ] 에러 처리(없는 배포, baseline 없음 등) 다듬기

**오후 (마감)**
- [ ] UI 폴리시: 색상, 화살표(before ▶ after), 빈 상태
- [ ] 배포 등록 모달(데모 트리거)
- [ ] (P2) Slack webhook 알림 — 시간 남으면
- [ ] README + 데모 리허설 2회
- [ ] 발표용 화면 글씨 크기/줌 점검

**Day 3 종료 기준**: 90초 데모를 끊김 없이 2회 성공.

---

## 3. 작업 분담 (2~3인 기준)

| 역할 | 담당 영역 |
|------|-----------|
| **Backend / Engine** | DB 스키마, ingest, pattern-engine, drift-engine, API |
| **Frontend** | 대시보드, 상세/diff 뷰, shadcn 컴포넌트, 모달 |
| **AI / Demo (겸임 가능)** | OpenAI 프롬프트·fallback, 시드 데이터, 데모 시나리오/발표 |

> 인터페이스(타입)를 Day 1 오전에 합의하면 병렬 작업이 매끄럽다. `DriftResult`, `PatternAgg` 타입을 먼저 못 박는다.

---

## 4. 기술 결정 (빠른 선택)

| 항목 | 선택 | 이유 |
|------|------|------|
| 개발 DB | **로컬 PostgreSQL (Docker)** | 빠른 반복·오프라인 개발. Aurora와 동일한 PG라 호환 |
| 배포 DB | AWS Aurora PostgreSQL | 데모/제출용. `DATABASE_URL`만 교체 |
| 로그 소스 | **로컬 테스트 앱(`test-app/`)** | 실제 ingest 흐름 검증. 외부 연동 없이 로컬에서 로그 생성 |
| DB 접근 | `pg` + 직접 SQL (또는 Drizzle) | 마이그레이션 오버헤드 회피 |
| 검증 | zod | 가볍고 타입 추론 |
| AI 모델 | `gpt-4o-mini` | 저렴·충분·빠름. 요약 작업엔 과한 모델 불필요 |
| 스타일 | Tailwind + shadcn/ui | 빠른 완성도 |
| 패키지 매니저 | pnpm | 빠름 |
| 차트 | 지양(숫자+화살표) | 시간 절약 |

---

## 5. 리스크 & 대응

| 리스크 | 영향 | 대응 |
|--------|------|------|
| 로컬↔Aurora 환경 차이 | 중 | 둘 다 PostgreSQL로 통일; `DATABASE_URL`만 교체; 데모 전날 Aurora에서 1회 리허설 |
| Aurora 커넥션/콜드스타트 이슈 | 중 | RDS Proxy 또는 짧은 풀; batch ingest로 호출 최소화 |
| OpenAI 응답 지연/실패 | 중 | fallback 요약 + 오프라인 스텁 플래그 |
| 정규화 품질 낮아 drift 부정확 | 높음 | 시드 데이터에 맞춰 규칙·임계값 튜닝; 단위 테스트 |
| 데모 중 데이터 꼬임 | 높음 | DB 리셋 + 시드 재실행 스크립트 1줄로 |
| 범위 욕심(기능 추가) | 높음 | P0 외 금지. 보너스는 Day 3 오후에만 |

---

## 6. "하지 않을 것" 목록 (Scope Guard)

해커톤에서 **명시적으로 안 만든다**:
- ❌ 원본 로그 저장 / 풀텍스트 검색
- ❌ 실시간 스트리밍 ingest
- ❌ 사용자/조직/권한(RBAC), 로그인
- ❌ 멀티 테넌시
- ❌ 자동 롤백 실행 (권고만)
- ❌ 임베딩 기반 클러스터링(다음 단계)

---

## 7. 완성 정의 (Definition of Done)

MVP가 "완성"이라고 부르는 기준:

1. ✅ 배포 등록 → ingest → analyze → 리포트가 API/UI로 모두 동작
2. ✅ 문제 배포가 CRITICAL로, 정상 배포가 SAFE로 분류됨
3. ✅ AI 요약 + 롤백 권고가 화면에 표시 (fallback 포함)
4. ✅ 원본 로그가 DB에 저장되지 않음을 코드로 보장
5. ✅ 시드 1회로 데모 환경 재현 가능
6. ✅ 90초 데모 리허설 성공

---

## 8. 빠른 시작 명령 (참고, 로컬 기준)

```bash
pnpm create next-app loglens --ts --app --tailwind
cd loglens
pnpm add pg zod openai
pnpm dlx shadcn@latest init

# 1) 로컬 PostgreSQL 기동 (Docker)
docker compose up -d db

# 2) 로컬 DB에 스키마 적용 (.env.local의 DATABASE_URL 사용)
psql "$DATABASE_URL" -f schema.sql

# 3) 개발 서버
pnpm dev

# 4) 데모 시드 (로컬 DB로)
pnpm tsx scripts/seed.ts

# 5) 로컬 테스트 앱으로 실제 로그 흘려보내기
pnpm tsx test-app/index.ts --scenario problem
```

> ⚠️ `DATABASE_URL`, `OPENAI_API_KEY` 등 비밀값은 코드/레포에 넣지 말고 로컬은 `.env.local`(gitignore), 배포는 Vercel 환경변수 등 안전한 비밀 저장소에만 둔다.

---

## 9. 로컬 개발 환경 (Local Setup)

개발·테스트는 전부 로컬에서 한다. 클라우드(Aurora/Vercel)는 데모 직전에만 맞춘다.

### 9.1 로컬 DB — PostgreSQL on Docker

Aurora도 PostgreSQL이므로 로컬에선 동일 엔진의 컨테이너를 쓴다. 코드는 `DATABASE_URL`만 바라보면 되고, 로컬↔Aurora 전환은 환경변수 한 줄.

```yaml
# docker-compose.yml
services:
  db:
    image: postgres:16
    ports: ["5432:5432"]
    environment:
      POSTGRES_USER: loglens
      POSTGRES_PASSWORD: loglens   # 로컬 전용 더미 값
      POSTGRES_DB: loglens
    volumes:
      - loglens_pg:/var/lib/postgresql/data
volumes:
  loglens_pg:
```

```bash
# .env.local (로컬 전용, 커밋 금지)
DATABASE_URL=postgresql://loglens:loglens@localhost:5432/loglens
OPENAI_API_KEY=...        # 로컬 비밀 저장소/개인 키. 레포·문서에 절대 적지 않는다
```

> 배포 시에는 같은 `DATABASE_URL` 키에 Aurora 접속 문자열을 넣는 것 외에 코드 변경이 없다.

### 9.2 로컬 테스트 애플리케이션 (`test-app/`) — 로그 송신 스크립트 (A안)

LogLens에 로그를 보내줄 "배포된 서비스" 역할을 하는 로컬 CLI 스크립트. 미니 서버를 띄우지 않고, 시나리오별 로그 라인을 **생성 → batch로 `/api/ingest`에 전송**한다. 외부 연동 없이 로컬에서만 돈다.

**역할**
- 시나리오별(정상 / 문제) 로그 라인을 정의된 패턴 분포대로 생성한다.
- LogLens에 배포를 등록(`POST /api/deployments`)하고, 그 배포 ID로 로그를 batch ingest 한다.
- 선택적으로 `--analyze` 시 분석까지 트리거해 end-to-end를 한 번에 검증한다.
- 숫자/ID/타임스탬프를 매 라인 랜덤화해 **정규화 로직까지 자연스럽게 검증**한다.

#### 파일 구조

```
test-app/
├── index.ts        # CLI 진입점 (인자 파싱 → 등록 → ingest → (옵션) analyze)
├── scenarios.ts    # NORMAL / PROBLEM 로그 분포 정의 (08-demo-scenario와 동일)
├── generator.ts    # 분포 → 라인 배열 생성 (숫자/ID 랜덤화)
└── client.ts       # LogLens API 호출 래퍼 (fetch + x-api-key)
```

#### `scenarios.ts` — 로그 분포 정의

> [08. 데모 시나리오](./08-demo-scenario.md)의 `NORMAL` / `PROBLEM`과 **동일한 분포**. 시드와 테스트 앱이 같은 데이터를 공유하도록 한 곳에 둔다(가능하면 시드 스크립트와 import 공유).

```ts
// test-app/scenarios.ts
export type LogLevel = "info" | "warn" | "error";
export interface LogSpec { level: LogLevel; template: string; weight: number; }

// {n} = 랜덤 숫자, {id} = 랜덤 ID, {ms} = 랜덤 소요시간 → generator가 치환
export const SCENARIOS: Record<string, { version: string; specs: LogSpec[] }> = {
  normal: {
    version: "9f8e7d6",
    specs: [
      { level: "info",  template: "Request handled in {ms}ms",          weight: 9000 },
      { level: "info",  template: "Cache warmed in {ms}ms",             weight: 88 },
      { level: "info",  template: "Payment processed for order {id}",   weight: 2400 },
      { level: "warn",  template: "Slow query {ms}ms",                  weight: 40 },
      { level: "error", template: "Timeout calling upstream",           weight: 20 },
    ],
  },
  problem: {
    version: "a1b2c3d",
    specs: [
      { level: "info",  template: "Request handled in {ms}ms",                weight: 8800 },
      { level: "info",  template: "Payment processed for order {id}",         weight: 1100 },
      { level: "warn",  template: "Slow query {ms}ms",                        weight: 60 },
      { level: "warn",  template: "retrying request {n}/3",                   weight: 54 },
      { level: "error", template: "Timeout calling upstream",                 weight: 18 },
      { level: "error", template: "NullPointerException at /pay/charge.ts:{n}", weight: 142 },
      { level: "error", template: "payment gateway returned {n}",             weight: 88 },
      { level: "error", template: "DB timeout after {ms}ms",                  weight: 210 },
    ],
  },
};
```

#### `generator.ts` — 분포 → 라인 생성

```ts
// test-app/generator.ts
import { SCENARIOS, type LogSpec } from "./scenarios";

const rand = (n: number) => Math.floor(Math.random() * n);

function fill(template: string): string {
  return template
    .replace(/\{ms\}/g, () => String(10 + rand(5000)))
    .replace(/\{id\}/g, () => String(1000 + rand(9000)))
    .replace(/\{n\}/g,  () => String(1 + rand(500)));
}

export function generateLogs(scenario: string) {
  const def = SCENARIOS[scenario];
  if (!def) throw new Error(`unknown scenario: ${scenario}`);

  const lines = def.specs.flatMap((s: LogSpec) =>
    Array.from({ length: s.weight }, () => ({
      timestamp: new Date().toISOString(),
      level: s.level,
      message: fill(s.template),   // 매 라인 숫자/ID 랜덤 → 정규화 검증
    }))
  );

  // 시간순 섞기(선택)
  for (let i = lines.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [lines[i], lines[j]] = [lines[j], lines[i]];
  }
  return { version: def.version, lines };
}
```

#### `client.ts` — API 호출 래퍼

```ts
// test-app/client.ts
const BASE = process.env.LOGLENS_URL ?? "http://localhost:3000";
const API_KEY = process.env.LOGLENS_API_KEY ?? "";  // 로컬 더미 키, 환경변수로만

async function post(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

export const registerDeployment = (service: string, version: string) =>
  post("/api/deployments", { service, version, environment: "production" });

export const ingestLogs = (deploymentId: string, logs: unknown[]) =>
  post("/api/ingest", { deploymentId, logs });

export const analyze = (deploymentId: string) =>
  post(`/api/deployments/${deploymentId}/analyze`, {});
```

#### `index.ts` — CLI 진입점

```ts
// test-app/index.ts
import { generateLogs } from "./generator";
import { registerDeployment, ingestLogs, analyze } from "./client";

function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const scenario = arg("scenario", "normal")!;       // normal | problem
  const service = arg("service", "payment-api")!;
  const batchSize = Number(arg("batch", "5000"));
  const doAnalyze = process.argv.includes("--analyze");

  const { version, lines } = generateLogs(scenario);

  // 1) 배포 등록
  const dep = await registerDeployment(service, version);
  console.log(`▶ 배포 등록: ${service}@${version} (${dep.id})`);

  // 2) batch ingest (큰 배열은 나눠서 전송 → 서버리스/페이로드 한계 회피)
  for (let i = 0; i < lines.length; i += batchSize) {
    const chunk = lines.slice(i, i + batchSize);
    const r = await ingestLogs(dep.id, chunk);
    console.log(`  ↳ ingest ${i + chunk.length}/${lines.length} (patterns: ${r.patternsExtracted})`);
  }

  // 3) (옵션) 분석 트리거
  if (doAnalyze) {
    const report = await analyze(dep.id);
    console.log(`✔ 분석 완료: ${report.severity} (drift ${report.driftScore})`);
    console.log(`  ${report.recommendation ?? report.summary ?? ""}`);
  }

  console.log(`✅ done: ${scenario} 시나리오 ${lines.length} lines → ${dep.id}`);
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
```

#### `package.json` 스크립트 (편의)

```jsonc
{
  "scripts": {
    "testapp:normal":  "tsx test-app/index.ts --scenario normal",
    "testapp:problem": "tsx test-app/index.ts --scenario problem --analyze"
  }
}
```

#### 실행 방법

```bash
# LogLens 개발 서버를 먼저 띄운다 (별도 터미널)
pnpm dev                                            # http://localhost:3000

# 정상 배포 로그 전송 (등록 + ingest)
pnpm tsx test-app/index.ts --scenario normal
# 또는: pnpm testapp:normal

# 문제 배포 로그 전송 + 분석까지 한 번에
pnpm tsx test-app/index.ts --scenario problem --analyze
# 또는: pnpm testapp:problem

# 옵션
#   --service <name>   대상 서비스명 (기본 payment-api)
#   --batch <n>        ingest 배치 크기 (기본 5000)
#   --analyze          ingest 후 drift 분석 트리거
```

> **시드와의 관계**: 시드(`scripts/seed.ts`)는 DB에 데이터를 직접 채워 데모 환경을 빠르게 만든다. 테스트 앱은 **실제 HTTP API 경로(`/api/deployments` → `/api/ingest` → `/api/analyze`)를 그대로 타므로**, "API가 진짜 도는지"까지 검증한다. 둘은 `scenarios.ts`의 같은 분포를 공유한다.

### 9.3 로컬 → 배포 전환 체크리스트
- [ ] Aurora 인스턴스 생성 + 보안그룹/접속 확인
- [ ] Aurora에 `schema.sql` 적용
- [ ] Vercel 환경변수에 Aurora `DATABASE_URL` + `OPENAI_API_KEY` 등록
- [ ] 시드/테스트 앱의 `LOGLENS_URL`을 배포 URL로 바꿔 1회 리허설

---

📚 **문서 인덱스**
1. [제품 비전](./01-product-vision.md)
2. [PRD](./02-prd.md)
3. [시스템 아키텍처](./03-system-architecture.md)
4. [데이터베이스 설계](./04-database-design.md)
5. [Drift 감지 로직](./05-drift-detection.md)
6. [API 설계](./06-api-design.md)
7. [UI/UX 설계](./07-ui-ux.md)
8. [데모 시나리오](./08-demo-scenario.md)
9. **개발 계획** (현재 문서)