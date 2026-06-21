// test-app/scenarios.ts
// NORMAL / PROBLEM 로그 분포 정의 (docs/08-demo-scenario.md와 동일).
// 시드와 테스트 앱이 같은 데이터를 공유하도록 한 곳에 둔다.

export type LogLevel = "info" | "warn" | "error";
export interface LogSpec {
  level: LogLevel;
  template: string;
  weight: number;
}

// {n} = 랜덤 숫자, {id} = 랜덤 ID, {ms} = 랜덤 소요시간 → generator가 치환
export const SCENARIOS: Record<string, { version: string; specs: LogSpec[] }> = {
  normal: {
    version: "9f8e7d6",
    specs: [
      { level: "info", template: "Request handled in {ms}ms", weight: 9000 },
      { level: "info", template: "Cache warmed in {ms}ms", weight: 88 },
      { level: "info", template: "Payment processed for order {id}", weight: 2400 },
      { level: "warn", template: "Slow query {ms}ms", weight: 40 },
      { level: "error", template: "Timeout calling upstream", weight: 20 },
    ],
  },
  problem: {
    version: "a1b2c3d",
    specs: [
      { level: "info", template: "Request handled in {ms}ms", weight: 8800 },
      { level: "info", template: "Payment processed for order {id}", weight: 1100 },
      { level: "warn", template: "Slow query {ms}ms", weight: 60 },
      { level: "warn", template: "retrying request {n}/3", weight: 54 },
      { level: "error", template: "Timeout calling upstream", weight: 18 },
      { level: "error", template: "NullPointerException at /pay/charge.ts:{n}", weight: 142 },
      { level: "error", template: "payment gateway returned {n}", weight: 88 },
      { level: "error", template: "DB timeout after {ms}ms", weight: 210 },
    ],
  },
};