import { Table, Column, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { BaseModel } from './base-model.js';
import { Organization } from './organization.js';
import { User } from './user.js';

export type OrganizationRole = 'owner' | 'admin' | 'member';

@Table({
    tableName: 'organization_members',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
})
export class OrganizationMember extends BaseModel {

    @ForeignKey(() => Organization)
    @Column({
        type: DataType.UUID,
        allowNull: false
    })
    declare organization_id: string;

    @ForeignKey(() => User)
    @Column({
        type: DataType.UUID,
        allowNull: false
    })
    declare user_id: string;

    @Column({
        type: DataType.STRING(20),
        allowNull: false,
        defaultValue: 'member'
    })
    declare role: OrganizationRole;

    // Using 'any' to avoid emitDecoratorMetadata circular reference issues
    @BelongsTo(() => Organization)
    declare organization?: any;

    @BelongsTo(() => User)
    declare user?: any;
}
