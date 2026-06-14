import { parse } from 'csv-parse/sync';
import { createHash } from 'node:crypto';
import { IMPORT_YEAR, MEMBERSHIP, USD_TO_INR_RATE, inMembershipWindow, normaliseName } from './policies.js';

const REQUIRED_COLUMNS = ['date', 'description', 'paid_by', 'amount', 'currency', 'split_type', 'split_with', 'split_details', 'notes'];
const SETTLEMENT_HINTS = ['paid back', 'deposit share', 'settlement'];

export function parseCsv(text) {
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_quotes: true,
    trim: false
  });
}

export function importExpenses(csvText, dbMembers = null) {
  const rows = parseCsv(csvText);
  const headerProblems = validateHeaders(rows);
  const processed = [];
  const anomalies = [...headerProblems];
  const duplicateIndex = new Map();

  const context = {
    normaliseName,
    inMembershipWindow,
    membersMap: MEMBERSHIP,
    memberNames: Object.keys(MEMBERSHIP),
    usdRate: USD_TO_INR_RATE
  };

  if (dbMembers && Array.isArray(dbMembers)) {
    const normalizedMembers = dbMembers.map(m => ({
      name: m.name,
      joinDate: m.join_date,
      leaveDate: m.leave_date,
      aliases: Array.isArray(m.aliases) ? m.aliases : []
    }));

    const dynamicNormaliseName = (value) => {
      const raw = String(value || '').trim();
      if (!raw) return '';
      const lowerRaw = raw.toLowerCase();
      // Case-insensitive direct name check
      const directMatch = normalizedMembers.find(m => m.name.toLowerCase() === lowerRaw);
      if (directMatch) return directMatch.name;
      // Alias check
      const aliasMatch = normalizedMembers.find(m => m.aliases.some(a => a.toLowerCase() === lowerRaw));
      if (aliasMatch) return aliasMatch.name;
      return raw;
    };

    const dynamicInMembershipWindow = (memberName, isoDate) => {
      const member = normalizedMembers.find(m => m.name === memberName);
      if (!member || !isoDate) return false;
      return isoDate >= member.joinDate && (!member.leaveDate || isoDate <= member.leaveDate);
    };

    const membersMap = {};
    normalizedMembers.forEach(m => {
      membersMap[m.name] = { joinDate: m.joinDate, leaveDate: m.leaveDate };
    });

    context.normaliseName = dynamicNormaliseName;
    context.inMembershipWindow = dynamicInMembershipWindow;
    context.membersMap = membersMap;
    context.memberNames = normalizedMembers.map(m => m.name);
  }

  rows.forEach((raw, offset) => {
    const rowNumber = offset + 2;
    const result = normaliseRow(raw, rowNumber, context);
    anomalies.push(...result.anomalies);

    if (result.status === 'expense') {
      const duplicateKey = makeDuplicateKey(result.expense);
      const existing = duplicateIndex.get(duplicateKey);
      if (existing) {
        result.expense.status = 'needs_review';
        result.expense.excludedReason = 'Possible duplicate; kept out of balances until approved.';
        anomalies.push(anomaly(rowNumber, 'possible_duplicate', 'Needs review', `Looks similar to row ${existing.rowNumber}: ${existing.description}`));
      } else {
        duplicateIndex.set(duplicateKey, { rowNumber, description: result.expense.description });
      }
    }

    processed.push(result);
  });

  const acceptedExpenses = processed.filter((entry) => entry.expense && entry.expense.status === 'accepted').map((entry) => entry.expense);
  const settlements = processed.filter((entry) => entry.settlement).map((entry) => entry.settlement);
  const balances = calculateBalances(acceptedExpenses, settlements, context);
  const summary = {
    totalRows: rows.length,
    acceptedExpenses: acceptedExpenses.length,
    settlements: settlements.length,
    needsReview: processed.filter((entry) => entry.expense?.status === 'needs_review').length,
    rejectedRows: processed.filter((entry) => entry.status === 'rejected').length,
    anomalyCount: anomalies.length,
    usdRate: context.usdRate
  };

  return { rows: processed, anomalies, expenses: acceptedExpenses, settlements, balances, summary };
}

function validateHeaders(rows) {
  if (!rows.length) return [anomaly(1, 'empty_file', 'Rejected', 'No data rows found.')];
  const missing = REQUIRED_COLUMNS.filter((column) => !(column in rows[0]));
  return missing.map((column) => anomaly(1, 'missing_column', 'Rejected', `Missing required column: ${column}`));
}

function normaliseRow(raw, rowNumber, context) {
  const anomalies = [];
  const description = String(raw.description || '').trim();
  const paidByRaw = String(raw.paid_by || '');
  const paidBy = context.normaliseName(paidByRaw);
  const splitTypeRaw = String(raw.split_type || '').trim().toLowerCase();
  const currencyRaw = String(raw.currency || '').trim().toUpperCase();
  const splitWith = splitNames(raw.split_with);
  const notes = String(raw.notes || '').trim();
  const dateResult = parseDate(raw.date);
  const amountResult = parseAmount(raw.amount);

  if (dateResult.warning) anomalies.push(anomaly(rowNumber, dateResult.warning.type, dateResult.warning.action, dateResult.warning.message));
  if (amountResult.warning) anomalies.push(anomaly(rowNumber, amountResult.warning.type, amountResult.warning.action, amountResult.warning.message));
  if (paidByRaw && paidBy !== paidByRaw.trim()) {
    anomalies.push(anomaly(rowNumber, 'name_alias', 'Normalised', `Mapped payer "${paidByRaw}" to "${paidBy}".`));
  }
  if (!paidBy) {
    return { rowNumber, raw, status: 'rejected', anomalies: [...anomalies, anomaly(rowNumber, 'missing_payer', 'Rejected', 'Cannot create an expense without a payer.')] };
  }

  const splitType = splitTypeRaw || 'settlement';
  const looksLikeSettlement = splitType === 'settlement' || SETTLEMENT_HINTS.some((hint) => `${description} ${notes}`.toLowerCase().includes(hint));
  if (looksLikeSettlement) {
    const payee = splitWith[0] || extractPayeeFromDescription(description, context);
    return {
      rowNumber,
      raw,
      status: 'settlement',
      anomalies: [...anomalies, anomaly(rowNumber, 'settlement_in_expense_sheet', 'Converted to settlement', 'Stored as a payment instead of an expense.')],
      settlement: {
        rowNumber,
        date: dateResult.iso,
        payer: paidBy,
        payee,
        amountInr: amountResult.value * currencyRate(currencyRaw || 'INR', context),
        sourceCurrency: currencyRaw || 'INR',
        originalAmount: amountResult.value,
        description,
        notes
      }
    };
  }

  if (!dateResult.iso) anomalies.push(anomaly(rowNumber, 'invalid_date', 'Needs review', `Could not parse date "${raw.date}".`));
  if (!amountResult.valid) anomalies.push(anomaly(rowNumber, 'invalid_amount', 'Needs review', `Could not parse amount "${raw.amount}".`));

  let currency = currencyRaw;
  if (!currency) {
    currency = 'INR';
    anomalies.push(anomaly(rowNumber, 'missing_currency', 'Defaulted to INR', 'Currency was blank; INR is the house currency and all surrounding rows are INR.'));
  }
  if (currency === 'USD') {
    anomalies.push(anomaly(rowNumber, 'foreign_currency', 'Converted to INR', `Converted USD to INR at documented rate ${context.usdRate}.`));
  }

  if (amountResult.value < 0) {
    anomalies.push(anomaly(rowNumber, 'negative_amount', 'Treated as refund', 'Negative amount kept as a refund/credit and included in balances.'));
  }
  if (amountResult.value === 0) {
    return { rowNumber, raw, status: 'rejected', anomalies: [...anomalies, anomaly(rowNumber, 'zero_amount', 'Rejected', 'Zero-value row has no balance effect and appears to be a placeholder correction.')] };
  }

  const splitDetails = parseSplitDetails(raw.split_details, rowNumber, anomalies, context);
  let effectiveSplitType = splitType;
  if (splitType === 'equal' && splitDetails.length) {
    anomalies.push(anomaly(rowNumber, 'split_type_detail_mismatch', 'Used equal split', 'split_type is equal, so extra split_details were ignored.'));
  }
  if (!['equal', 'unequal', 'percentage', 'share'].includes(splitType)) {
    anomalies.push(anomaly(rowNumber, 'unknown_split_type', 'Needs review', `Unsupported split type "${raw.split_type}".`));
    effectiveSplitType = 'equal';
  }

  const participants = splitWith.map((member) => {
    const normalised = context.normaliseName(member);
    if (normalised !== member.trim()) anomalies.push(anomaly(rowNumber, 'name_alias', 'Normalised', `Mapped participant "${member}" to "${normalised}".`));
    if (!context.membersMap[normalised]) anomalies.push(anomaly(rowNumber, 'unknown_participant', 'Included as external participant', `${normalised} is not a flat mate; included only for this split.`));
    if (dateResult.iso && !context.inMembershipWindow(normalised, dateResult.iso)) {
      anomalies.push(anomaly(rowNumber, 'outside_membership_window', 'Needs review', `${normalised} was not active on ${dateResult.iso}; row excluded from balances until reviewed.`));
    }
    return normalised;
  });

  const shares = buildShares(effectiveSplitType, participants, splitDetails, amountResult.value * currencyRate(currency, context), rowNumber, anomalies);
  const reviewReasons = anomalies.filter((item) => item.rowNumber === rowNumber && ['possible_duplicate', 'outside_membership_window', 'invalid_date', 'invalid_amount', 'unknown_split_type', 'percentage_total_mismatch', 'split_total_mismatch'].includes(item.type));
  const status = reviewReasons.length ? 'needs_review' : 'accepted';

  return {
    rowNumber,
    raw,
    status: 'expense',
    anomalies,
    expense: {
      rowNumber,
      date: dateResult.iso,
      description,
      paidBy,
      amountInr: roundMoney(amountResult.value * currencyRate(currency, context)),
      originalAmount: amountResult.value,
      sourceCurrency: currency,
      splitType: effectiveSplitType,
      participants,
      shares,
      notes,
      status,
      excludedReason: status === 'needs_review' ? reviewReasons.map((item) => item.message).join(' ') : ''
    }
  };
}

function parseDate(value) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { iso: raw };
  const slash = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slash) {
    return {
      iso: `${slash[3]}-${slash[2]}-${slash[1]}`,
      warning: { type: 'date_format', action: 'Normalised', message: `Converted DD/MM/YYYY date "${raw}" to ISO.` }
    };
  }
  const month = raw.match(/^([A-Za-z]{3,})\s+(\d{1,2})$/);
  if (month) {
    const monthIndex = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(month[1].slice(0, 3).toLowerCase()) + 1;
    if (monthIndex) {
      return {
        iso: `${IMPORT_YEAR}-${String(monthIndex).padStart(2, '0')}-${String(month[2]).padStart(2, '0')}`,
        warning: { type: 'date_missing_year', action: 'Normalised', message: `Added import year ${IMPORT_YEAR} to date "${raw}".` }
      };
    }
  }
  return { iso: '', warning: { type: 'invalid_date', action: 'Needs review', message: `Could not parse date "${raw}".` } };
}

function parseAmount(value) {
  const raw = String(value || '').trim();
  const cleaned = raw.replace(/,/g, '');
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return { value: 0, valid: false };
  const warning = raw !== cleaned
    ? { type: 'amount_format', action: 'Normalised', message: `Removed thousands separator from amount "${raw}".` }
    : decimalPlaces(cleaned) > 2
      ? { type: 'amount_precision', action: 'Rounded', message: `Rounded amount "${raw}" to two decimals for money math.` }
      : null;
  return { value: roundMoney(num), valid: true, warning };
}

function splitNames(value) {
  return String(value || '').split(';').map((name) => name.trim()).filter(Boolean);
}

function parseSplitDetails(value, rowNumber, anomalies, context) {
  const text = String(value || '').trim();
  if (!text) return [];
  return text.split(';').map((chunk) => {
    const match = chunk.trim().match(/^(.+?)\s+(-?\d+(?:\.\d+)?%?)$/);
    if (!match) {
      anomalies.push(anomaly(rowNumber, 'split_detail_parse_error', 'Needs review', `Could not parse split detail "${chunk.trim()}".`));
      return null;
    }
    return { member: context.normaliseName(match[1]), value: Number(match[2].replace('%', '')), isPercent: match[2].includes('%') };
  }).filter(Boolean);
}

function buildShares(splitType, participants, details, amountInr, rowNumber, anomalies) {
  if (!participants.length) {
    anomalies.push(anomaly(rowNumber, 'missing_participants', 'Needs review', 'No participants found for split.'));
    return [];
  }

  if (splitType === 'equal') {
    return allocateByWeights(participants.map((member) => ({ member, weight: 1 })), amountInr);
  }

  if (splitType === 'share') {
    const detailMap = mapDetails(details);
    const weights = participants.map((member) => ({ member, weight: detailMap.get(member) || 0 }));
    if (weights.some((entry) => entry.weight <= 0)) anomalies.push(anomaly(rowNumber, 'missing_share_detail', 'Needs review', 'Every participant needs a positive share count.'));
    return allocateByWeights(weights, amountInr);
  }

  if (splitType === 'percentage') {
    const detailMap = mapDetails(details);
    const total = [...detailMap.values()].reduce((sum, value) => sum + value, 0);
    if (Math.abs(total - 100) > 0.001) anomalies.push(anomaly(rowNumber, 'percentage_total_mismatch', 'Needs review', `Percentages add to ${total}, not 100.`));
    return participants.map((member) => ({ member, amountInr: roundMoney(amountInr * ((detailMap.get(member) || 0) / 100)) }));
  }

  if (splitType === 'unequal') {
    const detailMap = mapDetails(details);
    const total = [...detailMap.values()].reduce((sum, value) => sum + value, 0);
    if (Math.abs(total - amountInr) > 0.01) anomalies.push(anomaly(rowNumber, 'split_total_mismatch', 'Needs review', `Unequal split adds to ${total}, not ${amountInr}.`));
    return participants.map((member) => ({ member, amountInr: roundMoney(detailMap.get(member) || 0) }));
  }

  return allocateByWeights(participants.map((member) => ({ member, weight: 1 })), amountInr);
}

function calculateBalances(expenses, settlements, context) {
  const ledger = new Map();
  const ensure = (member) => {
    if (!ledger.has(member)) ledger.set(member, { paid: 0, owed: 0, net: 0, expenseRows: [] });
    return ledger.get(member);
  };

  for (const member of context.memberNames) ensure(member);

  expenses.forEach((expense) => {
    const payer = ensure(expense.paidBy);
    payer.paid += expense.amountInr;
    payer.expenseRows.push(expense.rowNumber);
    expense.shares.forEach((share) => {
      const person = ensure(share.member);
      person.owed += share.amountInr;
      person.expenseRows.push(expense.rowNumber);
    });
  });

  settlements.forEach((settlement) => {
    ensure(settlement.payer).paid += settlement.amountInr;
    ensure(settlement.payee).owed += settlement.amountInr;
  });

  for (const value of ledger.values()) {
    value.paid = roundMoney(value.paid);
    value.owed = roundMoney(value.owed);
    value.net = roundMoney(value.paid - value.owed);
    value.expenseRows = [...new Set(value.expenseRows)].sort((a, b) => a - b);
  }

  return {
    members: [...ledger.entries()].map(([member, value]) => ({ member, ...value })).sort((a, b) => a.member.localeCompare(b.member)),
    settlements: simplifyDebts(ledger)
  };
}

function simplifyDebts(ledger) {
  const debtors = [];
  const creditors = [];
  for (const [member, value] of ledger.entries()) {
    if (value.net < -0.01) debtors.push({ member, amount: roundMoney(-value.net) });
    if (value.net > 0.01) creditors.push({ member, amount: roundMoney(value.net) });
  }
  const settlements = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = roundMoney(Math.min(debtors[i].amount, creditors[j].amount));
    if (amount > 0) settlements.push({ from: debtors[i].member, to: creditors[j].member, amountInr: amount });
    debtors[i].amount = roundMoney(debtors[i].amount - amount);
    creditors[j].amount = roundMoney(creditors[j].amount - amount);
    if (debtors[i].amount <= 0.01) i += 1;
    if (creditors[j].amount <= 0.01) j += 1;
  }
  return settlements;
}

function makeDuplicateKey(expense) {
  const day = expense.date || '';
  const participants = [...expense.participants].sort().join('|');
  const words = expense.description.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((word) => word.length > 3).sort().join(' ');
  return createHash('sha1').update(`${day}|${participants}|${words}`).digest('hex');
}

function allocateByWeights(weights, amountInr) {
  const totalWeight = weights.reduce((sum, entry) => sum + entry.weight, 0);
  if (!totalWeight) return weights.map((entry) => ({ member: entry.member, amountInr: 0 }));
  return weights.map((entry) => ({ member: entry.member, amountInr: roundMoney(amountInr * (entry.weight / totalWeight)) }));
}

function mapDetails(details) {
  return new Map(details.map((entry) => [entry.member, entry.value]));
}

function currencyRate(currency, context) {
  return currency === 'USD' ? context.usdRate : 1;
}

function decimalPlaces(value) {
  const match = String(value).match(/\.(\d+)$/);
  return match ? match[1].length : 0;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function extractPayeeFromDescription(description, context) {
  const match = description.match(/paid\s+(.+?)\s+back/i);
  return match ? context.normaliseName(match[1]) : '';
}

function anomaly(rowNumber, type, action, message) {
  return { rowNumber, type, action, message };
}
