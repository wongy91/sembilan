import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export function createLocalD1(path = ':memory:') {
  const db = new DatabaseSync(path);
  const dir = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(file, dir), 'utf8'));
  }
  const statement = (sql, params = []) => ({
    bind: (...args) => statement(sql, args),
    all: async () => ({ success: true, results: db.prepare(sql).all(...params).map((row) => ({ ...row })) }),
    first: async (column) => {
      const row = db.prepare(sql).get(...params);
      if (row == null) return null;
      return column ? row[column] : { ...row };
    },
    run: async () => {
      const r = db.prepare(sql).run(...params);
      return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
  });
  return { prepare: (sql) => statement(sql), raw: db };
}
