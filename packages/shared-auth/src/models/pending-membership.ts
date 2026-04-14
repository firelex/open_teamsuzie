import { Table, Column, DataType, ForeignKey, BelongsTo, Model, PrimaryKey, Default } from 'sequelize-typescript';
import { Organization } from './organization.js';
import { User } from './user.js';

export type PendingMembershipStatus = 'pending' | 'approved' | 'rejected';

@Table({
    tableName: 'pending_membership',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
})
export class PendingMembership extends Model {

    @PrimaryKey
    @Default(DataType.UUIDV4)
    @Column({
        type: DataType.UUID
    })
    declare id: string;

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
        defaultValue: 'pending'
    })
    declare status: PendingMembershipStatus;

    @Column({
        type: DataType.UUID,
        allowNull: true
    })
    declare resolved_by: string | null;

    @Column({
        type: DataType.DATE,
        allowNull: true
    })
    declare resolved_at: Date | null;

    @BelongsTo(() => Organization)
    declare organization?: Organization;

    @BelongsTo(() => User, 'user_id')
    declare user?: User;
}
