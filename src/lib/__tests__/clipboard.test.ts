import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

import { copyTextToClipboard } from '$lib/utils/clipboard';

const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
let originalExecCommand: typeof document.execCommand | undefined;

function mockNavigator(writeTextImpl: ReturnType<typeof vi.fn>): void {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      clipboard: {
        writeText: writeTextImpl,
      },
    } as Navigator,
  });
}

function restoreNavigator(): void {
  if (originalNavigatorDescriptor) {
    Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
  } else {
    delete (globalThis as { navigator?: Navigator }).navigator;
  }
}

function mockExecCommand(spy: ReturnType<typeof vi.fn>): void {
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: spy,
  });
}

describe('copyTextToClipboard', () => {
  beforeEach(() => {
    originalExecCommand = document.execCommand;
  });

  afterEach(() => {
    restoreNavigator();
    if (originalExecCommand) {
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        value: originalExecCommand,
      });
    } else {
      delete (document as { execCommand?: typeof document.execCommand }).execCommand;
    }
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('uses navigator.clipboard when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockNavigator(writeText);

    await copyTextToClipboard('Hello');

    expect(writeText).toHaveBeenCalledWith('Hello');
  });

  it('falls back to execCommand when navigator.clipboard fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    const execCommand = vi.fn().mockReturnValue(true);
    mockNavigator(writeText);
    mockExecCommand(execCommand);

    await copyTextToClipboard('Fallback');

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('throws when no clipboard mechanism succeeds', async () => {
    const execCommand = vi.fn().mockReturnValue(false);
    mockExecCommand(execCommand);
    mockNavigator(vi.fn().mockRejectedValue(new Error('denied')));

    await expect(copyTextToClipboard('Fail')).rejects.toThrow('document.execCommand copy failed');
  });
});
