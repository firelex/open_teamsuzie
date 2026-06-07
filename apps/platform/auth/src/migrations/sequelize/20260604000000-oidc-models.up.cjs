const { Sequelize } = require('sequelize');

module.exports = {
    up: async ({ context: queryInterface }) => {
        await queryInterface.createTable('oidc_models', {
            id: {
                type: Sequelize.STRING(96),
                primaryKey: true,
                allowNull: false
            },
            type: {
                type: Sequelize.STRING(64),
                allowNull: false
            },
            payload: {
                type: Sequelize.JSONB,
                allowNull: false
            },
            grant_id: {
                type: Sequelize.STRING(96),
                allowNull: true
            },
            user_code: {
                type: Sequelize.STRING(64),
                allowNull: true
            },
            uid: {
                type: Sequelize.STRING(64),
                allowNull: true
            },
            expires_at: {
                type: Sequelize.DATE,
                allowNull: true
            },
            consumed_at: {
                type: Sequelize.DATE,
                allowNull: true
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

        await queryInterface.addIndex('oidc_models', ['type'], {
            name: 'oidc_models_type_idx'
        });
        await queryInterface.addIndex('oidc_models', ['grant_id'], {
            name: 'oidc_models_grant_id_idx'
        });
        await queryInterface.addIndex('oidc_models', ['uid'], {
            name: 'oidc_models_uid_idx'
        });
        await queryInterface.addIndex('oidc_models', ['user_code'], {
            name: 'oidc_models_user_code_idx'
        });
        await queryInterface.addIndex('oidc_models', ['expires_at'], {
            name: 'oidc_models_expires_at_idx'
        });
    },
    down: async ({ context: queryInterface }) => {
        await queryInterface.dropTable('oidc_models');
    }
};
