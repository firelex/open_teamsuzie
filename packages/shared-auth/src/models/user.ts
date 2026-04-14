import { Table, Column, DataType } from 'sequelize-typescript';
import { BaseModel } from './base-model.js';

export type UserRole = 'admin' | 'user';

@Table({
    tableName: 'users',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
})
export class User extends BaseModel {

    @Column({
        type: DataType.STRING,
        allowNull: false,
        unique: true
    })
    declare email: string;

    @Column({
        type: DataType.STRING,
        allowNull: false
    })
    declare name: string;

    @Column({
        type: DataType.STRING,
        allowNull: false
    })
    declare password_hash: string;

    @Column({
        type: DataType.JSONB,
        allowNull: false,
        defaultValue: {}
    })
    declare preferences: Record<string, unknown>;

    @Column({
        type: DataType.STRING(20),
        allowNull: false,
        defaultValue: 'user'
    })
    declare role: UserRole;

    @Column({
        type: DataType.UUID,
        allowNull: true
    })
    declare default_organization_id: string | null;

    @Column({
        type: DataType.BOOLEAN,
        allowNull: false,
        defaultValue: false
    })
    declare email_verified: boolean;

    // Override BaseModel's audit fields: users are root entities that can
    // be created without a parent user (signup, admin bootstrap), so
    // these must be nullable at the DB + Sequelize validation level. The
    // TypeScript type stays `string` to satisfy subclass invariance — the
    // migration backfills legacy rows to a non-null value, and callers
    // never dereference these fields directly, so the narrow type is a
    // safe lie in practice.
    @Column({
        type: DataType.UUID,
        allowNull: true
    })
    declare created_by: string;

    @Column({
        type: DataType.UUID,
        allowNull: true
    })
    declare updated_by: string;
}
