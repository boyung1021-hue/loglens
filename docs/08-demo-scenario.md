# 08. 데모 시나리오 (Demo Scenario)

> 목표: **90초 안에** "배포 → drift 감지 → AI 권고 → 롤백 판단"의 가치를 보여준다.
> 핵심 메시지: *"LogLens는 로그를 보여주지 않습니다. 무엇이 달라졌는지를 보여줍니다."*

---

## 1. 데모 스토리 (내러티브)

> **상황**: payment-api 서비스에 새 버전(`a1b2c3d`)을 배포했다. 겉보기엔 멀쩡하지만, 결제 모듈에 NPE 버그가 숨어 있다.

1. **(0–15초) 문제 제기**
   - "배포하고 나면 항상 불안하죠. 대시보드를 한참 뒤져야 뭐가 문제인지 압니다."
   - LogLens 홈을 연다. 어제까지의 배포는 모두 🟢 SAFE.

2. **(15–40초) 배포 + 수집**
   - `[+ 배포 등록]` → payment-api `a1b2c3d` 등록.
   - 시드 스크립트가 "배포 후 로그"를 ingest (미리 준비된 문제 로그).
   - "원본 로그는 저장하지 않습니다. 패턴과 통계만 추출합니다."

3. **(40–65초) Drift 감지**
   - `[분석 실행]` 클릭 → 몇 초 후 상세 화면.
   - 🔴 **CRITICAL · Drift 72** 배너가 뜬다.
   - "직전 배포와 자동 비교했더니, 신규 에러 패턴 3종과 에러율 4%→18% 상승을 잡았습니다."

4. **(65–85초) AI 권고**
   - AI 요약 낭독: "결제 모듈 NPE 142건, DB timeout 70배 급증... **즉시 롤백 권고.**"
   - "엔지니어가 그래프를 비교할 필요 없이, 무엇이 달라졌는지 바로 답을 줍니다."

5. **(85–90초) 마무리**
   - "이게 LogLens입니다. *Detect deployment log drift before it becomes downtime.*"

---

## 2. 데모 데이터 (Baseline vs Problem)

두 배포의 로그 패턴 분포를 의도적으로 다르게 구성한다.

### Baseline 배포 (`9f8e7d6`, 정상 — 18시간 전)
```
info  : "Request handled in <NUM>ms"        → 9,000건
info  : "Cache warmed in <NUM>ms"           →    88건
info  : "Payment processed for order <NUM>" → 2,400건
warn  : "Slow query <NUM>ms"                →    40건
error : "Timeout calling upstream"          →    20건   (에러율 ≈ 4%)
```

### Problem 배포 (`a1b2c3d`, 문제 — 방금)
```
info  : "Request handled in <NUM>ms"               → 8,800건
info  : "Payment processed for order <NUM>"        → 1,100건  ← 처리량 급감
warn  : "Slow query <NUM>ms"                       →    60건
warn  : "retrying request <NUM>/3"                 →    54건  ← 🆕 신규
error : "Timeout calling upstream"                 →    18건
error : "NullPointerException at <PATH>"           →   142건  ← 🆕 신규(치명)
error : "payment gateway returned <NUM>"           →    88건  ← 🆕 신규
error : "DB timeout after <NUM>ms"                 →   210건  ← 📈 급증(3→210)
# "Cache warmed in <NUM>ms" 없음                              ← 📉 소멸
                                       (에러율 ≈ 18%)
```

### 이 데이터가 만드는 drift
| 종류 | 항목 |
|------|------|
| 🆕 신규 에러 | NullPointerException(142), payment gateway(88) |
| 🆕 신규 warn | retrying request(54) |
| 📈 급증 | DB timeout (3 → 210, 70배) |
| 📉 소멸 | Cache warmed (88 → 0) |
| 지표 | 에러율 4% → 18% |
| **점수** | 신규 에러 2×25 + 급증 에러 20 + 소멸 8 + 에러율 14 ≈ **72 → CRITICAL** |

---

## 3. 시드 스크립트 (데모 안정성의 핵심)

발표 중 실시간 로그 생성에 의존하지 말고, **재현 가능한 시드**를 준비한다.

```ts
// scripts/seed.ts
// 1. payment-api의 정상 배포 2~3개 생성 + 정상 로그 ingest
// 2. 문제 배포 1개 생성 (analyze는 데모 중 라이브로 실행)
//    → 발표 임팩트를 위해 분석은 라이브, 데이터는 시드

const NORMAL = [
  { level: "info",  message: "Request handled in 42ms",            weight: 9000 },
  { level: "info",  message: "Cache warmed in 45ms",               weight: 88 },
  { level: "info",  message: "Payment processed for order 5821",   weight: 2400 },
  { level: "warn",  message: "Slow query 1200ms",                  weight: 40 },
  { level: "error", message: "Timeout calling upstream",           weight: 20 },
];

const PROBLEM = [
  { level: "info",  message: "Request handled in 42ms",                  weight: 8800 },
  { level: "info",  message: "Payment processed for order 5821",         weight: 1100 },
  { level: "warn",  message: "Slow query 1200ms",                        weight: 60 },
  { level: "warn",  message: "retrying request 2/3",                     weight: 54 },
  { level: "error", message: "Timeout calling upstream",                 weight: 18 },
  { level: "error", message: "NullPointerException at /pay/charge.ts:88",weight: 142 },
  { level: "error", message: "payment gateway returned 503",             weight: 88 },
  { level: "error", message: "DB timeout after 5000ms",                  weight: 210 },
];

// weight만큼 라인을 생성하되 숫자/ID는 랜덤하게 변형 → 정규화 검증도 자연스럽게 데모됨
// 실행: pnpm tsx scripts/seed.ts
```

> 💡 **팁**: 메시지의 숫자를 매 라인 랜덤화하면(예: order 5821 → 9012) "정규화가 실제로 동작한다"는 것도 데모에서 함께 보여줄 수 있다.

---

## 4. 데모 체크리스트 (발표 전)

- [ ] 시드 실행 완료 — 정상 배포들이 🟢로 보인다.
- [ ] 문제 배포는 등록만 되어 있고 분석은 **안 한 상태**로 둔다(라이브 임팩트).
- [ ] OpenAI API Key 동작 확인 + **fallback 요약도 확인**(네트워크 불안 대비).
- [ ] 인터넷 불안 대비: AI 응답을 캐시/스텁으로 대체할 수 있는 플래그 준비.
- [ ] 화면 글씨 크기 키우기(발표용).
- [ ] drift 점수가 확실히 CRITICAL(≥60)로 뜨는지 사전 리허설.

---

## 5. 예상 Q&A

**Q. 로그를 다 저장 안 하면 나중에 디버깅은?**
> LogLens는 "무엇이 달라졌나"에 답하는 도구입니다. 상세 디버깅은 기존 로그 도구와 함께 씁니다. 우리는 패턴당 샘플 1개는 보관하므로 "어떤 로그인지"는 확인 가능합니다.

**Q. 패턴 정규화가 틀리면?**
> 임계값과 규칙은 튜닝 가능합니다. MVP는 정규식 기반이고, 다음 단계로 임베딩 기반 클러스터링을 계획합니다.

**Q. baseline은 어떻게 정하나?**
> 같은 서비스·환경의 직전(롤백되지 않은) 배포를 자동 선택합니다. 수동 지정도 가능합니다.

**Q. 기존 APM/로그 도구와 뭐가 다른가?**
> 그들은 "내가 가진 로그"를 보여줍니다. LogLens는 "이번 배포가 바꾼 것"을 보여줍니다. 분석 단위가 로그가 아니라 **배포**입니다.

➡️ 다음 문서: [09. 개발 계획](./09-development-plan.md)