const { Pool } = require('pg');

async function migrate() {
  const pool = new Pool({ connectionString: 'postgres://root:root@localhost:44333/vlearn' });
  const { rows } = await pool.query('SELECT id, note FROM questions');
  
  let updated = 0;
  for (const row of rows) {
    if (!row.note) continue;
    let newNote = row.note;
    
    // Replace old headings with new ones
    newNote = newNote.replace(/【核心错因分析】/g, '【错因分析】');
    newNote = newNote.replace(/【正确思路拆解】/g, '【核心解析】');
    newNote = newNote.replace(/核心错因：/g, '【错因分析】\n');
    
    // If it has "步骤1 xxx：yyy", let's transform it to "【xxx】\nyyy"
    // e.g. "步骤1 题眼定位：xxx" -> "【题眼定位】\nxxx"
    newNote = newNote.replace(/步骤\d+\s*(.+?)[:：]\s*(.*)/g, '【$1】\n$2');
    newNote = newNote.replace(/步骤\d+\s*-\s*(.+?)[:：]?\s*(.*)/g, '【$1】\n$2');
    
    if (newNote !== row.note) {
      await pool.query('UPDATE questions SET note = $1 WHERE id = $2', [newNote, row.id]);
      updated++;
    }
  }
  
  console.log(`Migrated ${updated} questions.`);
  await pool.end();
}

migrate().catch(console.error);
