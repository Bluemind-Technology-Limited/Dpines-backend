#!/usr/bin/env node

/**
 * Script to apply Supabase migrations to the database
 * Run: node apply_migration.js
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error('❌ Error: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not found in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  db: { schema: 'public' }
});

async function applyMigration() {
  try {
    console.log('📋 Reading migration file...');
    const migrationPath = path.join(__dirname, 'supabase_migrations', 'add_collector_to_loans.sql');
    const migrationSql = fs.readFileSync(migrationPath, 'utf-8');
    
    console.log('🔗 Connecting to Supabase...');
    
    // Get the RLS policy to check connection
    const { data: policies, error: checkError } = await supabase.rpc('get_policies', {
      p_schema: 'public',
      p_table: 'loans'
    }).catch(() => ({ data: null, error: null }));
    
    console.log('⚙️  Applying migration...');
    console.log('\n' + '='.repeat(60));
    console.log('SQL:');
    console.log('='.repeat(60));
    console.log(migrationSql);
    console.log('='.repeat(60) + '\n');
    
    // Split by semicolon and execute each statement
    const statements = migrationSql
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0);
    
    console.log(`Found ${statements.length} SQL statements to execute\n`);
    
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      console.log(`[${i + 1}/${statements.length}] Executing statement...`);
      console.log(`${stmt.substring(0, 80)}...`);
      
      // We need to use the raw database connection
      // Since Supabase JS client doesn't support raw SQL, we'll provide instructions
    }
    
    console.log('\n❌ Note: Supabase JS SDK cannot execute raw SQL.');
    console.log('\n✅ To apply this migration, please:');
    console.log('1. Go to Supabase Dashboard: https://app.supabase.com');
    console.log('2. Select your project');
    console.log('3. Go to SQL Editor');
    console.log('4. Click "New Query"');
    console.log('5. Copy and paste the SQL above');
    console.log('6. Click "Run"');
    console.log('\nMigration file location: supabase_migrations/add_collector_to_loans.sql');
    
  } catch (error) {
    console.error('❌ Error applying migration:', error.message);
    process.exit(1);
  }
}

applyMigration();
