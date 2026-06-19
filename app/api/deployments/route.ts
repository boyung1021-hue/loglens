import { z } from "zod";
import { createDeployment } from "@/lib/deployments";

// pg는 Node 런타임이 필요하다 (Edge 런타임 비호환).
export const runtime = "nodejs";

const CreateDeploymentSchema = z.object({
  service: z.string().min(1),
  version: z.string().min(1),
  environment: z.string().min(1).optional(),
  deployedAt: z.iso.datetime().optional(),
});

// POST /api/deployments — 배포 등록
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

  const parsed = CreateDeploymentSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "service, version 필수", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }

  try {
    const dep = await createDeployment(parsed.data);
    return Response.json(dep, { status: 201 });
  } catch (err) {
    console.error("createDeployment 실패:", err);
    return Response.json(
      { error: "배포 등록 중 오류가 발생했습니다.", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}