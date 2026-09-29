import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
dotenv.config({ path: fileURLToPath(new URL('../stale-inheritance/sample.env', import.meta.url)), quiet: true });
void process.env.DATABASE_URL;
console.log('ESM application read.');
