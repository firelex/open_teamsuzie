import { describe, expect, it } from 'vitest';
import { addressOf, splitAddressList } from './index.js';

describe('email addresses', () => {
    it('splits a list without breaking "Last, First" display names', () => {
        expect(splitAddressList('"Reed, Anna" <anna@x.com>, ben@hawk.com,  "Cole, Ben (Hawk)" <ben.cole@hawk.com>')).toEqual([
            '"Reed, Anna" <anna@x.com>', 'ben@hawk.com', '"Cole, Ben (Hawk)" <ben.cole@hawk.com>',
        ]);
        expect(splitAddressList(null)).toEqual([]);
        expect(splitAddressList(' , ')).toEqual([]);
    });

    it('takes the bare address, lower case, from a display form', () => {
        expect(addressOf('"Reed, Anna" <Anna@X.com>')).toBe('anna@x.com');
        expect(addressOf('  Ben@Hawk.com ')).toBe('ben@hawk.com');
    });

    it('does not confuse an address with a longer one that contains it', () => {
        expect(addressOf('reuben@hawk.com')).not.toBe(addressOf('ben@hawk.com'));
    });
});
