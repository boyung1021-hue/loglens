// scripts/seed.ts
// 데모용 시드: 정상 배포 3개 + 문제 배포 1개를 로컬 DB에 "직접" 채운다.
// 서버(pnpm dev) 없이 실행된다 — API route(/ingest, /analyze)와 동일한 lib 파이프라인을
// 그대로 재사용하므로, 화면에 보이는 결과와 100% 같은 방식으로 데이터가 쌓인다.
//
//   pnpm seed              # 리셋 후 시드 (데모 기본값)
//   pnpm seed -- --keep    # 리셋 없이 이어서 시드
//
// 데이터 분포는 test-app/scenarios.ts를 공유한다(시드 == 테스트 앱).
// DATABASE_URL 필요 — package.json의 seed 스크립트가 --env-file로 주입한다.
// (OPENAI_API_KEY가 없으면 요약은 규칙 기반 fallback으로 떨어진다 — 데모는 멈추지 않는다.)

import { getPool, query } from "@/lib/db";
import { aggregate } from "@/lib/pattern-engine";
import { persistPatterns } from "@/lib/patterns";
import { createDeployment } from "@/lib/deployments";
import { loadPatternPairs, selectBaseline } from "@/lib/baseline";
import { computeDrift } from "@/lib/drift-engine";
import { summarizeDrift } from "@/lib/openai";
import { buildDetails, markDeploymentStatus, saveDriftReport } from "@/lib/reports";
import { generateLogs } from "../test-app/generator";

interface SeedStep {
  service: string;
  scenario: "normal" | "problem";
  version: string;
  /** 배포 시각을 지금으로부터 N시간 전으로 둔다 → baseline 자동 선택이 결정적이 된다. */
  hoursAgo: number;
}

const SERVICE = "payment-api";
const HOUR = 3_600_000;

// 같은 서비스의 시계열: 정상 → 정상 → 정상 → 문제(최신).
// 문제 배포는 직전 정상(24h)을 baseline으로 잡아 확실히 CRITICAL이 된다.
const PLAN: SeedStep[] = [
  { service: SERVICE, scenario: "normal", version: "b7c2f10", hoursAgo: 72 },
  { service: SERVICE, scenario: "normal", version: "c4d9a83", hoursAgo: 48 },
  { service: SERVICE, scenario: "normal", version: "9f8e7d6", hoursAgo: 24 },
  { service: SERVICE, scenario: "problem", version: "a1b2c3d", hoursAgo: 1 },
];

/** loglens 스키마의 모든 데이터를 비운다. 데모 중 꼬여도 "리셋 + 재실행"으로 복구. */
async function reset() {
  await query(
    "TRUNCATE drift_reports, pattern_stats, log_patterns, deployments RESTART IDENTITY CASCADE",
  );
  console.log("🧹 기존 데이터 초기화 (loglens.*)");
}

/** 배포 등록 + 로그 생성 → 정규화·집계 → 패턴 적재. (= /api/deployments + /api/ingest) */
async function ingestStep(step: SeedStep): Promise<string> {
  const deployedAt = new Date(Date.now() - step.hoursAgo * HOUR).toISOString();
  const dep = await createDeployment({
    service: step.service,
    version: step.version,
    environment: "production",
    deployedAt,
  });

  const { lines } = generateLogs(step.scenario);
  const aggs = aggregate(lines);
  await persistPatterns(dep.id, aggs);

  console.log(
    `▶ ${step.service}@${step.version} (${step.scenario}) — ${lines.length} lines → ${aggs.length} patterns`,
  );
  return dep.id;
}

/** baseline 자동 선택 → drift 계산 → AI/fallback 요약 → 리포트 저장. (= /analyze) */
async function analyzeStep(id: string, version: string) {
  const baseline = await selectBaseline(id);

  if (!baseline) {
    await saveDriftReport(id, null, 0, "safe", {
      note: "No baseline deployment to compare against — drift not computed (first deployment).",
    });
    await markDeploymentStatus(id, "analyzed");
    console.log(`  ↳ ${version}: baseline 없음 → safe (첫 배포)`);
    return;
  }

  const pairs = await loadPatternPairs(id, baseline.id);
  const drift = computeDrift(pairs);
  const ai = await summarizeDrift(drift);
  const details = { ...buildDetails(drift), keyChanges: ai.keyChanges, aiFallback: ai.fallback };

  await saveDriftReport(id, baseline.id, drift.driftScore, drift.severity, details, {
    summary: ai.summary,
    recommendation: ai.recommendation,
  });
  await markDeploymentStatus(id, "analyzed");

  console.log(
    `  ↳ ${version}: ${drift.severity.toUpperCase()} (drift ${drift.driftScore})` +
      `${ai.fallback ? " · AI fallback" : " · AI"}`,
  );
}

async function main() {
  if (!process.argv.includes("--keep")) await reset();

  // 1) 전부 ingest 먼저 (모든 배포의 pattern_stats가 쌓인 뒤 분석해야 baseline이 보인다)
  const seeded: { id: string; version: string }[] = [];
  for (const step of PLAN) {
    seeded.push({ id: await ingestStep(step), version: step.version });
  }

  // 2) 시간순으로 분석 (오래된 배포부터 → baseline 체인이 자연스럽게 형성)
  console.log("— 분석 —");
  for (const { id, version } of seeded) {
    await analyzeStep(id, version);
  }

  console.log("✅ 시드 완료. `pnpm dev` 후 http://localhost:3000 에서 확인하세요.");
}

main()
  .catch((e) => {
    console.error("❌ 시드 실패:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => getPool().end());