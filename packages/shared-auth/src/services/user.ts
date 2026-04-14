import bcrypt from 'bcryptjs';
import { User } from '../models/user.js';
import type { SharedAuthConfig } from '../types.js';

export default class UserService {

    private config: SharedAuthConfig;

    constructor(config: SharedAuthConfig) {
        this.config = config;
    }

    create = async (email: string, password: string, name: string, role: 'admin' | 'user' = 'user'): Promise<User> => {
        const existingUser = await User.findOne({ where: { email } });
        if (existingUser) {
            throw Object.assign(new Error('User with this email already exists'), { code: 400 });
        }

        const password_hash = await bcrypt.hash(password, 10);

        const user = await User.create({
            email,
            name,
            password_hash,
            role,
            created_by: this.config.default_user_id,
            updated_by: this.config.default_user_id
        });

        return user;
    }

    authenticate = async (email: string, password: string): Promise<User | null> => {
        const user = await User.findOne({ where: { email } });
        if (!user) return null;

        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) return null;

        return user;
    }

    findById = async (id: string): Promise<User | null> => {
        return User.findByPk(id);
    }

    findByEmail = async (email: string): Promise<{ id: string; email: string; name: string; role: string } | null> => {
        const user = await User.findOne({ where: { email }, attributes: ['id', 'email', 'name', 'role'] });
        if (!user) return null;
        return { id: user.id, email: user.email, name: user.name, role: user.role };
    }

    findAll = async (): Promise<{ users: { id: string; name: string; role: string }[] }> => {
        const users = await User.findAll({
            attributes: ['id', 'name', 'role', 'email'],
            order: [['name', 'ASC']]
        });
        const filteredUsers = users.filter(u =>
            u.role !== 'admin' &&
            u.email.toLowerCase() !== 'admin'
        );
        return { users: filteredUsers.map(u => ({ id: u.id, name: u.name, role: u.role })) };
    }
}
