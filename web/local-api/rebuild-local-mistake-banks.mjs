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
const defaultUserId = '00000000-0000-0000-0000-000000000001';

const ENGLISH_TIERS = {
  high: [
    ['语法', '时态', '规则应用', '时态'],
    ['语法', '非谓语动词', '规则应用', '非谓语动词'],
    ['词汇', '词义辨析', '知识点定位', '词义辨析'],
    ['词汇', '固定搭配', '规则应用', '固定搭配'],
    ['阅读', '细节理解', '步骤执行', '阅读细节'],
    ['阅读', '主旨理解', '步骤执行', '阅读主旨'],
    ['综合', '完型填空', '规则应用', '完型填空'],
  ],
  mid: [
    ['语法', '主谓一致', '规则应用', '主谓一致'],
    ['语法', '从句', '规则应用', '从句'],
    ['语法', '被动语态', '规则应用', '被动语态'],
    ['阅读', '推理判断', '步骤执行', '阅读推理'],
    ['词法', '形容词与副词', '规则应用', '形副辨析'],
    ['翻译', '翻译技巧', '表达输出', '翻译技巧'],
  ],
  low: [
    ['语法', '虚拟语气', '规则应用', '虚拟语气'],
    ['语法', '特殊句式', '知识点定位', '倒装强调'],
    ['词法', '介词', '知识点定位', '介词搭配'],
    ['词法', '冠词', '知识点定位', '冠词用法'],
    ['词法', '代词', '知识点定位', '代词指代'],
    ['写作', '表达准确', '表达输出', '写作表达'],
  ],
};

const C_TIERS = {
  high: [
    ['基础', '变量与数据类型', '知识点定位', '数据类型'],
    ['基础', '运算符与表达式', '规则应用', '运算表达式'],
    ['基础', '选择结构', '步骤执行', '分支结构'],
    ['基础', '循环结构', '规则应用', '循环控制'],
    ['基础', '数组', '规则应用', '数组边界'],
    ['语法进阶', '指针', '步骤执行', '指针'],
    ['基础', '函数', '规则应用', '函数调用'],
  ],
  mid: [
    ['基础', '字符串', '知识点定位', '字符串'],
    ['语法进阶', '结构体', '知识点定位', '结构体'],
    ['算法', '排序与查找', '规则应用', '排序查找'],
    ['算法', '边界条件', '规则应用', '边界条件'],
    ['基础语法', '预处理与宏定义', '知识点定位', '宏定义'],
    ['算法基础', '位运算', '步骤执行', '位运算'],
  ],
  low: [
    ['语法进阶', '文件操作', '步骤执行', '文件操作'],
    ['语法进阶', '内存管理', '步骤执行', '内存管理'],
    ['函数与模块', '递归算法', '规则应用', '递归'],
    ['数据结构', '共用体与枚举', '知识点定位', '枚举共用体'],
    ['内存与指针', '函数指针', '规则应用', '函数指针'],
    ['输入输出', '格式化输入输出', '步骤执行', '格式化IO'],
  ],
};

const ENGLISH_WEIGHT_PLAN = { high: 60, mid: 35, low: 25 };
const C_WEIGHT_PLAN = { high: 60, mid: 35, low: 25 };

function masteryByTier(tier) {
  if (tier === 'high') return { mastery: 40, confidence: 0.4 };
  if (tier === 'mid') return { mastery: 55, confidence: 0.55 };
  return { mastery: 68, confidence: 0.68 };
}

function chooseAnswer(index) {
  return ['A', 'B', 'C', 'D'][index % 4];
}

function stringifyChoice(stem, options) {
  return [stem, `A. ${options.A}`, `B. ${options.B}`, `C. ${options.C}`, `D. ${options.D}`].join('\n');
}

function buildEnglishChoice(topicName, index) {
  const answers = [
    {
      stem: 'The teacher suggested that every student ____ a weekly reading plan.',
      options: { A: 'make', B: 'makes', C: 'made', D: 'making' },
      answer: 'A',
    },
    {
      stem: 'By the end of this month, she ____ three mock tests.',
      options: { A: 'finishes', B: 'will finish', C: 'will have finished', D: 'finished' },
      answer: 'C',
    },
    {
      stem: 'The report was delayed ____ the missing data.',
      options: { A: 'because', B: 'because of', C: 'although', D: 'unless' },
      answer: 'B',
    },
    {
      stem: 'I prefer the plan ____ can improve writing speed.',
      options: { A: 'who', B: 'what', C: 'which', D: 'whose' },
      answer: 'C',
    },
    {
      stem: 'No sooner ____ the bell ring than the students entered the room.',
      options: { A: 'did', B: 'had', C: 'was', D: 'has' },
      answer: 'B',
    },
  ];
  const pick = answers[index % answers.length];
  const rotate = chooseAnswer(index);
  const map = rotate === 'A' ? ['A', 'B', 'C', 'D'] : rotate === 'B' ? ['B', 'C', 'D', 'A'] : rotate === 'C' ? ['C', 'D', 'A', 'B'] : ['D', 'A', 'B', 'C'];
  const raw = [pick.options.A, pick.options.B, pick.options.C, pick.options.D];
  const keyed = {
    A: raw[map.indexOf('A')],
    B: raw[map.indexOf('B')],
    C: raw[map.indexOf('C')],
    D: raw[map.indexOf('D')],
  };
  return {
    question_text: stringifyChoice(pick.stem, keyed),
    question_type: 'choice',
    correct_answer: rotate,
    note: `知识点：${topicName}`,
  };
}

function buildEnglishFill(topicName, index) {
  const items = [
    { stem: 'If I ____ you, I would revise this paragraph.', answer: 'were' },
    { stem: 'The manager asked us ____ the task before Friday.', answer: 'to finish' },
    { stem: 'She is one of the students who ____ very hard.', answer: 'study' },
    { stem: 'The book ____ on the desk belongs to me.', answer: 'lying' },
    { stem: 'Hardly had he arrived ____ it began to rain.', answer: 'when' },
  ];
  const pick = items[index % items.length];
  return {
    question_text: pick.stem,
    question_type: 'fill',
    correct_answer: pick.answer,
    note: `知识点：${topicName}`,
  };
}

function buildEnglishJudge(topicName, index) {
  const items = [
    { stem: '判断：在英语中，形容词一般不能单独修饰动词。', answer: '正确' },
    { stem: '判断：定语从句中关系代词which可以指代物。', answer: '正确' },
    { stem: '判断：if引导的虚拟语气与现在事实相反时，be动词只能用was。', answer: '错误' },
    { stem: '判断：完成时态一定表示过去发生的动作。', answer: '错误' },
  ];
  const pick = items[index % items.length];
  return {
    question_text: pick.stem,
    question_type: 'judge',
    correct_answer: pick.answer,
    note: `知识点：${topicName}`,
  };
}

function buildCChoice(topicName, index) {
  const items = [
    {
      stem: '已知 int a=5,b=2; 表达式 a/b 的值是？',
      options: { A: '2', B: '2.5', C: '3', D: '0' },
      answer: 'A',
    },
    {
      stem: '下列哪种声明表示“指向int的指针”？',
      options: { A: 'int p;', B: 'int *p;', C: 'int &p;', D: 'int p*;' },
      answer: 'B',
    },
    {
      stem: '若 int arr[5]; 则合法下标是？',
      options: { A: '1~5', B: '0~5', C: '0~4', D: '1~4' },
      answer: 'C',
    },
    {
      stem: '下列哪个函数用于打开文件？',
      options: { A: 'openfile()', B: 'fopen()', C: 'fileopen()', D: 'open()' },
      answer: 'B',
    },
    {
      stem: 'switch语句中用于结束当前case的语句是？',
      options: { A: 'return', B: 'continue', C: 'exit', D: 'break' },
      answer: 'D',
    },
  ];
  const pick = items[index % items.length];
  return {
    question_text: stringifyChoice(pick.stem, pick.options),
    question_type: 'choice',
    correct_answer: pick.answer,
    note: `知识点：${topicName}`,
  };
}

function buildCFill(topicName, index) {
  const items = [
    { stem: 'C程序执行入口函数是 ____ 。', answer: 'main' },
    { stem: '字符串结束标志字符是 ____ 。', answer: '\\0' },
    { stem: '在循环中跳过本次迭代应使用 ____ 语句。', answer: 'continue' },
    { stem: 'fopen函数打开失败时返回 ____ 。', answer: 'NULL' },
    { stem: '表达式 x % 2 == 0 常用于判断x是否为 ____ 。', answer: '偶数' },
  ];
  const pick = items[index % items.length];
  return {
    question_text: pick.stem,
    question_type: 'fill',
    correct_answer: pick.answer,
    note: `知识点：${topicName}`,
  };
}

function buildCJudge(topicName, index) {
  const items = [
    { stem: '判断：二维数组在内存中按行优先存储。', answer: '正确' },
    { stem: '判断：指针变量可以不初始化直接解引用。', answer: '错误' },
    { stem: '判断：结构体成员访问可以使用点运算符。', answer: '正确' },
    { stem: '判断：递归函数不需要终止条件也能正常结束。', answer: '错误' },
  ];
  const pick = items[index % items.length];
  return {
    question_text: pick.stem,
    question_type: 'judge',
    correct_answer: pick.answer,
    note: `知识点：${topicName}`,
  };
}

function buildQuestionByType(subject, topicName, index) {
  const mode = index % 10;
  if (subject === '英语') {
    if (mode <= 4) return buildEnglishChoice(topicName, index);
    if (mode <= 7) return buildEnglishFill(topicName, index);
    return buildEnglishJudge(topicName, index);
  }
  if (mode <= 4) return buildCChoice(topicName, index);
  if (mode <= 7) return buildCFill(topicName, index);
  return buildCJudge(topicName, index);
}

function generateSubjectQuestions(subject, tiers, plan) {
  const rows = [];
  const now = Date.now();
  const tierEntries = Object.entries(plan);
  let globalIndex = 0;
  for (const [tier, total] of tierEntries) {
    const topics = tiers[tier];
    for (let i = 0; i < total; i += 1) {
      const topic = topics[i % topics.length];
      const [category, node, ability, errorType] = topic;
      const meta = masteryByTier(tier);
      const built = buildQuestionByType(subject, node, globalIndex);
      const createdAt = new Date(now - (globalIndex % 21) * 86400000).toISOString();
      const nextReviewDate = new Date(now + ((globalIndex % 5) - 2) * 86400000).toISOString();
      rows.push({
        subject,
        category,
        node,
        knowledge_point: node,
        ability,
        error_type: errorType,
        question_text: built.question_text,
        question_type: built.question_type,
        correct_answer: built.correct_answer,
        summary: `${node}错题`,
        note: built.note,
        review_count: 1 + (globalIndex % 3),
        stubborn_flag: globalIndex % 7 === 0,
        mastery_level: meta.mastery,
        confidence: meta.confidence,
        next_review_date: nextReviewDate,
        created_at: createdAt,
      });
      globalIndex += 1;
    }
  }
  return rows;
}

async function getUserIds(client) {
  const result = await client.query('SELECT id FROM auth.users ORDER BY created_at DESC NULLS LAST');
  if (result.rows.length > 0) {
    return result.rows.map((item) => String(item.id));
  }
  await client.query(
    `INSERT INTO auth.users (id, email)
     VALUES ($1::uuid, $2)
     ON CONFLICT (id) DO NOTHING`,
    [defaultUserId, 'local-seed@vlearn.dev'],
  );
  return [defaultUserId];
}

async function clearSubjectData(client, userId, subject) {
  const idsResult = await client.query(
    'SELECT id FROM questions WHERE user_id = $1 AND subject = $2',
    [userId, subject],
  );
  const questionIds = idsResult.rows.map((row) => row.id);
  if (questionIds.length > 0) {
    await client.query(
      'DELETE FROM question_review_attempts WHERE user_id = $1 AND question_id = ANY($2::uuid[])',
      [userId, questionIds],
    );
  }
  await client.query('DELETE FROM review_plan_cache WHERE user_id = $1', [userId]);
  await client.query(
    `DELETE FROM practice_attempts
     WHERE user_id = $1
       AND session_id IN (
         SELECT id FROM practice_sessions WHERE user_id = $1 AND subject = $2
       )`,
    [userId, subject],
  );
  await client.query('DELETE FROM practice_sessions WHERE user_id = $1 AND subject = $2', [userId, subject]);
  await client.query('DELETE FROM questions WHERE user_id = $1 AND subject = $2', [userId, subject]);
}

async function insertQuestions(client, userId, rows) {
  const inserted = [];
  for (const item of rows) {
    const result = await client.query(
      `INSERT INTO questions (
        user_id, subject, question_text, category, node, knowledge_point, ability, error_type,
        question_type, correct_answer, summary, note, review_count, stubborn_flag, mastery_level,
        confidence, next_review_date, created_at, is_archived
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,FALSE
      )
      RETURNING id, subject, knowledge_point, ability, error_type, correct_answer, question_type`,
      [
        userId,
        item.subject,
        item.question_text,
        item.category,
        item.node,
        item.knowledge_point,
        item.ability,
        item.error_type,
        item.question_type,
        item.correct_answer,
        item.summary,
        item.note,
        item.review_count,
        item.stubborn_flag,
        item.mastery_level,
        item.confidence,
        item.next_review_date,
        item.created_at,
      ],
    );
    inserted.push(result.rows[0]);
  }
  return inserted;
}

async function seedReviewHistory(client, userId, insertedQuestions) {
  const subset = insertedQuestions.slice(0, 36);
  for (let i = 0; i < subset.length; i += 1) {
    const q = subset[i];
    const isCorrect = i % 3 !== 0;
    const rating = isCorrect ? (i % 2 === 0 ? 'mastered' : 'vague') : 'forgot';
    const createdAt = new Date(Date.now() - (i + 1) * 3600000).toISOString();
    await client.query(
      `INSERT INTO question_review_attempts (
        user_id, question_id, question_type, user_answer, selected_option_text, correct_answer,
        is_correct, rating, error_type, ai_diagnosis, next_review_date, created_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12
      )`,
      [
        userId,
        q.id,
        q.question_type,
        isCorrect ? q.correct_answer : q.question_type === 'choice' ? 'D' : q.question_type === 'judge' ? '错误' : '错误答案',
        q.question_type === 'choice' ? (isCorrect ? q.correct_answer : 'D') : null,
        q.correct_answer,
        isCorrect,
        rating,
        q.error_type,
        JSON.stringify({
          source: 'local-api-rebuild',
          why_wrong: `${q.knowledge_point}易错规则遗漏`,
          fix_strategy: `针对${q.knowledge_point}进行分层复盘`,
        }),
        createdAt,
        createdAt,
      ],
    );
  }
}

async function rebuildWeakness(client, userId, insertedQuestions) {
  await client.query('DELETE FROM user_weakness WHERE user_id = $1', [userId]);
  const grouped = new Map();
  for (const item of insertedQuestions) {
    const key = `${item.knowledge_point}::${item.ability}`;
    const current = grouped.get(key) || { knowledge_point: item.knowledge_point, ability: item.ability, count: 0 };
    current.count += 1;
    grouped.set(key, current);
  }
  for (const value of grouped.values()) {
    await client.query(
      `INSERT INTO user_weakness (user_id, knowledge_point, ability, error_count, last_updated)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (user_id, knowledge_point, ability)
       DO UPDATE SET error_count = EXCLUDED.error_count, last_updated = NOW()`,
      [userId, value.knowledge_point, value.ability, value.count],
    );
  }
}

function buildNodeMarkdown(tag, data) {
  const lines = [];
  lines.push(`# ${tag}`);
  lines.push('');
  lines.push('### 解题方法');
  lines.push(`- 先识别题型，再按${tag}对应规则作答。`);
  lines.push('- 先做确定项，最后处理易混选项或边界情况。');
  lines.push('- 作答后反向检查关键词、时态/语义或边界条件。');
  lines.push('');
  lines.push('### 判断线索');
  lines.push(`- 常见能力维度：${Array.from(data.abilities).slice(0, 3).join('、') || '规则应用'}。`);
  lines.push(`- 常见错误标签：${Array.from(data.errorTypes).slice(0, 4).join('、') || tag}。`);
  lines.push(`- 题型分布：选择题 ${data.choice} / 填空题 ${data.fill} / 判断题 ${data.judge}。`);
  lines.push('');
  lines.push('### 易错规律');
  lines.push('- 容易只看表面关键词，忽略限定条件。');
  lines.push('- 容易在相似选项或相近概念间混淆。');
  lines.push('- 复盘时建议记录“错误原因 + 正确触发条件”。');
  return lines.join('\n');
}

async function rebuildLearningState(client, userId, insertedQuestions) {
  const grouped = new Map();
  for (const item of insertedQuestions) {
    const tag = String(item.knowledge_point || '').trim() || '未分类';
    const current = grouped.get(tag) || {
      subject: item.subject || '英语',
      count: 0,
      choice: 0,
      fill: 0,
      judge: 0,
      abilities: new Set(),
      errorTypes: new Set(),
    };
    current.count += 1;
    if (item.question_type === 'choice') current.choice += 1;
    if (item.question_type === 'fill') current.fill += 1;
    if (item.question_type === 'judge') current.judge += 1;
    if (item.ability) current.abilities.add(String(item.ability));
    if (item.error_type) current.errorTypes.add(String(item.error_type));
    grouped.set(tag, current);
  }

  const drawerByTag = {};
  const tipsByNode = {};
  for (const [tag, data] of grouped.entries()) {
    drawerByTag[tag] = {
      title: `${tag}知识点`,
      markdown: buildNodeMarkdown(tag, data),
    };
    tipsByNode[tag] = [
      `${tag}先判题型再作答`,
      '先排除明显错误项',
      '复盘记录错因与触发条件',
    ];
  }

  await client.query(
    `INSERT INTO user_learning_state (user_id, tag_extensions, taxonomy_overrides, learning_content, updated_at)
     VALUES ($1,$2::jsonb,$3::jsonb,$4::jsonb,NOW())
     ON CONFLICT (user_id)
     DO UPDATE SET
       tag_extensions = EXCLUDED.tag_extensions,
       taxonomy_overrides = EXCLUDED.taxonomy_overrides,
       learning_content = EXCLUDED.learning_content,
       updated_at = NOW()`,
    [
      userId,
      JSON.stringify({}),
      JSON.stringify({}),
      JSON.stringify({
        tipsByNode,
        drawerByTag,
      }),
    ],
  );
}

async function rebuildForUser(client, userId) {
  await clearSubjectData(client, userId, '英语');
  await clearSubjectData(client, userId, 'C语言');
  await client.query('DELETE FROM user_learning_state WHERE user_id = $1', [userId]);

  const englishRows = generateSubjectQuestions('英语', ENGLISH_TIERS, ENGLISH_WEIGHT_PLAN);
  const cRows = generateSubjectQuestions('C语言', C_TIERS, C_WEIGHT_PLAN);

  const insertedEnglish = await insertQuestions(client, userId, englishRows);
  const insertedC = await insertQuestions(client, userId, cRows);
  await seedReviewHistory(client, userId, [...insertedEnglish, ...insertedC]);
  await rebuildWeakness(client, userId, [...insertedEnglish, ...insertedC]);
  await rebuildLearningState(client, userId, [...insertedEnglish, ...insertedC]);

  return {
    english: insertedEnglish.length,
    cLang: insertedC.length,
  };
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userIds = await getUserIds(client);
    let totalEnglish = 0;
    let totalC = 0;
    for (const userId of userIds) {
      const result = await rebuildForUser(client, userId);
      totalEnglish += result.english;
      totalC += result.cLang;
    }
    await client.query('COMMIT');
    process.stdout.write(`rebuild users: ${userIds.length}\n`);
    process.stdout.write(`english questions inserted: ${totalEnglish}\n`);
    process.stdout.write(`c questions inserted: ${totalC}\n`);
    process.stdout.write('local-api mistake banks rebuild completed\n');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

main()
  .catch((error) => {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
