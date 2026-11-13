import { Table, Column, DataType, ForeignKey, BelongsTo, Model, PrimaryKey, Default } from 'sequelize-typescript';
import { User } from './user.js';

/** A one-time link an admin creates so a person can set a new password. Only the SHA-256 of the token is stored. */
@Table({ tableName: 'password_reset_token', underscored: true, timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' })
export class PasswordResetToken extends Model {
    @PrimaryKey
    @Default(DataType.UUIDV4)
    @Column({ type: DataType.UUID })
    declare id: string;

    @ForeignKey(() => User)
    @Column({ type: DataType.UUID, allowNull: false })
    declare user_id: string;

    @Column({ type: DataType.STRING(64), allowNull: false, unique: true })
    declare token_hash: string;

    @Column({ type: DataType.DATE, allowNull: false })
    declare expires_at: Date;

    @Column({ type: DataType.DATE, allowNull: true })
    declare used_at: Date | null;

    @ForeignKey(() => User)
    @Column({ type: DataType.UUID, allowNull: false })
    declare created_by: string;

    @BelongsTo(() => User, 'user_id')
    declare user?: User;
}
