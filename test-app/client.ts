// test-app/client.ts
// LogLens API 호출 래퍼. 외부 연동 없이 로컬 서버를 그대로 친다.

const BASE = process.env.LOGLENS_URL ?? "http://localhost:3000";
const API_KEY = process.env.LOGLENS_API_KEY ?? ""; // 로컬 더미 키, 환경변수로만

async function post<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export interface DeploymentResponse {
  id: string;
  service: string;
  version: string;
}

export interface IngestResponse {
  received: number;
  patternsExtracted: number;
  newPatterns: number;
}

export interface AnalyzeResponse {
  severity: string;
  driftScore: number;
  summary?: string | null;
  recommendation?: string | null;
}

export const registerDeployment = (service: string, version: string) =>
  post<DeploymentResponse>("/api/deployments", { service, version, environment: "production" });

export const ingestLogs = (deploymentId: string, logs: unknown[]) =>
  post<IngestResponse>("/api/ingest", { deploymentId, logs });

export const analyze = (deploymentId: string) =>
  post<AnalyzeResponse>(`/api/deployments/${deploymentId}/analyze`, {});