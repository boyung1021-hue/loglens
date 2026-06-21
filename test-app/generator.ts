// test-app/generator.ts
// 분포 → 로그 라인 배열 생성. 숫자/ID/타임스탬프를 매 라인 랜덤화해
// LogLens의 정규화 로직까지 자연스럽게 검증한다.

import { SCENARIOS, type LogLevel, type LogSpec } from "./scenarios";

export interface GeneratedLog {
  timestamp: string;
  level: LogLevel;
  message: string;
}

const rand = (n: number) => Math.floor(Math.random() * n);

function fill(template: string): string {
  return template
    .replace(/\{ms\}/g, () => String(10 + rand(5000)))
    .replace(/\{id\}/g, () => String(1000 + rand(9000)))
    .replace(/\{n\}/g, () => String(1 + rand(500)));
}

export function generateLogs(scenario: string): { version: string; lines: GeneratedLog[] } {
  const def = SCENARIOS[scenario];
  if (!def) throw new Error(`unknown scenario: ${scenario} (사용 가능: ${Object.keys(SCENARIOS).join(", ")})`);

  const lines: GeneratedLog[] = def.specs.flatMap((s: LogSpec) =>
    Array.from({ length: s.weight }, () => ({
      timestamp: new Date().toISOString(),
      level: s.level,
      message: fill(s.template), // 매 라인 숫자/ID 랜덤 → 정규화 검증
    })),
  );

  // 시간순 섞기(선택)
  for (let i = lines.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [lines[i], lines[j]] = [lines[j], lines[i]];
  }
  return { version: def.version, lines };
}