import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, renderHook, cleanup } from '@testing-library/react';
import { useEscapeKey } from './use-escape-key.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useEscapeKey', () => {
  it('fires on Escape when document.body has focus', () => {
    const onEscape = vi.fn();
    renderHook(() => useEscapeKey(onEscape));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('does not fire when target is an <input>', () => {
    const onEscape = vi.fn();
    renderHook(() => useEscapeKey(onEscape));

    const { getByTestId } = render(<input data-testid="i" />);
    const input = getByTestId('i') as HTMLInputElement;
    input.focus();
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onEscape).not.toHaveBeenCalled();
  });

  it('does not fire when an element with role="dialog" is in the DOM', () => {
    const onEscape = vi.fn();
    renderHook(() => useEscapeKey(onEscape));

    render(<div role="dialog">hi</div>);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onEscape).not.toHaveBeenCalled();
  });

  it('updates callback via ref without re-attaching the listener', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    const first = vi.fn();
    const second = vi.fn();

    const { rerender } = renderHook(({ cb }: { cb: () => void }) => useEscapeKey(cb), {
      initialProps: { cb: first },
    });

    const initialAddCalls = addSpy.mock.calls.filter((c) => c[0] === 'keydown').length;

    rerender({ cb: second });

    const afterRerenderAddCalls = addSpy.mock.calls.filter(
      (c) => c[0] === 'keydown',
    ).length;
    const afterRerenderRemoveCalls = removeSpy.mock.calls.filter(
      (c) => c[0] === 'keydown',
    ).length;

    expect(afterRerenderAddCalls).toBe(initialAddCalls);
    expect(afterRerenderRemoveCalls).toBe(0);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
