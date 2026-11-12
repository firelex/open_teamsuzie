import { describe, expect, it } from 'vitest';
import { openDb } from '@teamsuzie/db-sqlite';
import { LIBRARY_MIGRATIONS, LibraryStore } from '../index.js';

function setup() {
    let t = 1000;
    const db = openDb({ path: ':memory:', migrations: LIBRARY_MIGRATIONS });
    return new LibraryStore({ db, now: () => ++t });
}

describe('LibraryStore', () => {
    it('keeps the approved version for readers while a new draft waits', () => {
        const s = setup();
        const space = s.createSpace({ name: 'Corporate', visibility: 'firm', createdBy: 'kl@firm.com' });
        const item = s.createItem({ spaceId: space.id, kind: 'precedent', title: 'Share purchase agreement', body: 'v1 notes', createdBy: 'kl@firm.com' });
        expect(item.status).toBe('draft');
        expect(s.approvedContent(item.id)).toBeNull();

        s.approve(item.id, 'partner@firm.com', 1);
        const edited = s.update(item.id, { body: 'v2 notes' }, 'kl@firm.com', 'Updated for the 2026 Act');
        expect(edited.status).toBe('draft');
        expect(edited.version).toBe(2);
        expect(edited.body).toBe('v2 notes');
        expect(s.approvedContent(item.id)!.body).toBe('v1 notes');

        expect(() => s.approve(item.id, 'partner@firm.com', 1)).toThrow(/changed to version 2/);
        s.approve(item.id, 'partner@firm.com', 2);
        expect(s.approvedContent(item.id)!.body).toBe('v2 notes');
        expect(s.versions(item.id).map((v) => v.note)).toEqual(['Updated for the 2026 Act', 'Created']);
    });

    it('retires and reinstates, and deletes only never-approved drafts', () => {
        const s = setup();
        const space = s.createSpace({ name: 'Disputes', visibility: 'members', createdBy: 'a' });
        const item = s.createItem({ spaceId: space.id, kind: 'playbook', title: 'NDA', data: { rules: [1] }, createdBy: 'a' });
        s.approve(item.id, 'b', 1);
        expect(() => s.deleteDraft(item.id)).toThrow(/retire it instead/);
        expect(s.retire(item.id, 'b').status).toBe('retired');
        expect(s.approvedContent(item.id)).toBeNull();
        expect(() => s.update(item.id, { title: 'x' }, 'a')).toThrow(/retired/);
        const back = s.reinstate(item.id, 'a');
        expect(back.status).toBe('draft');
        expect(back.data).toEqual({ rules: [1] });

        const scrap = s.createItem({ spaceId: space.id, kind: 'workflow', title: 'Scrap', createdBy: 'a' });
        s.deleteDraft(scrap.id);
        expect(s.item(scrap.id)).toBeNull();
    });

    it('filters, searches and lists reviews that are due', () => {
        const s = setup();
        const corp = s.createSpace({ name: 'Corporate', visibility: 'firm', createdBy: 'a' });
        const lit = s.createSpace({ name: 'Disputes', visibility: 'firm', createdBy: 'a' });
        const spa = s.createItem({ spaceId: corp.id, kind: 'precedent', title: 'SPA', tags: ['M&A', ' M&A '], reviewBy: '2026-11-01', createdBy: 'a' });
        s.createItem({ spaceId: lit.id, kind: 'precedent', title: 'Letter before claim', summary: '50% of cases', createdBy: 'a' });
        expect(spa.tags).toEqual(['M&A']);
        expect(s.items({ spaceIds: [corp.id] }).map((i) => i.title)).toEqual(['SPA']);
        expect(s.items({ query: 'm&a' }).map((i) => i.title)).toEqual(['SPA']);
        expect(s.items({ query: '50%' }).map((i) => i.title)).toEqual(['Letter before claim']);
        expect(s.items({ query: '%' }).map((i) => i.title)).toEqual(['Letter before claim']);
        expect(s.reviewDue('2026-11-12')).toEqual([]);
        s.approve(spa.id, 'b', 1);
        expect(s.reviewDue('2026-11-12').map((i) => i.title)).toEqual(['SPA']);
        expect(() => s.setReviewBy(spa.id, '2026-02-30')).toThrow(/not a real date/);
    });

    it('gives each person one personal space that cannot be shared or archived', () => {
        const s = setup();
        const mine = s.personalSpace('Walt@Example.com');
        expect(s.personalSpace('walt@example.com').id).toBe(mine.id);
        expect(() => s.updateSpace(mine.id, { visibility: 'firm' })).toThrow(/personal space/);
        expect(() => s.archiveSpace(mine.id)).toThrow(/personal space/);
        s.createSpace({ name: 'Banking', visibility: 'firm', createdBy: 'a' });
        expect(s.spaces().map((x) => x.name)).toEqual(['Banking', 'My drafts']);
    });
});
