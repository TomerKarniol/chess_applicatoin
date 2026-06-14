// Copies SQL migration files into the build output so the compiled migrator
// can find them at runtime. Plain Node ESM — runs after `tsc`.
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const src = resolve(root, 'src/infrastructure/db/migrations');
const dst = resolve(root, 'dist/infrastructure/db/migrations');

mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
console.log(`[copy-migrations] ${src} → ${dst}`);
