import { describe, expect, it } from 'vitest';
import { keyKind } from './keys.js';

describe('keyKind', () => {
    it('accepts navigation keys and the new-message, reply and search shortcuts', () => {
        for (const key of ['Enter', 'Tab', 'Shift+Tab', 'Escape', 'ArrowDown', 'Home', 'PageDown', 'n', 'N', 'r', 'c', '/', 'Control+N', 'Meta+n', 'ControlOrMeta+R', 'Control+Shift+R']) {
            expect(keyKind(key), key).toBe('safe');
        }
    });

    it('recognises the keys that send', () => {
        for (const key of ['Control+Enter', 'Meta+Enter', 'ControlOrMeta+Enter', 'Alt+S', 'Alt+s']) expect(keyKind(key), key).toBe('send');
    });

    it('rejects everything else, including keys that delete or archive', () => {
        for (const key of ['Delete', 'Backspace', 'e', '#', 'Control+D', 'Shift+Delete', 'Control+A', 'Alt+F4', 'Meta+W', 'x', 'Control+Shift+V', '']) {
            expect(keyKind(key), key).toBe('forbidden');
        }
    });
});
