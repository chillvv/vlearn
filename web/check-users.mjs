import { Pool } from 'pg';

const pool = new Pool({ connectionString: 'postgresql://root:root@localhost:44333/vlearn' });

async function checkUsers() {
  try {
    const users = await pool.query('SELECT id, email FROM auth.users');
    console.log('Users in DB:');
    console.log(users.rows);

    const questionsByUser = await pool.query('SELECT user_id, COUNT(*) FROM questions GROUP BY user_id');
    console.log('\nQuestions by User ID:');
    console.log(questionsByUser.rows);

    const questionFields = await pool.query('SELECT id, subject, question_text, created_at FROM questions LIMIT 3');
    console.log('\nSample Questions:');
    console.log(questionFields.rows.map(r => r.question_text.substring(0, 30)));
    
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

checkUsers();