import { Table, Column, DataType, Model, PrimaryKey, Default } from 'sequelize-typescript';

export type ActorType = 'user' | 'agent' | 'system';

export type AuditAction =
    | 'config.create'
    | 'config.update'
    | 'config.delete'
    | 'api_key.create'
    | 'api_key.revoke'
    | 'api_key.rotate'
    | 'user.create'
    | 'user.update'
    | 'user.delete'
    | 'org.create'
    | 'org.update'
    | 'org.delete'
    | 'agent.create'
    | 'agent.update'
    | 'agent.delete'
    | 'auth.login'
    | 'auth.logout'
    | 'auth.failed_login';

export interface AuditDetails {
    old_value?: unknown;
    new_value?: unknown;
    reason?: string;
    [key: string]: unknown;
}

@Table({
    tableName: 'audit_log',
    underscored: true,
    timestamps: false
})
export class AuditLog extends Model {

    @PrimaryKey
    @Default(DataType.UUIDV4)
    @Column({
        type: DataType.UUID
    })
    declare id: string;

    @Column({
        type: DataType.DATE,
        allowNull: false,
        defaultValue: DataType.NOW
    })
    declare timestamp: Date;

    @Column({
        type: DataType.STRING(20),
        allowNull: false
    })
    declare actor_type: ActorType;

    @Column({
        type: DataType.UUID,
        allowNull: true
    })
    declare actor_id: string | null;

    @Column({
        type: DataType.STRING(50),
        allowNull: false
    })
    declare action: AuditAction | string;

    @Column({
        type: DataType.STRING(50),
        allowNull: false
    })
    declare resource_type: string;

    @Column({
        type: DataType.UUID,
        allowNull: true
    })
    declare resource_id: string | null;

    @Column({
        type: DataType.STRING(20),
        allowNull: true
    })
    declare scope: string | null;

    @Column({
        type: DataType.UUID,
        allowNull: true
    })
    declare scope_id: string | null;

    @Column({
        type: DataType.JSONB,
        allowNull: true
    })
    declare details: AuditDetails | null;

    @Column({
        type: DataType.INET,
        allowNull: true
    })
    declare ip_address: string | null;

    @Column({
        type: DataType.TEXT,
        allowNull: true
    })
    declare user_agent: string | null;
}
