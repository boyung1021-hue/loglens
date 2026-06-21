// test-app/index.ts
// CLI 진입점: 인자 파싱 → 배포 등록 → batch ingest → (옵션) analyze.

import { generateLogs } from "./generator";
import { analyze, ingestLogs, registerDeployment } from "./client";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const scenario = arg("scenario", "normal")!; // normal | problem
  const service = arg("service", "payment-api")!;
  const batchSize = Number(arg("batch", "5000"));
  const doAnalyze = process.argv.includes("--analyze");

  const { version, lines } = generateLogs(scenario);

  // 1) 배포 등록
  const dep = await registerDeployment(service, version);
  console.log(`▶ 배포 등록: ${service}@${version} (${dep.id})`);

  // 2) batch ingest (큰 배열은 나눠 전송 → 페이로드 한계 회피)
  for (let i = 0; i < lines.length; i += batchSize) {
    const chunk = lines.slice(i, i + batchSize);
    const r = await ingestLogs(dep.id, chunk);
    console.log(`  ↳ ingest ${i + chunk.length}/${lines.length} (patterns: ${r.patternsExtracted})`);
  }

  // 3) (옵션) 분석 트리거
  if (doAnalyze) {
    const report = await analyze(dep.id);
    console.log(`✔ 분석 완료: ${report.severity} (drift ${report.driftScore})`);
    console.log(`  ${report.recommendation ?? report.summary ?? ""}`);
  }

  console.log(`✅ done: ${scenario} 시나리오 ${lines.length} lines → ${dep.id}`);
}

main().catch((e) => {
  console.error("❌", e instanceof Error ? e.message : e);
  process.exit(1);
});