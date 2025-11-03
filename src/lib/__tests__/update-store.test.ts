import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

let updateStore: typeof import("$lib/stores/update.svelte")["updateStore"];

beforeEach(async () => {
  invoke.mockReset();
  vi.resetModules();
  ({ updateStore } = await import("$lib/stores/update.svelte"));
});

describe("updateStore", () => {
  it("initializes and triggers auto check when enabled", async () => {
    invoke.mockResolvedValue(undefined);

    await updateStore.init({
      currentVersion: "1.2.3",
      autoUpdate: true,
      proxy: { type: "system" },
    });

    expect(updateStore.status).toBe("checking");
    expect(invoke).toHaveBeenCalledWith("start_update_check", {
      currentVersion: "1.2.3",
      proxy: { type: "system" },
      manual: false,
    });
  });

  it("respects disabled auto update during init", async () => {
    invoke.mockResolvedValue(undefined);

    await updateStore.init({
      currentVersion: "1.2.3",
      autoUpdate: false,
      proxy: { type: "system" },
    });

    expect(updateStore.status).toBe("idle");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("handles availability and progress events", () => {
    updateStore.handleUpdateAvailable({ version: "2.0.0", notes: "notes" });
    expect(updateStore.status).toBe("available");
    expect(updateStore.latestVersion).toBe("2.0.0");

    updateStore.handleUpdateProgress({ percent: 0.42 });
    expect(updateStore.status).toBe("downloading");
    expect(updateStore.downloadProgress).toBe(42);

    updateStore.handleUpdateProgress({ downloaded: 25, total: 50 });
    expect(updateStore.downloadProgress).toBe(50);
  });

  it("starts and cancels download via backend commands", async () => {
    updateStore.handleUpdateAvailable({ version: "2.0.0" });
    invoke.mockResolvedValue(undefined);

    await updateStore.startDownload();
    expect(updateStore.status).toBe("downloading");
    expect(invoke).toHaveBeenNthCalledWith(1, "start_update_download", {
      version: "2.0.0",
      proxy: undefined,
    });

    invoke.mockResolvedValue(undefined);
    await updateStore.cancelDownload();
    expect(invoke).toHaveBeenNthCalledWith(2, "cancel_update_download");
    expect(updateStore.status).toBe("available");
  });

  it("marks update as downloaded and installs it", async () => {
    invoke.mockResolvedValue(undefined);
    updateStore.handleUpdateAvailable({ version: "2.0.0" });
    updateStore.handleUpdateDownloaded({ version: "2.0.0" });

    expect(updateStore.status).toBe("downloaded");
    expect(updateStore.pendingInstall).toBe(true);
    expect(updateStore.downloadProgress).toBe(100);

    await updateStore.installAndRestart();
    expect(invoke).toHaveBeenCalledWith("install_downloaded_update");
    expect(updateStore.status).toBe("idle");
    expect(updateStore.pendingInstall).toBe(false);
    expect(updateStore.latestVersion).toBeNull();
  });

  it("acknowledges installed updates", () => {
    updateStore.handleUpdateDownloaded({ version: "3.0.0" });
    expect(updateStore.status).toBe("downloaded");

    updateStore.acknowledgeInstalled();
    expect(updateStore.status).toBe("idle");
    expect(updateStore.pendingInstall).toBe(false);
    expect(updateStore.latestVersion).toBeNull();
  });

  it("records errors from failed update checks", async () => {
    invoke.mockRejectedValue(new Error("network"));

    await updateStore.checkForUpdates(true);

    expect(updateStore.status).toBe("error");
    expect(updateStore.error).toBe("network");
  });

  it("re-checks when auto update is re-enabled via sync", async () => {
    invoke.mockResolvedValue(undefined);

    await updateStore.init({ currentVersion: "1.0.0", autoUpdate: false });
    expect(invoke).not.toHaveBeenCalled();

    updateStore.syncConfig({ autoUpdate: true });

    expect(invoke).toHaveBeenCalledWith("start_update_check", {
      currentVersion: "1.0.0",
      proxy: undefined,
      manual: false,
    });
  });
});
