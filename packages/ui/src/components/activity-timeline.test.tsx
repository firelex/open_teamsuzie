import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { ActivityTimeline, type TimelineEntry } from './activity-timeline.js';

afterEach(() => cleanup());

describe('ActivityTimeline', () => {
  it('renders the empty label when no entries are supplied', () => {
    render(<ActivityTimeline entries={[]} emptyLabel="nothing yet" />);
    expect(screen.getByText('nothing yet')).toBeTruthy();
  });

  it('renders one li per entry with kind data-attribute', () => {
    const entries: TimelineEntry[] = [
      { id: '1', kind: 'created', summary: 'Created' },
      { id: '2', kind: 'comment.added', summary: 'Commented' },
    ];
    const { container } = render(<ActivityTimeline entries={entries} />);
    const items = container.querySelectorAll('[data-slot="activity-timeline-entry"]');
    expect(items.length).toBe(2);
    expect(items[0].getAttribute('data-kind')).toBe('created');
    expect(items[1].getAttribute('data-kind')).toBe('comment.added');
  });

  it('uses kindRenderer when supplied', () => {
    const entries: TimelineEntry[] = [
      { id: '1', kind: 'stage.moved', summary: 'Moved' },
    ];
    render(
      <ActivityTimeline
        entries={entries}
        kindRenderer={(k) =>
          k === 'stage.moved' ? { icon: <span>🚀</span> } : null
        }
      />,
    );
    expect(screen.getByText('🚀')).toBeTruthy();
  });
});
