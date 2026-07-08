import type { SqlJsStatic, Database as SqlJsDatabase } from 'sql.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const stateDir = join(homedir(), '.grabr');
mkdirSync(stateDir, { recursive: true });

const dbPath = join(stateDir, 'grabr.db');

let SQL: SqlJsStatic;
let db: SqlJsDatabase;
let initPromise: Promise<void> | null = null;

async function init(): Promise<void> {
  if (db) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const initSqlJs = (await import('sql.js')).default;
    SQL = await initSqlJs({
      locateFile: (file: string) => {
        const dir = dirname(fileURLToPath(import.meta.url));
        const localWasm = resolve(dir, file);
        if (existsSync(localWasm)) return localWasm;
        return resolve(dir, '..', 'node_modules', 'sql.js', 'dist', file);
      },
    });

    if (existsSync(dbPath)) {
      const buffer = readFileSync(dbPath);
      db = new SQL.Database(buffer);
    } else {
      db = new SQL.Database();
    }

    db.run('PRAGMA journal_mode = WAL');
    db.run(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        filename TEXT NOT NULL,
        destination TEXT NOT NULL,
        total_bytes INTEGER DEFAULT 0,
        downloaded_bytes INTEGER DEFAULT 0,
        chunks TEXT DEFAULT '[]',
        status TEXT DEFAULT 'queued',
        speed INTEGER DEFAULT 0,
        eta INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        error TEXT
      )
    `);

    persistDb();
  })();

  return initPromise;
}

function persistDb(): void {
  const data = db.export();
  writeFileSync(dbPath, Buffer.from(data));
}

export async function queryRun(sql: string, params?: (number | string | Uint8Array | null)[]): Promise<void> {
  await init();
  db.run(sql, params);
  persistDb();
}

export async function queryGet<T>(
  sql: string,
  params?: (number | string | Uint8Array | null)[]
): Promise<T | undefined> {
  await init();
  const stmt = db.prepare(sql);
  try {
    if (params) stmt.bind(params);
    return stmt.step() ? (stmt.getAsObject() as T) : undefined;
  } finally {
    stmt.free();
  }
}

export async function queryAll<T>(
  sql: string,
  params?: (number | string | Uint8Array | null)[]
): Promise<T[]> {
  await init();
  const stmt = db.prepare(sql);
  try {
    if (params) stmt.bind(params);
    const results: T[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject() as T);
    }
    return results;
  } finally {
    stmt.free();
  }
}