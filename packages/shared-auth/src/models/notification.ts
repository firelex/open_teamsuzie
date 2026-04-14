import { Table, Column, DataType, ForeignKey, BelongsTo, Model, PrimaryKey, Default } from 'sequelize-typescript';
import { User } from './user.js';

export type NotificationType = 'pending_membership' | 'membership_approved' | 'membership_rejected';

@Table({
    tableName: 'notification',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
})
export class Notification extends Model {

    @PrimaryKey
    @Default(DataType.UUIDV4)
    @Column({
        type: DataType.UUID
    })
    declare id: string;

    @ForeignKey(() => User)
    @Column({
        type: DataType.UUID,
        allowNull: false
    })
    declare user_id: string;

    @Column({
        type: DataType.STRING(50),
        allowNull: false
    })
    declare type: NotificationType;

    @Column({
        type: DataType.STRING(255),
        allowNull: false
    })
    declare title: string;

    @Column({
        type: DataType.TEXT,
        allowNull: true
    })
    declare message: string | null;

    @Column({
        type: DataType.JSONB,
        allowNull: false,
        defaultValue: {}
    })
    declare data: Record<string, unknown>;

    @Column({
        type: DataType.BOOLEAN,
        allowNull: false,
        defaultValue: false
    })
    declare is_read: boolean;

    @Column({
        type: DataType.STRING(500),
        allowNull: true
    })
    declare action_url: string | null;

    @BelongsTo(() => User)
    declare user?: User;
}
