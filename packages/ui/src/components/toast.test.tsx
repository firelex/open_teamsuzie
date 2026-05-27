import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';

import { ToastProvider, useToast } from './toast.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function wrapper({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

describe('useToast', () => {
  it('show() makes the message appear in the DOM', () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => {
      result.current.show('hi');
    });
    expect(document.body.textContent).toContain('hi');
  });

  it('auto-dismisses after durationMs', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => {
      result.current.show('byebye', { durationMs: 1000 });
    });
    expect(document.body.textContent).toContain('byebye');
    act(() => {
      vi.advanceTimersByTime(1001);
    });
    expect(document.body.textContent).not.toContain('byebye');
  });

  it('durationMs: 0 stays sticky', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => {
      result.current.show('forever', { durationMs: 0 });
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(document.body.textContent).toContain('forever');
  });

  it('stacks multiple toasts', () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => {
      result.current.show('one', { durationMs: 0 });
      result.current.show('two', { durationMs: 0 });
    });
    const statuses = document.querySelectorAll('[role="status"]');
    expect(statuses).toHaveLength(2);
    expect(document.body.textContent).toContain('one');
    expect(document.body.textContent).toContain('two');
  });

  it('applies the variant data attribute', () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => {
      result.current.show('done', { variant: 'success', durationMs: 0 });
    });
    const status = document.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.getAttribute('data-variant')).toBe('success');
    // CheckCircle2 lucide icon renders an aria-hidden <svg>.
    expect(status?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('action button fires the callback and dismisses the toast', () => {
    const onClick = vi.fn();
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => {
      result.current.show('saved', {
        durationMs: 0,
        action: { label: 'Undo', onClick },
      });
    });
    const btn = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent === 'Undo',
    );
    expect(btn).toBeDefined();
    act(() => {
      fireEvent.click(btn!);
    });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain('saved');
  });

  it('close button dismisses the toast', () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => {
      result.current.show('closeme', { durationMs: 0 });
    });
    const closeBtn = document.querySelector(
      'button[aria-label="Dismiss"]',
    ) as HTMLButtonElement | null;
    expect(closeBtn).not.toBeNull();
    act(() => {
      fireEvent.click(closeBtn!);
    });
    expect(document.body.textContent).not.toContain('closeme');
  });

  it('outside a provider returns a no-op and warns in dev', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => useToast());
    expect(typeof result.current.show).toBe('function');
    // Calling it should not throw and not render anything.
    expect(() => result.current.show('nothing')).not.toThrow();
    expect(document.body.textContent).not.toContain('nothing');
    expect(warn).toHaveBeenCalled();
  });
});
