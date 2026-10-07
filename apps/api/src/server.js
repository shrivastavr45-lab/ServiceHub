import { createApp } from './app.js';
import { config } from './config.js';
import { migrate } from './migrate.js';
import { pool } from './db.js';

await migrate();
const server = createApp().listen(config.PORT, () => console.log(`ServiceHub API listening on :${config.PORT}`));
const shutdown = () => server.close(() => pool.end().then(() => process.exit(0)));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
