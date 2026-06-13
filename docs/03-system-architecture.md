# 03. 시스템 아키텍처 (System Architecture)

> 핵심 원칙: **원본 로그를 모두 저장하지 않는다.**
> 배포 메타데이터, 추출된 패턴, 집계 통계, drift 분석 결과만 저장한다.

---

## 1. 기술 스택

| 레이어 | 기술 | 역할 |
|--------|------|------|
| 프론트엔드 | **Next.js 15** (App Router, React Server Components) | 대시보드 UI |
| 백엔드 | **Next.js Route Handlers** (`app/api/*`) | ingest / 분석 API |
| 호스팅 | **Vercel** | 배포 + 서버리스 함수 |
| 데이터베이스 | **AWS Aurora PostgreSQL** | 메타데이터·패턴·통계·drift 저장 |
| AI | **OpenAI API** | 패턴 그룹핑 보조 + drift 자연어 요약 |
| 언어 | **TypeScript** | 전 영역 공통 |

> 별도 백엔드 서버 없이 **Next.js 단일 앱**으로 풀스택을 구성한다. 해커톤 속도 우선.

---

## 2. 아키텍처 다이어그램

```
┌─────────────────────────────────────────────────────────────┐
│                  Log Sources (CI / App / Agent)              │
│        배포 시 로그를 batch로 push (해커톤: 시뮬레이터)        │
└───────────────────────────┬─────────────────────────────────┘
                            │ POST /api/ingest  (deploymentId + logs[])
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Next.js 15 on Vercel                      │
│                                                              │
│  ┌────────────────┐   ┌──────────────────┐  ┌────────────┐  │
│  │  Route Handlers │   │  Pattern Engine   │  │ Drift Engine│ │
│  │  /api/*         │──▶│  정규화·패턴추출   │─▶│ baseline 비교│ │
│  │  (ingest/분석)   │   │  통계 집계        │  │ 점수 산정    │ │
│  └────────────────┘   └──────────────────┘  └─────┬──────┘  │
│           │                                        │         │
│           │                                        ▼         │
│           │                              ┌──────────────────┐│
│           │                              │  OpenAI Client    ││
│           │                              │  drift 자연어 요약 ││
│           │                              └──────────────────┘│
│           ▼                                                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │           React Server Components (Dashboard)           │ │
│  └────────────────────────────────────────────────────────┘ │
└───────────────────────────┬─────────────────────────────────┘
                            │  SQL (no raw logs)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  AWS Aurora PostgreSQL                       │
│   deployments · log_patterns · pattern_stats · drift_reports │
│   (원본 로그 ✗  /  메타데이터·패턴·통계·분석결과 ✓)            │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. 데이터 흐름 (Data Flow)

### 3.1 Ingest 파이프라인 (원본 로그 → 패턴/통계)

```
raw log lines (메모리에만 존재)
   │
   ├─ 1. 파싱: level, timestamp, message 추출
   │
   ├─ 2. 정규화(Templating):
   │      "User 12345 failed in 320ms"
   │      → "User <NUM> failed in <NUM>ms"
   │
   ├─ 3. 패턴 해싱: normalize → fingerprint(hash)
   │
   ├─ 4. 집계: fingerprint별 count, error 여부, level 분포
   │
   └─ 5. 저장: log_patterns(upsert) + pattern_stats(deployment별)
          ⚠️ 원본 라인은 저장하지 않음 (샘플 1개만 옵션 보관)
```

**핵심**: 원본 로그는 함수 메모리 안에서만 처리되고, DB에는 **집계 결과만** 남는다. 이것이 비용과 프라이버시, 그리고 "drift 중심" 설계를 동시에 만족시킨다.

### 3.2 Drift 분석 파이프라인

```
현재 배포(current) 통계  +  직전 배포(baseline) 통계
   │
   ├─ 1. 패턴 집합 비교: NEW / DISAPPEARED / SHARED
   │
   ├─ 2. 공유 패턴의 빈도 변화율 계산 (spike/drop)
   │
   ├─ 3. 지표 변화: error_rate, 패턴 다양성 등
   │
   ├─ 4. drift_score 산정 (규칙 기반 가중합)
   │
   ├─ 5. OpenAI 요약: 위 결과를 프롬프트로 → 자연어 리포트 + 권고
   │
   └─ 6. 저장: drift_reports
```

---

## 4. 컴포넌트 책임

| 컴포넌트 | 책임 |
|----------|------|
| **Route Handlers** | HTTP 진입점. 검증, 트랜잭션, 응답. |
| **Pattern Engine** | 로그 정규화, fingerprint 생성, 집계. 순수 함수 위주(테스트 쉬움). |
| **Drift Engine** | 두 통계 스냅샷 비교, drift 항목/점수 산출. OpenAI 비의존. |
| **OpenAI Client** | drift 결과를 받아 요약/권고 텍스트 생성. 실패 시 규칙 기반 fallback. |
| **Dashboard (RSC)** | DB에서 직접 읽어 서버 렌더링. 배포 목록·상세·drift 뷰. |

> **설계 의도**: Drift 계산(결정적 로직)과 AI 요약(비결정적)을 분리한다. AI가 죽어도 drift 점수와 변경 목록은 항상 나온다.

---

## 5. 디렉토리 구조 (제안)

```
loglens/
├── app/
│   ├── page.tsx                      # 배포 목록 대시보드
│   ├── deployments/[id]/page.tsx     # 배포 상세 + drift 뷰
│   └── api/
│       ├── deployments/route.ts      # POST 배포 등록 / GET 목록
│       ├── ingest/route.ts           # POST 로그 수집
│       └── deployments/[id]/
│           └── analyze/route.ts      # POST drift 분석 트리거
├── lib/
│   ├── db.ts                         # Aurora PG 연결 (pg / drizzle)
│   ├── pattern-engine.ts             # 정규화 · fingerprint · 집계
│   ├── drift-engine.ts               # baseline 비교 · 점수 산정
│   ├── openai.ts                     # drift 요약 클라이언트
│   └── schema.ts                     # 타입 / 스키마
├── scripts/
│   └── seed.ts                       # 데모용 시드 데이터 생성기
└── docs/
```

---

## 6. 배포 / 인프라 노트

- **Vercel**: Next.js 앱을 그대로 배포. Route Handler가 서버리스 함수로 동작.
- **Aurora PostgreSQL**: 서버리스 v2 또는 작은 인스턴스. Vercel에서 커넥션 풀러(예: RDS Proxy 또는 `pg` 풀 + 짧은 커넥션) 사용 권장.
- **환경 변수**: `DATABASE_URL`, `OPENAI_API_KEY` 등은 Vercel 프로젝트 설정에 등록(코드/레포에 저장 금지).
- **콜드 스타트 대응**: ingest는 batch로만 받아 호출 횟수 최소화.

---

## 7. 확장 시 고려사항 (해커톤 이후)

- 실시간 스트리밍 ingest (현재는 batch)
- 패턴 임베딩 + 벡터 유사도로 더 정교한 그룹핑
- 멀티 서비스/멀티 환경 비교, 알림 라우팅, 자동 롤백 트리거

➡️ 다음 문서: [04. 데이터베이스 설계](./04-database-design.md)