import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIPlatform } from "$lib/types/platform";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const initialPlatforms: AIPlatform[] = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    icon: "chatgpt.svg",
    url: "https://chat.openai.com",
    enabled: true,
    isCustom: false,
    sortOrder: 2,
  },
  {
    id: "claude",
    name: "Claude",
    icon: "claude.svg",
    url: "https://claude.ai",
    enabled: true,
    isCustom: false,
    sortOrder: 1,
  },
  {
    id: "bing",
    name: "Bing",
    icon: "bing.svg",
    url: "https://bing.com",
    enabled: false,
    isCustom: true,
    sortOrder: 3,
  },
];

let platformData: AIPlatform[] = [];
let customIdCounter = 1;

const storageMocks = {
  getAIPlatforms: vi.fn(async () => clone(platformData)),
  saveAIPlatforms: vi.fn(async (platforms: AIPlatform[]) => {
    platformData = clone(platforms);
  }),
  addCustomPlatform: vi.fn(async (platform: Omit<AIPlatform, "id" | "isCustom" | "sortOrder">) => {
    const newPlatform: AIPlatform = {
      ...platform,
      id: `custom_${customIdCounter++}`,
      isCustom: true,
      sortOrder: platformData.length + 1,
    };
    platformData = [...platformData, newPlatform];
    return clone(newPlatform);
  }),
  updateAIPlatform: vi.fn(async (id: string, updates: Partial<AIPlatform>) => {
    const index = platformData.findIndex((item) => item.id === id);
    if (index !== -1) {
      platformData[index] = { ...platformData[index], ...updates };
    }
  }),
  deleteAIPlatform: vi.fn(async (id: string) => {
    platformData = platformData.filter((item) => item.id !== id);
  }),
};

vi.mock("$lib/utils/storage", () => storageMocks);

let platformsStore: (typeof import("$lib/stores/platforms.svelte"))["platformsStore"];

beforeEach(async () => {
  platformData = clone(initialPlatforms);
  customIdCounter = 1;

  storageMocks.getAIPlatforms.mockClear();
  storageMocks.saveAIPlatforms.mockClear();
  storageMocks.addCustomPlatform.mockClear();
  storageMocks.updateAIPlatform.mockClear();
  storageMocks.deleteAIPlatform.mockClear();

  vi.resetModules();
  ({ platformsStore } = await import("$lib/stores/platforms.svelte"));
  await platformsStore.init();
});

describe("PlatformsStore", () => {
  it("normalizes sort order during init", () => {
    expect(platformsStore.platforms.map((p) => p.id)).toEqual(["claude", "chatgpt", "bing"]);
    expect(platformsStore.platforms.map((p) => p.sortOrder)).toEqual([1, 2, 3]);
  });

  it("computes enabled platforms in sort order", () => {
    const enabled = platformsStore.enabledPlatforms;
    expect(enabled.map((p) => p.id)).toEqual(["claude", "chatgpt"]);
  });

  it("toggles platform enabled flag and persists", async () => {
    await platformsStore.togglePlatform("chatgpt");

    expect(storageMocks.updateAIPlatform).toHaveBeenCalledWith("chatgpt", { enabled: false });
    expect(platformsStore.getPlatformById("chatgpt")?.enabled).toBe(false);
  });

  it("adds custom platform with ordered placement", async () => {
    const custom = await platformsStore.addPlatform({
      name: "Custom",
      icon: "custom.svg",
      url: "https://custom.ai",
      enabled: true,
      userAgent: "",
    });

    expect(custom.isCustom).toBe(true);
    expect(platformsStore.platforms).toHaveLength(4);
    expect(platformsStore.platforms.at(-1)?.id).toBe(custom.id);
    expect(custom.sortOrder).toBe(4);
  });

  it("reorders platforms and normalizes sort indices", async () => {
    const shuffled = platformsStore.platforms.map((platform, index) => ({
      ...platform,
      sortOrder: index === 2 ? 0 : 5,
    }));

    await platformsStore.reorderPlatforms(shuffled);

    expect(storageMocks.saveAIPlatforms).toHaveBeenCalled();
    expect(platformsStore.platforms.map((p) => p.sortOrder)).toEqual([1, 2, 3]);
  });

  it("moves platform down and persists ordering", async () => {
    await platformsStore.movePlatform("claude", "down");

    expect(storageMocks.saveAIPlatforms).toHaveBeenCalled();
    expect(platformsStore.getPlatformById("claude")?.sortOrder).toBe(2);
    expect(platformsStore.getPlatformById("chatgpt")?.sortOrder).toBe(1);
    expect(platformsStore.enabledPlatforms.map((p) => p.id)).toEqual(["chatgpt", "claude"]);
  });

  it("prevents moving platform beyond bounds", async () => {
    await platformsStore.movePlatform("bing", "down");
    expect(storageMocks.saveAIPlatforms).not.toHaveBeenCalled();
  });

  it("removes custom platform only", async () => {
    const custom = await platformsStore.addPlatform({
      name: "Temp",
      icon: "temp.svg",
      url: "https://temp.ai",
      enabled: true,
      userAgent: "",
    });

    await platformsStore.removePlatform(custom.id);
    expect(platformsStore.getPlatformById(custom.id)).toBeUndefined();

    await expect(platformsStore.removePlatform("chatgpt")).rejects.toThrow("只能删除自定义平台");
  });
});
