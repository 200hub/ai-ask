/**
 * Update utilities - expose IPC helpers and event listeners for the frontend.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { DownloadTask, ReleaseAsset } from "$lib/types/update";
import { UPDATE_EVENTS } from "$lib/utils/constants";
import { logger } from "$lib/utils/logger";

export interface CheckUpdateResponse {
  hasUpdate: boolean;
  latestVersion?: string;
  isPrerelease?: boolean;
  publishedAt?: string;
  releaseNotes?: string;
  releaseUrl?: string;
  assets: ReleaseAsset[];
}

export interface UpdateAvailableEvent {
  version: string;
  assets: ReleaseAsset[];
  publishedAt?: string;
  releaseNotes?: string;
  releaseUrl?: string;
}

export interface UpdateDownloadedEvent {
  version: string;
  taskId: string;
  filePath?: string;
}

/**
 * Trigger a manual update check.
 */
export async function checkUpdate(): Promise<CheckUpdateResponse | null> {
  try {
    return await invoke<CheckUpdateResponse>("check_update");
  } catch (error) {
    logger.warn("check update failed", error);
    return null;
  }
}

/**
 * Start downloading the selected update asset.
 */
export async function downloadUpdate(
  version: string,
  assetId: string,
): Promise<DownloadTask | null> {
  try {
    return await invoke<DownloadTask>("download_update", {
      version,
      assetId,
    });
  } catch (error) {
    logger.error("download update failed", error);
    return null;
  }
}

/**
 * Query download task status.
 */
export async function getDownloadStatus(taskId: string): Promise<DownloadTask | null> {
  try {
    return await invoke<DownloadTask>("get_download_status", { taskId });
  } catch (error) {
    logger.warn("get download status failed", error);
    return null;
  }
}

/**
 * Schedule installing the downloaded update on next launch.
 */
export async function scheduleInstall(taskId: string): Promise<boolean> {
  try {
    await invoke("schedule_install", { taskId });
    return true;
  } catch (error) {
    logger.error("schedule install failed", error);
    return false;
  }
}

/**
 * Launch installer immediately and exit the app.
 */
export async function installUpdateNow(taskId: string): Promise<boolean> {
  try {
    await invoke("install_update_now", { taskId });
    return true;
  } catch (error) {
    logger.error("install update now failed", error);
    return false;
  }
}

/**
 * 将 GitHub Release Notes 转换为简洁摘要，便于在 tooltip 或卡片中展示。
 *
 * @param notes - 原始更新内容（Markdown 文本）
 * @param maxLines - 摘要最大行数
 * @param maxLength - 摘要最大字符数
 */
export function summarizeReleaseNotes(
  notes: string | null | undefined,
  maxLines = 4,
  maxLength = 220,
): string | null {
  if (!notes) {
    return null;
  }

  const normalized = notes.replace(/\r\n/g, "\n");
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (!lines.length) {
    return null;
  }

  const bulletified = lines.map((line) => line.replace(/^[-*+]\s+/, "- "));
  let summary = bulletified.slice(0, maxLines).join("\n");

  if (summary.length > maxLength) {
    summary = `${summary.slice(0, maxLength - 1).trimEnd()}…`;
  }

  return summary;
}

/**
 * Pick the most appropriate release asset based on the User-Agent string.
 */
export function selectAssetForUserAgent(
  assets: ReleaseAsset[],
  userAgent?: string,
): ReleaseAsset | null {
  if (!assets.length) {
    return null;
  }

  const ua = userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  const lowerUA = ua.toLowerCase();

  const isWindows = lowerUA.includes("windows");
  const isMac = lowerUA.includes("mac");
  const isLinux = lowerUA.includes("linux");
  const isAndroid = lowerUA.includes("android");
  const isIos = lowerUA.includes("iphone") || lowerUA.includes("ipad") || lowerUA.includes("ios");
  const isArm64 = lowerUA.includes("arm64") || lowerUA.includes("aarch64");
  const isX64 =
    lowerUA.includes("x86_64") ||
    lowerUA.includes("amd64") ||
    lowerUA.includes("win64") ||
    lowerUA.includes("x64");

  const matches = (asset: ReleaseAsset) => {
    const platform = asset.platform;
    const arch = asset.arch;

    const platformOk =
      (isWindows && platform === "windows") ||
      (isMac && platform === "macos") ||
      (isLinux && platform === "linux") ||
      (isAndroid && platform === "android") ||
      (isIos && platform === "ios");

    if (!platformOk) {
      return false;
    }

    if (!arch || arch === "universal") {
      return true;
    }

    if (arch === "arm64") {
      return isArm64;
    }

    if (arch === "x64") {
      return isX64 || !isArm64;
    }

    return true;
  };

  return (
    assets.find(matches) ??
    assets.find((asset) => asset.platform === "windows") ??
    assets[0] ??
    null
  );
}

/**
 * Listen for update:available event.
 */
export async function onUpdateAvailable(
  handler: (payload: UpdateAvailableEvent) => void,
): Promise<UnlistenFn> {
  if (typeof window === "undefined") {
    return () => {};
  }

  const unlisten = await listen<UpdateAvailableEvent>(UPDATE_EVENTS.available, (event) =>
    handler(event.payload),
  );

  return unlisten;
}

/**
 * Listen for update:downloaded event.
 */
export async function onUpdateDownloaded(
  handler: (payload: UpdateDownloadedEvent) => void,
): Promise<UnlistenFn> {
  if (typeof window === "undefined") {
    return () => {};
  }

  const unlisten = await listen<UpdateDownloadedEvent>(UPDATE_EVENTS.downloaded, (event) =>
    handler(event.payload),
  );

  return unlisten;
}
