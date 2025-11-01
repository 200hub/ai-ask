import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../utils/logger", () => {
  return {
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
});

// Use relative path import to the module under test
import { injectQuestionToPlatform, isPlatformSupported, getSupportedPlatforms, generateInjectionScript, getPlatformStrategy } from "../utils/injection";
import * as core from "@tauri-apps/api/core";

describe("injection utils", () => {
  beforeEach(() => {
    (core.invoke as unknown as { mockClear: () => void }).mockClear();
  });

  it("reports supported platforms", () => {
    const supported = getSupportedPlatforms();
    expect(Array.isArray(supported)).toBe(true);
    expect(isPlatformSupported("chatgpt")).toBe(true);
  });

  it("invokes inject_question_to_platform with generated script", async () => {
    await injectQuestionToPlatform("chatgpt", "Hello?");

    // First call should be the injection command; subsequent calls may poll for status
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls = (core.invoke as any).mock.calls as any[];
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const call = calls[0];
    expect(call[0]).toBe("inject_question_to_platform");
    const payload = call[1].payload;
    expect(payload.platform_id).toBe("chatgpt");
    expect(typeof payload.script).toBe("string");
  expect(payload.script).toContain("#prompt-textarea");
  expect(payload.script).toContain("send-button");
  });

  it("throws for unsupported platform", async () => {
    await expect(injectQuestionToPlatform("unknown-platform", "Q")).rejects.toThrow(
      /not yet supported/i,
    );
  });

  it("generates script with proper escaping for special characters", () => {
    const strategy = getPlatformStrategy("chatgpt")!;
    const script = generateInjectionScript(strategy, `a"b'c\\d\n`);
    // Script should include escaped JSON string of the question
    expect(script).toContain(JSON.stringify(`a"b'c\\d\n`));
  });
});
