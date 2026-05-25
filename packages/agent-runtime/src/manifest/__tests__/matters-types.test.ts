import { describe, expect, it } from 'vitest';
import { defaultManifest } from '../index.js';
import type {
    AgentManifest,
    ManifestCustomField,
    ManifestMatterType,
} from '../index.js';
import {
    getMatterType,
    resolveMatterTypes,
    validateCustomFieldValues,
} from '../index.js';

function manifestWithTypes(
    types: ManifestMatterType[] | undefined,
): AgentManifest {
    return {
        ...defaultManifest(),
        matters: types ? { types } : {},
    };
}

describe('resolveMatterTypes', () => {
    it('returns an empty array when manifest.matters.types is absent', () => {
        expect(resolveMatterTypes(defaultManifest())).toEqual([]);
    });

    it('returns an empty array when types is explicitly an empty array', () => {
        expect(resolveMatterTypes(manifestWithTypes([]))).toEqual([]);
    });

    it('returns the types in declaration order', () => {
        const types: ManifestMatterType[] = [
            { id: 'litigation', label: 'Litigation' },
            { id: 'transactional', label: 'Transactional' },
        ];
        expect(resolveMatterTypes(manifestWithTypes(types))).toEqual(types);
    });

    it('drops malformed entries (missing id or label)', () => {
        const types = [
            { id: 'ok', label: 'OK' },
            { id: '', label: 'No id' },
            { id: 'no-label', label: '' },
            { id: 'trim-ok  ', label: '  Trim OK  ' },
        ] as ManifestMatterType[];
        const got = resolveMatterTypes(manifestWithTypes(types));
        expect(got).toEqual([
            { id: 'ok', label: 'OK' },
            { id: 'trim-ok', label: 'Trim OK' },
        ]);
    });
});

describe('getMatterType', () => {
    it('returns the type by id', () => {
        const types: ManifestMatterType[] = [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
        ];
        const m = manifestWithTypes(types);
        expect(getMatterType(m, 'a')).toEqual({ id: 'a', label: 'A' });
        expect(getMatterType(m, 'b')).toEqual({ id: 'b', label: 'B' });
    });

    it('returns null for an unknown id', () => {
        const m = manifestWithTypes([{ id: 'a', label: 'A' }]);
        expect(getMatterType(m, 'missing')).toBeNull();
    });

    it('returns null when typeId is undefined / null / empty', () => {
        const m = manifestWithTypes([{ id: 'a', label: 'A' }]);
        expect(getMatterType(m, undefined)).toBeNull();
        expect(getMatterType(m, null)).toBeNull();
        expect(getMatterType(m, '')).toBeNull();
    });
});

describe('validateCustomFieldValues', () => {
    const fields: ManifestCustomField[] = [
        { key: 'jurisdiction', label: 'Jurisdiction', type: 'text', required: true },
        { key: 'amount', label: 'Amount', type: 'number' },
        { key: 'closed_on', label: 'Closed', type: 'date' },
        {
            key: 'stage',
            label: 'Stage',
            type: 'enum',
            options: ['intake', 'open', 'closed'],
        },
        { key: 'public', label: 'Public?', type: 'boolean' },
    ];

    it('passes when all required fields present and values valid', () => {
        const r = validateCustomFieldValues(fields, {
            jurisdiction: 'NY',
            amount: 1000,
            closed_on: '2026-05-25',
            stage: 'open',
            public: true,
        });
        expect(r.ok).toBe(true);
        expect(r.errors).toEqual({});
    });

    it('flags missing required fields', () => {
        const r = validateCustomFieldValues(fields, {});
        expect(r.ok).toBe(false);
        expect(r.errors.jurisdiction).toMatch(/required/i);
        // Non-required fields not flagged when missing.
        expect(r.errors.amount).toBeUndefined();
    });

    it('flags wrong types', () => {
        const r = validateCustomFieldValues(fields, {
            jurisdiction: 'NY',
            amount: 'not a number',
            closed_on: 'not a date',
            stage: 'unknown-option',
            public: 'yes-string',
        });
        expect(r.ok).toBe(false);
        expect(r.errors.amount).toMatch(/number/i);
        expect(r.errors.closed_on).toMatch(/date/i);
        expect(r.errors.stage).toMatch(/one of/i);
        expect(r.errors.public).toMatch(/boolean/i);
    });

    it('coerces empty strings on optional fields to undefined (no error)', () => {
        const r = validateCustomFieldValues(fields, {
            jurisdiction: 'NY',
            amount: '',
            closed_on: '',
        });
        expect(r.ok).toBe(true);
    });

    it('accepts numeric strings on number fields (form inputs are strings)', () => {
        const r = validateCustomFieldValues(fields, {
            jurisdiction: 'NY',
            amount: '42',
        });
        expect(r.ok).toBe(true);
    });

    it('ignores extra keys not in the type definition', () => {
        const r = validateCustomFieldValues(fields, {
            jurisdiction: 'NY',
            stray: 'extra value',
        });
        expect(r.ok).toBe(true);
        expect(r.errors).toEqual({});
    });
});
