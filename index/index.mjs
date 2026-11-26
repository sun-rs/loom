import { closeSync, mkdirSync, openSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const columns = {
  role: 'TEXT', project: 'TEXT NOT NULL', task: 'TEXT', wave: 'TEXT', addr: 'TEXT PRIMARY KEY NOT NULL',
  backend: "TEXT NOT NULL CHECK (backend IN ('tui', 'headless'))", runtimeId: 'TEXT', cli: 'TEXT', model: 'TEXT',
  sessionId: 'TEXT', transcriptPath: 'TEXT', cwd: 'TEXT', account: 'TEXT CHECK (account IS NULL)',
  baseCommit: 'TEXT', startedAt: 'INTEGER', endedAt: 'INTEGER', parent: 'TEXT',
  effort: 'TEXT', pane: 'TEXT',
};
const fields = Object.keys(columns);
export const roles = Object.freeze(['super', 'leader', 'auditor', 'worker']);
export const rotatingRoles = Object.freeze(['leader', 'auditor']);
const rotationSchema = `CREATE TABLE IF NOT EXISTS rotations (
  successor TEXT PRIMARY KEY, predecessor TEXT NOT NULL, project TEXT NOT NULL, role TEXT NOT NULL,
  startedAt INTEGER NOT NULL, boundAt INTEGER, verifiedAt INTEGER, failedAt INTEGER,
  firstReportAt INTEGER, firstReportMisses INTEGER, verifiedTurn TEXT, failure TEXT
) STRICT`;
const schema = `CREATE TABLE IF NOT EXISTS sessions (${fields.map(key => `${key} ${columns[key]}`).join(', ')}) STRICT`;
const insert = `INSERT INTO sessions (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`;
const mutable = fields.filter(key => key !== 'addr');
const replace = `UPDATE sessions SET ${mutable.map(key => `${key} = ?`).join(', ')} WHERE addr = ?`;
const find = (db, addr) => db.prepare(`SELECT ${fields.join(', ')} FROM sessions WHERE addr = ?`).get(addr);
const equal = (left, right) => fields.every(key => left[key] === right[key]);

function checkFields(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new TypeError('Expected a session object');
  for (const key of Object.keys(values)) {
    if (!Object.hasOwn(columns, key)) throw new TypeError(`Unknown session field: ${key}`);
  }
}

function normalize(values, historicalRole) {
  checkFields(values);
  const row = Object.fromEntries(fields.map(key => [key, values[key] ?? null]));
  for (const [key, value] of Object.entries(row)) {
    if (value === null) continue;
    if (key === 'startedAt' || key === 'endedAt') {
      if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`Expected Unix milliseconds for ${key}`);
    } else if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
      throw new TypeError(`Expected a nonempty string for ${key}`);
    }
  }
  if (!row.addr || !row.project) throw new TypeError('Expected addr and project');
  if (!['tui', 'headless'].includes(row.backend)) throw new TypeError('Expected tui or headless backend');
  if (row.role !== null && !roles.includes(row.role) && row.role !== historicalRole) throw new TypeError(`Unknown role: ${row.role}`);
  if (row.addr === row.parent) throw new RangeError('A session cannot be its own parent');
  if (row.account !== null) throw new TypeError('Expected null account placeholder');
  for (const key of ['cwd', 'transcriptPath']) {
    if (row[key] !== null && !isAbsolute(row[key])) throw new TypeError(`Expected an absolute ${key}`);
  }
  if (row.startedAt !== null && row.endedAt !== null && row.endedAt < row.startedAt) {
    throw new RangeError('endedAt precedes startedAt');
  }
  return row;
}

function withDatabase(path, writable, use) {
  if (writable) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    closeSync(openSync(path, 'a', 0o600));
  }
  const db = new DatabaseSync(path, { readOnly: !writable });
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    if (!writable) return use(db);
    db.exec('BEGIN IMMEDIATE');
    db.exec(schema);
    db.exec(rotationSchema);
    const present = new Set(db.prepare('PRAGMA table_info(sessions)').all().map(column => column.name));
    for (const key of ['effort', 'pane']) {
      if (!present.has(key)) db.exec(`ALTER TABLE sessions ADD COLUMN ${key} ${columns[key]}`);
    }
    const result = use(db);
    db.exec('COMMIT');
    return result;
  } finally {
    db.close();
  }
}

export function openIndex(path = process.env.LOOM_INDEX_PATH ||
  join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'loom', 'index.sqlite')) {
  path = resolve(path);
  return {
    initialize() { withDatabase(path, true, () => {}); },

    rotations() {
      if (!statSync(path, { throwIfNoEntry: false })) return [];
      return withDatabase(path, false, db => {
        if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'rotations'").get()) return [];
        return db.prepare('SELECT * FROM rotations ORDER BY startedAt, successor').all().map(row => ({ ...row }));
      });
    },

    beginRotation({ successor, predecessor, project, role, startedAt }) {
      return withDatabase(path, true, db => {
        if (db.prepare('SELECT 1 FROM rotations WHERE successor = ?').get(successor)) return;
        const pending = db.prepare(`SELECT role, successor FROM rotations WHERE project = ? AND
          verifiedAt IS NULL AND failedAt IS NULL`).get(project);
        if (pending) return { ...pending };
        db.prepare('INSERT INTO rotations (successor, predecessor, project, role, startedAt) VALUES (?, ?, ?, ?, ?)')
          .run(successor, predecessor, project, role, startedAt);
      });
    },

    bindRotation(successor, at) {
      withDatabase(path, true, db => db.prepare('UPDATE rotations SET boundAt = COALESCE(boundAt, ?) WHERE successor = ?')
        .run(at, successor));
    },

    reportRotation(successor, { at, turn, misses, verified = misses === 0 }) {
      withDatabase(path, true, db => db.prepare(`UPDATE rotations SET firstReportAt = COALESCE(firstReportAt, ?),
        firstReportMisses = COALESCE(firstReportMisses, ?), verifiedAt = ?, verifiedTurn = ?
        WHERE successor = ? AND boundAt IS NOT NULL AND verifiedAt IS NULL AND failedAt IS NULL`)
        .run(at, misses, verified ? at : null, verified ? turn : null, successor));
    },

    failRotation(successor, at, failure) {
      withDatabase(path, true, db => db.prepare(`UPDATE rotations SET failedAt = ?, failure = ?
        WHERE successor = ? AND verifiedAt IS NULL AND failedAt IS NULL`).run(at, failure, successor));
    },

    register(values) {
      const row = normalize(values);
      return withDatabase(path, true, db => {
        const previous = find(db, row.addr);
        if (!previous) db.prepare(insert).run(...fields.map(key => row[key]));
        else if (!equal(previous, row)) throw new Error(`Session already registered: ${row.addr}`);
        return row;
      });
    },

    update(addr, changes) {
      checkFields(changes);
      if (Object.hasOwn(changes, 'addr')) throw new TypeError('Session address is immutable');
      if (!statSync(path, { throwIfNoEntry: false })) return null;
      return withDatabase(path, true, db => {
        const previous = find(db, addr);
        if (!previous) return null;
        const row = normalize({ ...previous, ...changes }, previous.role);
        if (previous.sessionId && row.sessionId !== previous.sessionId && !Object.hasOwn(changes, 'transcriptPath')) {
          row.transcriptPath = null;
        }
        db.prepare(replace).run(...mutable.map(key => row[key]), addr);
        return row;
      });
    },

    query(filters = {}) {
      checkFields(filters);
      if (!statSync(path, { throwIfNoEntry: false })) return [];
      const entries = Object.entries(filters).filter(([, value]) => value !== undefined);
      const where = entries.length ? ` WHERE ${entries.map(([key]) => `${key} IS ?`).join(' AND ')}` : '';
      return withDatabase(path, false, db => {
        if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'sessions'").get()) return [];
        const present = new Set(db.prepare('PRAGMA table_info(sessions)').all().map(column => column.name));
        const select = fields.map(key => present.has(key) ? key : `NULL AS ${key}`).join(', ');
        const rows = db.prepare(`SELECT * FROM (SELECT ${select} FROM sessions)${where} ORDER BY startedAt NULLS LAST, addr`)
          .all(...entries.map(([, value]) => value));
        return rows.map(row => ({ ...row }));
      });
    },

    async importRelay(projectDir, options) {
      const { readRelay } = await import('./relay.mjs');
      const rows = readRelay(projectDir, options).map(normalize);
      if (!rows.length) return [];
      return withDatabase(path, true, db => rows.map(row => {
        const previous = find(db, row.addr);
        if (!previous) {
          db.prepare(insert).run(...fields.map(key => row[key]));
          return row;
        }
        if (previous.project !== row.project) throw new Error(`Address belongs to another project: ${row.addr}`);
        if (previous.sessionId && row.sessionId && previous.sessionId !== row.sessionId) {
          return { ...previous };
        }
        const merged = normalize(Object.fromEntries(fields.map(key => [key, previous[key] ?? row[key]])));
        if (!equal(previous, merged)) db.prepare(replace).run(...mutable.map(key => merged[key]), merged.addr);
        return merged;
      }));
    },
  };
}

export const index = openIndex();
export default index;
