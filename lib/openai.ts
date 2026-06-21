import OpenAI from "openai";
import type { DriftItem, DriftResult } from "@/lib/drift-engine";

/**
 * AI 요약 레이어 — 결정적으로 계산된 drift 결과를 사람이 읽을 자연어로 변환한다.
 *
 * 설계 의도: drift 점수/목록은 AI 없이도 항상 산출된다(lib/drift-engine.ts).
 * 여기서는 "해석/요약"만 얹는다. OPENAI_API_KEY가 없거나 호출이 실패하면
 * 규칙 기반 fallback으로 떨어지므로 데모는 절대 멈추지 않는다.
 *
 * 출처/규칙: docs/05-drift-detection.md §6
 */

export interface AiDriftSummary {
  summary: string;
  keyChanges: string[];
  recommendation: string;
  /** AI 호출 없이 규칙 기반으로 생성됐는지 여부(디버깅/표시용). */
  fallback: boolean;
}

const MODEL = "gpt-4o-mini";

const SYSTEM_PROMPT = `너는 배포 안정성 분석가다. 배포 전후 로그 패턴의 변화(drift) 데이터를 받아,
엔지니어가 롤백 여부를 즉시 판단할 수 있도록 한국어로 요약한다.
규칙:
- 추측 금지. 주어진 데이터만 근거로 한다.
- 신규 에러 패턴과 에러율 상승을 최우선으로 강조한다.
- 반드시 아래 JSON 스키마로만 답한다:
  { "summary": "2~3문장 요약", "keyChanges": ["핵심 변화 불릿", ...], "recommendation": "한 줄 권고" }`;

// 모듈 수준 캐싱. 키가 없으면 client를 만들지 않는다.
let client: OpenAI | null = null;
function getClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!client) client = new OpenAI();
  return client;
}

/** AI에 넘길 입력은 길이를 제한한다(상위 10개씩). */
function buildPayload(drift: DriftResult) {
  return {
    driftScore: drift.driftScore,
    severity: drift.severity,
    newPatterns: drift.newPatterns.slice(0, 10),
    spikingPatterns: drift.spikingPatterns.slice(0, 10),
    disappearedPatterns: drift.disappearedPatterns.slice(0, 10),
    metrics: drift.metrics,
  };
}

/**
 * drift 결과를 자연어 요약 + 핵심 변화 + 롤백 권고로 변환한다.
 * 키 미설정/호출 실패/파싱 실패는 모두 fallbackSummary로 안전하게 흡수한다.
 */
export async function summarizeDrift(drift: DriftResult): Promise<AiDriftSummary> {
  const ai = getClient();
  if (!ai) return fallbackSummary(drift);

  try {
    const res = await ai.chat.completions.create({
      model: MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(buildPayload(drift)) },
      ],
    });

    const content = res.choices[0]?.message?.content;
    if (!content) return fallbackSummary(drift);

    const parsed = JSON.parse(content) as Partial<AiDriftSummary>;
    const fb = fallbackSummary(drift);
    return {
      summary: parsed.summary?.trim() || fb.summary,
      keyChanges:
        Array.isArray(parsed.keyChanges) && parsed.keyChanges.length > 0
          ? parsed.keyChanges.map(String)
          : fb.keyChanges,
      recommendation: parsed.recommendation?.trim() || fb.recommendation,
      fallback: false,
    };
  } catch (err) {
    console.error("summarizeDrift 실패, fallback 사용:", err);
    return fallbackSummary(drift);
  }
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

function changeLine(i: DriftItem): string {
  if (i.baselineCount === 0) return `신규: ${i.template} (${i.currentCount}건)`;
  const ratio = i.ratio === null ? "" : ` (${Math.round(i.ratio * 10) / 10}배)`;
  return `급증: ${i.template} (${i.baselineCount} → ${i.currentCount}건${ratio})`;
}

/**
 * AI 없이 drift 결과를 규칙 기반 문구로 요약한다.
 * AI 실패 시 대체용이자, AI 응답의 누락 필드를 메우는 기본값으로도 쓰인다.
 */
export function fallbackSummary(drift: DriftResult): AiDriftSummary {
  const { newPatterns, spikingPatterns, disappearedPatterns, metrics, driftScore, severity } = drift;
  const newErrors = newPatterns.filter((p) => p.level === "error");

  const summary =
    `Drift 점수 ${driftScore} (${severity}). ` +
    `신규 패턴 ${newPatterns.length}개(에러 ${newErrors.length}개), 급증 ${spikingPatterns.length}개, ` +
    `소멸 ${disappearedPatterns.length}개. ` +
    `에러율 ${pct(metrics.errorRateBefore)} → ${pct(metrics.errorRateAfter)}.`;

  const keyChanges = [
    ...newErrors.slice(0, 3).map(changeLine),
    ...spikingPatterns.filter((p) => p.level === "error").slice(0, 3).map(changeLine),
    ...disappearedPatterns
      .filter((p) => p.level !== "error")
      .slice(0, 2)
      .map((i) => `소멸: ${i.template} (이전 ${i.baselineCount}건)`),
  ];

  const recommendation =
    severity === "critical"
      ? "즉시 롤백을 검토하세요. 신규 에러 패턴 또는 에러율 상승이 사용자 영향으로 이어질 수 있습니다."
      : severity === "warning"
        ? "변화가 감지되었습니다. 배포 상태를 확인하세요."
        : "유의미한 drift가 없습니다. 정상 배포로 보입니다.";

  return { summary, keyChanges, recommendation, fallback: true };
}