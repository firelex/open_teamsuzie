import { DataTypes, QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { User } from '../models/user.js';
import { OrgInvite } from '../models/org-invite.js';

/** Columns added after the first release. Run after `sync()`; adds each one only where it is missing. */
const ADDED_COLUMNS: Array<{ model: { name: string }; table: string; column: string; spec: Parameters<ReturnType<Sequelize['getQueryInterface']>['addColumn']>[2] }> = [
    { model: User, table: 'users', column: 'is_active', spec: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true } },
    { model: User, table: 'users', column: 'last_sign_in_at', spec: { type: DataTypes.DATE, allowNull: true } },
    { model: OrgInvite, table: 'org_invite', column: 'email', spec: { type: DataTypes.STRING(255), allowNull: true } },
];

/**
 * Brings an existing database up to the columns the user-administration code needs, then checks the users table
 * for emails that differ only in capital letters.
 *
 * A column is added only for a model the app registered with this Sequelize instance: an app that does not use
 * invites (no OrgInvite model) has no org_invite table to alter.
 *
 * Throws when two accounts share an email once capitals are ignored: sign-in and invites compare emails that way,
 * so such a pair would be one person with two accounts. Someone must merge or rename one before the app starts.
 */
export async function ensureUserAdminSchema(sequelize: Sequelize): Promise<void> {
    const qi = sequelize.getQueryInterface();
    for (const { model, table, column, spec } of ADDED_COLUMNS) {
        if (!sequelize.models[model.name]) continue;
        const existing = await qi.describeTable(table);
        if (!(column in existing)) await qi.addColumn(table, column, spec);
    }
    if (!sequelize.models[User.name]) return;
    const rows = await sequelize.query<{ email: string }>('SELECT email FROM users', { type: QueryTypes.SELECT });
    const byLower = new Map<string, string[]>();
    for (const { email } of rows) {
        const key = email.toLowerCase();
        byLower.set(key, [...(byLower.get(key) ?? []), email]);
    }
    const clashes = [...byLower.values()].filter((emails) => emails.length > 1);
    if (clashes.length > 0) {
        throw new Error(
            `Two accounts share an email when capital letters are ignored: ${clashes.map((e) => e.join(' and ')).join('; ')}; merge or rename one before starting`,
        );
    }
}
