import { Table, Column, DataType, Model, PrimaryKey, Default } from 'sequelize-typescript';

@Table({
    tableName: 'email_verification',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
})
export class EmailVerification extends Model {

    @PrimaryKey
    @Default(DataType.UUIDV4)
    @Column({
        type: DataType.UUID
    })
    declare id: string;

    @Column({
        type: DataType.STRING(255),
        allowNull: false
    })
    declare email: string;

    @Column({
        type: DataType.STRING(64),
        allowNull: false,
        unique: true
    })
    declare token: string;

    @Column({
        type: DataType.STRING(255),
        allowNull: false
    })
    declare name: string;

    @Column({
        type: DataType.STRING(255),
        allowNull: false
    })
    declare password_hash: string;

    @Column({
        type: DataType.DATE,
        allowNull: false
    })
    declare expires_at: Date;

    @Column({
        type: DataType.DATE,
        allowNull: true
    })
    declare verified_at: Date | null;
}
