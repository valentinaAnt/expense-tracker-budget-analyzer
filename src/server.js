import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { openDatabase } from './db/database.js';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB_PATH || fileURLToPath(new URL('../data/expenses.db', import.meta.url));

let db;
try {
  db = openDatabase(DB_PATH);
} catch (error) {
  console.error(`Could not open database at ${DB_PATH}: ${error.message}`);
  process.exit(1);
}

const app = createApp(db);

const server = app.listen(PORT, HOST, (error) => {
  if (error) {
    console.error(`Could not start server on port ${PORT}: ${error.message}`);
    db.close();
    process.exit(1);
  }
  console.log(`Expense Tracker running at http://${HOST}:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
});

// Close the HTTP server and the database cleanly on Ctrl+C.
function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
