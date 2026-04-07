import { Pool } from 'pg';

const pool = new Pool({ connectionString: 'postgresql://root:root@localhost:44333/vlearn' });

async function checkQuestions() {
  try {
    const total = await pool.query('SELECT COUNT(*) FROM questions');
    const archived = await pool.query('SELECT COUNT(*) FROM questions WHERE is_archived = TRUE');
    const active = await pool.query('SELECT COUNT(*) FROM questions WHERE COALESCE(is_archived, FALSE) = FALSE');
    
    console.log(`总题目数 (Total): ${total.rows[0].count}`);
    console.log(`被归档的题目数 (Archived, 前端默认不显示): ${archived.rows[0].count}`);
    console.log(`活跃的题目数 (Active, 前端默认显示): ${active.rows[0].count}`);

    const masteryStates = await pool.query('SELECT mastery_state, COUNT(*) FROM questions GROUP BY mastery_state');
    console.log('\n按掌握状态分布:');
    masteryStates.rows.forEach(row => {
      console.log(`- ${row.mastery_state || '空'}: ${row.count}`);
    });

    const subjects = await pool.query('SELECT subject, COUNT(*) FROM questions GROUP BY subject');
    console.log('\n按科目分布:');
    subjects.rows.forEach(row => {
      console.log(`- ${row.subject || '空'}: ${row.count}`);
    });
    
  } catch (err) {
    console.error('数据库查询失败:', err);
  } finally {
    await pool.end();
  }
}

checkQuestions();