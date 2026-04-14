import { Table, Column, DataType, Model, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { Organization } from './organization.js';

export type OAuthProviderType = 'gmail' | 'outlook' | 'x' | 'instagram' | 'linkedin';

export interface OAuthProviderAdditionalConfig {
    scopes?: string[];
    [key: string]: any;
}

@Table({
    tableName: 'oauth_provider_config',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
})
export class OAuthProviderConfig extends Model {
    @Column({
        type: DataType.UUID,
        defaultValue: DataType.UUIDV4,
        primaryKey: true
    })
    declare id: string;

    @Column({
        type: DataType.STRING(50),
        allowNull: false
    })
    declare provider: OAuthProviderType;

    @Column({
        type: DataType.STRING(255),
        allowNull: true
    })
    declare email_domain: string | null;

    @ForeignKey(() => Organization)
    @Column({
        type: DataType.UUID,
        allowNull: true
    })
    declare organization_id: string | null;

    @BelongsTo(() => Organization)
    declare organization: Organization;

    @Column({
        type: DataType.STRING(255),
        allowNull: false
    })
    declare client_id: string;

    @Column({
        type: DataType.TEXT,
        allowNull: false
    })
    declare client_secret_encrypted: string;

    @Column({
        type: DataType.STRING(255),
        allowNull: true
    })
    declare tenant_id: string | null;

    @Column({
        type: DataType.STRING(500),
        allowNull: true
    })
    declare redirect_uri: string | null;

    @Column({
        type: DataType.JSONB,
        allowNull: true
    })
    declare additional_config: OAuthProviderAdditionalConfig | null;

    @Column({
        type: DataType.BOOLEAN,
        defaultValue: true
    })
    declare is_active: boolean;
}
