import { afterEach, describe, expect, it } from "vitest";
import { computeDrift } from "@/lib/drift-engine";
import { fallbackSummary, summarizeDrift } from "@/lib/openai";

// 문제 배포에 해당하는 drift 결과 (신규 에러 2종 + 정상 패턴) → critical.
const drift = computeDrift([
  { fingerprint: "info|ok", template: "ok", level: "info", baselineCount: 1000, currentCount: 1000 },
  { fingerprint: "error|npe", template: "npe", level: "error", baselineCount: 0, currentCount: 142 },
  { fingerprint: "error|db", template: "db timeout", level: "error", baselineCount: 0, currentCount: 100 },
]);

afterEach(() => {
  delete process.env.LOGLENS_AI;
});

describe("summarizeDrift — 오프라인 스위치 (LOGLENS_AI)", () => {
  it("LOGLENS_AI=off 이면 AI 호출 없이 fallback으로 고정된다", async () => {
    process.env.LOGLENS_AI = "off";
    const r = await summarizeDrift(drift);
    expect(r.fallback).toBe(true);
    // fallback 경로의 결과는 규칙 기반 요약과 동일해야 한다 (네트워크 의존 없음).
    expect(r).toEqual(fallbackSummary(drift));
  });

  it.each(["0", "false", "OFF"])("LOGLENS_AI=%s 도 오프라인으로 인식한다", async (v) => {
    process.env.LOGLENS_AI = v;
    const r = await summarizeDrift(drift);
    expect(r.fallback).toBe(true);
  });
});

describe("fallbackSummary — 규칙 기반 요약", () => {
  it("severity가 critical이면 롤백 권고를 낸다", () => {
    const fb = fallbackSummary(drift);
    expect(fb.fallback).toBe(true);
    expect(fb.recommendation).toContain("롤백");
    expect(fb.keyChanges.length).toBeGreaterThan(0);
  });
});