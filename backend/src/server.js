/**
 * CERADRIVE ERP — Server Entry Point
 *
 * Loads environment variables, imports the Express app, and binds the port.
 * No business logic here.
 */

import 'dotenv/config';
import app from './app.js';

const PORT = process.env.PORT ?? 3001;
const ENV  = process.env.NODE_ENV ?? 'development';

app.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║     CERADRIVE BRAKES ERP             ║');
  console.log('  ║     Backend API Server               ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
  console.log(`  Environment : ${ENV}`);
  console.log(`  Port        : ${PORT}`);
  console.log(`  API Base    : http://localhost:${PORT}/api/v1`);
  console.log(`  Health      : http://localhost:${PORT}/api/v1/health`);
  console.log('');
});
