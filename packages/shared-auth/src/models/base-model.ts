import { Column, Model, DataType, PrimaryKey, Default } from 'sequelize-typescript';

export class BaseModel extends Model {

    static associate(m?: unknown) {
        return m;
    }

    @PrimaryKey
    @Default(DataType.UUIDV4)
    @Column({
        type: DataType.UUID
    })
    declare id: string;

    @Column({
        type: DataType.DATE,
        defaultValue: DataType.NOW,
        allowNull: true
    })
    declare updated_at: Date | null;

    @Column({
        type: DataType.DATE,
        defaultValue: DataType.NOW,
        allowNull: true
    })
    declare created_at: Date;

    @Column({
        type: DataType.UUID,
        allowNull: false
    })
    declare updated_by: string;

    @Column({
        type: DataType.UUID,
        allowNull: false
    })
    declare created_by: string;
}
