import { z } from "zod";
import { aggregate } from "@/lib/pattern-engine";
import { deploymentExists, persistPatterns } from "@/lib/patterns";

// pg는 Node 런타임이 필요하다 (Edge 런타임 비호환).
export const runtime = "nodejs";

const IngestSchema = z.object({
  deploymentId: z.uuid(),
  logs: z
    .array(
      z.object({
        timestamp: z.iso.datetime().optional(),
        level: z.enum(["info", "warn", "error"]).default("info"),
        message: z.string().min(1),
      }),
    )
    .max(20000),
});

// POST /api/ingest — 로그 batch 수신 → 정규화·집계 → upsert. 원본은 저장하지 않는다.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: "JSON 본문을 파싱할 수 없습니다.", code: "INVALID_JSON" },
      { status: 400 },
    );
  }

  const parsed = IngestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "deploymentId(uuid), logs[] 필수", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }
  const { deploymentId, logs } = parsed.data;

  try {
    if (!(await deploymentExists(deploymentId))) {
      return Response.json(
        { error: "배포를 찾을 수 없습니다.", code: "NOT_FOUND" },
        { status: 404 },
      );
    }

    // 1) 정규화 + fingerprint + 집계 (메모리 내). 이후 logs(원본)는 GC 대상.
    const aggs = aggregate(logs);

    // 2) 패턴 사전 + 배포별 통계 upsert
    const { newPatternCount } = await persistPatterns(deploymentId, aggs);

    return Response.json({
      deploymentId,
      received: logs.length,
      patternsExtracted: aggs.length,
      newPatterns: newPatternCount,
    });
  } catch (err) {
    console.error("ingest 실패:", err);
    return Response.json(
      { error: "로그 수집 중 오류가 발생했습니다.", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}
