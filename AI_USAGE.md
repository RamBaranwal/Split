# AI Usage

## Tools Used

- OpenAI Codex for repo creation, CSV/PDF inspection, importer logic, React/Express implementation, and documentation drafting.

## Key Prompts

- "Read the assignment PDF and CSV, then build a full MERN-style website that satisfies every deliverable."
- "Detect every CSV anomaly and document how the importer handles it."
- "Create README, SCOPE, DECISIONS, and AI_USAGE for the assignment submission."

## Cases Where AI Was Wrong or Needed Correction

1. The first instinct was to make a strict MERN app with MongoDB. I caught that the PDF says "Use relational DBs only," so the implementation uses React + Express + Node with PGlite/Postgres-style relational tables.
2. The initial PDF extraction failed on the rupee symbol due to Windows console encoding. I reran extraction with UTF-8 output before trusting the requirements.
3. A naive importer would treat "Rohan paid Aisha back" as a normal expense. I changed the policy to store settlement-like rows separately so they affect balances without creating false shared consumption.
4. A silent duplicate cleanup would violate Meera's request. I changed duplicate handling to `needs_review` so the app surfaces the issue instead of deleting or choosing a winner.

## Engineer of Record Notes

Every anomaly policy is implemented in `server/lib/importer.js` and mirrored in `SCOPE.md`. The live-review trace path is: CSV row -> `importExpenses` -> `import_anomalies` table -> Import Report UI.
