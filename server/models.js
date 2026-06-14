import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password_hash: { type: String, required: true },
  created_at: { type: Date, default: Date.now }
});

const GroupSchema = new mongoose.Schema({
  name: { type: String, required: true },
  base_currency: { type: String, default: 'INR' },
  created_at: { type: Date, default: Date.now }
});

const MemberSchema = new mongoose.Schema({
  group_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
  name: { type: String, required: true },
  join_date: { type: String, required: true }, // YYYY-MM-DD
  leave_date: { type: String, default: null }, // YYYY-MM-DD
  aliases: { type: [String], default: [] }
});
MemberSchema.index({ group_id: 1, name: 1 }, { unique: true });

const ImportRunSchema = new mongoose.Schema({
  group_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
  filename: { type: String, required: true },
  summary: {
    totalRows: Number,
    acceptedExpenses: Number,
    settlements: Number,
    needsReview: Number,
    rejectedRows: Number,
    anomalyCount: Number,
    usdRate: Number
  },
  created_at: { type: Date, default: Date.now }
});

const ImportAnomalySchema = new mongoose.Schema({
  import_run_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ImportRun', required: true },
  row_number: { type: Number, required: true },
  type: { type: String, required: true },
  action: { type: String, required: true },
  message: { type: String, required: true }
});

const ExpenseSchema = new mongoose.Schema({
  group_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
  import_run_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ImportRun', default: null },
  source_row: { type: Number, default: null },
  expense_date: { type: String }, // YYYY-MM-DD
  description: { type: String, required: true },
  paid_by: { type: String, required: true },
  amount_inr: { type: Number, required: true },
  original_amount: { type: Number, required: true },
  source_currency: { type: String, required: true },
  split_type: { type: String, required: true },
  status: { type: String, required: true }, // 'accepted', 'needs_review'
  excluded_reason: { type: String, default: '' },
  notes: { type: String, default: '' },
  participants: { type: [String], default: [] },
  shares: [{
    member_name: { type: String, required: true },
    amount_inr: { type: Number, required: true }
  }]
});

const SettlementSchema = new mongoose.Schema({
  group_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
  import_run_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ImportRun', default: null },
  source_row: { type: Number, default: null },
  settlement_date: { type: String }, // YYYY-MM-DD
  payer: { type: String, required: true },
  payee: { type: String, required: true },
  amount_inr: { type: Number, required: true },
  source_currency: { type: String, required: true },
  original_amount: { type: Number, required: true },
  description: { type: String, default: '' }
});

export const User = mongoose.model('User', UserSchema);
export const Group = mongoose.model('Group', GroupSchema);
export const Member = mongoose.model('Member', MemberSchema);
export const ImportRun = mongoose.model('ImportRun', ImportRunSchema);
export const ImportAnomaly = mongoose.model('ImportAnomaly', ImportAnomalySchema);
export const Expense = mongoose.model('Expense', ExpenseSchema);
export const Settlement = mongoose.model('Settlement', SettlementSchema);

// Ensure MongoDB documents automatically return `id` (as a string) to match React expectations
mongoose.set('toJSON', { virtuals: true });
mongoose.set('toObject', { virtuals: true });

