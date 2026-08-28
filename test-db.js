const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres.ljltszslriajsodsfsyx',
  password: 'Madeofsteel12',
  host: 'aws-1-eu-west-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  ssl: true
});

pool.query('SELECT version();', (err, res) => {
  if (err) {
    console.error('❌ Connection failed:', err.message);
    process.exit(1);
  } else {
    console.log('✅ Connected!');
    console.log('Database version:', res.rows[0].version);
    process.exit(0);
  }
});

setTimeout(() => {
  console.error('❌ Connection timeout');
  process.exit(1);
}, 5000);
