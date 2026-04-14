const { Sequelize } = require('sequelize');

module.exports = {
    up: async ({ context: queryInterface }) => {
        // Create organization table
        await queryInterface.createTable('organization', {
            id: {
                type: Sequelize.UUID,
                defaultValue: Sequelize.UUIDV4,
                primaryKey: true
            },
            name: {
                type: Sequelize.STRING(255),
                allowNull: false
            },
            slug: {
                type: Sequelize.STRING(100),
                allowNull: false,
                unique: true
            },
            status: {
                type: Sequelize.STRING(20),
                allowNull: false,
                defaultValue: 'active'
            },
            settings: {
                type: Sequelize.JSONB,
                allowNull: false,
                defaultValue: {}
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
            },
            created_by: {
                type: Sequelize.UUID,
                allowNull: false
            },
            updated_by: {
                type: Sequelize.UUID,
                allowNull: false
            }
        });

        // Create organization_member table
        await queryInterface.createTable('organization_member', {
            id: {
                type: Sequelize.UUID,
                defaultValue: Sequelize.UUIDV4,
                primaryKey: true
            },
            organization_id: {
                type: Sequelize.UUID,
                allowNull: false,
                references: {
                    model: 'organization',
                    key: 'id'
                },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            user_id: {
                type: Sequelize.UUID,
                allowNull: false,
                references: {
                    model: 'user',
                    key: 'id'
                },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            role: {
                type: Sequelize.STRING(20),
                allowNull: false,
                defaultValue: 'member'
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
            },
            created_by: {
                type: Sequelize.UUID,
                allowNull: false
            },
            updated_by: {
                type: Sequelize.UUID,
                allowNull: false
            }
        });

        // Create agent table
        await queryInterface.createTable('agent', {
            id: {
                type: Sequelize.UUID,
                defaultValue: Sequelize.UUIDV4,
                primaryKey: true
            },
            user_id: {
                type: Sequelize.UUID,
                allowNull: false,
                references: {
                    model: 'user',
                    key: 'id'
                },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            name: {
                type: Sequelize.STRING(255),
                allowNull: false
            },
            agent_type: {
                type: Sequelize.STRING(50),
                allowNull: false,
                defaultValue: 'openclaw'
            },
            status: {
                type: Sequelize.STRING(20),
                allowNull: false,
                defaultValue: 'active'
            },
            api_key_hash: {
                type: Sequelize.STRING(255),
                allowNull: true
            },
            api_key_prefix: {
                type: Sequelize.STRING(8),
                allowNull: true
            },
            config: {
                type: Sequelize.JSONB,
                allowNull: false,
                defaultValue: {}
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
            },
            created_by: {
                type: Sequelize.UUID,
                allowNull: false
            },
            updated_by: {
                type: Sequelize.UUID,
                allowNull: false
            }
        });

        // Add default_organization_id to user table
        await queryInterface.addColumn('user', 'default_organization_id', {
            type: Sequelize.UUID,
            allowNull: true,
            references: {
                model: 'organization',
                key: 'id'
            },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL'
        });

        // Create indexes
        await queryInterface.addIndex('organization_member', ['organization_id', 'user_id'], {
            unique: true,
            name: 'organization_member_org_user_unique'
        });
        await queryInterface.addIndex('agent', ['user_id'], {
            name: 'agent_user_id_idx'
        });
        await queryInterface.addIndex('agent', ['api_key_prefix'], {
            name: 'agent_api_key_prefix_idx'
        });
    },
    down: async ({ context: queryInterface }) => {
        await queryInterface.removeColumn('user', 'default_organization_id');
        await queryInterface.dropTable('agent');
        await queryInterface.dropTable('organization_member');
        await queryInterface.dropTable('organization');
    }
};
