# Expense Tracker & Budget Analyzer

A local, single-user web app for tracking expenses and monthly budgets, built with **Node.js, Express, SQLite and
vanilla JavaScript** as an AI-Assisted Development exam project (with Claude Code).

## Features

- Add, edit and delete expenses (amount in €, category, date, description); filter the list by category.
- **Export CSV**: download the expenses shown in the list as a file that opens in Excel.
- Manage categories: nine defaults, plus add, rename and delete your own. Deleting a category that has expenses moves
  them to a category you choose.
- Set one recurring monthly budget per category.
- Dashboard per month: total spent, total budget, budget left, categories over budget, a spending-vs-budget chart, the
  top 3 categories, and a chart of the last 6 months (click a month to open it).
- On phones, the expense list is shown as cards.
- Validation in the browser and on the server; data stored in SQLite and kept after restarts.
- Light and dark theme: the moon/sun button in the header switches it, and the browser remembers the choice.

## Getting started

Requires **Node.js 24 LTS** or newer and Git. No database server or build tools are needed.

```powershell
git clone https://github.com/valentinaAnt/expense-tracker-budget-analyzer.git
cd expense-tracker-budget-analyzer
npm ci
npm start
```

Open **http://127.0.0.1:3000**. Stop the server with **Ctrl+C**.

| Command | What it does |
|---|---|
| `npm start` | Start the server |
| `npm run dev` | Start and restart on file changes |
| `npm test` | Run all automated tests |
| `npm run test:coverage` | Run the tests with a coverage report |

Optional environment variables: `PORT` (default `3000`) and `DB_PATH` (default `data/expenses.db`).
Data is stored in `data/expenses.db`, which is not committed to Git; delete it to start over.

## Calculation rules

- An expense belongs to the month of its date (from the 1st up to, but not including, the 1st of the next month).
- Remaining budget = monthly limit − spent; a negative value means the budget is exceeded.
- Status: `ok` below 80 %, `warning` from 80 % to 100 %, `over` above 100 %, `no-budget` without a budget.
- Category names are unique (ignoring case). Deleting a category also deletes its budget; if it still has expenses, they
  are first moved to another category (in one transaction, so either everything happens or nothing does).
- CSV export: UTF-8 with a byte-order mark, comma-separated, amounts with a dot (`12.50`). Text starting with `=`, `+`,
  `-` or `@` gets a leading `'` so Excel does not run it as a formula. If Excel shows everything in one column (some
  regional settings expect `;`), open the file with **Data → From Text/CSV**.
- Amounts are stored as integer cents, so totals are exact.

## API

All endpoints are under `/api` and use JSON; amounts are in euros.

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Server and database status |
| GET, POST | `/api/categories` | List (with expense counts) / create |
| PUT, DELETE | `/api/categories/:id` | Rename / delete (409 while it has expenses, unless `?moveTo=<categoryId>` is given) |
| GET, POST | `/api/expenses` | List (optional `month=YYYY-MM`, `categoryId`) / create |
| GET | `/api/expenses/export` | Same filters as the list, as a CSV download |
| GET, PUT, DELETE | `/api/expenses/:id` | Read / update / delete |
| GET | `/api/budgets` | List budgets |
| PUT, DELETE | `/api/budgets/:categoryId` | Set / remove a budget |
| GET | `/api/analytics/summary` | Monthly summary (optional `month=YYYY-MM`) |
| GET | `/api/analytics/trend` | Spending per month up to `month` (optional; `months` 1–24, default 6) and the monthly budget |

Errors are returned as `{"error": {"code", "message", "details"}}` with the codes `VALIDATION_ERROR` / `INVALID_JSON`
(400), `NOT_FOUND` (404), `CONFLICT` (409), `PAYLOAD_TOO_LARGE` (413) and `INTERNAL_ERROR` (500).

## Testing

`npm test` runs 124 tests with Node's built-in `node:test` runner: validation, CSV formatting, database, services, the
HTTP API and the real server process (including data surviving a restart). Each test uses its own temporary database,
so your data is never touched. Line coverage is about 97.5 %.

## Project structure

```
src/        server, app setup, validation, errors, CSV export, database, routes, services
public/     index.html, css/styles.css, js/api.js, js/app.js
tests/      unit, HTTP and server tests
docs/       development-log.md (AI-assisted development record)
report/     main.tex (LaTeX project report)
```

## Troubleshooting

| Problem | Solution |
|---|---|
| `npm.ps1 cannot be loaded` | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or use `npm.cmd`. |
| Port 3000 already in use | Stop the other program or use another port: `$env:PORT = '3100'; npm start`. |
| `npm install` asks for Python / node-gyp | Keep the project's `.npmrc` (`ignore-scripts=true`). |
| "Could not load data" in the page | Start the server and click **Retry**. |

## Documentation

- [`docs/development-log.md`](docs/development-log.md) — the actual prompts, changes, test results and commits.
- [`report/main.tex`](report/main.tex) — the project report as a LaTeX file.

**Compiling the report in Overleaf:** New Project → Upload Project → upload `report/main.tex` together with the two
screenshots in `report/` (`01-dashboard.png`, `04-tests.png`), check that the compiler is **pdfLaTeX**, then click
**Recompile** and **Download PDF**.
Locally (with MiKTeX or TeX Live): run `pdflatex main.tex` twice in the `report` folder.
