# Scope and Anomaly Log

## Import Policy

The importer never edits the CSV by hand. It reads the uploaded file, normalises fields where a policy is safe, excludes rows that need human approval from balances, and stores every finding in `import_anomalies`.

House currency is INR. USD rows are converted at `USD_TO_INR_RATE`, default `83`.

## Data Problems Found and Handling

| Problem | Example row(s) | Action |
| --- | --- | --- |
| Duplicate-looking expenses | 6, 25 | Marked `needs_review`; excluded from balances until approved. |
| Amount with thousands separator | 7 | Removed comma and imported. |
| Lowercase or spaced names | 9, 27 | Normalised to canonical member names. |
| Excess amount precision | 10 | Rounded to two decimals. |
| Name alias | 11 | Mapped `Priya S` to `Priya`. |
| Missing payer | 13 | Rejected because payer affects balances. |
| Settlement recorded in expense sheet | 14, 38 | Stored as settlement/payment, not an expense. |
| Percentages do not add to 100 | 15, 32 | Marked `needs_review`; excluded until approved. |
| Non-ISO dates | 16-34 | Converted DD/MM/YYYY to ISO where unambiguous. |
| Foreign currency | 20, 21, 23, 26 | Converted USD to INR at documented rate. |
| External participant | 23 | Normalised Kabir as external one-day participant. |
| Negative amount | 26 | Treated as refund/credit and included if otherwise valid. |
| Missing year in date | 27 | Added import year 2026. |
| Missing currency | 28 | Defaulted to INR because surrounding house expenses are INR. |
| Whitespace in amount | 29 | Trimmed and imported. |
| Zero amount placeholder | 31 | Rejected because it has no balance effect. |
| Ambiguous date | 34 | Parsed as DD/MM/YYYY but surfaced as a date-format anomaly. |
| Member outside active window | 36 | Marked `needs_review`; excluded from balances. |
| Equal split with share details | 42 | Used `equal` because split_type is the explicit field; surfaced mismatch. |

## Database Schema

- `users`: demo login users.
- `groups`: expense groups, base currency.
- `members`: group members with `join_date` and optional `leave_date`.
- `import_runs`: each CSV import and its summary JSON.
- `import_anomalies`: row-level anomaly report.
- `expenses`: imported or manual expenses, with source row and review status.
- `expense_splits`: one row per member share for traceability.
- `settlements`: imported or manual payments between people.

The schema is relational: expenses, splits, settlements, members, and anomaly reports are separate tables linked by foreign keys.
