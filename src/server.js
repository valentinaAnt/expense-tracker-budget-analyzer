import { createApp } from './app.js';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 3000;

const app = createApp();

app.listen(PORT, HOST, (error) => {
  if (error) {
    console.error(`Could not start server on port ${PORT}: ${error.message}`);
    process.exit(1);
  }
  console.log(`Expense Tracker running at http://${HOST}:${PORT}`);
});
