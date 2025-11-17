/**
 * Translation helpers test suite
 */

import { describe, it, expect } from "vitest";
import {
  buildTranslationUrl,
  getTargetLangCode,
  isPlatformLocaleSupported,
  retryTranslation,
} from "../utils/translation-helpers";

describe("Translation Helpers", () => {
  describe("buildTranslationUrl", () => {
    it("should build Google Translate URL with target language", () => {
      const url = buildTranslationUrl("google", "https://translate.google.com", "zh-CN");
      expect(url).toContain("sl=auto");
      expect(url).toContain("tl=zh-CN");
    });

    it("should build DeepL URL with target language", () => {
      const url = buildTranslationUrl("deepl", "https://www.deepl.com", "en-US");
      expect(url).toContain("#auto/en/");
    });

    it("should build Baidu URL with target language", () => {
      const url = buildTranslationUrl("baidu", "https://fanyi.baidu.com", "ja-JP");
      expect(url).toContain("#auto/jp");
    });

    it("should build Bing URL with target language", () => {
      const url = buildTranslationUrl("bing", "https://www.bing.com/translator", "ko-KR");
      expect(url).toContain("from=auto-detect");
      expect(url).toContain("to=ko");
    });

    it("should return base URL for Youdao (no URL params)", () => {
      const baseUrl = "https://fanyi.youdao.com";
      const url = buildTranslationUrl("youdao", baseUrl, "zh-CN");
      expect(url).toBe(baseUrl);
    });

    it("should include source text in URL for Google", () => {
      const url = buildTranslationUrl("google", "", "en-US", "Hello World");
      expect(url).toContain("text=Hello%20World");
    });
  });

  describe("getTargetLangCode", () => {
    it("should return correct language code for Google", () => {
      expect(getTargetLangCode("google", "zh-CN")).toBe("zh-CN");
      expect(getTargetLangCode("google", "en-US")).toBe("en");
      expect(getTargetLangCode("google", "ja-JP")).toBe("ja");
    });

    it("should return correct language code for DeepL", () => {
      expect(getTargetLangCode("deepl", "zh-CN")).toBe("zh");
      expect(getTargetLangCode("deepl", "en-US")).toBe("en");
    });

    it("should return correct language code for Baidu", () => {
      expect(getTargetLangCode("baidu", "ja-JP")).toBe("jp");
      expect(getTargetLangCode("baidu", "ko-KR")).toBe("kor");
    });

    it("should return correct language code for Bing", () => {
      expect(getTargetLangCode("bing", "zh-CN")).toBe("zh-Hans");
    });

    it("should return undefined for unsupported locale", () => {
      // @ts-expect-error Testing invalid locale
      expect(getTargetLangCode("google", "xx-XX")).toBeUndefined();
    });
  });

  describe("isPlatformLocaleSupported", () => {
    it("should return true for supported locales", () => {
      expect(isPlatformLocaleSupported("google", "zh-CN")).toBe(true);
      expect(isPlatformLocaleSupported("deepl", "en-US")).toBe(true);
      expect(isPlatformLocaleSupported("baidu", "ja-JP")).toBe(true);
    });

    it("should return false for unsupported locales", () => {
      // @ts-expect-error Testing invalid locale
      expect(isPlatformLocaleSupported("google", "xx-XX")).toBe(false);
    });
  });

  describe("retryTranslation", () => {
    it("should return result on first success", async () => {
      const fn = async () => "Success";
      const result = await retryTranslation(fn, 3, 100);
      expect(result).toBe("Success");
    });

    it("should retry on empty result", async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        return attempts < 2 ? "" : "Success";
      };
      const result = await retryTranslation(fn, 3, 10);
      expect(result).toBe("Success");
      expect(attempts).toBe(2);
    });

    it("should throw after max retries", async () => {
      const fn = async () => {
        throw new Error("Always fails");
      };
      await expect(retryTranslation(fn, 2, 10)).rejects.toThrow("Always fails");
    });

    it("should use exponential backoff", async () => {
      const startTime = Date.now();
      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 3) throw new Error("Not ready");
        return "Success";
      };

      await retryTranslation(fn, 3, 50);
      const duration = Date.now() - startTime;

      // Should take at least 50 + 100 = 150ms (exponential backoff: 50*2^0 + 50*2^1)
      expect(duration).toBeGreaterThanOrEqual(100);
      expect(attempts).toBe(3);
    });
  });
});
