import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';

function setClipboard(value: unknown): void {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value });
}

function setExecCommand(fn: ((cmd: string) => boolean) | undefined): void {
  Object.defineProperty(document, 'execCommand', { configurable: true, writable: true, value: fn });
}

describe('copyText', () => {
  afterEach(() => {
    setClipboard(undefined);
    setExecCommand(undefined);
  });

  it('uses the Clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    await expect(copyText('hello')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('falls back to the copy command when the Clipboard API fails', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')) });
    let selected = '';
    setExecCommand((cmd) => {
      selected = (document.activeElement as HTMLTextAreaElement | null)?.value ?? '';
      return cmd === 'copy';
    });
    await expect(copyText('fallback')).resolves.toBe(true);
    expect(selected).toBe('fallback');
    // The helper textarea is removed again.
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('reports failure when nothing works', async () => {
    setClipboard(undefined);
    setExecCommand(() => false);
    await expect(copyText('x')).resolves.toBe(false);
    setExecCommand(undefined);
    await expect(copyText('x')).resolves.toBe(false);
  });
});
