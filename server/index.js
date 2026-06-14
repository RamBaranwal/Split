import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import multer from 'multer';
import { createHash } from 'node:crypto';
import { getDb, seedGroup } from './db.js';
import { User, Group, Member, ImportRun, ImportAnomaly, Expense, Settlement } from './models.js';
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
  
  await getDb();
  const passwordHash = hashPassword(password);
  let user = await User.findOne({ email });
  
  if (user && user.password_hash !== passwordHash) {
    return res.status(401).json({ error: 'Invalid password for this demo account.' });
  }
  
  if (!user) {
    user = await User.create({ name, email, password_hash: passwordHash });
  }
  
  res.json({
    token: Buffer.from(`${user.id}:${user.email}`).toString('base64'),
    user: { id: user.id, name: user.name, email: user.email }
  });
});

app.get('/api/groups', async (_req, res) => {
  await getDb();
  const defaultGroupId = await seedGroup();
  const groups = await Group.find().sort({ created_at: 1 });
  res.json({ groups });
});

app.post('/api/groups', async (req, res) => {
  await getDb();
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Group name is required.' });
  const group = await Group.create({ name, base_currency: 'INR' });
  res.status(201).json({ group });
});

app.get('/api/groups/:groupId/members', async (req, res) => {
  await getDb();
  const members = await Member.find({ group_id: req.params.groupId }).sort({ join_date: 1, name: 1 });
  res.json({ members });
});

app.post('/api/groups/:groupId/members', async (req, res) => {
  await getDb();
  const { name, joinDate, leaveDate = null, aliases = [] } = req.body || {};
  if (!name || !joinDate) return res.status(400).json({ error: 'Member name and joinDate are required.' });
  
  try {
    // Auto-add lowercase name and custom aliases
    const uniqueAliases = [...new Set([name.toLowerCase(), ...aliases.map(a => a.trim().toLowerCase())])].filter(Boolean);
    
    const member = await Member.create({
      group_id: req.params.groupId,
      name,
      join_date: joinDate,
      leave_date: leaveDate || null,
      aliases: uniqueAliases
    });
    res.status(201).json({ member });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: `Member "${name}" already exists in this group.` });
    }
    throw err;
  }
});

app.patch('/api/members/:memberId', async (req, res) => {
  await getDb();
  const { leaveDate = null, aliases } = req.body || {};
  
  const update = {};
  if (leaveDate !== undefined) update.leave_date = leaveDate || null;
  if (aliases !== undefined && Array.isArray(aliases)) {
    update.aliases = [...new Set(aliases.map(a => a.trim().toLowerCase()))].filter(Boolean);
  }
  
  const member = await Member.findByIdAndUpdate(req.params.memberId, update, { returnDocument: 'after' });
  if (!member) return res.status(404).json({ error: 'Member not found.' });
  res.json({ member });
});

app.delete('/api/members/:memberId', async (req, res) => {
  await getDb();
  const member = await Member.findByIdAndDelete(req.params.memberId);
  if (!member) return res.status(404).json({ error: 'Member not found.' });
  res.json({ success: true });
});

app.get('/api/groups/:groupId/expenses', async (req, res) => {
  await getDb();
  const expenses = await Expense.find({ group_id: req.params.groupId }).sort({ expense_date: 1, source_row: 1 });
  res.json({ expenses });
});

app.patch('/api/expenses/:expenseId/status', async (req, res) => {
  await getDb();
  const { status } = req.body || {};
  if (!['accepted', 'needs_review', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status option.' });
  }
  const update = { status };
  if (status === 'accepted') {
    update.excluded_reason = '';
  }
  const expense = await Expense.findByIdAndUpdate(req.params.expenseId, update, { returnDocument: 'after' });
  if (!expense) return res.status(404).json({ error: 'Expense not found.' });
  res.json({ expense });
});

app.delete('/api/expenses/:expenseId', async (req, res) => {
  await getDb();
  const expense = await Expense.findByIdAndDelete(req.params.expenseId);
  if (!expense) return res.status(404).json({ error: 'Expense not found.' });
  res.json({ success: true });
});

app.post('/api/groups/:groupId/expenses', async (req, res) => {
  await getDb();
  const { expenseDate, description, paidBy, amountInr, splitType = 'equal', splits = [], notes = '' } = req.body || {};
  if (!expenseDate || !description || !paidBy || !amountInr || !splits.length) {
    return res.status(400).json({ error: 'Expense date, description, payer, amount, and splits are required.' });
  }
  
  const shares = splits.map(s => ({
    member_name: s.member,
    amount_inr: Number(s.amountInr)
  }));

  const expense = await Expense.create({
    group_id: req.params.groupId,
    expense_date: expenseDate,
    description,
    paid_by: paidBy,
    amount_inr: Number(amountInr),
    original_amount: Number(amountInr),
    source_currency: 'INR',
    split_type: splitType,
    status: 'accepted',
    notes,
    shares
  });
  
  res.status(201).json({ expense });
});

app.post('/api/groups/:groupId/settlements', async (req, res) => {
  await getDb();
  const { settlementDate, payer, payee, amountInr, description = 'Manual settlement' } = req.body || {};
  if (!settlementDate || !payer || !payee || !amountInr) {
    return res.status(400).json({ error: 'Settlement date, payer, payee, and amount are required.' });
  }
  
  const settlement = await Settlement.create({
    group_id: req.params.groupId,
    settlement_date: settlementDate,
    payer,
    payee,
    amount_inr: Number(amountInr),
    source_currency: 'INR',
    original_amount: Number(amountInr),
    description
  });
  
  res.status(201).json({ settlement });
});

app.post('/api/groups/:groupId/imports', upload.single('file'), async (req, res) => {
  await getDb();
  const defaultGroupId = await seedGroup();
  if (!req.file) return res.status(400).json({ error: 'Upload expenses_export.csv to run the importer.' });
  
  const filename = req.file?.originalname || 'expenses_export.csv';
  const csvText = req.file.buffer.toString('utf8');
  
  // Dynamic validation: load group members from MongoDB first
  let groupMembers = await Member.find({ group_id: req.params.groupId });
  const isDryRun = req.query.dryRun === 'true';

  try {
    const rows = parseCsv(csvText);
    const namesInCsv = new Set();
    rows.forEach(row => {
      if (row.paid_by) {
        namesInCsv.add(row.paid_by.trim());
      }
      if (row.split_with) {
        row.split_with.split(';').forEach(n => {
          const trimmed = n.trim();
          if (trimmed) namesInCsv.add(trimmed);
        });
      }
      if (row.split_details) {
        row.split_details.split(';').forEach(chunk => {
          const match = chunk.trim().match(/^(.+?)\s+(-?\d+(?:\.\d+)?%?)$/);
          if (match) {
            namesInCsv.add(match[1].trim());
          }
        });
      }
    });

    const isNameKnown = (name) => {
      const lower = name.toLowerCase();
      return groupMembers.some(m => 
        m.name.toLowerCase() === lower || 
        m.aliases.some(a => a.toLowerCase() === lower)
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
      // Mock new members in memory so the dry run handles them without "unknown_participant" anomalies
      const mockMembers = [...groupMembers];
      newNamesToCreate.forEach(name => {
        mockMembers.push({
          group_id: req.params.groupId,
          name,
          join_date: '2026-01-01',
          leave_date: null,
          aliases: [name.toLowerCase()]
        });
      });
      const report = importExpenses(csvText, mockMembers);
      return res.status(200).json({ importRunId: null, createdAt: new Date(), report, dryRun: true });
    }

    // Real run: create missing members in MongoDB
    for (const name of newNamesToCreate) {
      await Member.create({
        group_id: req.params.groupId,
        name,
        join_date: '2026-01-01',
        leave_date: null,
        aliases: [name.toLowerCase()]
      });
    }

    // Refresh our list of members if new ones were saved
    if (newNamesToCreate.length > 0) {
      groupMembers = await Member.find({ group_id: req.params.groupId });
    }
  } catch (err) {
    console.error('Error auto-creating members from CSV:', err);
  }

  const report = importExpenses(csvText, groupMembers);

  // Clear previous imported expenses and settlements for this group
  await Expense.deleteMany({ group_id: req.params.groupId });
  await Settlement.deleteMany({ group_id: req.params.groupId });

  const run = await ImportRun.create({
    group_id: req.params.groupId,
    filename,
    summary: report.summary
  });
  const importRunId = run._id;

  if (report.anomalies.length) {
    const anomaliesToSave = report.anomalies.map((item) => ({
      import_run_id: importRunId,
      row_number: item.rowNumber,
      type: item.type,
      action: item.action,
      message: item.message
    }));
    await ImportAnomaly.insertMany(anomaliesToSave);
  }

  const expensesToSave = report.rows.filter((entry) => entry.expense).map((entry) => {
    const exp = entry.expense;
    return {
      group_id: req.params.groupId,
      import_run_id: importRunId,
      source_row: exp.rowNumber,
      expense_date: exp.date || null,
      description: exp.description,
      paid_by: exp.paidBy,
      amount_inr: exp.amountInr,
      original_amount: exp.originalAmount,
      source_currency: exp.sourceCurrency,
      split_type: exp.splitType,
      status: exp.status,
      excluded_reason: exp.excludedReason,
      notes: exp.notes,
      participants: exp.participants,
      shares: exp.shares.map(s => ({
        member_name: s.member,
        amount_inr: s.amountInr
      }))
    };
  });
  
  if (expensesToSave.length) {
    await Expense.insertMany(expensesToSave);
  }

  const settlementsToSave = report.settlements.map((settlement) => ({
    group_id: req.params.groupId,
    import_run_id: importRunId,
    source_row: settlement.rowNumber,
    settlement_date: settlement.date || null,
    payer: settlement.payer,
    payee: settlement.payee,
    amount_inr: settlement.amountInr,
    source_currency: settlement.sourceCurrency,
    original_amount: settlement.originalAmount,
    description: settlement.description
  }));

  if (settlementsToSave.length) {
    await Settlement.insertMany(settlementsToSave);
  }

  res.status(201).json({ importRunId, createdAt: run.created_at, report });
});

app.get('/api/groups/:groupId/imports/latest', async (req, res) => {
  await getDb();
  const run = await ImportRun.findOne({ group_id: req.params.groupId }).sort({ created_at: -1 });
  if (!run) return res.json({ report: null });
  
  const anomalies = await ImportAnomaly.find({ import_run_id: run._id }).sort({ row_number: 1, _id: 1 });
  const expenses = await Expense.find({ import_run_id: run._id }).sort({ source_row: 1 });
  const settlements = await Settlement.find({ import_run_id: run._id }).sort({ source_row: 1 });
  
  res.json({
    report: {
      run,
      anomalies,
      expenses,
      settlements
    }
  });
});

app.get('/api/groups/:groupId/balances', async (req, res) => {
  await getDb();
  const expenses = await Expense.find({ group_id: req.params.groupId, status: 'accepted' });
  const settlements = await Settlement.find({ group_id: req.params.groupId });
  const groupMembers = await Member.find({ group_id: req.params.groupId });
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

function recomputeBalances(report, memberNames) {
  const ledger = new Map();
  const ensure = (member) => {
    if (!ledger.has(member)) ledger.set(member, { paid: 0, owed: 0, net: 0, expenseRows: [] });
    return ledger.get(member);
  };
  
  // Pre-populate members so they show in summary
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
  let errMsg = err.message || 'Unexpected server error.';
  if (err.name === 'MongooseServerSelectionError' || errMsg.includes('ECONNREFUSED')) {
    errMsg = 'Database Connection Failed: Please ensure MongoDB is running locally at 127.0.0.1:27017 or provide a valid MONGODB_URI connection string in your .env file.';
  }
  res.status(500).json({ error: errMsg });
});

app.listen(port, async () => {
  try {
    const db = await getDb();
    await seedGroup(db);
    console.log(`Split API listening on http://127.0.0.1:${port}`);
  } catch (err) {
    console.error('\n❌ DATABASE CONNECTION ERROR:');
    console.error('Could not connect to MongoDB. The server is listening, but database actions will fail.');
    console.error('Please configure a valid MONGODB_URI in your .env file or start MongoDB locally on port 27017.\n');
    console.log(`Split API listening on http://127.0.0.1:${port} (DATABASE OFFLINE)`);
  }
});
