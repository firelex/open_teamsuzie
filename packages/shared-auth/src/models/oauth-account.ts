import { Table, Column, DataType, Model } from 'sequelize-typescript';

export type OAuthProvider = 'gmail' | 'outlook' | 'x' | 'instagram' | 'linkedin';
export type OwnerType = 'user' | 'agent';
export type AccountLabel = 'agent' | 'human' | 'system';

export interface GmailCredentials {
    client_id: string;
    client_secret: string;
    redirect_uri: string;
    refresh_token?: string;
    access_token?: string;
}

export interface OutlookCredentials {
    client_id: string;
    client_secret: string;
    tenant_id: string;
    refresh_token?: string;
    access_token?: string;
}

export interface XCredentials {
    consumer_key: string;
    consumer_secret: string;
    access_token: string;
    access_token_secret: string;
    bearer_token?: string;
    user_id?: string;
}

export interface InstagramCredentials {
    access_token: string;
    user_id: string;
}

export interface LinkedInCredentials {
    email: string;
    password: string;
}

export type OAuthCredentials = GmailCredentials | OutlookCredentials | XCredentials | InstagramCredentials | LinkedInCredentials;

@Table({
    tableName: 'oauth_account',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
})
export class OAuthAccount extends Model {

    @Column({
        type: DataType.UUID,
        defaultValue: DataType.UUIDV4,
        primaryKey: true
    })
    declare id: string;

    @Column({
        type: DataType.STRING(20),
        allowNull: false
    })
    declare owner_type: OwnerType;

    @Column({
        type: DataType.UUID,
        allowNull: false
    })
    declare owner_id: string;

    @Column({
        type: DataType.STRING(50),
        allowNull: false
    })
    declare provider: OAuthProvider;

    @Column({
        type: DataType.STRING(255),
        allowNull: true
    })
    declare email_address: string | null;

    @Column({
        type: DataType.STRING(20),
        allowNull: false,
        defaultValue: 'human'
    })
    declare account_label: AccountLabel;

    @Column({
        type: DataType.STRING(255),
        allowNull: true
    })
    declare display_name: string | null;

    @Column({
        type: DataType.TEXT,
        allowNull: true
    })
    declare credentials_encrypted: string | null;

    @Column({
        type: DataType.BOOLEAN,
        allowNull: false,
        defaultValue: true
    })
    declare is_active: boolean;

    @Column({
        type: DataType.STRING(255),
        allowNull: true
    })
    declare oauth_state: string | null;

    @Column({
        type: DataType.DATE,
        allowNull: true
    })
    declare last_synced_at: Date | null;

    @Column({
        type: DataType.DATE,
        allowNull: true
    })
    declare token_expires_at: Date | null;
}
