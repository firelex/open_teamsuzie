import { Table, Column, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { BaseModel } from './base-model.js';
import { User } from './user.js';

@Table({
    tableName: 'user_device',
    underscored: true
})
export class UserDevice extends BaseModel {

    @ForeignKey(() => User)
    @Column({
        type: DataType.UUID,
        allowNull: false
    })
    declare user_id: string;

    @Column({
        type: DataType.STRING(100),
        allowNull: false
    })
    declare device_name: string;

    @Column({
        type: DataType.STRING(50),
        allowNull: true
    })
    declare platform: string | null;

    @Column({
        type: DataType.DATE,
        allowNull: true
    })
    declare last_seen_at: Date | null;

    @BelongsTo(() => User)
    declare user?: User;
}
