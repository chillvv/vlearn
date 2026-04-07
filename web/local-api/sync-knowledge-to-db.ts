import { KNOWLEDGE_DB, buildKnowledgeMarkdownFromData } from '../src/app/lib/knowledgeContent';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: 'postgres://root:root@localhost:44333/vlearn' });

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    for (const [tag, data] of Object.entries(KNOWLEDGE_DB)) {
      if (tag === 'default') continue;
      
      const markdown = buildKnowledgeMarkdownFromData(data, tag);
      console.log(`Updating ${tag}... length: ${markdown.length}`);
      
      await client.query(
        `UPDATE knowledge_nodes SET tips_and_tricks = $1 WHERE node = $2`,
        [markdown, tag]
      );
    }
    
    await client.query('COMMIT');
    console.log('Successfully updated database with rich markdown knowledge content!');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error:', e);
  } finally {
    client.release();
    pool.end();
  }
}

run();