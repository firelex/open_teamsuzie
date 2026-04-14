import { Table, Column, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { BaseModel } from './base-model.js';
import { User } from './user.js';
import { Organization } from './organization.js';
import { AgentProfile } from './agent-profile.js';

export type AgentType = 'openclaw' | 'custom';
export type AgentStatus = 'active' | 'inactive' | 'suspended';

export interface AgentConfig {
    skills?: string[];
    text_model?: string;
    vision_model?: string;
    temperature?: number;
    max_tokens?: number;
    use_prompt_condensation?: boolean;
    condensation_model?: string;
    egress_whitelist?: string[];
    tts_voice?: string;
    [key: string]: unknown;
}

@Table({
    tableName: 'agent',
    underscored: true
})
export class Agent extends BaseModel {

    @ForeignKey(() => User)
    @Column({
        type: DataType.UUID,
        allowNull: false
    })
    declare user_id: string;

    @Column({
        type: DataType.STRING(255),
        allowNull: false
    })
    declare name: string;

    @Column({
        type: DataType.TEXT,
        allowNull: true
    })
    declare description: string | null;

    @Column({
        type: DataType.STRING(50),
        allowNull: false,
        defaultValue: 'openclaw'
    })
    declare agent_type: AgentType;

    @Column({
        type: DataType.STRING(20),
        allowNull: false,
        defaultValue: 'active'
    })
    declare status: AgentStatus;

    @Column({
        type: DataType.STRING(255),
        allowNull: true
    })
    declare api_key_hash: string | null;

    @Column({
        type: DataType.STRING(8),
        allowNull: true
    })
    declare api_key_prefix: string | null;

    @Column({
        type: DataType.STRING(255),
        allowNull: true,
        unique: true
    })
    declare email_address: string | null;

    @Column({
        type: DataType.JSONB,
        allowNull: false,
        defaultValue: {}
    })
    declare config: AgentConfig;

    @ForeignKey(() => Organization)
    @Column({
        type: DataType.UUID,
        allowNull: false
    })
    declare organization_id: string;

    @ForeignKey(() => AgentProfile)
    @Column({
        type: DataType.UUID,
        allowNull: true
    })
    declare profile_id: string | null;

    @Column({
        type: DataType.BOOLEAN,
        allowNull: true,
        defaultValue: null
    })
    declare is_primary: boolean | null;

    @Column({ type: DataType.BLOB, allowNull: true })
    declare image: Buffer | null;

    @Column({ type: DataType.STRING(100), allowNull: true })
    declare image_content_type: string | null;

    @Column({ type: DataType.DATE, allowNull: true })
    declare last_active_at: Date | null;

    @BelongsTo(() => User)
    declare user?: User;

    @BelongsTo(() => Organization)
    declare organization?: Organization;

    @BelongsTo(() => AgentProfile)
    declare profile?: AgentProfile;
}
