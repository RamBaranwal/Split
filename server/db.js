import sqlite3 from 'sqlite3';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, '..', 'database_v2.sqlite');

let dbConn = null;

export function getDb() {
  if (dbConn) return dbConn;
  
  dbConn = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error('Failed to open SQLite database:', err);
    } else {
      console.log(`Connected to SQLite database at ${dbPath}`);
    }
  });
  
  return dbConn;
}

// Promisified helper methods
export function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this); // contains lastID and changes
    });
  });
}

export function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

export function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

export async function initDb() {
  await dbRun('PRAGMA foreign_keys = ON;');
  
  await dbRun(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      base_currency TEXT DEFAULT 'INR',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      join_date TEXT NOT NULL,
      leave_date TEXT DEFAULT NULL,
      aliases TEXT DEFAULT '',
      FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
      UNIQUE(group_id, name)
    );
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS import_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      total_rows INTEGER NOT NULL,
      accepted_expenses INTEGER NOT NULL,
      settlements INTEGER NOT NULL,
      needs_review INTEGER NOT NULL,
      rejected_rows INTEGER NOT NULL,
      anomaly_count INTEGER NOT NULL,
      usd_rate REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE
    );
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS import_anomalies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_run_id INTEGER NOT NULL,
      row_number INTEGER NOT NULL,
      type TEXT NOT NULL,
      action TEXT NOT NULL,
      message TEXT NOT NULL,
      FOREIGN KEY(import_run_id) REFERENCES import_runs(id) ON DELETE CASCADE
    );
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      import_run_id INTEGER DEFAULT NULL,
      source_row INTEGER DEFAULT NULL,
      expense_date TEXT,
      description TEXT NOT NULL,
      paid_by TEXT NOT NULL,
      amount_inr REAL NOT NULL,
      original_amount REAL NOT NULL,
      source_currency TEXT NOT NULL,
      split_type TEXT NOT NULL,
      status TEXT NOT NULL,
      excluded_reason TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      participants TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY(import_run_id) REFERENCES import_runs(id) ON DELETE SET NULL
    );
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS expense_splits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expense_id INTEGER NOT NULL,
      member_name TEXT NOT NULL,
      amount_inr REAL NOT NULL,
      FOREIGN KEY(expense_id) REFERENCES expenses(id) ON DELETE CASCADE
    );
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS settlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      import_run_id INTEGER DEFAULT NULL,
      source_row INTEGER DEFAULT NULL,
      settlement_date TEXT,
      payer TEXT NOT NULL,
      payee TEXT NOT NULL,
      amount_inr REAL NOT NULL,
      source_currency TEXT NOT NULL,
      original_amount REAL NOT NULL,
      description TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY(import_run_id) REFERENCES import_runs(id) ON DELETE SET NULL
    );
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expense_id INTEGER NOT NULL,
      sender TEXT NOT NULL,
      message TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(expense_id) REFERENCES expenses(id) ON DELETE CASCADE
    );
  `);
}

export async function seedGroup() {
  await initDb();
  
  const groupName = 'Split Flat';
  let group = await dbGet('SELECT * FROM groups WHERE name = ?', [groupName]);
  let groupId;
  
  if (group) {
    groupId = group.id;
  } else {
    const res = await dbRun('INSERT INTO groups (name, base_currency) VALUES (?, ?)', [groupName, 'INR']);
    groupId = res.lastID;
    
    const members = [
      { name: 'Aisha', joinDate: '2026-02-01', leaveDate: null, aliases: 'aisha' },
      { name: 'Rohan', joinDate: '2026-02-01', leaveDate: null, aliases: 'rohan,rohan ' },
      { name: 'Priya', joinDate: '2026-02-01', leaveDate: null, aliases: 'priya,priya s' },
      { name: 'Meera', joinDate: '2026-02-01', leaveDate: '2026-03-31', aliases: 'meera' },
      { name: 'Dev', joinDate: '2026-02-08', leaveDate: '2026-03-14', aliases: 'dev' },
      { name: 'Sam', joinDate: '2026-04-10', leaveDate: null, aliases: 'sam' },
      { name: 'Kabir', joinDate: '2026-03-11', leaveDate: '2026-03-11', aliases: "kabir,dev's friend kabir" }
    ];

    for (const m of members) {
      await dbRun(
        'INSERT INTO members (group_id, name, join_date, leave_date, aliases) VALUES (?, ?, ?, ?, ?)',
        [groupId, m.name, m.joinDate, m.leaveDate, m.aliases]
      );
    }
    console.log('Successfully seeded default group and members in SQLite database.');
  }
  
  return groupId;
}
