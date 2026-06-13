# 06. API 설계 (API Design)

> Next.js 15 Route Handlers(`app/api/*`) 기반 REST API.
> 데이터 형식: JSON. 인증: 해커톤은 단일 API Key 헤더(`x-api-key`)로 단순화.

---

## 1. API 개요

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/api/deployments` | 배포 등록 |
| `GET`  | `/api/deployments` | 배포 목록 조회 |
| `GET`  | `/api/deployments/:id` | 배포 상세 + 최신 drift |
| `POST` | `/api/ingest` | 로그 수집(batch) |
| `POST` | `/api/deployments/:id/analyze` | drift 분석 트리거 |
| `GET`  | `/api/deployments/:id/drift` | drift 리포트 조회 |

---

## 2. 엔드포인트 상세

### 2.1 `POST /api/deployments` — 배포 등록

**Request**
```json
{
  "service": "payment-api",
  "version": "a1b2c3d",
  "environment": "production",
  "deployedAt": "2026-06-13T09:00:00Z"
}
```

**Response 201**
```json
{
  "id": "d3f1...",
  "service": "payment-api",
  "version": "a1b2c3d",
  "environment": "production",
  "deployedAt": "2026-06-13T09:00:00Z",
  "status": "ingesting"
}
```

```ts
// app/api/deployments/route.ts
export async function POST(req: Request) {
  const body = await req.json();
  // 검증
  if (!body.service || !body.version) {
    return Response.json({ error: "service, version 필수" }, { status: 400 });
  }
  const dep = await createDeployment(body);
  return Response.json(dep, { status: 201 });
}
```

---

### 2.2 `POST /api/ingest` — 로그 수집

배포 ID와 함께 로그 라인 배열을 보낸다. 서버는 정규화·집계 후 **원본은 버리고** 통계만 저장한다.

**Request**
```json
{
  "deploymentId": "d3f1...",
  "logs": [
    { "timestamp": "2026-06-13T09:01:02Z", "level": "error", "message": "User 12345 payment failed in 320ms" },
    { "timestamp": "2026-06-13T09:01:03Z", "level": "info",  "message": "Cache warmed in 45ms" }
  ]
}
```

**Response 200**
```json
{
  "deploymentId": "d3f1...",
  "received": 2,
  "patternsExtracted": 2,
  "newPatterns": 1
}
```

```ts
// app/api/ingest/route.ts
export async function POST(req: Request) {
  const { deploymentId, logs } = await req.json();
  if (!deploymentId || !Array.isArray(logs)) {
    return Response.json({ error: "deploymentId, logs[] 필수" }, { status: 400 });
  }

  // 1) 정규화 + fingerprint + 집계 (메모리 내)
  const aggs = aggregate(logs.map(l => ({
    ...l, template: normalize(l.message),
  })));

  // 2) 패턴 사전 upsert + 배포별 통계 upsert
  const result = await persistPatterns(deploymentId, aggs);
  // ⚠️ logs(원본)는 여기서 GC. DB에 저장하지 않음.

  return Response.json({
    deploymentId,
    received: logs.length,
    patternsExtracted: aggs.length,
    newPatterns: result.newPatternCount,
  });
}
```

> **배치 권장**: 1회 호출당 수천~1만 라인. 호출 횟수를 줄여 서버리스 콜드스타트/비용을 절감.

---

### 2.3 `POST /api/deployments/:id/analyze` — drift 분석

current 배포를 직전 배포(baseline)와 비교해 drift를 계산하고 AI 요약을 생성한다.

**Request** (본문 없음, 또는 baseline 명시)
```json
{ "baselineId": "optional-override" }
```

**Response 200**
```json
{
  "deploymentId": "d3f1...",
  "baselineId": "c2e0...",
  "driftScore": 72,
  "severity": "critical",
  "summary": "결제 모듈에서 신규 NullPointerException 142건 발생, 에러율 4% → 18% 상승...",
  "recommendation": "즉시 롤백을 권고합니다.",
  "details": {
    "newPatterns": [ { "template": "NullPointerException at <PATH>", "count": 142, "level": "error" } ],
    "spikingPatterns": [ { "template": "DB timeout after <NUM>ms", "before": 3, "after": 210, "changeRatio": 70 } ],
    "disappearedPatterns": [ { "template": "Cache warmed in <NUM>ms", "previousCount": 88 } ],
    "metrics": { "errorRateBefore": 0.04, "errorRateAfter": 0.18, "newPatternCount": 3 }
  }
}
```

```ts
// app/api/deployments/[id]/analyze/route.ts
export async function POST(req: Request, { params }) {
  const { id } = await params;
  const baseline = await findBaseline(id);           // 직전 배포 자동 선택
  if (!baseline) {
    return Response.json({ error: "비교할 baseline 배포가 없습니다." }, { status: 422 });
  }

  const pairs = await loadPatternPairs(id, baseline.id);   // SQL 비교 쿼리
  const drift = computeDrift(pairs);                       // 결정적 계산
  const ai    = await summarizeDrift(drift).catch(() => null); // 실패 허용

  const report = await saveDriftReport(id, baseline.id, drift, ai);
  await markStatus(id, "analyzed");
  return Response.json(report);
}
```

---

### 2.4 `GET /api/deployments/:id` — 배포 상세

**Response 200**
```json
{
  "id": "d3f1...",
  "service": "payment-api",
  "version": "a1b2c3d",
  "environment": "production",
  "deployedAt": "2026-06-13T09:00:00Z",
  "status": "analyzed",
  "patternCount": 126,
  "latestDrift": {
    "driftScore": 72,
    "severity": "critical",
    "summary": "...",
    "recommendation": "즉시 롤백을 권고합니다.",
    "createdAt": "2026-06-13T09:03:11Z"
  }
}
```

---

### 2.5 `GET /api/deployments` — 배포 목록

**Query**: `?service=payment-api&environment=production&limit=20`

**Response 200**
```json
{
  "deployments": [
    { "id": "d3f1...", "service": "payment-api", "version": "a1b2c3d",
      "deployedAt": "2026-06-13T09:00:00Z", "severity": "critical", "driftScore": 72 },
    { "id": "c2e0...", "service": "payment-api", "version": "9f8e7d6",
      "deployedAt": "2026-06-12T15:00:00Z", "severity": "safe", "driftScore": 6 }
  ]
}
```

---

## 3. 공통 규약

### 3.1 인증 (해커톤 단순화)
```
x-api-key: <LOGLENS_API_KEY>
```
- 단일 키를 환경변수로 관리. 키 불일치 시 `401`.
- 대시보드(RSC) 내부 호출은 DB 직접 접근하므로 인증 불필요.

### 3.2 에러 응답 형식
```json
{ "error": "사람이 읽을 메시지", "code": "VALIDATION_ERROR" }
```

| 상태 | 의미 |
|------|------|
| 400 | 잘못된 요청(필수 필드 누락) |
| 401 | API Key 불일치 |
| 404 | 배포 없음 |
| 422 | 처리 불가(예: baseline 없음) |
| 500 | 서버 오류 |

### 3.3 검증
- 가벼운 런타임 검증은 **zod** 권장.
```ts
const IngestSchema = z.object({
  deploymentId: z.string().uuid(),
  logs: z.array(z.object({
    timestamp: z.string().datetime().optional(),
    level: z.enum(["info","warn","error"]).default("info"),
    message: z.string().min(1),
  })).max(20000),
});
```

---

## 4. 전형적인 호출 흐름 (End-to-End)

```bash
# 1. 배포 등록
curl -X POST /api/deployments -H "x-api-key: $KEY" \
  -d '{"service":"payment-api","version":"a1b2c3d"}'
# → { "id": "d3f1...", "status": "ingesting" }

# 2. 로그 수집 (배포 직후 N분간 수집한 로그를 batch로)
curl -X POST /api/ingest -H "x-api-key: $KEY" \
  -d '{"deploymentId":"d3f1...","logs":[...]}'

# 3. drift 분석
curl -X POST /api/deployments/d3f1.../analyze -H "x-api-key: $KEY"
# → { "severity": "critical", "recommendation": "즉시 롤백 권고" }
```

➡️ 다음 문서: [07. UI/UX 설계](./07-ui-ux.md)