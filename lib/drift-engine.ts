import type { LogLevel } from "./pattern-engine";

/**
 * Drift 엔진 — 순수 함수만 모았다 (DB/네트워크/시간 의존 없음).
 *
 * baseline(배포 전) vs current(배포 후) 패턴 통계를 비교해
 * "무엇이 달라졌는가"를 결정적 규칙으로 계산한다. AI는 그 위에 얹는 요약 레이어다.
 *
 * 파이프라인: PatternPair[] → computeDrift() → DriftResult
 *   NEW / DISAPPEARED / SPIKE / DROP 분류 → metrics → driftScore(0~100) → severity
 *
 * 출처/규칙: docs/05-drift-detection.md §4–5
 */

/**
 * fingerprint 기준으로 짝지은 baseline·current 패턴 한 쌍.
 * fingerprint가 level을 포함하므로 한 쌍의 level은 고정 → 에러 수는 level에서 파생한다.
 */
export interface PatternPair {
  fingerprint: string;
  template: string;
  level: LogLevel;
  baselineCount: number;
  currentCount: number;
}

/** drift로 분류된 패턴 1건. before/after 카운트와 변화 비율을 함께 담는다. */
export interface DriftItem {
  fingerprint: string;
  template: string;
  level: LogLevel;
  baselineCount: number;
  currentCount: number;
  /** currentCount / baselineCount. baseline이 0이면 null(신규). */
  ratio: number | null;
}

/** 집계 지표 변화 — 에러율/총량/패턴 다양성. */
export interface DriftMetrics {
  totalBefore: number;
  totalAfter: number;
  /** 0~1. 에러 레벨 라인 비율. */
  errorRateBefore: number;
  errorRateAfter: number;
  /** baseline/current에 등장한 (count>0) 고유 패턴 수. */
  patternsBefore: number;
  patternsAfter: number;
}

export type Severity = "safe" | "warning" | "critical";

export interface DriftResult {
  newPatterns: DriftItem[];
  disappearedPatterns: DriftItem[];
  spikingPatterns: DriftItem[];
  droppingPatterns: DriftItem[];
  metrics: DriftMetrics;
  /** 0~100. 클수록 위험. */
  driftScore: number;
  severity: Severity;
}

// 분류 임계값 — 데모 데이터에 맞춰 Day 3에서 튜닝.
const SPIKE_RATIO = 3; // 3배 이상 증가하면 spike
const DROP_RATIO = 0.33; // 1/3 이하로 감소하면 drop
const MIN_COUNT = 5; // 노이즈 컷: 이보다 적으면 무시

function toItem(p: PatternPair): DriftItem {
  const { fingerprint, template, level, baselineCount, currentCount } = p;
  return {
    fingerprint,
    template,
    level,
    baselineCount,
    currentCount,
    ratio: baselineCount > 0 ? currentCount / baselineCount : null,
  };
}

/**
 * baseline·current 패턴 쌍 배열을 받아 drift 항목·점수·severity를 산출한다.
 * 분류는 상호배타적이다 (한 패턴은 NEW/DISAPPEARED/SPIKE/DROP 중 최대 하나).
 */
export function computeDrift(pairs: PatternPair[]): DriftResult {
  const newPatterns: DriftItem[] = [];
  const disappearedPatterns: DriftItem[] = [];
  const spikingPatterns: DriftItem[] = [];
  const droppingPatterns: DriftItem[] = [];

  for (const p of pairs) {
    const b = p.baselineCount;
    const c = p.currentCount;

    if (b === 0 && c >= MIN_COUNT) {
      newPatterns.push(toItem(p));
    } else if (c === 0 && b >= MIN_COUNT) {
      disappearedPatterns.push(toItem(p));
    } else if (b > 0 && c >= MIN_COUNT && c / b >= SPIKE_RATIO) {
      spikingPatterns.push(toItem(p));
    } else if (b >= MIN_COUNT && c / b <= DROP_RATIO) {
      droppingPatterns.push(toItem(p));
    }
  }

  const metrics = computeMetrics(pairs);
  const driftScore = score({ newPatterns, spikingPatterns, disappearedPatterns, metrics });

  return {
    newPatterns,
    disappearedPatterns,
    spikingPatterns,
    droppingPatterns,
    metrics,
    driftScore,
    severity: toSeverity(driftScore),
  };
}

/** 총량·에러율·패턴 다양성 변화를 한 번에 집계한다. */
function computeMetrics(pairs: PatternPair[]): DriftMetrics {
  let totalBefore = 0;
  let totalAfter = 0;
  let errorsBefore = 0;
  let errorsAfter = 0;
  let patternsBefore = 0;
  let patternsAfter = 0;

  for (const p of pairs) {
    totalBefore += p.baselineCount;
    totalAfter += p.currentCount;
    if (p.level === "error") {
      errorsBefore += p.baselineCount;
      errorsAfter += p.currentCount;
    }
    if (p.baselineCount > 0) patternsBefore += 1;
    if (p.currentCount > 0) patternsAfter += 1;
  }

  return {
    totalBefore,
    totalAfter,
    errorRateBefore: totalBefore > 0 ? errorsBefore / totalBefore : 0,
    errorRateAfter: totalAfter > 0 ? errorsAfter / totalAfter : 0,
    patternsBefore,
    patternsAfter,
  };
}

/**
 * 가중합으로 0~100 점수를 만든다. 에러 관련 변화에 큰 가중치를 둔다.
 * - 신규 에러 패턴이 가장 강한 신호, 그다음 급증 에러, 소멸한 정상 패턴, 에러율 상승폭.
 */
function score({
  newPatterns,
  spikingPatterns,
  disappearedPatterns,
  metrics,
}: Pick<DriftResult, "newPatterns" | "spikingPatterns" | "disappearedPatterns" | "metrics">): number {
  let s = 0;

  // 1) 신규 에러 패턴: 가장 강한 신호
  const newErrors = newPatterns.filter((p) => p.level === "error").length;
  s += newErrors * 25;
  s += (newPatterns.length - newErrors) * 5; // 신규 비에러 패턴

  // 2) 급증한 에러 패턴
  s += spikingPatterns.filter((p) => p.level === "error").length * 20;

  // 3) 소멸한 정상 패턴 (기능 중단 의심)
  s += disappearedPatterns.filter((p) => p.level !== "error").length * 8;

  // 4) 에러율 상승폭 (0.14 상승 → +14)
  const deltaErr = metrics.errorRateAfter - metrics.errorRateBefore;
  if (deltaErr > 0) s += deltaErr * 100;

  return Math.max(0, Math.min(100, Math.round(s)));
}

const toSeverity = (driftScore: number): Severity =>
  driftScore >= 60 ? "critical" : driftScore >= 25 ? "warning" : "safe";