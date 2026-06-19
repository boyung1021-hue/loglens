import { describe, expect, it } from "vitest";
import { aggregate, fingerprint, normalize } from "@/lib/pattern-engine";

describe("normalize", () => {
  it("문서 예시: 숫자/IP/소요시간을 토큰으로 치환한다", () => {
    expect(normalize("User 12345 login failed from 10.0.3.2 in 320ms")).toBe(
      "User <NUM> login failed from <IP> in <NUM>ms",
    );
  });

  it("값만 다른 같은 의미의 로그는 동일한 템플릿이 된다", () => {
    const a = normalize("User 12345 login failed from 10.0.3.2 in 320ms");
    const b = normalize("User 67890 login failed from 10.0.7.9 in 88ms");
    expect(a).toBe(b);
  });

  it("타임스탬프를 <TS>로 치환한다", () => {
    expect(normalize("2026-06-20T10:23:45.123Z request received")).toBe("<TS> request received");
    expect(normalize("2026-06-20 10:23:45 request received")).toBe("<TS> request received");
  });

  it("UUID를 <UUID>로 치환한다 (대소문자 무관)", () => {
    expect(normalize("order 550E8400-E29B-41D4-A716-446655440000 created")).toBe(
      "order <UUID> created",
    );
  });

  it("경로를 <PATH>로 치환한다", () => {
    expect(normalize("GET /api/users/123/posts 200")).toBe("GET <PATH> <NUM>");
  });

  it("소요시간 <NUM>ms는 일반 <NUM>보다 우선 적용된다", () => {
    expect(normalize("done in 450ms")).toBe("done in <NUM>ms");
  });

  it("16진수를 <HEX>로 치환한다", () => {
    expect(normalize("addr 0x1a2b3c freed")).toBe("addr <HEX> freed");
  });

  it("따옴표 문자열을 <STR>로 치환한다", () => {
    expect(normalize('config "prod-east-1" loaded')).toBe('config "<STR>" loaded');
  });

  it("여러 공백을 하나로 정리하고 트림한다", () => {
    expect(normalize("  too    many   spaces  ")).toBe("too many spaces");
  });

  it("최대 500자로 자른다", () => {
    expect(normalize("x".repeat(600)).length).toBe(500);
  });
});

describe("fingerprint", () => {
  it("같은 (템플릿, 레벨)은 항상 같은 해시를 낸다", () => {
    expect(fingerprint("User <NUM> failed", "error")).toBe(fingerprint("User <NUM> failed", "error"));
  });

  it("레벨이 다르면 해시가 다르다", () => {
    expect(fingerprint("User <NUM> failed", "info")).not.toBe(
      fingerprint("User <NUM> failed", "error"),
    );
  });

  it("템플릿이 다르면 해시가 다르다", () => {
    expect(fingerprint("a", "info")).not.toBe(fingerprint("b", "info"));
  });

  it("16자 16진수 해시를 반환한다", () => {
    expect(fingerprint("anything", "info")).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("aggregate", () => {
  it("값만 다른 같은 패턴 로그를 하나로 묶어 센다", () => {
    const result = aggregate([
      { message: "User 1 login failed in 10ms", level: "error" },
      { message: "User 2 login failed in 20ms", level: "error" },
      { message: "User 3 login failed in 30ms", level: "error" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(3);
    expect(result[0].errorCount).toBe(3);
    expect(result[0].template).toBe("User <NUM> login failed in <NUM>ms");
  });

  it("같은 문구라도 레벨이 다르면 별개 패턴으로 나뉜다", () => {
    const result = aggregate([
      { message: "cache miss", level: "info" },
      { message: "cache miss", level: "warn" },
    ]);
    expect(result).toHaveLength(2);
  });

  it("errorCount는 error 레벨 라인만 센다", () => {
    const result = aggregate([
      { message: "ok", level: "info" },
      { message: "ok", level: "info" },
    ]);
    expect(result[0].count).toBe(2);
    expect(result[0].errorCount).toBe(0);
  });

  it("level이 없으면 info로 간주한다", () => {
    const result = aggregate([{ message: "no level here" }]);
    expect(result[0].level).toBe("info");
  });

  it("대표 sample로 첫 원본 라인을 남긴다", () => {
    const result = aggregate([
      { message: "User 1 hit /a", level: "info" },
      { message: "User 2 hit /b", level: "info" },
    ]);
    expect(result[0].sample).toBe("User 1 hit /a");
  });

  it("빈 배치는 빈 배열을 반환한다", () => {
    expect(aggregate([])).toEqual([]);
  });
});