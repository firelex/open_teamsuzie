import { Table, Column, DataType, ForeignKey, BelongsTo, Model, PrimaryKey, Default } from 'sequelize-typescript';
import { Organization } from './organization.js';
import { User } from './user.js';

@Table({
    tableName: 'org_invite',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
})
export class OrgInvite extends Model {

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
    declare created_by: string;

    @Column({
        type: DataType.STRING(64),
        allowNull: false,
        unique: true
    })
    declare token: string;

    @Column({
        type: DataType.STRING(20),
        allowNull: false,
        defaultValue: 'member'
    })
    declare role: string;

    @Column({
        type: DataType.INTEGER,
        allowNull: true
    })
    declare max_uses: number | null;

    @Column({
        type: DataType.INTEGER,
        allowNull: false,
        defaultValue: 0
    })
    declare use_count: number;

    @Column({
        type: DataType.DATE,
        allowNull: true
    })
    declare expires_at: Date | null;

    @Column({
        type: DataType.BOOLEAN,
        allowNull: false,
        defaultValue: true
    })
    declare is_active: boolean;

    @BelongsTo(() => Organization)
    declare organization?: Organization;

    @BelongsTo(() => User)
    declare creator?: User;
}
