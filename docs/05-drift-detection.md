# 05. Drift 감지 로직 (Drift Detection)

> LogLens의 심장. "배포 후 무엇이 달라졌는가"를 **결정적 규칙(deterministic)** 으로 계산하고, 그 결과를 **AI로 요약**한다.
> 설계 의도: AI 없이도 drift 점수와 변경 목록은 항상 산출된다. AI는 "해석/요약" 레이어다.

---

## 1. Drift의 4가지 종류

배포 전(baseline) vs 배포 후(current) 패턴 통계를 비교하여 4가지 drift를 찾는다.

| 종류 | 정의 | 위험 신호 |
|------|------|-----------|
| **NEW (신규 패턴)** | baseline엔 없고 current에만 등장 | 새 에러 패턴이면 매우 위험 |
| **DISAPPEARED (소멸 패턴)** | baseline엔 있었는데 current엔 없음 | 정상 동작 로그가 사라짐 = 기능 중단 의심 |
| **SPIKE (급증)** | 공유 패턴인데 빈도가 급상승 | 에러 패턴 급증 = 강한 위험 신호 |
| **DROP (급감)** | 공유 패턴인데 빈도가 급감 | 처리량 감소 / 경로 차단 의심 |

추가로 **집계 지표 변화**도 본다: 에러율(error_rate), 패턴 다양성, 총 로그량.

---

## 2. 1단계 — 로그 정규화 (Templating)

drift 정확도는 정규화 품질에 달려 있다. 가변값을 토큰으로 치환해 "같은 의미의 로그"를 하나의 패턴으로 묶는다.

```ts
// lib/pattern-engine.ts
const RULES: [RegExp, string][] = [
  [/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}\S*/g, "<TS>"],     // 타임스탬프
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<UUID>"],
  [/\b\d+\.\d+\.\d+\.\d+\b/g, "<IP>"],                          // IP
  [/\/[\w\-./]+/g, "<PATH>"],                                   // 경로
  [/\b\d+ms\b/g, "<NUM>ms"],                                    // 소요시간
  [/\b\d+\b/g, "<NUM>"],                                        // 일반 숫자/ID
  [/0x[0-9a-f]+/gi, "<HEX>"],
  [/"[^"]*"/g, '"<STR>"'],                                      // 따옴표 문자열
];

export function normalize(message: string): string {
  let t = message.trim();
  for (const [re, token] of RULES) t = t.replace(re, token);
  return t.replace(/\s+/g, " ").slice(0, 500);
}
```

**예시**

```
입력:  User 12345 login failed from 10.0.3.2 in 320ms
출력:  User <NUM> login failed from <IP> in <NUM>ms
```

### Fingerprint

```ts
import { createHash } from "crypto";
export const fingerprint = (template: string, level: string) =>
  createHash("sha1").update(`${level}|${template}`).digest("hex").slice(0, 16);
```

---

## 3. 2단계 — 집계 (Aggregation)

ingest된 배치를 fingerprint별로 묶어 배포별 통계를 만든다.

```ts
interface PatternAgg {
  fingerprint: string;
  template: string;
  level: "info" | "warn" | "error";
  count: number;
  errorCount: number;   // level === "error" 인 라인 수
  sample?: string;      // 옵션: 대표 1줄
}
```

→ `pattern_stats` 테이블에 upsert (DB 문서 4.3 참고). **원본 라인은 여기서 버린다.**

---

## 4. 3단계 — Drift 계산 (결정적 로직)

baseline/current 통계를 받아 drift 항목과 점수를 산출한다.

```ts
// lib/drift-engine.ts
interface PatternPair {
  template: string;
  level: string;
  baselineCount: number;
  currentCount: number;
  currentErrors: number;
}

interface DriftResult {
  newPatterns: DriftItem[];
  disappearedPatterns: DriftItem[];
  spikingPatterns: DriftItem[];
  droppingPatterns: DriftItem[];
  metrics: DriftMetrics;
  driftScore: number;       // 0~100
  severity: "safe" | "warning" | "critical";
}

const SPIKE_RATIO = 3;     // 3배 이상 증가하면 spike
const DROP_RATIO = 0.33;   // 1/3 이하로 감소하면 drop
const MIN_COUNT = 5;       // 노이즈 컷: 이보다 적으면 무시

export function computeDrift(pairs: PatternPair[]): DriftResult {
  const newPatterns: DriftItem[] = [];
  const disappeared: DriftItem[] = [];
  const spiking: DriftItem[] = [];
  const dropping: DriftItem[] = [];

  for (const p of pairs) {
    const { baselineCount: b, currentCount: c } = p;

    if (b === 0 && c >= MIN_COUNT) {
      newPatterns.push(toItem(p, c));
    } else if (c === 0 && b >= MIN_COUNT) {
      disappeared.push(toItem(p, b));
    } else if (b > 0 && c / b >= SPIKE_RATIO && c >= MIN_COUNT) {
      spiking.push(toItem(p, c, b));
    } else if (b > 0 && c / b <= DROP_RATIO && b >= MIN_COUNT) {
      dropping.push(toItem(p, c, b));
    }
  }

  const metrics = computeMetrics(pairs);
  const driftScore = score({ newPatterns, spiking, disappeared, metrics });
  return {
    newPatterns, disappearedPatterns: disappeared,
    spikingPatterns: spiking, droppingPatterns: dropping,
    metrics, driftScore, severity: toSeverity(driftScore),
  };
}
```

---

## 5. 4단계 — Drift 점수 산정 (Scoring)

가중합으로 0~100 점수를 만든다. **에러 관련 변화에 큰 가중치**를 둔다.

```ts
function score({ newPatterns, spiking, disappeared, metrics }): number {
  let s = 0;

  // 1) 신규 에러 패턴: 가장 강한 신호
  const newErrors = newPatterns.filter(p => p.level === "error");
  s += newErrors.length * 25;
  s += (newPatterns.length - newErrors.length) * 5;   // 신규 비에러 패턴

  // 2) 급증한 에러 패턴
  s += spiking.filter(p => p.level === "error").length * 20;

  // 3) 소멸한 정상 패턴(기능 중단 의심)
  s += disappeared.filter(p => p.level !== "error").length * 8;

  // 4) 에러율 상승폭
  const deltaErr = metrics.errorRateAfter - metrics.errorRateBefore;
  if (deltaErr > 0) s += deltaErr * 100;   // 0.14 상승 → +14

  return Math.min(100, Math.round(s));
}

const toSeverity = (score: number) =>
  score >= 60 ? "critical" : score >= 25 ? "warning" : "safe";
```

| 점수 | severity | 의미 |
|------|----------|------|
| 0–24 | `safe` | 유의미한 drift 없음. 정상 배포로 판단. |
| 25–59 | `warning` | 변화 감지. 확인 권장. |
| 60–100 | `critical` | 강한 drift. **롤백 검토 권고.** |

> 임계값(SPIKE_RATIO, 가중치 등)은 데모 데이터에 맞게 튜닝. 해커톤에서는 "문제 배포가 확실히 critical로 뜨도록" 맞추는 게 핵심.

---

## 6. 5단계 — AI 요약 (OpenAI)

결정적으로 계산된 drift 결과를 **사람이 읽을 자연어**로 변환한다.

```ts
// lib/openai.ts
const SYSTEM_PROMPT = `
너는 배포 안정성 분석가다. 배포 전후 로그 패턴의 변화(drift) 데이터를 받아,
엔지니어가 롤백 여부를 즉시 판단할 수 있도록 한국어로 요약한다.
규칙:
- 2~3문장 요약 + 핵심 변화 불릿 + 한 줄 권고.
- 추측 금지. 주어진 데이터만 근거로.
- 신규 에러 패턴과 에러율 상승을 최우선으로 강조.
`;

export async function summarizeDrift(drift: DriftResult) {
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify({
          driftScore: drift.driftScore,
          severity: drift.severity,
          newPatterns: drift.newPatterns.slice(0, 10),
          spikingPatterns: drift.spikingPatterns.slice(0, 10),
          disappearedPatterns: drift.disappearedPatterns.slice(0, 10),
          metrics: drift.metrics,
        }) },
    ],
  });
  // { summary, keyChanges[], recommendation } 형태로 파싱
  return JSON.parse(res.choices[0].message.content!);
}
```

### AI 출력 예시

```json
{
  "summary": "이번 배포 후 결제 모듈에서 새로운 NullPointerException 에러 패턴이 142건 발생했고, DB timeout 로그가 배포 전 대비 70배 급증했습니다. 전체 에러율은 4%에서 18%로 상승했습니다.",
  "keyChanges": [
    "신규 에러: NullPointerException at <PATH> (142건)",
    "급증: DB timeout after <NUM>ms (3 → 210건, 70배)",
    "소멸: Cache warmed 로그 사라짐 (캐시 초기화 실패 의심)"
  ],
  "recommendation": "즉시 롤백을 권고합니다. 결제 경로의 신규 에러와 에러율 4.5배 상승은 사용자 영향이 큽니다."
}
```

### Fallback (AI 실패 시)

OpenAI 호출이 실패하면 규칙 기반 템플릿 문구로 대체한다. drift 점수/목록은 이미 있으므로 데모는 멈추지 않는다.

```ts
function fallbackSummary(d: DriftResult): string {
  return `Drift 점수 ${d.driftScore} (${d.severity}). ` +
    `신규 패턴 ${d.newPatterns.length}개, 급증 ${d.spikingPatterns.length}개, ` +
    `에러율 ${(d.metrics.errorRateBefore*100).toFixed(0)}% → ${(d.metrics.errorRateAfter*100).toFixed(0)}%.`;
}
```

---

## 7. 전체 파이프라인 요약

```
정규화 → fingerprint → 집계(배포별) → baseline 비교
   → drift 항목(NEW/DISAPPEARED/SPIKE/DROP) → 점수/severity
   → OpenAI 요약 + 권고 → drift_reports 저장 → 대시보드 표시
```

➡️ 다음 문서: [06. API 설계](./06-api-design.md)