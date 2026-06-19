import { query } from "@/lib/db";

export interface Deployment {
  id: string;
  service: string;
  version: string;
  environment: string;
  deployedAt: string;
  status: string;
}

export interface CreateDeploymentInput {
  service: string;
  version: string;
  environment?: string;
  deployedAt?: string;
}

/**
 * 배포 메타데이터를 한 건 등록한다.
 * environment 미지정 시 'production', deployedAt 미지정 시 now()로 기본 처리.
 */
export async function createDeployment(input: CreateDeploymentInput): Promise<Deployment> {
  const { rows } = await query<Deployment>(
    `INSERT INTO deployments (service, version, environment, deployed_at)
     VALUES ($1, $2, COALESCE($3, 'production'), COALESCE($4::timestamptz, now()))
     RETURNING id, service, version, environment,
               deployed_at AS "deployedAt", status`,
    [input.service, input.version, input.environment ?? null, input.deployedAt ?? null],
  );
  return rows[0];
}