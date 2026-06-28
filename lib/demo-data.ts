/**
 * 데모 폴백 데이터 — DB가 연결되지 않았을 때(.env 없음 / Vercel에 DB 연결 전) 보여줄 화면용 데이터.
 *
 * 하드코딩 대신 실제 파이프라인(pattern-engine → drift-engine → reports → openai fallback)을
 * 그대로 태워서 만든다. 따라서 seed로 채운 화면과 100% 동일한 형태가 나온다.
 * 순수 함수만 쓰므로 DB·네트워크·OPENAI_API_KEY 없이 결정적으로 생성된다.
 *
 * 시나리오는 test-app/scenarios.ts(= seed)와 동일: payment-api 정상 3 + 문제 1(최신, CRITICAL).
 */

import { normalize, fingerprint, type LogLevel } from "@/lib/pattern-engine";
import { computeDrift, type PatternPair } from "@/lib/drift-engine";
import { buildDetails } from "@/lib/reports";
import { fallbackSummary } from "@/lib/openai";
import { SCENARIOS } from "../test-app/scenarios";
import type {
  DeploymentDetail,
  DeploymentListItem,
  DeploymentReport,
} from "@/lib/deployments";

const SERVICE = "payment-api";
const HOUR = 3_600_000;

/** z.uuid() 검증을 통과해야 상세 페이지가 열리므로 유효한 UUID를 쓴다. */
const ID = {
  normal72: "11111111-1111-4111-8111-111111111111",
  normal48: "22222222-2222-4222-8222-222222222222",
  normal24: "33333333-3333-4333-8333-333333333333",
  problem1: "44444444-4444-4444-8444-444444444444",
} as const;

interface DemoStep {
  id: string;
  version: string;
  scenario: "normal" | "problem";
  hoursAgo: number;
}

// 같은 서비스의 시계열: 정상 → 정상 → 정상 → 문제(최신). seed의 PLAN과 동일.
const PLAN: DemoStep[] = [
  { id: ID.normal72, version: "b7c2f10", scenario: "normal", hoursAgo: 72 },
  { id: ID.normal48, version: "c4d9a83", scenario: "normal", hoursAgo: 48 },
  { id: ID.normal24, version: "9f8e7d6", scenario: "normal", hoursAgo: 24 },
  { id: ID.problem1, version: "a1b2c3d", scenario: "problem", hoursAgo: 1 },
];

interface AggPattern {
  fingerprint: string;
  template: string;
  level: LogLevel;
  count: number;
}

/**
 * 가변값 placeholder를 고정 숫자로 치환한다(= generator.fill의 결정적 버전).
 * 이후 normalize가 숫자를 <NUM>/<PATH> 토큰으로 바꾸므로 seed와 동일한 템플릿이 나온다.
 */
function fill(template: string): string {
  return template
    .replace(/\{ms\}/g, "100")
    .replace(/\{id\}/g, "1000")
    .replace(/\{n\}/g, "1");
}

/** 시나리오 분포(weight)를 집계 패턴으로 변환한다. 정규화·fingerprint는 실제 엔진을 그대로 쓴다. */
function aggregateScenario(scenario: "normal" | "problem"): AggPattern[] {
  return SCENARIOS[scenario].specs.map((s) => {
    const template = normalize(fill(s.template));
    return {
      fingerprint: fingerprint(template, s.level),
      template,
      level: s.level,
      count: s.weight, // spec당 weight개의 라인이 생성되므로 곧 패턴 카운트
    };
  });
}

/** baseline·current 집계를 fingerprint 기준 full-outer-join해 PatternPair[]로 만든다 (= loadPatternPairs). */
function pairUp(baseline: AggPattern[], current: AggPattern[]): PatternPair[] {
  const map = new Map<string, PatternPair>();
  const ensure = (a: AggPattern) => {
    const existing = map.get(a.fingerprint);
    if (existing) return existing;
    const pair: PatternPair = {
      fingerprint: a.fingerprint,
      template: a.template,
      level: a.level,
      baselineCount: 0,
      currentCount: 0,
    };
    map.set(a.fingerprint, pair);
    return pair;
  };
  for (const b of baseline) ensure(b).baselineCount = b.count;
  for (const c of current) ensure(c).currentCount = c.count;
  return [...map.values()];
}

/** drift 리포트를 (DB 없이) 계산한다. baseline 없으면 첫 배포 note만 단다. */
function buildReport(
  baseline: AggPattern[] | null,
  baselineVersion: string | null,
  current: AggPattern[],
  createdAt: string,
): DeploymentReport {
  if (!baseline) {
    return {
      baselineId: null,
      baselineVersion: null,
      driftScore: 0,
      severity: "safe",
      summary: null,
      recommendation: null,
      details: { note: "비교할 baseline 배포가 없어 drift를 계산하지 않았습니다 (첫 배포)." },
      createdAt,
    };
  }

  const drift = computeDrift(pairUp(baseline, current));
  const ai = fallbackSummary(drift);
  return {
    baselineId: null,
    baselineVersion,
    driftScore: drift.driftScore,
    severity: drift.severity,
    summary: ai.summary,
    recommendation: ai.recommendation,
    details: { ...buildDetails(drift), keyChanges: ai.keyChanges, aiFallback: true },
    createdAt,
  };
}

/** 데모 배포 4건의 상세를 생성한다. 시간 기준은 호출 시점(now) → "N시간 전"이 자연스럽다. */
function buildDemoDeployments(): DeploymentDetail[] {
  const now = Date.now();
  const aggs = new Map<"normal" | "problem", AggPattern[]>();
  const aggOf = (s: "normal" | "problem") => {
    const cached = aggs.get(s);
    if (cached) return cached;
    const v = aggregateScenario(s);
    aggs.set(s, v);
    return v;
  };

  return PLAN.map((step, i) => {
    const current = aggOf(step.scenario);
    const prev = i === 0 ? null : PLAN[i - 1];
    const baseline = prev ? aggOf(prev.scenario) : null;
    const deployedAt = new Date(now - step.hoursAgo * HOUR).toISOString();

    return {
      id: step.id,
      service: SERVICE,
      version: step.version,
      environment: "production",
      deployedAt,
      status: "analyzed",
      patternCount: current.length,
      report: buildReport(baseline, prev?.version ?? null, current, deployedAt),
    };
  });
}

/** DB 미연결 시 배포 목록(최신순)으로 보여줄 데모 데이터. */
export function getDemoDeployments(): DeploymentListItem[] {
  return buildDemoDeployments()
    .map((d) => ({
      id: d.id,
      service: d.service,
      version: d.version,
      environment: d.environment,
      deployedAt: d.deployedAt,
      status: d.status,
      severity: d.report?.severity ?? null,
      driftScore: d.report?.driftScore ?? null,
    }))
    .sort((a, b) => b.deployedAt.localeCompare(a.deployedAt));
}

/** DB 미연결 시 배포 상세로 보여줄 데모 데이터. 없는 id면 null. */
export function getDemoDeploymentDetail(id: string): DeploymentDetail | null {
  return buildDemoDeployments().find((d) => d.id === id) ?? null;
}