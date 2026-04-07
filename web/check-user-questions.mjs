import { Pool } from 'pg';

const pool = new Pool({ connectionString: 'postgresql://root:root@localhost:44333/vlearn' });

async function checkUserQuestions() {
  try {
    const userId = '359ed1b4-913b-41a2-8d9f-f597d0f2084c';

    const res = await pool.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN is_archived = TRUE THEN 1 ELSE 0 END) as archived,
        SUM(CASE WHEN mastery_state = 'mastered' THEN 1 ELSE 0 END) as mastered,
        SUM(CASE WHEN next_review_date <= NOW() THEN 1 ELSE 0 END) as due,
        SUM(CASE WHEN stubborn_flag = TRUE THEN 1 ELSE 0 END) as stubborn,
        COUNT(DISTINCT subject) as subjects_count
      FROM questions 
      WHERE user_id = $1
    `, [userId]);

    console.log('User 1300968688@qq.com Stats:');
    console.log(res.rows[0]);

    const subjects = await pool.query('SELECT subject, COUNT(*) FROM questions WHERE user_id = $1 GROUP BY subject', [userId]);
    console.log('\nSubjects:');
    console.log(subjects.rows);

    const categories = await pool.query('SELECT category, COUNT(*) FROM questions WHERE user_id = $1 GROUP BY category', [userId]);
    console.log('\nCategories:');
    console.log(categories.rows);

    const l2s = await pool.query('SELECT knowledge_point, COUNT(*) FROM questions WHERE user_id = $1 GROUP BY knowledge_point', [userId]);
    console.log('\nKnowledge Points (L2):');
    console.log(l2s.rows);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

checkUserQuestions();