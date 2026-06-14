# Spreetree Shared Expenses

A MERN-style full-stack expense app for the Spreetree assignment. It uses React, Node, and Express, with an embedded relational Postgres-compatible database through PGlite because the assignment explicitly requires relational databases only.

## Features

- Demo login module
- Group and membership windows, including joins and leaves over time
- CSV import for `expenses_export.csv` exactly as provided
- Equal, unequal, percentage, and share split support
- INR/USD handling with a documented conversion rate
- Group balance summary, member trace rows, and simplified settlements
- Import report that lists every anomaly detected and the action taken
- Manual expense and settlement API endpoints

## Local Setup

1. Install Node.js 20 or newer.
2. Install dependencies:

```bash
npm install
```

3. Copy environment defaults if desired:

```bash
cp .env.example .env
```

4. Start the app:

```bash
npm run dev
```

5. Open the Vite URL, usually `http://127.0.0.1:5173`.
6. Sign in with any email/password, then upload `expenses_export.csv` from the assignment.

The API runs on `http://127.0.0.1:4000`. Local relational data is stored under `server/.data/`.

## Useful Commands

```bash
npm test
npm run server:start
npm run build
```

## Deployment Notes

Deploy the React build and Node server together on Render, Railway, Fly.io, or another Node host. Set:

- `PORT`
- `USD_TO_INR_RATE=83`
- `IMPORT_YEAR=2026`

For a production deployment, replace the demo login hash flow with a real auth provider or JWT secret-backed auth. PGlite is enough for this assignment/demo; a hosted Postgres database can use the same relational schema.

## AI Used

I used OpenAI Codex as the primary development collaborator to inspect the PDF/CSV, draft the importer policy, implement the React/Express app, and generate the required documentation. The decisions and AI audit are recorded in `DECISIONS.md` and `AI_USAGE.md`.
