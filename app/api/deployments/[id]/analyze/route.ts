import { z } from "zod";
import { loadPatternPairs, selectBaseline } from "@/lib/baseline";
import { computeDrift } from "@/lib/drift-engine";
import { summarizeDrift } from "@/lib/openai";
import { deploymentExists } from "@/lib/patterns";
import { buildDetails, markDeploymentStatus, saveDriftReport } from "@/lib/reports";

// pg는 Node 런타임이 필요하다 (Edge 런타임 비호환).
export const runtime = "nodejs";

// 본문은 선택. baselineId를 명시하면 자동 선택을 덮어쓴다.
const AnalyzeSchema = z.object({
  baselineId: z.uuid().optional(),
});

// POST /api/deployments/:id/analyze — baseline 비교 → drift 계산 → drift_reports 저장 (AI 제외)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!z.uuid().safeParse(id).success) {
    return Response.json(
      { error: "유효하지 않은 배포 ID입니다.", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }

  // 본문은 없을 수도 있다(빈 body 허용). 있으면 baselineId만 검증한다.
  let baselineOverride: string | undefined;
  try {
    const raw = await req.text();
    if (raw.trim()) {
      const parsed = AnalyzeSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        return Response.json(
          { error: "baselineId는 uuid여야 합니다.", code: "VALIDATION_ERROR" },
          { status: 400 },
        );
      }
      baselineOverride = parsed.data.baselineId;
    }
  } catch {
    return Response.json(
      { error: "JSON 본문을 파싱할 수 없습니다.", code: "INVALID_JSON" },
      { status: 400 },
    );
  }

  try {
    if (!(await deploymentExists(id))) {
      return Response.json(
        { error: "배포를 찾을 수 없습니다.", code: "NOT_FOUND" },
        { status: 404 },
      );
    }

    const baseline = baselineOverride
      ? { id: baselineOverride }
      : await selectBaseline(id);

    // baseline 없음(첫 배포 등): 비교 기준이 없으므로 drift를 계산하지 않고
    // 중립 리포트(safe, score 0)를 남긴다. 전부 NEW로 처리해 오탐 critical을 내지 않는다.
    if (!baseline) {
      const report = await saveDriftReport(id, null, 0, "safe", {
        note: "비교할 baseline 배포가 없어 drift를 계산하지 않았습니다 (첫 배포).",
      });
      await markDeploymentStatus(id, "analyzed");
      return Response.json(report);
    }

    const pairs = await loadPatternPairs(id, baseline.id);
    const drift = computeDrift(pairs);

    // AI 요약(실패 시 내부에서 fallback). keyChanges는 details에 함께 보관한다.
    const ai = await summarizeDrift(drift);
    const details = { ...buildDetails(drift), keyChanges: ai.keyChanges, aiFallback: ai.fallback };

    const report = await saveDriftReport(
      id,
      baseline.id,
      drift.driftScore,
      drift.severity,
      details,
      { summary: ai.summary, recommendation: ai.recommendation },
    );
    await markDeploymentStatus(id, "analyzed");

    return Response.json(report);
  } catch (err) {
    console.error("analyze 실패:", err);
    return Response.json(
      { error: "분석 중 오류가 발생했습니다.", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}