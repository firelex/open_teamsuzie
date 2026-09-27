import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { EmailAttachmentChip } from './email-attachment-chip.js';
import { EmailThreadView, type EmailThreadMessage } from './email-thread-view.js';

afterEach(() => cleanup());

const message = (over: Partial<EmailThreadMessage>): EmailThreadMessage => ({
  id: 'm1', fromName: 'Anna Reed', from: 'anna@sterlingrowe.com', to: ['me@firm.com'], cc: [],
  sentAt: '2026-09-20T09:00:00Z', html: null, text: 'Hello', quotedFrom: null, attachments: [], unread: false,
  ...over,
});

const older = message({ id: 'm1', text: 'First message', sentAt: '2026-09-20T09:00:00Z' });
const newer = message({ id: 'm2', fromName: 'Ben Cole', from: 'ben@hawk.com', text: 'Agreed.\nOn Sun, Anna wrote:\n> First message', quotedFrom: 8, sentAt: '2026-09-21T09:00:00Z' });

describe('EmailThreadView', () => {
  it('shows the newest message first in latest-first order', () => {
    const { container } = render(<EmailThreadView messages={[older, newer]} order="latest_first" renderHtml={() => null} />);
    const ids = [...container.querySelectorAll('[data-slot="email-message"]')].map((e) => e.getAttribute('data-message-id'));
    expect(ids).toEqual(['m2', 'm1']);
  });

  it('keeps the given order in oldest-first order', () => {
    const { container } = render(<EmailThreadView messages={[newer, older]} order="oldest_first" renderHtml={() => null} />);
    const ids = [...container.querySelectorAll('[data-slot="email-message"]')].map((e) => e.getAttribute('data-message-id'));
    expect(ids).toEqual(['m1', 'm2']);
  });

  it('hides the quoted history until asked', () => {
    render(<EmailThreadView messages={[newer]} order="latest_first" renderHtml={() => null} />);
    expect(screen.queryByText(/On Sun, Anna wrote/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show quoted text' }));
    expect(screen.getByText(/On Sun, Anna wrote/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide quoted text' })).toBeTruthy();
  });

  it('offers no quote toggle when the message quotes nothing', () => {
    render(<EmailThreadView messages={[older]} order="latest_first" renderHtml={() => null} />);
    expect(screen.queryByRole('button', { name: 'Show quoted text' })).toBeNull();
  });

  it('shows the sender, recipients and copy list in the header', () => {
    render(<EmailThreadView messages={[message({ cc: ['cara@hawk.com'] })]} order="latest_first" renderHtml={() => null} />);
    expect(screen.getByText('Anna Reed')).toBeTruthy();
    expect(screen.getByText('<anna@sterlingrowe.com>')).toBeTruthy();
    expect(screen.getByText('me@firm.com')).toBeTruthy();
    expect(screen.getByText('cara@hawk.com')).toBeTruthy();
  });

  it('hands HTML bodies to the host to mount, and never mounts HTML itself', () => {
    const renderHtml = vi.fn((html: string) => <div data-testid="host-html">{html.length}</div>);
    render(<EmailThreadView messages={[message({ html: '<p>Hi</p>', text: 'Hi' })]} order="latest_first" renderHtml={renderHtml} />);
    expect(renderHtml).toHaveBeenCalledWith('<p>Hi</p>');
    expect(screen.getByTestId('host-html')).toBeTruthy();
  });

  it('opens an attachment by its id, even when two share a file name', () => {
    const onOpen = vi.fn();
    render(<EmailThreadView messages={[message({ attachments: [
      { id: 'a1', filename: 'image001.png', contentType: 'image/png', size: 100 },
      { id: 'a2', filename: 'image001.png', contentType: 'image/png', size: 200 },
    ] })]} order="latest_first" renderHtml={() => null} onOpenAttachment={onOpen} />);
    fireEvent.click(screen.getAllByRole('button', { name: /image001\.png/ })[1]!);
    expect(onOpen).toHaveBeenCalledWith('m1', 'a2');
  });

  it('marks unread messages', () => {
    const { container } = render(<EmailThreadView messages={[message({ unread: true })]} order="latest_first" renderHtml={() => null} />);
    expect(container.querySelector('[data-slot="email-message"]')!.getAttribute('data-unread')).toBe('true');
  });
});

describe('EmailAttachmentChip', () => {
  it('shows the kind of file and its size', () => {
    render(<EmailAttachmentChip filename="Disclosure letter.pdf" size={1536} />);
    expect(screen.getByText('PDF')).toBeTruthy();
    expect(screen.getByText(/1\.5 KB/)).toBeTruthy();
  });

  it('is not a button when nothing can open it', () => {
    render(<EmailAttachmentChip filename="notes.txt" size={null} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
