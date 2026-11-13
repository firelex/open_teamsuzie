import { DataTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';

/** Columns added after the first release. Run after `sync()`; adds each one only where it is missing. */
const ADDED_COLUMNS: Array<{ table: string; column: string; spec: Parameters<ReturnType<Sequelize['getQueryInterface']>['addColumn']>[2] }> = [
    { table: 'users', column: 'is_active', spec: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true } },
    { table: 'users', column: 'last_sign_in_at', spec: { type: DataTypes.DATE, allowNull: true } },
    { table: 'org_invite', column: 'email', spec: { type: DataTypes.STRING(255), allowNull: true } },
];

export async function ensureUserAdminSchema(sequelize: Sequelize): Promise<void> {
    const qi = sequelize.getQueryInterface();
    for (const { table, column, spec } of ADDED_COLUMNS) {
        const existing = await qi.describeTable(table);
        if (!(column in existing)) await qi.addColumn(table, column, spec);
    }
}
