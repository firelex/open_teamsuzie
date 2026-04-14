import { Table, Column, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { BaseModel } from './base-model.js';
import { User } from './user.js';

export interface OrganizationSettings {
    max_agents?: number;
    max_users?: number;
    features?: string[];
    [key: string]: unknown;
}

@Table({
    tableName: 'organizations',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
})
export class Organization extends BaseModel {

    @Column({
        type: DataType.STRING(255),
        allowNull: false
    })
    declare name: string;

    @Column({
        type: DataType.STRING(100),
        allowNull: false,
        unique: true
    })
    declare slug: string;

    @Column({
        type: DataType.JSONB,
        allowNull: false,
        defaultValue: {}
    })
    declare settings: OrganizationSettings;

    @Column({
        type: DataType.STRING(20),
        allowNull: false,
        defaultValue: 'human'
    })
    declare type: string;

    @ForeignKey(() => User)
    @Column({
        type: DataType.UUID,
        allowNull: true
    })
    declare owner_id: string | null;

    @Column({
        type: DataType.TEXT,
        allowNull: true
    })
    declare mission: string | null;

    @Column({
        type: DataType.STRING(255),
        allowNull: true
    })
    declare website: string | null;

    @Column({
        type: DataType.STRING(50),
        allowNull: true
    })
    declare timezone: string | null;

    @BelongsTo(() => User)
    declare owner?: User;
}
