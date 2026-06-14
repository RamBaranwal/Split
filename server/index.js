import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import multer from 'multer';
import { createHash } from 'node:crypto';
import { getDb, initDb, seedGroup, dbRun, dbGet, dbAll } from './db.js';
import { importExpenses, parseCsv } from './lib/importer.js';

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const port = Number(process.env.PORT || 4000);

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, app: 'split-expenses' });
});

app.post('/api/auth/login', async (req, res) => {
  const { email = '', password = '', name = 'Demo User' } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  
  await initDb();
  const passwordHash = hashPassword(password);
  let user = await dbGet('SELECT * FROM users WHERE email = ?', [email]);
  
  if (user && user.password_hash !== passwordHash) {
    return res.status(401).json({ error: 'Invalid password for this demo account.' });
  }
  
  if (!user) {
    const result = await dbRun('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)', [name, email, passwordHash]);
    user = { id: result.lastID, name, email };
  }
  
  res.json({
    token: Buffer.from(`${user.id}:${user.email}`).toString('base64'),
    user: { id: user.id, name: user.name, email: user.email }
  });
});

app.get('/api/groups', async (_req, res) => {
  await initDb();
  const defaultGroupId = await seedGroup();
  const groups = await dbAll('SELECT * FROM groups ORDER BY created_at ASC');
  res.json({ groups });
});

app.post('/api/groups', async (req, res) => {
  await initDb();
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Group name is required.' });
  const result = await dbRun('INSERT INTO groups (name, base_currency) VALUES (?, ?)', [name, 'INR']);
  const group = await dbGet('SELECT * FROM groups WHERE id = ?', [result.lastID]);
  res.status(201).json({ group });
});

app.delete('/api/groups/:groupId', async (req, res) => {
  await initDb();
  const groupId = req.params.groupId;
  const group = await dbGet('SELECT * FROM groups WHERE id = ?', [groupId]);
  if (!group) return res.status(404).json({ error: 'Group not found.' });
  
  await dbRun('DELETE FROM groups WHERE id = ?', [groupId]);
  res.json({ success: true });
});


app.get('/api/groups/:groupId/members', async (req, res) => {
  await initDb();
  const members = await dbAll('SELECT * FROM members WHERE group_id = ? ORDER BY join_date ASC, name ASC', [req.params.groupId]);
  const processed = members.map(m => ({
    ...m,
    aliases: m.aliases ? m.aliases.split(',') : []
  }));
  res.json({ members: processed });
});

app.post('/api/groups/:groupId/members', async (req, res) => {
  await initDb();
  const { name, joinDate, leaveDate = null, aliases = [] } = req.body || {};
  if (!name || !joinDate) return res.status(400).json({ error: 'Member name and joinDate are required.' });
  
  try {
    const uniqueAliases = [...new Set([name.toLowerCase(), ...aliases.map(a => a.trim().toLowerCase())])].filter(Boolean).join(',');
    
    const result = await dbRun(
      'INSERT INTO members (group_id, name, join_date, leave_date, aliases) VALUES (?, ?, ?, ?, ?)',
      [req.params.groupId, name, joinDate, leaveDate || null, uniqueAliases]
    );
    const member = await dbGet('SELECT * FROM members WHERE id = ?', [result.lastID]);
    member.aliases = member.aliases ? member.aliases.split(',') : [];
    res.status(201).json({ member });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: `Member "${name}" already exists in this group.` });
    }
    throw err;
  }
});

app.patch('/api/members/:memberId', async (req, res) => {
  await initDb();
  const { leaveDate = null, aliases } = req.body || {};
  
  const current = await dbGet('SELECT * FROM members WHERE id = ?', [req.params.memberId]);
  if (!current) return res.status(404).json({ error: 'Member not found.' });
  
  let updatedLeaveDate = current.leave_date;
  if (leaveDate !== undefined) updatedLeaveDate = leaveDate || null;
  
  let updatedAliases = current.aliases;
  if (aliases !== undefined && Array.isArray(aliases)) {
    updatedAliases = [...new Set(aliases.map(a => a.trim().toLowerCase()))].filter(Boolean).join(',');
  }
  
  await dbRun(
    'UPDATE members SET leave_date = ?, aliases = ? WHERE id = ?',
    [updatedLeaveDate, updatedAliases, req.params.memberId]
  );
  const member = await dbGet('SELECT * FROM members WHERE id = ?', [req.params.memberId]);
  member.aliases = member.aliases ? member.aliases.split(',') : [];
  res.json({ member });
});

app.delete('/api/members/:memberId', async (req, res) => {
  await initDb();
  const member = await dbGet('SELECT * FROM members WHERE id = ?', [req.params.memberId]);
  if (!member) return res.status(404).json({ error: 'Member not found.' });
  
  await dbRun('DELETE FROM members WHERE id = ?', [req.params.memberId]);
  res.json({ success: true });
});

app.get('/api/groups/:groupId/expenses', async (req, res) => {
  await initDb();
  const expenses = await dbAll('SELECT * FROM expenses WHERE group_id = ? ORDER BY expense_date ASC, source_row ASC', [req.params.groupId]);
  
  for (const exp of expenses) {
    const splits = await dbAll('SELECT * FROM expense_splits WHERE expense_id = ?', [exp.id]);
    exp.shares = splits.map(s => ({
      member_name: s.member_name,
      amount_inr: s.amount_inr
    }));
    exp.participants = exp.participants ? exp.participants.split(',') : [];
    
    const commentRow = await dbGet('SELECT COUNT(*) as cnt FROM comments WHERE expense_id = ?', [exp.id]);
    exp.commentCount = commentRow ? commentRow.cnt : 0;
  }
  
  res.json({ expenses });
});

app.post('/api/groups/:groupId/expenses', async (req, res) => {
  await initDb();
  const { expenseDate, description, paidBy, amountInr, splitType = 'equal', splits = [], notes = '' } = req.body || {};
  if (!expenseDate || !description || !paidBy || !amountInr || !splits.length) {
    return res.status(400).json({ error: 'Expense date, description, payer, amount, and splits are required.' });
  }
  
  const participantNames = splits.map(s => s.member).join(',');
  
  const result = await dbRun(
    `INSERT INTO expenses (group_id, expense_date, description, paid_by, amount_inr, original_amount, source_currency, split_type, status, notes, participants) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.params.groupId, expenseDate, description, paidBy, Number(amountInr), Number(amountInr), 'INR', splitType, 'accepted', notes, participantNames]
  );
  const expenseId = result.lastID;
  
  for (const s of splits) {
    await dbRun(
      'INSERT INTO expense_splits (expense_id, member_name, amount_inr) VALUES (?, ?, ?)',
      [expenseId, s.member, Number(s.amountInr)]
    );
  }
  
  const expense = await dbGet('SELECT * FROM expenses WHERE id = ?', [expenseId]);
  expense.shares = splits.map(s => ({ member_name: s.member, amount_inr: s.amountInr }));
  expense.participants = splits.map(s => s.member);
  
  res.status(201).json({ expense });
});

app.patch('/api/expenses/:expenseId/status', async (req, res) => {
  await initDb();
  const { status } = req.body || {};
  if (!['accepted', 'needs_review', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status option.' });
  }
  
  let updateSql = 'UPDATE expenses SET status = ?';
  const params = [status];
  if (status === 'accepted') {
    updateSql += ', excluded_reason = ""';
  }
  updateSql += ' WHERE id = ?';
  params.push(req.params.expenseId);
  
  await dbRun(updateSql, params);
  const expense = await dbGet('SELECT * FROM expenses WHERE id = ?', [req.params.expenseId]);
  if (!expense) return res.status(404).json({ error: 'Expense not found.' });
  
  const splits = await dbAll('SELECT * FROM expense_splits WHERE expense_id = ?', [expense.id]);
  expense.shares = splits.map(s => ({ member_name: s.member_name, amount_inr: s.amount_inr }));
  expense.participants = expense.participants ? expense.participants.split(',') : [];
  
  res.json({ expense });
});

app.delete('/api/expenses/:expenseId', async (req, res) => {
  await initDb();
  const expense = await dbGet('SELECT * FROM expenses WHERE id = ?', [req.params.expenseId]);
  if (!expense) return res.status(404).json({ error: 'Expense not found.' });
  
  await dbRun('DELETE FROM expenses WHERE id = ?', [req.params.expenseId]);
  res.json({ success: true });
});

app.post('/api/groups/:groupId/settlements', async (req, res) => {
  await initDb();
  const { settlementDate, payer, payee, amountInr, description = 'Manual settlement' } = req.body || {};
  if (!settlementDate || !payer || !payee || !amountInr) {
    return res.status(400).json({ error: 'Settlement date, payer, payee, and amount are required.' });
  }
  
  const result = await dbRun(
    `INSERT INTO settlements (group_id, settlement_date, payer, payee, amount_inr, source_currency, original_amount, description) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.params.groupId, settlementDate, payer, payee, Number(amountInr), 'INR', Number(amountInr), description]
  );
  const settlement = await dbGet('SELECT * FROM settlements WHERE id = ?', [result.lastID]);
  res.status(201).json({ settlement });
});

app.post('/api/groups/:groupId/imports', upload.single('file'), async (req, res) => {
  await initDb();
  const defaultGroupId = await seedGroup();
  if (!req.file) return res.status(400).json({ error: 'Upload expenses_export.csv to run the importer.' });
  
  const filename = req.file?.originalname || 'expenses_export.csv';
  const csvText = req.file.buffer.toString('utf8');
  
  let groupMembers = await dbAll('SELECT * FROM members WHERE group_id = ?', [req.params.groupId]);
  const isDryRun = req.query.dryRun === 'true';

  try {
    const rows = parseCsv(csvText);
    const namesInCsv = new Set();
    rows.forEach(row => {
      if (row.paid_by) namesInCsv.add(row.paid_by.trim());
      if (row.split_with) {
        row.split_with.split(';').forEach(n => {
          const trimmed = n.trim();
          if (trimmed) namesInCsv.add(trimmed);
        });
      }
      if (row.split_details) {
        row.split_details.split(';').forEach(chunk => {
          const match = chunk.trim().match(/^(.+?)\s+(-?\d+(?:\.\d+)?%?)$/);
          if (match) namesInCsv.add(match[1].trim());
        });
      }
    });

    const isNameKnown = (name) => {
      const lower = name.toLowerCase();
      return groupMembers.some(m => 
        m.name.toLowerCase() === lower || 
        (m.aliases && m.aliases.split(',').some(a => a.toLowerCase() === lower))
      );
    };

    const newNamesToCreate = [];
    namesInCsv.forEach(rawName => {
      if (!isNameKnown(rawName)) {
        const formatted = cleanAndFormatName(rawName);
        if (formatted && !newNamesToCreate.includes(formatted)) {
          const existsInDb = groupMembers.some(m => m.name === formatted);
          if (!existsInDb) {
            newNamesToCreate.push(formatted);
          }
        }
      }
    });

    if (isDryRun) {
      const mockMembers = [...groupMembers];
      newNamesToCreate.forEach(name => {
        mockMembers.push({
          group_id: req.params.groupId,
          name,
          join_date: '2026-01-01',
          leave_date: null,
          aliases: name.toLowerCase()
        });
      });
      const report = importExpenses(csvText, mockMembers);
      return res.status(200).json({ importRunId: null, createdAt: new Date(), report, dryRun: true });
    }

    for (const name of newNamesToCreate) {
      await dbRun(
        'INSERT INTO members (group_id, name, join_date, leave_date, aliases) VALUES (?, ?, ?, ?, ?)',
        [req.params.groupId, name, '2026-01-01', null, name.toLowerCase()]
      );
    }

    if (newNamesToCreate.length > 0) {
      groupMembers = await dbAll('SELECT * FROM members WHERE group_id = ?', [req.params.groupId]);
    }
  } catch (err) {
    console.error('Error auto-creating members from CSV in SQLite:', err);
  }

  const report = importExpenses(csvText, groupMembers);

  await dbRun('DELETE FROM expenses WHERE group_id = ? AND import_run_id IS NOT NULL', [req.params.groupId]);
  await dbRun('DELETE FROM settlements WHERE group_id = ? AND import_run_id IS NOT NULL', [req.params.groupId]);

  const result = await dbRun(
    `INSERT INTO import_runs (group_id, filename, total_rows, accepted_expenses, settlements, needs_review, rejected_rows, anomaly_count, usd_rate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.params.groupId,
      filename,
      report.summary.totalRows,
      report.summary.acceptedExpenses,
      report.summary.settlements,
      report.summary.needsReview,
      report.summary.rejectedRows,
      report.summary.anomalyCount,
      report.summary.usdRate
    ]
  );
  const importRunId = result.lastID;

  if (report.anomalies.length) {
    for (const anomaly of report.anomalies) {
      await dbRun(
        'INSERT INTO import_anomalies (import_run_id, row_number, type, action, message) VALUES (?, ?, ?, ?, ?)',
        [importRunId, anomaly.rowNumber, anomaly.type, anomaly.action, anomaly.message]
      );
    }
  }

  for (const entry of report.rows) {
    if (entry.expense) {
      const exp = entry.expense;
      const pNames = exp.participants.join(',');
      
      const expResult = await dbRun(
        `INSERT INTO expenses (group_id, import_run_id, source_row, expense_date, description, paid_by, amount_inr, original_amount, source_currency, split_type, status, excluded_reason, notes, participants)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.params.groupId,
          importRunId,
          exp.rowNumber,
          exp.date || null,
          exp.description,
          exp.paidBy,
          exp.amountInr,
          exp.originalAmount,
          exp.sourceCurrency,
          exp.splitType,
          exp.status,
          exp.excludedReason,
          exp.notes,
          pNames
        ]
      );
      const expId = expResult.lastID;
      
      for (const s of exp.shares) {
        await dbRun(
          'INSERT INTO expense_splits (expense_id, member_name, amount_inr) VALUES (?, ?, ?)',
          [expId, s.member, s.amountInr]
        );
      }
    }
  }

  for (const st of report.settlements) {
    await dbRun(
      `INSERT INTO settlements (group_id, import_run_id, source_row, settlement_date, payer, payee, amount_inr, source_currency, original_amount, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.params.groupId,
        importRunId,
        st.rowNumber,
        st.date || null,
        st.payer,
        st.payee,
        st.amountInr,
        st.sourceCurrency,
        st.originalAmount,
        st.description
      ]
    );
  }

  const runRow = await dbGet('SELECT created_at FROM import_runs WHERE id = ?', [importRunId]);
  res.status(201).json({ importRunId, createdAt: runRow.created_at, report });
});

app.get('/api/groups/:groupId/imports/latest', async (req, res) => {
  await initDb();
  const run = await dbGet('SELECT * FROM import_runs WHERE group_id = ? ORDER BY created_at DESC LIMIT 1', [req.params.groupId]);
  if (!run) return res.json({ report: null });
  
  const anomalies = await dbAll('SELECT * FROM import_anomalies WHERE import_run_id = ? ORDER BY row_number ASC, id ASC', [run.id]);
  const expenses = await dbAll('SELECT * FROM expenses WHERE import_run_id = ? ORDER BY source_row ASC', [run.id]);
  for (const exp of expenses) {
    const splits = await dbAll('SELECT * FROM expense_splits WHERE expense_id = ?', [exp.id]);
    exp.shares = splits.map(s => ({ member_name: s.member_name, amount_inr: s.amount_inr }));
    exp.participants = exp.participants ? exp.participants.split(',') : [];
  }
  const settlements = await dbAll('SELECT * FROM settlements WHERE import_run_id = ? ORDER BY source_row ASC', [run.id]);
  
  res.json({
    report: {
      run: {
        id: run.id,
        group_id: run.group_id,
        filename: run.filename,
        created_at: run.created_at,
        summary: {
          totalRows: run.total_rows,
          acceptedExpenses: run.accepted_expenses,
          settlements: run.settlements,
          needsReview: run.needs_review,
          rejectedRows: run.rejected_rows,
          anomalyCount: run.anomaly_count,
          usdRate: run.usd_rate
        }
      },
      anomalies,
      expenses,
      settlements
    }
  });
});

app.get('/api/groups/:groupId/balances', async (req, res) => {
  await initDb();
  const expenses = await dbAll('SELECT * FROM expenses WHERE group_id = ? AND status = "accepted"', [req.params.groupId]);
  for (const exp of expenses) {
    const splits = await dbAll('SELECT * FROM expense_splits WHERE expense_id = ?', [exp.id]);
    exp.shares = splits.map(s => ({ member_name: s.member_name, amount_inr: s.amount_inr }));
  }
  
  const settlements = await dbAll('SELECT * FROM settlements WHERE group_id = ?', [req.params.groupId]);
  const groupMembers = await dbAll('SELECT * FROM members WHERE group_id = ?', [req.params.groupId]);
  const memberNames = groupMembers.map(m => m.name);

  const reportShape = {
    expenses: expenses.map((expense) => ({
      rowNumber: expense.source_row,
      paidBy: expense.paid_by,
      amountInr: Number(expense.amount_inr),
      shares: expense.shares.map(s => ({ member: s.member_name, amountInr: Number(s.amount_inr) }))
    })),
    settlements: settlements.map((settlement) => ({
      payer: settlement.payer,
      payee: settlement.payee,
      amountInr: Number(settlement.amount_inr)
    }))
  };
  
  res.json({ balances: recomputeBalances(reportShape, memberNames) });
});

app.get('/api/expenses/:expenseId/comments', async (req, res) => {
  await initDb();
  const comments = await dbAll('SELECT * FROM comments WHERE expense_id = ? ORDER BY timestamp ASC', [req.params.expenseId]);
  res.json({ comments });
});

app.post('/api/expenses/:expenseId/comments', async (req, res) => {
  await initDb();
  const { sender, message } = req.body || {};
  if (!sender || !message) return res.status(400).json({ error: 'Sender and message text are required.' });
  
  const result = await dbRun('INSERT INTO comments (expense_id, sender, message) VALUES (?, ?, ?)', [req.params.expenseId, sender, message]);
  const comment = await dbGet('SELECT * FROM comments WHERE id = ?', [result.lastID]);
  res.status(201).json({ comment });
});

function recomputeBalances(report, memberNames) {
  const ledger = new Map();
  const ensure = (member) => {
    if (!ledger.has(member)) ledger.set(member, { paid: 0, owed: 0, net: 0, expenseRows: [] });
    return ledger.get(member);
  };
  
  memberNames.forEach(ensure);

  report.expenses.forEach((expense) => {
    ensure(expense.paidBy).paid += expense.amountInr;
    if (expense.rowNumber != null) {
      ensure(expense.paidBy).expenseRows.push(expense.rowNumber);
    }
    expense.shares.forEach((share) => {
      ensure(share.member).owed += share.amountInr;
      if (expense.rowNumber != null) {
        ensure(share.member).expenseRows.push(expense.rowNumber);
      }
    });
  });
  
  report.settlements.forEach((settlement) => {
    ensure(settlement.payer).paid += settlement.amountInr;
    ensure(settlement.payee).owed += settlement.amountInr;
  });
  
  return [...ledger.entries()].map(([member, value]) => ({
    member,
    paid: money(value.paid),
    owed: money(value.owed),
    net: money(value.paid - value.owed),
    expenseRows: [...new Set(value.expenseRows)].filter(r => r != null).sort((a, b) => a - b)
  })).sort((a, b) => a.member.localeCompare(b.member));
}

function money(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function hashPassword(password) {
  return createHash('sha256').update(`split:${password}`).digest('hex');
}

function cleanAndFormatName(rawName) {
  let name = String(rawName || '').trim();
  name = name.replace(/\s+/g, ' ');
  if (!name) return '';
  return name.split(' ').map(word => {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(' ');
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Unexpected server error.' });
});

app.listen(port, async () => {
  try {
    await initDb();
    await seedGroup();
    console.log(`Split API listening on http://127.0.0.1:${port}`);
  } catch (err) {
    console.error('\n❌ DATABASE CONNECTION ERROR:', err);
    console.log(`Split API listening on http://127.0.0.1:${port} (DATABASE OFFLINE)`);
  }
});
