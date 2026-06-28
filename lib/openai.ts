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

const SYSTEM_PROMPT = `You are a deployment reliability analyst. Given log pattern drift data from before
and after a deployment, summarize it in English so an engineer can immediately decide whether to roll back.
Rules:
- No speculation. Base everything only on the given data.
- Prioritize new error patterns and a rising error rate.
- Respond ONLY with the following JSON schema:
  { "summary": "2-3 sentence summary", "keyChanges": ["key change bullet", ...], "recommendation": "one-line recommendation" }`;

/**
 * 데모 오프라인 스위치. LOGLENS_AI=off|0|false 이면 키가 있어도 AI를 호출하지 않고
 * 규칙 기반 fallback으로 고정한다 (발표 시 네트워크 의존 제거용).
 */
function isAiDisabled(): boolean {
  const v = process.env.LOGLENS_AI?.trim().toLowerCase();
  return v === "off" || v === "0" || v === "false";
}

// 모듈 수준 캐싱. 오프라인 플래그가 켜졌거나 키가 없으면 client를 만들지 않는다.
let client: OpenAI | null = null;
function getClient(): OpenAI | null {
  if (isAiDisabled()) return null;
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
  if (i.baselineCount === 0) return `New: ${i.template} (${i.currentCount})`;
  const ratio = i.ratio === null ? "" : ` (${Math.round(i.ratio * 10) / 10}x)`;
  return `Spike: ${i.template} (${i.baselineCount} → ${i.currentCount}${ratio})`;
}

/**
 * AI 없이 drift 결과를 규칙 기반 문구로 요약한다.
 * AI 실패 시 대체용이자, AI 응답의 누락 필드를 메우는 기본값으로도 쓰인다.
 */
export function fallbackSummary(drift: DriftResult): AiDriftSummary {
  const { newPatterns, spikingPatterns, disappearedPatterns, metrics, driftScore, severity } = drift;
  const newErrors = newPatterns.filter((p) => p.level === "error");

  const summary =
    `Drift score ${driftScore} (${severity}). ` +
    `${newPatterns.length} new pattern(s) (${newErrors.length} error), ${spikingPatterns.length} spiking, ` +
    `${disappearedPatterns.length} disappeared. ` +
    `Error rate ${pct(metrics.errorRateBefore)} → ${pct(metrics.errorRateAfter)}.`;

  const keyChanges = [
    ...newErrors.slice(0, 3).map(changeLine),
    ...spikingPatterns.filter((p) => p.level === "error").slice(0, 3).map(changeLine),
    ...disappearedPatterns
      .filter((p) => p.level !== "error")
      .slice(0, 2)
      .map((i) => `Disappeared: ${i.template} (was ${i.baselineCount})`),
  ];

  const recommendation =
    severity === "critical"
      ? "Consider an immediate rollback. New error patterns or a rising error rate may be impacting users."
      : severity === "warning"
        ? "Changes detected. Review the deployment status."
        : "No significant drift. This looks like a healthy deployment.";

  return { summary, keyChanges, recommendation, fallback: true };
}