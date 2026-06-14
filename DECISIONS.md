# Decision Log

## Relational DB Instead of MongoDB

Options considered: MongoDB for strict MERN naming, SQLite/Postgres for the assignment requirement.

Decision: use a React + Node/Express app with embedded Postgres-compatible PGlite. The assignment says relational DBs only, so MongoDB would be a grading risk.

## Review Queue for Risky Rows

Options considered: automatically delete duplicates, choose the highest amount, or mark rows for approval.

Decision: risky rows are imported as `needs_review` and excluded from balances. Meera specifically asked to approve anything deleted or changed.

## USD Conversion

Options considered: leave USD as-is, fetch live FX rates, or use a documented fixed rate.

Decision: convert USD to INR at a fixed `USD_TO_INR_RATE=83`. Live rates would make old imports non-repeatable.

## Membership Windows

Options considered: trust `split_with` completely or enforce member dates.

Decision: if a row charges someone outside their active window, surface it and hold the row for review. This answers Sam's request and avoids silent balance changes.

## Settlements Are Not Expenses

Options considered: keep settlement rows as expenses or store payments separately.

Decision: settlement-like rows are stored in `settlements`. They affect net balances but do not create a consumption split.

## Rounding

Options considered: round each split immediately or round only final balances.

Decision: normalise money to two decimals when importing and calculating shares. This keeps ledger values understandable in the UI and live review.

## Duplicate Detection

Options considered: exact row matching, fuzzy matching, or no automatic detection.

Decision: use a conservative same-date, same-participant, similar-description rule. It catches obvious duplicates without deleting anything automatically.
