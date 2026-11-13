import { afterEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { User } from '../models/user.js';
import UserService from '../services/user.js';
import { SequelizeUserAdminStore } from '../services/user-admin-store.js';
import { ensureUserAdminSchema } from '../services/schema-upgrade.js';
import { emailMatches } from '../utils/email.js';
import type { SharedAuthConfig } from '../types.js';

// Lookups are checked by the `where` clause they hand to the User model (spied, so no database is needed). That
// Postgres then matches `Bob@Firm.com` for `lower(email) = 'bob@firm.com'` is checked in the app against the real
// database, not here.

const config = { default_user_id: '00000000-0000-0000-0000-000000000000' } as SharedAuthConfig;

/** The SQL-ish shape Sequelize builds for `where(fn('lower', col('email')), value)`. */
function lowerEmailClause(value: string) {
    return expect.objectContaining({
        attribute: expect.objectContaining({ fn: 'lower', args: [expect.objectContaining({ col: 'email' })] }),
        logic: value,
    });
}

afterEach(() => vi.restoreAllMocks());

describe('emailMatches', () => {
    it('compares lower(email) with the trimmed, lower-cased address', () => {
        expect(emailMatches('  Bob@Firm.COM ')).toEqual(lowerEmailClause('bob@firm.com'));
    });
});

describe('lookups by email ignore capital letters', () => {
    it('authenticate finds an account stored with capitals', async () => {
        const stored = {
            email: 'Bob@Firm.com', is_active: true, password_hash: await bcrypt.hash('right-password', 4),
            save: vi.fn(async () => {}),
        };
        const findOne = vi.spyOn(User, 'findOne').mockResolvedValue(stored as unknown as User);
        const user = await new UserService(config).authenticate('bob@firm.com', 'right-password');
        expect(user).toBe(stored);
        expect(findOne.mock.calls[0]![0]!.where).toEqual(lowerEmailClause('bob@firm.com'));
    });

    it('create refuses an address that exists with different capitals', async () => {
        const findOne = vi.spyOn(User, 'findOne').mockResolvedValue({ email: 'Bob@Firm.com' } as unknown as User);
        const create = vi.spyOn(User, 'create');
        await expect(new UserService(config).create('bob@firm.com', 'pw', 'Bob')).rejects.toThrow('User with this email already exists');
        expect(findOne.mock.calls[0]![0]!.where).toEqual(lowerEmailClause('bob@firm.com'));
        expect(create).not.toHaveBeenCalled();
    });

    it('findByEmail compares ignoring capitals', async () => {
        const findOne = vi.spyOn(User, 'findOne').mockResolvedValue(null);
        await new UserService(config).findByEmail('BOB@firm.com');
        expect(findOne.mock.calls[0]![0]!.where).toEqual(lowerEmailClause('bob@firm.com'));
    });

    it('the admin store finds an account stored with capitals (so an invite to it is refused)', async () => {
        const findOne = vi.spyOn(User, 'findOne').mockResolvedValue(null);
        await new SequelizeUserAdminStore(new UserService(config)).findUserByEmail('bob@firm.com');
        expect(findOne.mock.calls[0]![0]!.where).toEqual(lowerEmailClause('bob@firm.com'));
    });
});

describe('ensureUserAdminSchema', () => {
    function fakeSequelize(emails: string[], models: string[] = ['User', 'OrgInvite']) {
        const addColumn = vi.fn(async () => {});
        const describeTable = vi.fn(async () => ({ is_active: {}, last_sign_in_at: {}, email: {} }));
        return {
            addColumn, describeTable,
            sequelize: {
                models: Object.fromEntries(models.map((m) => [m, {}])),
                getQueryInterface: () => ({ describeTable, addColumn }),
                query: vi.fn(async () => emails.map((email) => ({ email }))),
            } as never,
        };
    }

    it('refuses to start when two emails are equal ignoring capitals, naming them', async () => {
        const { sequelize } = fakeSequelize(['ann@firm.com', 'Bob@Firm.com', 'bob@firm.com']);
        await expect(ensureUserAdminSchema(sequelize)).rejects.toThrow(
            'Two accounts share an email when capital letters are ignored: Bob@Firm.com and bob@firm.com; merge or rename one before starting',
        );
    });

    it('passes when every email is distinct ignoring capitals', async () => {
        const { sequelize } = fakeSequelize(['ann@firm.com', 'Bob@Firm.com']);
        await expect(ensureUserAdminSchema(sequelize)).resolves.toBeUndefined();
    });

    it('leaves alone the tables of models the app did not register', async () => {
        const { sequelize, describeTable } = fakeSequelize([], ['User']);
        await ensureUserAdminSchema(sequelize);
        expect(describeTable.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['users', 'users']);
    });
});
