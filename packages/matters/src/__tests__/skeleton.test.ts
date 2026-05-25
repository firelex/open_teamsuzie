import { describe, expect, it } from 'vitest';
import { SUBJECT_MATTER } from '../index.js';

describe('@teamsuzie/matters package skeleton', () => {
    it('exports SUBJECT_MATTER for use against @teamsuzie/sharing MembersStore', () => {
        expect(SUBJECT_MATTER).toBe('matter');
    });
});
