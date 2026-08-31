import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env variables
dotenv.config({ path: path.join(__dirname, '../.env.local') });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ Error: DATABASE_URL not found in .env.local');
  process.exit(1);
}

const client = new pg.Client({
  connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});

async function run() {
  try {
    console.log('🔌 Connecting to Postgres database...');
    await client.connect();
    console.log('✓ Connected successfully.');

    const sqlPath = path.join(__dirname, '../supabase_migrations/add_collector_to_loans.sql');
    console.log(`📋 Reading SQL from ${sqlPath}...`);
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('⚙️ Executing migration SQL...');
    await client.query(sql);
    console.log('✓ Migration applied successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    await client.end();
  }
}

run();
