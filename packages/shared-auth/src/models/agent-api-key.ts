import { Table, Column, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { BaseModel } from './base-model.js';
import { Agent } from './agent.js';

export const API_KEY_SCOPES = {
    'embeddings:read': 'Search embeddings',
    'embeddings:write': 'Create/update embeddings',
    'documents:read': 'Search documents',
    'documents:write': 'Ingest documents',
    'entities:read': 'Query graph entities',
    'entities:write': 'Create/update entities',
    'tools:email': 'Email tools',
    'tools:calendar': 'Calendar tools',
    'tools:social': 'Social media tools',
    'config:read': 'Read own config'
} as const;

export type ApiKeyScope = keyof typeof API_KEY_SCOPES;

@Table({
    tableName: 'agent_api_key',
    underscored: true,
    timestamps: false
})
export class AgentApiKey extends BaseModel {

    @ForeignKey(() => Agent)
    @Column({
        type: DataType.UUID,
        allowNull: false
    })
    declare agent_id: string;

    @Column({
        type: DataType.STRING(255),
        allowNull: false
    })
    declare name: string;

    @Column({
        type: DataType.STRING(255),
        allowNull: false
    })
    declare key_hash: string;

    @Column({
        type: DataType.STRING(12),
        allowNull: false
    })
    declare key_prefix: string;

    @Column({
        type: DataType.ARRAY(DataType.STRING(50)),
        allowNull: false,
        defaultValue: []
    })
    declare scopes: ApiKeyScope[];

    @Column({
        type: DataType.INTEGER,
        allowNull: false,
        defaultValue: 60
    })
    declare rate_limit_per_minute: number;

    @Column({
        type: DataType.DATE,
        allowNull: true
    })
    declare last_used_at: Date | null;

    @Column({
        type: DataType.DATE,
        allowNull: true
    })
    declare expires_at: Date | null;

    @Column({
        type: DataType.BOOLEAN,
        allowNull: false,
        defaultValue: true
    })
    declare is_active: boolean;

    @Column({
        type: DataType.DATE,
        allowNull: false,
        defaultValue: DataType.NOW
    })
    declare created_at: Date;

    @Column({
        type: DataType.DATE,
        allowNull: true
    })
    declare revoked_at: Date | null;

    @Column({
        type: DataType.UUID,
        allowNull: true
    })
    declare revoked_by: string | null;

    @BelongsTo(() => Agent)
    declare agent?: Agent;
}
