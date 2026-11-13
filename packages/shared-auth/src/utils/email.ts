import { col, fn, where } from 'sequelize';

/**
 * A `where` clause for the users table that matches `email` ignoring capital letters
 * (`lower(email) = <email lower-cased>`). New accounts are stored lower-cased, but older rows may keep the
 * capitals they were created with, and apps key their own data by that exact stored string, so stored emails are
 * never rewritten; every lookup by email compares this way instead. Use it only in queries on the users table
 * without includes (the bare `email` column must be unambiguous).
 */
export function emailMatches(email: string) {
    return where(fn('lower', col('email')), email.trim().toLowerCase());
}
