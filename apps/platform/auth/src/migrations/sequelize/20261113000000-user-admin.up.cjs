const { Sequelize } = require('sequelize');

// Firm user administration (shared-auth): the User model now reads users.is_active and users.last_sign_in_at, so a
// database made before them breaks sign-in until they exist. scripts/sync-tables.mjs runs before this (see the
// Dockerfile) and creates any missing table from the models, but sync() never adds a column to an existing table;
// this migration does, and creates the password reset table.
//
// The models use the table 'users' (plural), not the 'user' table the first migration made, so this migration targets
// 'users'. Each column is added only when missing: a database whose 'users' table was created by sync-tables after
// the User model gained these columns already has them.
//
// org_invite: no migration here creates it and this service does not register the OrgInvite model, so sync-tables
// does not create it either. Its email column is added only when an org_invite table exists (made by another app
// sharing this database).

module.exports = {
    up: async ({ context: queryInterface }) => {
        const users = await queryInterface.describeTable('users');
        if (!('is_active' in users)) {
            await queryInterface.addColumn('users', 'is_active', {
                type: Sequelize.BOOLEAN,
                allowNull: false,
                defaultValue: true
            });
        }
        if (!('last_sign_in_at' in users)) {
            await queryInterface.addColumn('users', 'last_sign_in_at', {
                type: Sequelize.DATE,
                allowNull: true
            });
        }

        const tables = (await queryInterface.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
        if (tables.includes('org_invite')) {
            const orgInvite = await queryInterface.describeTable('org_invite');
            if (!('email' in orgInvite)) {
                await queryInterface.addColumn('org_invite', 'email', {
                    type: Sequelize.STRING(255),
                    allowNull: true
                });
            }
        }

        if (!tables.includes('password_reset_token')) {
            await queryInterface.createTable('password_reset_token', {
                id: {
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.UUIDV4,
                    primaryKey: true
                },
                user_id: {
                    type: Sequelize.UUID,
                    allowNull: false,
                    references: {
                        model: 'users',
                        key: 'id'
                    }
                },
                token_hash: {
                    type: Sequelize.STRING(64),
                    allowNull: false,
                    unique: true
                },
                expires_at: {
                    type: Sequelize.DATE,
                    allowNull: false
                },
                used_at: {
                    type: Sequelize.DATE,
                    allowNull: true
                },
                created_by: {
                    type: Sequelize.UUID,
                    allowNull: false,
                    references: {
                        model: 'users',
                        key: 'id'
                    }
                },
                created_at: {
                    type: Sequelize.DATE,
                    allowNull: false,
                    defaultValue: Sequelize.NOW
                },
                updated_at: {
                    type: Sequelize.DATE,
                    allowNull: false,
                    defaultValue: Sequelize.NOW
                }
            });
        }
    },
    down: async ({ context: queryInterface }) => {
        await queryInterface.dropTable('password_reset_token');
        await queryInterface.removeColumn('users', 'last_sign_in_at');
        await queryInterface.removeColumn('users', 'is_active');
    }
};
