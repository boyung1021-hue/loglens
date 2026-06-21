import { createHash } from "node:crypto";

/**
 * 로그 패턴 엔진 — 순수 함수만 모았다 (DB/네트워크/시간 의존 없음).
 *
 * 파이프라인: normalize → fingerprint → aggregate
 *   1) normalize  : 가변값을 토큰으로 치환해 "같은 의미의 로그"를 하나의 템플릿으로 묶는다.
 *   2) fingerprint: 템플릿 + 레벨을 짧은 해시로 만들어 패턴의 고유 ID로 쓴다.
 *   3) aggregate  : 로그 배치를 fingerprint별로 묶어 배포별 통계를 만들고 원본은 버린다.
 *
 * 출처/규칙: docs/05-drift-detection.md
 */

export type LogLevel = "info" | "warn" | "error";

/** ingest로 들어오는 한 줄. level이 없으면 info로 간주한다. */
export interface LogLine {
  message: string;
  level?: LogLevel;
  /** ISO-8601 타임스탬프 (옵션). first/last seen 집계에 쓰인다. */
  timestamp?: string;
}

/** fingerprint별 집계 결과. pattern_stats / log_patterns upsert의 입력이 된다. */
export interface PatternAgg {
  fingerprint: string;
  template: string;
  level: LogLevel;
  count: number;
  /** level === "error" 인 라인 수 (그룹 내 레벨은 동일하므로 0 또는 count). */
  errorCount: number;
  /** 대표 원본 1줄 (옵션, PII 주의). */
  sample?: string;
  /** 이 패턴이 배치 내에서 처음/마지막 등장한 시각 (타임스탬프가 있을 때만). */
  firstSeen?: string;
  lastSeen?: string;
}

/**
 * 정규화 규칙. 순서가 중요하다 — 위에서부터 차례로 적용된다.
 * (예: "<NUM>ms"가 일반 "<NUM>"보다 먼저 와야 소요시간이 보존된다.)
 */
const RULES: [RegExp, string][] = [
  [/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}\S*/g, "<TS>"], // 타임스탬프
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<UUID>"],
  [/\b\d+\.\d+\.\d+\.\d+\b/g, "<IP>"], // IP
  [/\/[\w\-./]+/g, "<PATH>"], // 경로
  [/\b\d+ms\b/g, "<NUM>ms"], // 소요시간
  [/\b\d+\b/g, "<NUM>"], // 일반 숫자/ID
  [/0x[0-9a-f]+/gi, "<HEX>"],
  [/"[^"]*"/g, '"<STR>"'], // 따옴표 문자열
];

/**
 * 로그 메시지를 템플릿으로 정규화한다.
 * 가변값(타임스탬프/UUID/IP/경로/숫자 등)을 토큰으로 치환하고 공백을 정리한 뒤 500자로 자른다.
 */
export function normalize(message: string): string {
  let t = message.trim();
  for (const [re, token] of RULES) t = t.replace(re, token);
  return t.replace(/\s+/g, " ").slice(0, 500);
}

/**
 * 템플릿 + 레벨로 16자 해시를 만든다. 같은 패턴이면 항상 같은 fingerprint.
 * 레벨을 포함하므로 같은 문구라도 info/error는 서로 다른 패턴이 된다.
 */
export function fingerprint(template: string, level: string): string {
  return createHash("sha1").update(`${level}|${template}`).digest("hex").slice(0, 16);
}

/**
 * 로그 배치를 fingerprint별로 묶어 패턴 통계 배열로 집계한다.
 * 원본 라인은 여기서 버린다 (sample 1줄만 대표로 남긴다).
 */
export function aggregate(logs: LogLine[]): PatternAgg[] {
  const map = new Map<string, PatternAgg>();

  for (const { message, level = "info", timestamp } of logs) {
    const template = normalize(message);
    const fp = fingerprint(template, level);

    const existing = map.get(fp);
    if (existing) {
      existing.count += 1;
      if (level === "error") existing.errorCount += 1;
      // ISO-8601(UTC) 문자열은 사전순 비교가 곧 시간순 비교다.
      if (timestamp) {
        if (existing.firstSeen === undefined || timestamp < existing.firstSeen) {
          existing.firstSeen = timestamp;
        }
        if (existing.lastSeen === undefined || timestamp > existing.lastSeen) {
          existing.lastSeen = timestamp;
        }
      }
    } else {
      map.set(fp, {
        fingerprint: fp,
        template,
        level,
        count: 1,
        errorCount: level === "error" ? 1 : 0,
        sample: message,
        firstSeen: timestamp,
        lastSeen: timestamp,
      });
    }
  }

  return [...map.values()];
}