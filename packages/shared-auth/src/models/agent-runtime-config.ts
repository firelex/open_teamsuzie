import { Table, Column, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { BaseModel } from './base-model.js';
import { Agent } from './agent.js';

export type DeploymentStatus = 'pending' | 'deployed' | 'error' | 'syncing';

export interface OpenClawConfig {
    gateway?: {
        port?: number;
        logLevel?: string;
        enableWebhooks?: boolean;
        [key: string]: unknown;
    };
    agents?: {
        [name: string]: {
            channels?: string[];
            settings?: Record<string, unknown>;
        };
    };
    [key: string]: unknown;
}

@Table({
    tableName: 'agent_runtime_config',
    underscored: true
})
export class AgentRuntimeConfig extends BaseModel {

    @ForeignKey(() => Agent)
    @Column({
        type: DataType.UUID,
        allowNull: false,
        unique: true
    })
    declare agent_id: string;

    @Column({
        type: DataType.JSONB,
        allowNull: false,
        defaultValue: {}
    })
    declare openclaw_config: OpenClawConfig;

    @Column({
        type: DataType.TEXT,
        allowNull: true
    })
    declare gateway_token_encrypted: string | null;

    @Column({
        type: DataType.TEXT,
        allowNull: true
    })
    declare env_vars_encrypted: string | null;

    @Column({
        type: DataType.STRING(20),
        allowNull: false,
        defaultValue: 'pending'
    })
    declare deployment_status: DeploymentStatus;

    @Column({
        type: DataType.STRING(500),
        allowNull: true
    })
    declare webhook_url: string | null;

    @Column({
        type: DataType.DATE,
        allowNull: true
    })
    declare last_sync_at: Date | null;

    @BelongsTo(() => Agent)
    declare agent?: Agent;
}
