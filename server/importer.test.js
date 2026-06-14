import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importExpenses } from './lib/importer.js';

const csvPath = process.argv[2] || 'C:/Users/Ram Baranwal/Downloads/expenses_export.csv';
const csv = readFileSync(csvPath, 'utf8');
const report = importExpenses(csv);

assert.equal(report.summary.totalRows, 42);
assert.ok(report.summary.anomalyCount >= 12, 'expected at least the 12 deliberate anomalies');
assert.ok(report.anomalies.some((item) => item.type === 'foreign_currency'));
assert.ok(report.anomalies.some((item) => item.type === 'settlement_in_expense_sheet'));
assert.ok(report.anomalies.some((item) => item.type === 'outside_membership_window'));
assert.ok(report.anomalies.some((item) => item.type === 'possible_duplicate'));
assert.ok(report.balances.members.length >= 6);

console.log(JSON.stringify({
  rows: report.summary.totalRows,
  acceptedExpenses: report.summary.acceptedExpenses,
  needsReview: report.summary.needsReview,
  anomalies: report.summary.anomalyCount,
  settlements: report.summary.settlements
}, null, 2));
