import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';

import { PipelineBoard, type PipelineBoardStage } from './pipeline-board.js';

afterEach(() => cleanup());

interface Subject {
  id: string;
  title: string;
}

const stages: PipelineBoardStage<Subject>[] = [
  {
    id: 's1',
    name: 'Applied',
    subjects: [{ id: 'a', title: 'Alice' }],
  },
  {
    id: 's2',
    name: 'Interview',
    subjects: [],
  },
];

describe('PipelineBoard', () => {
  it('renders one column per stage and renders the cards', () => {
    const { container } = render(
      <PipelineBoard
        stages={stages}
        getSubjectId={(s) => s.id}
        renderSubject={(s) => <div>{s.title}</div>}
      />,
    );
    const cols = container.querySelectorAll('[data-slot="pipeline-board-column"]');
    expect(cols.length).toBe(2);
    expect(container.textContent).toContain('Alice');
  });

  it('fires onMove with destination stage when a card is dropped', () => {
    const onMove = vi.fn();
    const { container } = render(
      <PipelineBoard
        stages={stages}
        getSubjectId={(s) => s.id}
        renderSubject={(s) => <div>{s.title}</div>}
        onMove={onMove}
      />,
    );
    const card = container.querySelector(
      '[data-slot="pipeline-board-card"]',
    ) as HTMLElement;
    const targetCol = container.querySelector(
      '[data-stage-id="s2"]',
    ) as HTMLElement;
    expect(card).toBeTruthy();
    expect(targetCol).toBeTruthy();

    const data: Record<string, string> = {};
    const dataTransfer = {
      setData: (k: string, v: string) => {
        data[k] = v;
      },
      getData: (k: string) => data[k] ?? '',
      effectAllowed: '' as string,
    } as unknown as DataTransfer;

    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(targetCol, { dataTransfer });
    fireEvent.drop(targetCol, { dataTransfer });

    expect(onMove).toHaveBeenCalledWith('a', 's2');
  });

  it('does not make cards draggable when onMove is omitted', () => {
    const { container } = render(
      <PipelineBoard
        stages={stages}
        getSubjectId={(s) => s.id}
        renderSubject={(s) => <div>{s.title}</div>}
      />,
    );
    const card = container.querySelector(
      '[data-slot="pipeline-board-card"]',
    ) as HTMLElement;
    expect(card.getAttribute('draggable')).toBe('false');
  });
});
