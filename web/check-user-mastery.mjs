import { Pool } from 'pg';

const pool = new Pool({ connectionString: 'postgresql://root:root@localhost:44333/vlearn' });

async function checkUserMasteryLevel() {
  try {
    const userId = '359ed1b4-913b-41a2-8d9f-f597d0f2084c';

    const levels = await pool.query(`
      SELECT 
        COUNT(*) as count,
        SUM(CASE WHEN COALESCE(mastery_level, ROUND(COALESCE(confidence, 0.5) * 100)) >= 80 THEN 1 ELSE 0 END) as greater_than_80,
        SUM(CASE WHEN COALESCE(mastery_level, ROUND(COALESCE(confidence, 0.5) * 100)) < 80 THEN 1 ELSE 0 END) as less_than_80
      FROM questions 
      WHERE user_id = $1
    `, [userId]);

    console.log('User mastery levels:');
    console.log(levels.rows[0]);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

checkUserMasteryLevel();