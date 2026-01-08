#!/usr/bin/env node
/**
 * Run database migrations
 *
 * This script is used in CI to verify migrations run successfully.
 * It connects to the database and runs all pending migrations.
 *
 * Usage: DATABASE_URL=postgres://... node scripts/run-migrations.js
 */

import { runMigrations, closeDb } from '../dist/cloud/db/index.js';

async function main() {
  console.log('Starting database migrations...');
  console.log(`Database URL: ${process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':***@') || 'not set'}`);

  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  try {
    await runMigrations();
    console.log('All migrations completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await closeDb();
  }
}

main();
