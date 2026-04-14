import 'reflect-metadata';
import dotenv from 'dotenv';
import { resolve } from 'node:path';

// Load .env BEFORE importing the app (ESM hoists static imports)
const envPath = resolve(process.cwd(), '.env');
const result = dotenv.config({ path: envPath });

if (result.error) {
    console.error(`[FATAL] Failed to load .env from ${envPath}:`, result.error.message);
} else {
    console.log(`[INFO] Loaded .env from ${envPath}`);
}

// Now dynamically import the app — env vars are available
await import('./index.js');
