import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import {
  EditablePropertyList,
  type EditablePropertyDescriptor,
} from './property-panel.js';

afterEach(() => cleanup());

describe('EditablePropertyList', () => {
  it('renders read-only display of each property', () => {
    const properties: EditablePropertyDescriptor[] = [
      { key: 'name', label: 'Name', value: 'Acme' },
      { key: 'count', label: 'Count', value: 12, type: 'number' },
    ];
    render(<EditablePropertyList properties={properties} />);
    expect(screen.getByText('Acme')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
  });

  it('uses renderValue when provided', () => {
    const properties: EditablePropertyDescriptor[] = [
      {
        key: 'status',
        label: 'Status',
        value: 'open',
        renderValue: (v) => <span data-testid="custom">{String(v).toUpperCase()}</span>,
      },
    ];
    render(<EditablePropertyList properties={properties} />);
    expect(screen.getByTestId('custom').textContent).toBe('OPEN');
  });

  it('commits via Enter and fires onChange when the value changes', () => {
    const onChange = vi.fn();
    const properties: EditablePropertyDescriptor[] = [
      { key: 'name', label: 'Name', value: 'Acme' },
    ];
    const { container } = render(
      <EditablePropertyList properties={properties} onChange={onChange} />,
    );
    const display = container.querySelector(
      '[data-slot="editable-property-display"]',
    ) as HTMLElement;
    fireEvent.click(display);
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'NewCorp' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('name', 'NewCorp');
  });

  it('readOnly properties stay non-editable', () => {
    const properties: EditablePropertyDescriptor[] = [
      { key: 'id', label: 'ID', value: 'abc', readOnly: true },
    ];
    const { container } = render(<EditablePropertyList properties={properties} />);
    const display = container.querySelector(
      '[data-slot="editable-property-display"]',
    ) as HTMLButtonElement;
    expect(display.disabled).toBe(true);
    fireEvent.click(display);
    expect(container.querySelector('input')).toBeNull();
  });

  it('Escape cancels the edit without firing onChange', () => {
    const onChange = vi.fn();
    const properties: EditablePropertyDescriptor[] = [
      { key: 'name', label: 'Name', value: 'Acme' },
    ];
    const { container } = render(
      <EditablePropertyList properties={properties} onChange={onChange} />,
    );
    fireEvent.click(
      container.querySelector('[data-slot="editable-property-display"]')!,
    );
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'OopsCo' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onChange).not.toHaveBeenCalled();
  });
});
