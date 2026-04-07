import { Pool } from 'pg';
import { readFileSync } from 'fs';
const env = readFileSync('./local-api/.env', 'utf-8').split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=')[1].trim();
const pool = new Pool({ connectionString: env });
pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'review_plan_telemetry'").then(res => {
  console.log(res.rows);
  pool.end();
});