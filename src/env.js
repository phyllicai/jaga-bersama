// Tiny .env loader (no dependency). Real environment variables win.
import { readFileSync, existsSync } from 'node:fs';
export function loadEnv(file = '.env') {
  if (!existsSync(file)) return process.env;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined && m[2] !== '') process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return process.env;
}
