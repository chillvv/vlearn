import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envFilePath = path.join(__dirname, '.env');

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith('\'') && value.endsWith('\''))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile(envFilePath);

const databaseUrl = String(process.env.DATABASE_URL || '').trim();
if (!databaseUrl) {
  throw new Error('缺少 DATABASE_URL');
}

const pool = new Pool({ connectionString: databaseUrl });

const MOCK_KNOWLEDGE_SUMMARIES = {
  '时态': {
    title: '英语：时态',
    markdown: '### 判别主线\n- 先看时间状语（by the time、since、for）再定时态。\n- 再看动作先后关系：先发生常用完成体，后发生常用一般时。\n\n### 高频错位\n- 看到 by the time 容易误判成同一时态。\n- 主句已给完成体时，从句常需回到一般过去时。\n\n### 易错规律\n- 不要只凭中文“已经”选时态，必须回到句内证据。'
  },
  '虚拟语气': {
    title: '英语：虚拟语气',
    markdown: '### 核心规则\n- 与现在事实相反：if从句用过去式，主句用would/could/should/might + 动词原形。\n- 与过去事实相反：if从句用had + 过去分词，主句用would/could/should/might + have + 过去分词。\n\n### 高频陷阱\n- 混合时间虚拟语气：从句与过去事实相反，主句与现在事实相反。\n- 倒装结构：省略if，将were/had/should提到主语前面。'
  },
  '变量与数据类型': {
    title: 'C语言：变量与数据类型',
    markdown: '### 基础考点\n- C语言中十六进制常量以 `0x` 开头，八进制以 `0` 开头。\n- 数据类型的内存占用：`int` 通常为4字节，`char` 1字节，`double` 8字节。\n\n### 常见错因\n- 混淆整型除法与浮点除法：`10 / 3` 的结果是 `3`，而 `10.0 / 3` 是 `3.333333`。\n- 格式化输出占位符用错，如 `%d` 和 `%f`。'
  },
  '指针': {
    title: 'C语言：指针',
    markdown: '### 核心概念\n- 指针变量存储的是地址，用 `&` 取地址，用 `*` 解引用。\n- 数组名在多数情况下会退化为指向首元素的指针。\n\n### 高频陷阱\n- 混淆指针数组与数组指针：`int *p[4]` 是指针数组，`int (*p)[4]` 是指向含有4个元素的数组的指针。\n- 越界访问与野指针问题。'
  }
};

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // 获取所有用户
    const res = await client.query('SELECT id FROM auth.users');
    const userIds = res.rows.map(row => row.id);
    
    for (const userId of userIds) {
      // 获取当前 user_learning_state
      const stateRes = await client.query('SELECT learning_content FROM user_learning_state WHERE user_id = $1', [userId]);
      
      let learning_content = { tipsByNode: {}, drawerByTag: {} };
      if (stateRes.rows.length > 0 && stateRes.rows[0].learning_content) {
        learning_content = stateRes.rows[0].learning_content;
      }
      
      if (!learning_content.drawerByTag) {
        learning_content.drawerByTag = {};
      }
      
      // 合并知识点总结
      for (const [tag, data] of Object.entries(MOCK_KNOWLEDGE_SUMMARIES)) {
        learning_content.drawerByTag[tag] = {
          title: data.title,
          markdown: data.markdown,
          summary: `已沉淀关于 ${tag} 的核心规则与高频陷阱。`
        };
      }
      
      // 更新或插入
      await client.query(
        `INSERT INTO user_learning_state (user_id, learning_content) 
         VALUES ($1, $2)
         ON CONFLICT (user_id) 
         DO UPDATE SET learning_content = EXCLUDED.learning_content, updated_at = NOW()`,
        [userId, JSON.stringify(learning_content)]
      );
    }
    
    await client.query('COMMIT');
    console.log(`Successfully updated knowledge summaries for ${userIds.length} users.`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
  } finally {
    client.release();
    pool.end();
  }
}

main();
