/**
 * Which keys a route may press. Webmail keyboard shortcuts are stable but some are destructive (Delete, Gmail's
 * "e" and "#"), so routes may only press navigation keys and the shortcuts that open a new message, a reply or the
 * search box. A key that sends (Ctrl/Cmd+Enter, Alt+S) may only be pressed as the operation's commit step.
 */
export type KeyKind = 'safe' | 'send' | 'forbidden';

const NAVIGATION = new Set(['enter', 'tab', 'escape', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'home', 'end', 'pageup', 'pagedown']);
/** Single keys webmails use to start a message, a reply or a search (Outlook N and R, Gmail C and R, both /). */
const SINGLE_SHORTCUTS = new Set(['n', 'r', 'c', '/']);
/** With Ctrl or Cmd: new message (N) and reply (R); with Shift too: reply all. */
const COMMAND_SHORTCUTS = new Set(['n', 'r']);

const MODIFIERS: Record<string, string> = {
    control: 'command', ctrl: 'command', meta: 'command', cmd: 'command', command: 'command', controlormeta: 'command',
    alt: 'alt', option: 'alt', shift: 'shift',
};

export function keyKind(key: string): KeyKind {
    const parts = key.split('+').map((p) => p.trim().toLowerCase());
    const main = parts.pop() ?? '';
    if (main === '') return 'forbidden';
    const modifiers = new Set<string>();
    for (const part of parts) {
        const modifier = MODIFIERS[part];
        if (modifier === undefined) return 'forbidden';
        modifiers.add(modifier);
    }
    const only = (...wanted: string[]) => modifiers.size === wanted.length && wanted.every((m) => modifiers.has(m));
    if (main === 'enter' && only('command')) return 'send';
    if (main === 's' && only('alt')) return 'send';
    if (NAVIGATION.has(main) && (modifiers.size === 0 || (main === 'tab' && only('shift')))) return 'safe';
    if (SINGLE_SHORTCUTS.has(main) && modifiers.size === 0) return 'safe';
    if (COMMAND_SHORTCUTS.has(main) && (only('command') || (main === 'r' && only('command', 'shift')))) return 'safe';
    // Outlook's search box.
    if (main === 'q' && only('alt')) return 'safe';
    return 'forbidden';
}

export const ALLOWED_KEYS_DESCRIPTION =
    'Enter, Tab, Shift+Tab, Escape, the arrow keys, Home, End, PageUp, PageDown; the single keys N, R, C and /; '
    + 'ControlOrMeta+N, ControlOrMeta+R and ControlOrMeta+Shift+R (Control or Meta may be written instead of ControlOrMeta); Alt+Q; '
    + 'and, only as the step marked "commits", a key that sends: ControlOrMeta+Enter or Alt+S';
