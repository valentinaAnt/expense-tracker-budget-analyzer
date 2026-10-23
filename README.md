# Expense Tracker & Budget Analyzer

A browser-based personal finance app built with **Node.js, Express, SQLite and vanilla JavaScript**.
Record expenses, set a monthly budget per category, and see on a dashboard where your money goes.
It runs locally on your computer for a single user — no accounts, no cloud, no bank connections.

Built as an AI-Assisted Development exam project with Claude Code; the real development process is documented in
[`docs/development-log.md`](docs/development-log.md) and the report in [`report/main.tex`](report/main.tex).

## Features

- **Expenses** — add, edit and delete (with confirmation) expenses with an amount, category, date and description.
- **Budgets** — one recurring monthly limit per category; set, change or remove it at any time.
- **Dashboard** for a selected month — total spent, total budget, budget left or exceeded, categories over budget,
  a spending-vs-budget bar chart and the top 3 categories.
- **Validation** in the browser *and* on the server, with clear messages under each form field.
- **Persistent storage** in a local SQLite file; data survives restarts.
- Amounts in euros (€), stored as integer cents so totals are always exact.

## Requirements

- [Node.js](https://nodejs.org/) **24 LTS** or newer (tested with 24.22.1 and npm 11.19.1)
- Git
- A modern browser (tested with Microsoft Edge)

No database server, Python or C++ build tools are needed: SQLite is embedded through `better-sqlite3`, which ships a
prebuilt binary.

## Getting started

```powershell
git clone https://github.com/valentinaAnt/expense-tracker-budget-analyzer.git
cd expense-tracker-budget-analyzer
npm ci
npm start
```

Open **http://127.0.0.1:3000** in your browser. Stop the server with **Ctrl+C**.

`npm ci` installs the exact dependency versions from `package-lock.json` (`npm install` also works).

### Scripts

| Command | What it does |
|---|---|
| `npm start` | Starts the server |
| `npm run dev` | Starts the server and restarts it when a file changes (`node --watch`) |
| `npm test` | Runs all automated tests |
| `npm run test:coverage` | Runs the tests and prints a code coverage table |

### Configuration

| Environment variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port to listen on (`0` = any free port). The server only listens on `127.0.0.1`. |
| `DB_PATH` | `data/expenses.db` | Location of the SQLite database file (created automatically) |

Example (PowerShell): `$env:PORT = '3100'; npm start`

### Your data

Everything is stored in `data/expenses.db` (plus the SQLite helper files `-wal` and `-shm`). These files are excluded
from Git. To start over, stop the server and delete them; the database and the nine categories are recreated on the
next start.

## How the numbers are calculated

- **Month rule:** an expense belongs to the month of its date. A month is the range from the 1st (inclusive) to the
  1st of the next month (exclusive), e.g. October 2026 = `2026-10-01` ≤ date < `2026-11-01`. The expense list and the
  dashboard use the same rule.
- **Categories:** Food, Transport, Housing, Utilities, Health, Entertainment, Shopping, Education, Other.
- **Remaining budget** = monthly limit − spent; a negative value means the budget is exceeded.
- **Status:** `ok` below 80 % of the budget, `warning` from 80 % up to and including 100 %, `over` above 100 %,
  `no-budget` when a category has no budget.
- **Top categories:** the 3 categories with the highest spending, with their share of the month's total.

## API

All endpoints are under `/api` and use JSON. Amounts are sent and returned in euros (e.g. `12.5`).

| Method | Path | Request | Success | Errors |
|---|---|---|---|---|
| GET | `/api/health` | – | 200 `{status, database}` | 500 |
| GET | `/api/categories` | – | 200 list of `{id, name}` | – |
| GET | `/api/expenses` | optional query `month=YYYY-MM`, `categoryId` | 200 list, newest first | 400 invalid filter |
| GET | `/api/expenses/:id` | – | 200 expense | 400 invalid ID, 404 |
| POST | `/api/expenses` | `{amount, categoryId, date, description}` | 201 created expense | 400, 413 |
| PUT | `/api/expenses/:id` | same as POST | 200 updated expense | 400, 404 |
| DELETE | `/api/expenses/:id` | – | 204 | 400, 404 |
| GET | `/api/budgets` | – | 200 list of `{categoryId, categoryName, monthlyLimit, updatedAt}` | – |
| PUT | `/api/budgets/:categoryId` | `{monthlyLimit}` | 200 created or replaced budget | 400, 404 unknown category |
| DELETE | `/api/budgets/:categoryId` | – | 204 | 400, 404 no budget |
| GET | `/api/analytics/summary` | optional query `month=YYYY-MM` (default: current month) | 200 summary | 400 |

**Validation rules:** amount > 0, at most 2 decimals, at most 1,000,000; `categoryId` must exist; date must be a real
calendar date `YYYY-MM-DD` (years 2000–2100); description 1–200 characters after trimming. Fields such as `id` or
`createdAt` sent by the client are ignored.

**Errors** always have the same shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid expense data",
    "details": [{ "field": "amount", "message": "Amount must be a positive number with at most 2 decimals, up to 1,000,000" }]
  }
}
```

Codes: `VALIDATION_ERROR` (400), `INVALID_JSON` (400), `NOT_FOUND` (404), `PAYLOAD_TOO_LARGE` (413),
`INTERNAL_ERROR` (500 — details are logged on the server, never sent to the client).

**Example** (PowerShell, with the server running):

```powershell
Invoke-RestMethod -Method Put -Uri http://127.0.0.1:3000/api/budgets/1 -ContentType 'application/json' -Body '{"monthlyLimit": 200}'
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3000/api/expenses -ContentType 'application/json' `
  -Body '{"amount": 175.25, "categoryId": 1, "date": "2026-10-22", "description": "Groceries"}'
Invoke-RestMethod "http://127.0.0.1:3000/api/analytics/summary?month=2026-10" | ConvertTo-Json -Depth 5
```

Summary response for that data:

```json
{
  "month": "2026-10", "totalSpent": 175.25, "totalBudget": 200, "expenseCount": 1,
  "categories": [{ "categoryId": 1, "name": "Food", "spent": 175.25, "expenseCount": 1, "budget": 200,
                   "remaining": 24.75, "percentUsed": 87.6, "status": "warning" }],
  "topCategories": [{ "categoryId": 1, "name": "Food", "spent": 175.25, "sharePercent": 100 }]
}
```

## Testing

```powershell
npm test
```

The suite (81 tests) uses Node's built-in `node:test` runner and covers:

- validation rules (amounts, dates, months, IDs, descriptions),
- the database schema, constraints and persistence after closing and reopening,
- expense, budget and analytics services, including month boundaries, exact budget limits and empty months,
- the HTTP API: status codes, error format, malformed JSON, oversized bodies, unknown routes, database failures,
- the real `src/server.js` process: start-up, invalid configuration, and data surviving a server restart.

Every test uses its own temporary database in the system temp folder, so your data in `data/` is never touched.
`npm run test:coverage` reports about 96 % line coverage. The browser interface was checked manually and with a
temporary headless-browser script (see the development log, Entry 7).

## Project structure

```
src/
  server.js              starts the HTTP server, opens the database, handles Ctrl+C
  app.js                 createApp(db): middleware, routes, static files, error handler
  errors.js              error types and the central JSON error handler
  validation.js          shared input checks and the month rule
  db/database.js         opens SQLite, creates the schema, seeds categories
  routes/                expenses, budgets, analytics, categories (HTTP only)
  services/              business rules and parameterized SQL
public/
  index.html             the single-page interface
  css/styles.css         layout and styling
  js/api.js              all requests to the API
  js/app.js              rendering and user interactions
tests/                   unit, HTTP and server-process tests
data/                    local database (not in Git)
docs/development-log.md  AI-assisted development record
report/main.tex          LaTeX project report
```

## Troubleshooting

| Problem | Solution |
|---|---|
| `npm.ps1 cannot be loaded because running scripts is disabled` | Run `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned` once, or use `npm.cmd start`. |
| `Could not start server on port 3000 … EADDRINUSE` | Another program (or a second copy of the app) uses port 3000. Stop it or choose another port: `$env:PORT = '3100'; npm start`. |
| `npm install` tries to run `node-gyp` and asks for Python | Keep the project's `.npmrc` (`ignore-scripts=true`); better-sqlite3 uses its bundled binary and needs no compilation. |
| `Could not open database at …` | `DB_PATH` points to a folder or an unwritable location; use a file path such as `data/expenses.db`. |
| The page shows "Could not load data" | The server is not running or was stopped; start it and click **Retry**. |

## Security notes

All SQL uses parameterized statements, user text is rendered with `textContent` (never as HTML), the server listens on
`127.0.0.1` only, request bodies are limited to 10 kB, and the database file is never committed.
