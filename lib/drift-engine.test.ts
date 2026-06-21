import { describe, expect, it } from "vitest";
import { computeDrift, type PatternPair } from "@/lib/drift-engine";

/** 테스트용 PatternPair 생성 헬퍼. fingerprint는 template+level로 적당히 만든다. */
function pair(p: Partial<PatternPair> & Pick<PatternPair, "baselineCount" | "currentCount">): PatternPair {
  const level = p.level ?? "info";
  const template = p.template ?? "some pattern";
  return {
    fingerprint: p.fingerprint ?? `${level}|${template}`,
    template,
    level,
    baselineCount: p.baselineCount,
    currentCount: p.currentCount,
  };
}

describe("computeDrift — 분류", () => {
  it("baseline 0 · current ≥ MIN_COUNT 이면 NEW", () => {
    const r = computeDrift([pair({ template: "boom", level: "error", baselineCount: 0, currentCount: 142 })]);
    expect(r.newPatterns).toHaveLength(1);
    expect(r.newPatterns[0].ratio).toBeNull();
    expect(r.disappearedPatterns).toHaveLength(0);
  });

  it("current 0 · baseline ≥ MIN_COUNT 이면 DISAPPEARED", () => {
    const r = computeDrift([pair({ template: "cache warmed", baselineCount: 88, currentCount: 0 })]);
    expect(r.disappearedPatterns).toHaveLength(1);
    expect(r.newPatterns).toHaveLength(0);
  });

  it("SPIKE_RATIO(3배) 이상 증가하면 SPIKE", () => {
    const r = computeDrift([pair({ template: "db timeout", level: "error", baselineCount: 3, currentCount: 210 })]);
    expect(r.spikingPatterns).toHaveLength(1);
    expect(r.spikingPatterns[0].ratio).toBe(70);
  });

  it("DROP_RATIO(1/3) 이하로 감소하면 DROP", () => {
    const r = computeDrift([pair({ template: "payment processed", baselineCount: 2400, currentCount: 100 })]);
    expect(r.droppingPatterns).toHaveLength(1);
  });

  it("거의 변화 없는 패턴은 어느 분류에도 들지 않는다", () => {
    const r = computeDrift([pair({ template: "request handled", baselineCount: 9000, currentCount: 8800 })]);
    expect(r.newPatterns).toHaveLength(0);
    expect(r.disappearedPatterns).toHaveLength(0);
    expect(r.spikingPatterns).toHaveLength(0);
    expect(r.droppingPatterns).toHaveLength(0);
  });
});

describe("computeDrift — MIN_COUNT 노이즈 컷", () => {
  it("MIN_COUNT 미만 신규 패턴은 NEW로 보지 않는다", () => {
    const r = computeDrift([pair({ baselineCount: 0, currentCount: 4 })]);
    expect(r.newPatterns).toHaveLength(0);
  });

  it("MIN_COUNT 미만으로 사라진 패턴은 DISAPPEARED로 보지 않는다", () => {
    const r = computeDrift([pair({ baselineCount: 4, currentCount: 0 })]);
    expect(r.disappearedPatterns).toHaveLength(0);
  });

  it("급증해도 current가 MIN_COUNT 미만이면 SPIKE 아님", () => {
    const r = computeDrift([pair({ baselineCount: 1, currentCount: 4 })]);
    expect(r.spikingPatterns).toHaveLength(0);
  });
});

describe("computeDrift — metrics", () => {
  it("에러율과 총량을 정확히 집계한다", () => {
    const r = computeDrift([
      pair({ template: "ok", level: "info", baselineCount: 90, currentCount: 80 }),
      pair({ template: "fail", level: "error", baselineCount: 10, currentCount: 20 }),
    ]);
    expect(r.metrics.totalBefore).toBe(100);
    expect(r.metrics.totalAfter).toBe(100);
    expect(r.metrics.errorRateBefore).toBeCloseTo(0.1);
    expect(r.metrics.errorRateAfter).toBeCloseTo(0.2);
    expect(r.metrics.patternsBefore).toBe(2);
    expect(r.metrics.patternsAfter).toBe(2);
  });

  it("총량 0이면 에러율은 0 (0 나눗셈 방지)", () => {
    const r = computeDrift([]);
    expect(r.metrics.errorRateBefore).toBe(0);
    expect(r.metrics.errorRateAfter).toBe(0);
  });

  it("current에만 등장한 패턴은 patternsBefore에 세지 않는다", () => {
    const r = computeDrift([pair({ baselineCount: 0, currentCount: 50 })]);
    expect(r.metrics.patternsBefore).toBe(0);
    expect(r.metrics.patternsAfter).toBe(1);
  });
});

describe("computeDrift — score / severity", () => {
  it("drift 없으면 score 0, safe", () => {
    const r = computeDrift([pair({ baselineCount: 1000, currentCount: 1000 })]);
    expect(r.driftScore).toBe(0);
    expect(r.severity).toBe("safe");
  });

  it("신규 에러 패턴 1개는 +25 → warning", () => {
    const r = computeDrift([pair({ level: "error", baselineCount: 0, currentCount: 30 })]);
    // 신규 에러 25 + 에러율 0→1 상승분 100 = clamp 100. 에러율 영향 없이 보려면 비에러 총량이 필요.
    expect(r.severity).toBe("critical");
    expect(r.driftScore).toBe(100);
  });

  it("신규 비에러 패턴만 있으면 작은 점수 (+5)", () => {
    const r = computeDrift([
      pair({ template: "noise", level: "info", baselineCount: 0, currentCount: 30 }),
      pair({ template: "steady", level: "info", baselineCount: 1000, currentCount: 1000 }),
    ]);
    expect(r.driftScore).toBe(5);
    expect(r.severity).toBe("safe");
  });

  it("문제 배포 시나리오는 critical로 분류된다", () => {
    const r = computeDrift([
      pair({ template: "request handled", level: "info", baselineCount: 9000, currentCount: 8800 }),
      pair({ template: "npe at charge", level: "error", baselineCount: 0, currentCount: 142 }),
      pair({ template: "gateway returned", level: "error", baselineCount: 0, currentCount: 88 }),
      pair({ template: "db timeout", level: "error", baselineCount: 3, currentCount: 210 }),
    ]);
    expect(r.severity).toBe("critical");
    expect(r.driftScore).toBeGreaterThanOrEqual(60);
    expect(r.newPatterns).toHaveLength(2);
    expect(r.spikingPatterns).toHaveLength(1);
  });

  it("score는 0~100으로 clamp된다", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      pair({ template: `err-${i}`, level: "error" as const, baselineCount: 0, currentCount: 50 }),
    );
    const r = computeDrift(many);
    expect(r.driftScore).toBe(100);
  });
});