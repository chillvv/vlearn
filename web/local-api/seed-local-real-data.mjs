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
const seedTag = 'seed-local-real-v2';
const seedTagPrefix = 'seed-local-real-v';
const defaultSeedUser = '00000000-0000-0000-0000-000000000001';
const supabaseUrl = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

const ENGLISH_BLUEPRINT_META = [
  { category: '语法', node: '时态', ability: '规则应用', errorType: '时态' },
  { category: '语法', node: '主谓一致', ability: '知识点定位', errorType: '主谓一致' },
  { category: '语法', node: '虚拟语气', ability: '规则应用', errorType: '虚拟语气' },
  { category: '语法', node: '从句', ability: '知识点定位', errorType: '从句' },
  { category: '语法', node: '被动语态', ability: '规则应用', errorType: '写作表达' },
  { category: '语法', node: '非谓语动词', ability: '规则应用', errorType: '非谓语动词' },
  { category: '词汇', node: '介词', ability: '表达输出', errorType: '词义辨析' },
  { category: '词汇', node: '冠词', ability: '知识点定位', errorType: '词义辨析' },
  { category: '词汇', node: '代词', ability: '规则应用', errorType: '词义辨析' },
  { category: '词汇', node: '词形变化', ability: '表达输出', errorType: '词义辨析' },
  { category: '词汇', node: '词义辨析', ability: '知识点定位', errorType: '词义辨析' },
  { category: '词汇', node: '固定搭配', ability: '规则应用', errorType: '固定搭配' },
  { category: '阅读', node: '主旨理解', ability: '步骤执行', errorType: '阅读主旨' },
  { category: '阅读', node: '细节理解', ability: '步骤执行', errorType: '阅读细节' },
  { category: '阅读', node: '推理判断', ability: '规则应用', errorType: '阅读推理' },
  { category: '阅读', node: '句子结构', ability: '知识点定位', errorType: '阅读推理' },
  { category: '阅读', node: '逻辑连接', ability: '步骤执行', errorType: '阅读推理' },
  { category: '写作', node: '表达准确', ability: '表达输出', errorType: '写作表达' },
];

const C_BLUEPRINT_META = [
  { category: '基础', node: '变量与数据类型', ability: '知识点定位', errorType: '数据类型' },
  { category: '基础', node: '运算符与表达式', ability: '规则应用', errorType: '运算表达式' },
  { category: '基础', node: '选择结构', ability: '步骤执行', errorType: '分支循环' },
  { category: '基础', node: '循环结构', ability: '规则应用', errorType: '分支循环' },
  { category: '基础', node: '函数', ability: '知识点定位', errorType: '函数调用' },
  { category: '基础', node: '数组', ability: '规则应用', errorType: '数组' },
  { category: '基础', node: '字符串', ability: '知识点定位', errorType: '字符串' },
  { category: '语法进阶', node: '指针', ability: '步骤执行', errorType: '指针' },
  { category: '语法进阶', node: '结构体', ability: '知识点定位', errorType: '结构体' },
  { category: '语法进阶', node: '文件操作', ability: '步骤执行', errorType: '文件操作' },
  { category: '算法', node: '排序与查找', ability: '规则应用', errorType: '排序查找' },
  { category: '语法进阶', node: '内存管理', ability: '步骤执行', errorType: '内存管理' },
  { category: '算法', node: '边界条件', ability: '规则应用', errorType: '边界条件' },
];

 const ENGLISH_WRITING_EVIDENCE_BANK = [
  // 类别1：学习与成长 (Study & Growth) - 专升本极高频
  { text: '【论证素材-学习成长】请用英文写1句“对比型例子”支持观点：Reading broadens our horizons.', answer: 'Compared with those who never read, people who read regularly have a deeper understanding of the world.' },
  { text: '【论证素材-学习成长】请用英文写1句“数据型例子”支持观点：Lifelong learning is essential.', answer: 'According to a recent survey, over 80% of successful professionals spend at least one hour learning new skills every day.' },
  { text: '【论证素材-学习成长】请用英文写1句“因果型例子”支持观点：Good habits lead to success.', answer: 'Because he developed a habit of getting up early to study, he finally passed the difficult exam.' },
  { text: '【论证素材-学习成长】请用英文写1句“个人经历型例子”支持观点：Practice makes perfect.', answer: 'In my own experience, practicing spoken English for 20 minutes daily made me much more confident in interviews.' },
  { text: '【论证素材-学习成长】请用英文写1句“结果型例子”支持观点：Time management improves efficiency.', answer: 'By making a detailed to-do list every morning, my learning efficiency has increased significantly.' },

  // 类别2：科技与生活 (Technology & Life) - 热门话题
  { text: '【论证素材-科技生活】请用英文写1句“现象型例子”支持观点：Smartphones dominate our lives.', answer: 'For instance, it is common to see people staring at their phones whether they are on a subway or at a dinner table.' },
  { text: '【论证素材-科技生活】请用英文写1句“让步+转折例子”支持观点：Technology has drawbacks.', answer: 'Although the Internet brings convenience, it also causes problems like information overload and privacy leaks.' },
  { text: '【论证素材-科技生活】请用英文写1句“对比型例子”支持观点：Online communication lacks warmth.', answer: 'Unlike face-to-face communication, texting online often makes people feel isolated and lonely.' },
  { text: '【论证素材-科技生活】请用英文写1句“条件型例子”支持观点：AI changes the future.', answer: 'If we make good use of artificial intelligence, it will save us a huge amount of time in doing repetitive work.' },
  { text: '【论证素材-科技生活】请用英文写1句“数据型例子”支持观点：E-books are becoming popular.', answer: 'Studies show that the sales of e-books have doubled in the past five years because of their portability.' },

  // 类别3：个人品质与职场 (Personal Qualities & Career) - 核心考点
  { text: '【论证素材-个人品质】请用英文写1句“引言型例子”支持观点：Perseverance is the key to success.', answer: 'As the saying goes, "Rome was not built in a day." Only through continuous efforts can we achieve our goals.' },
  { text: '【论证素材-个人品质】请用英文写1句“假设型例子”支持观点：Teamwork is crucial.', answer: 'Without effective teamwork, it would be impossible for a company to finish such a complex project on time.' },
  { text: '【论证素材-个人品质】请用英文写1句“因果型例子”支持观点：Honesty wins trust.', answer: 'Because the store always sells high-quality products and never cheats customers, it has won a good reputation.' },
  { text: '【论证素材-个人品质】请用英文写1句“场景型例子”支持观点：Stress can be a motivation.', answer: 'When facing a tight deadline, appropriate stress often pushes me to focus better and work faster.' },
  { text: '【论证素材-个人品质】请用英文写1句“问题-解决例子”支持观点：Optimism helps overcome difficulties.', answer: 'When encountering failures, keeping a positive attitude helped me find alternative solutions instead of giving up.' },

  // 类别4：社会与环境 (Society & Environment) - 万能素材
  { text: '【论证素材-社会环境】请用英文写1句“呼吁型例子”支持观点：Environmental protection requires everyone\'s effort.', answer: 'Therefore, it is high time that we took immediate actions, such as sorting garbage and using public transportation.' },
  { text: '【论证素材-社会环境】请用英文写1句“对比型例子”支持观点：Health is more important than wealth.', answer: 'No matter how much money you earn, it is meaningless if you lose your health.' },
  { text: '【论证素材-社会环境】请用英文写1句“现象型例子”支持观点：Traffic congestion is a severe issue.', answer: 'Take big cities for example; millions of people waste hours stuck in traffic jams every morning.' },
  { text: '【论证素材-社会环境】请用英文写1句“条件型例子”支持观点：Exercise benefits health.', answer: 'As long as you keep exercising for half an hour a day, your physical and mental health will improve greatly.' },
  { text: '【论证素材-社会环境】请用英文写1句“结果型例子”支持观点：Protecting wild animals is urgent.', answer: 'If we continue to destroy their habitats, many precious species will disappear from the earth forever.' }
];

const C_CONCEPT_FILL_50 = [
  { text: '【概念填空1】一个C程序通常由一个或多个____组成。', answer: '函数' },
  { text: '【概念填空2】C程序执行的入口函数是____。', answer: 'main' },
  { text: '【概念填空3】标识符只能由字母、数字和____组成。', answer: '下划线' },
  { text: '【概念填空4】在C中，单引号括起来的是____常量。', answer: '字符' },
  { text: '【概念填空5】双引号括起来的是____。', answer: '字符串字面量' },
  { text: '【概念填空6】关系表达式的结果只有0或____。', answer: '1' },
  { text: '【概念填空7】逻辑与运算符写作____。', answer: '&&' },
  { text: '【概念填空8】逻辑或运算符写作____。', answer: '||' },
  { text: '【概念填空9】逻辑非运算符写作____。', answer: '!' },
  { text: '【概念填空10】条件运算符的形式是____。', answer: '条件?表达式1:表达式2' },
  { text: '【概念填空11】switch分支中用于阻止贯穿执行的语句是____。', answer: 'break' },
  { text: '【概念填空12】while循环属于____型循环。', answer: '当型' },
  { text: '【概念填空13】do...while循环至少会执行____次。', answer: '1' },
  { text: '【概念填空14】for(;;)在没有break时通常形成____。', answer: '死循环' },
  { text: '【概念填空15】continue语句会结束本次循环并进入____。', answer: '下一次循环' },
  { text: '【概念填空16】一维数组下标从____开始。', answer: '0' },
  { text: '【概念填空17】长度为n的一维数组最大下标是____。', answer: 'n-1' },
  { text: '【概念填空18】二维数组按____顺序存储。', answer: '行优先' },
  { text: '【概念填空19】字符串结束标志字符是____。', answer: '\\0' },
  { text: '【概念填空20】strlen函数返回字符串中不含____的字符个数。', answer: '\\0' },
  { text: '【概念填空21】函数形参在调用时接收的是____。', answer: '实参的值' },
  { text: '【概念填空22】递归函数必须有明确的____条件。', answer: '终止' },
  { text: '【概念填空23】局部变量的作用域通常在其所在的____内。', answer: '代码块' },
  { text: '【概念填空24】全局变量的作用域从定义处到文件____。', answer: '末尾' },
  { text: '【概念填空25】未显式初始化的静态存储期变量默认值为____。', answer: '0' },
  { text: '【概念填空26】使用extern声明变量时，表示该变量在别处有____。', answer: '定义' },
  { text: '【概念填空27】register变量通常____取地址。', answer: '不能' },
  { text: '【概念填空28】&运算符用于获取变量的____。', answer: '地址' },
  { text: '【概念填空29】*p表示访问指针p所指向地址中的____。', answer: '值' },
  { text: '【概念填空30】NULL通常表示____指针。', answer: '空' },
  { text: '【概念填空31】若int *p; 则p+1会跨过____个int大小。', answer: '1' },
  { text: '【概念填空32】数组名在多数表达式中会退化为____。', answer: '首元素地址' },
  { text: '【概念填空33】结构体成员通过点运算符____访问。', answer: '.' },
  { text: '【概念填空34】结构体指针访问成员应使用运算符____。', answer: '->' },
  { text: '【概念填空35】typedef的作用是为已有类型定义新的____。', answer: '类型名' },
  { text: '【概念填空36】枚举类型关键字是____。', answer: 'enum' },
  { text: '【概念填空37】共用体关键字是____。', answer: 'union' },
  { text: '【概念填空38】打开文本文件读取模式应使用____。', answer: 'r' },
  { text: '【概念填空39】二进制写模式常用____。', answer: 'wb' },
  { text: '【概念填空40】fopen失败时返回____。', answer: 'NULL' },
  { text: '【概念填空41】关闭文件的函数是____。', answer: 'fclose' },
  { text: '【概念填空42】读取一行字符串的常用函数是____。', answer: 'fgets' },
  { text: '【概念填空43】向文件写入格式化数据的函数是____。', answer: 'fprintf' },
  { text: '【概念填空44】fseek第三个参数SEEK_END表示基准位置是____。', answer: '文件末尾' },
  { text: '【概念填空45】ftell返回当前文件位置的____偏移量。', answer: '字节' },
  { text: '【概念填空46】feof在____后才可能为真。', answer: '读失败' },
  { text: '【概念填空47】十六进制常量前缀是____。', answer: '0x' },
  { text: '【概念填空48】八进制常量前缀通常是____。', answer: '0' },
  { text: '【概念填空49】把十进制转二进制常用“____取余”法。', answer: '除2' },
  { text: '【概念填空50】二分查找要求待查数组必须先____。', answer: '有序|排序' },
];

function buildEnglishExamStems(node) {
  const grammarFill = {
    时态: { text: '【专升本填空】By the time the final defense starts, the group ____ (complete) all revisions.', answer: 'will have completed' },
    主谓一致: { text: '【专升本填空】Each of the proposals ____ (need) a clear budget plan.', answer: 'needs' },
    虚拟语气: { text: '【专升本填空】If I ____ (be) in your position, I would apply for the internship immediately.', answer: 'were' },
    从句: { text: '【专升本填空】This is the lab ____ we tested the new device last semester.', answer: 'where' },
    被动语态: { text: '【专升本填空】The survey report ____ (finish) before Monday morning.', answer: 'must be finished' },
    非谓语动词: { text: '【专升本填空】____ (compare) with last year, this plan is more practical.', answer: 'Compared' },
    介词: { text: '【专升本填空】The students are responsible ____ checking the references.', answer: 'for' },
    冠词: { text: '【专升本填空】It is ____ honor to represent our class in the final speech.', answer: 'an' },
    代词: { text: '【专升本填空】Everyone should submit ____ own reflection after class.', answer: 'his or her' },
    词形变化: { text: '【专升本填空】Her explanation is clear and highly ____ (persuade).', answer: 'persuasive' },
    词义辨析: { text: '【专升本填空】The medicine can ____ the pain but cannot remove the cause.', answer: 'relieve' },
    固定搭配: { text: '【专升本填空】The manager asked us to carry ____ the safety check immediately.', answer: 'out' },
    主旨理解: { text: '【主旨概括】短文围绕“旧校舍改造后辍学率下降”。请写出英文主旨句（不超过18词）。', answer: 'Renovated school spaces improved learning engagement and reduced dropout rates.' },
    细节理解: { text: '【细节提取】短文指出产品延期的直接原因是什么？请用英文短语作答。', answer: 'critical bugs found in security testing' },
    推理判断: { text: '【推理判断】根据“她放弃短期利润并投入培训”，推断其经营取向并用英文作答。', answer: 'She values long-term development.' },
    句子结构: { text: '【句子分析】指出句子主干：Although the road was icy, the driver continued slowly.', answer: 'the driver continued slowly' },
    逻辑连接: { text: '【衔接填空】The data were incomplete; ____ , the team delayed the final decision.', answer: 'therefore' },
    表达准确: { text: '【改错重写】Many student has trouble on manage time.（写出正确句）', answer: 'Many students have trouble managing time.' },
  };
  const weakEssayByNode = {
    虚拟语气: '【短文写作】用“与现在事实相反”和“与过去事实相反”各造1句，并写1句个人反思（60-90词）。',
    固定搭配: '【短文写作】围绕“备考计划”写80词，至少使用3个固定搭配（如 carry out, take part in, focus on）。',
    介词: '【短文写作】写80词说明你的复习安排，至少正确使用5个介词短语。',
    词形变化: '【改写任务】将给定词 educate/efficient/confident 分别变形并完成三句学术语境句子。',
    表达准确: '【作文训练】写一段90词英文短文：How I Prove My Point in Writing，要求给出至少2个论证例子。',
  };
  const base = grammarFill[node] ? [
    { type: 'fill', ...grammarFill[node] }
  ] : [];
  if (node === '表达准确') {
    return [
      ...base,
      ...ENGLISH_WRITING_EVIDENCE_BANK.map((item) => ({ type: 'essay', text: item.text, answer: item.answer })),
    ];
  }
  return base;
}

function buildCExamStems(node) {
  const stemByNode = {
    '变量与数据类型': {
      fill: { text: '【填空题】C中十六进制常量以____开头；八进制常量以____开头。', answer: '0x|0' },
      read: { text: '【程序阅读】int x=10; float y=3.0; printf("%f", x/y); 写出输出结果。', answer: '3.333333|3.3333333' },
      code: { text: '【程序填空】将十进制15赋给十六进制形式变量n：int n = ____;', answer: '0xF' },
    },
    字符串: {
      fill: { text: '【填空题】字符串字面量"abcd"的值本质是该字符串的____。', answer: '首地址|起始地址' },
      read: { text: '【程序阅读】char s[]="abc"; printf("%c %c", *s, s[0]); 输出为何？', answer: 'a a' },
      code: { text: '【程序填空】已定义 char s[10]; 将"abcd"拷贝到s：____(s, "abcd");', answer: 'strcpy' },
    },
    数组: {
      fill: { text: '【填空题】二维数组a中，a表示____，a[0]表示____。', answer: '首行地址|第一行首元素地址' },
      read: { text: '【程序阅读】int a[2][3]={{1,2,3},{4,5,6}}; int (*p)[3]=a; printf("%d", p[1][2]); 输出？', answer: '6' },
      code: { text: '【程序填空】遍历int a[n]合法下标的for条件应写为 i ____ n。', answer: '<' },
    },
    指针: {
      fill: { text: '【填空题】表达式*(*(pa+i)+j)与____等价。', answer: 'pa[i][j]' },
      read: { text: '【程序阅读】int a=5,*p=&a; *p=8; printf("%d",a); 输出？', answer: '8' },
      code: { text: '【程序填空】定义“指向含4个int的一维数组”的指针p：int (____p)[4];', answer: '*' },
    },
    文件操作: {
      fill: { text: '【填空题】feof(fp)在____之后才会返回真。', answer: '读取失败|读操作失败' },
      read: { text: '【程序阅读】fseek(fp,0,SEEK_END); long n=ftell(fp); n表示什么？', answer: '文件字节长度|文件末尾位置' },
      code: { text: '【程序填空】以二进制追加模式打开文件：fopen("data.bin", "____");', answer: 'ab' },
    },
    默认: null,
  };
  const item = stemByNode[node];
  const base = item ? [
    { type: 'fill', text: item.fill.text, answer: item.fill.answer },
    { type: 'mixed', text: item.read.text, answer: item.read.answer },
    { type: 'essay', text: item.code.text, answer: item.code.answer },
  ] : [];
  if (node === '变量与数据类型') {
    return [
      ...base,
      ...C_CONCEPT_FILL_50.map((item) => ({ type: 'fill', text: item.text, answer: item.answer })),
    ];
  }
  return base;
}

const blueprints = [
  ...ENGLISH_BLUEPRINT_META.map((item) => ({
    subject: '英语',
    category: item.category,
    node: item.node,
    ability: item.ability,
    errorType: item.errorType,
    stems: buildEnglishExamStems(item.node),
  })),
  ...C_BLUEPRINT_META.map((item) => ({
    subject: 'C语言',
    category: item.category,
    node: item.node,
    ability: item.ability,
    errorType: item.errorType,
    stems: buildCExamStems(item.node),
  })),
];

function buildQuestions() {
  const now = Date.now();
  const rows = [];
  const seen = new Set();
  let index = 0;
  for (const item of blueprints) {
    for (const stem of item.stems) {
      const dedupKey = `${item.subject}::${item.node}::${stem.text.trim().toLowerCase()}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      const createdAt = new Date(now - ((index % 14) + 1) * 86400000).toISOString();
      const dueOffsetDays = (index % 3) - 1;
      const nextReviewDate = new Date(now + dueOffsetDays * 86400000).toISOString();
      const mastery = 35 + (index % 9) * 7;
      const confidence = Math.max(0.25, Math.min(0.92, mastery / 100));
      rows.push({
        subject: item.subject,
        category: item.category,
        node: item.node,
        knowledge_point: item.node,
        ability: item.ability,
        error_type: item.errorType,
        question_text: stem.text,
        question_type: stem.type,
        correct_answer: stem.answer,
        summary: `高频易错点：${item.node}`,
        note: `【核心错因分析】\n本题重点考查【${item.node}】。做错本题往往是因为对该知识点的核心规则记忆模糊，或是在实际应用中忽略了常见的边缘陷阱与特殊情况。\n\n【正确思路拆解】\n正确答案是：“${stem.answer}”。\n解题时，需要严格按照【${item.node}】的定义与要求，一步步对照题干信息进行推导。建议复习时多关注此知识点的基础技巧与易错提醒，避免下次踩坑。`,
        review_count: 1 + (index % 4),
        stubborn_flag: index % 5 === 0,
        mastery_level: mastery,
        confidence,
        next_review_date: nextReviewDate,
        created_at: createdAt,
      });
      index += 1;
    }
  }
  return rows;
}

function pickRating(mastery) {
  if (mastery < 50) return 'forgot';
  if (mastery < 75) return 'vague';
  return 'mastered';
}

async function fetchCloudUserIds() {
  if (!supabaseUrl || !serviceRoleKey) return [];
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=1&per_page=50`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  }).catch(() => null);
  if (!response || !response.ok) return [];
  const payload = await response.json().catch(() => null);
  const list = Array.isArray(payload?.users) ? payload.users : Array.isArray(payload) ? payload : [];
  return list.map((item) => String(item?.id || '')).filter(Boolean);
}

async function resolveUserIds(client) {
  const specified = String(process.env.MIGRATION_USER_ID || '').trim();
  if (specified) return [specified];
  const set = new Set();
  const preferred = await client.query(
    `SELECT id
     FROM auth.users
     WHERE id::text <> $1
     ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST`,
    [defaultSeedUser],
  );
  for (const row of preferred.rows) {
    set.add(String(row.id));
  }
  const cloudUserIds = await fetchCloudUserIds();
  for (const id of cloudUserIds) {
    set.add(id);
  }
  if (set.size === 0) {
    set.add(defaultSeedUser);
  }
  return Array.from(set);
}

async function seedQuestions(client, userId) {
  const questions = buildQuestions();
  
  // 核心修改：移除所有 DELETE 语句，改为查询已有题目，实现“只增不减”
  const existing = await client.query(
    'SELECT question_text FROM questions WHERE user_id = $1',
    [userId]
  );
  const existingTexts = new Set(existing.rows.map(r => r.question_text));

  const inserted = [];
  for (const item of questions) {
    // 如果题目已经存在，则直接跳过，保留用户的原有数据和进度
    if (existingTexts.has(item.question_text)) {
      continue;
    }

    const result = await client.query(
      `INSERT INTO questions (
        user_id, subject, question_text, category, node, knowledge_point, ability, error_type,
        question_type, correct_answer, summary, note, review_count, stubborn_flag, mastery_level,
        confidence, next_review_date, created_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
      )
      RETURNING id, subject, knowledge_point, ability, error_type, mastery_level, question_text, correct_answer, created_at`,
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

async function seedWeakness(client, userId, insertedQuestions) {
  const grouped = new Map();
  for (const item of insertedQuestions) {
    const key = `${item.knowledge_point}::${item.ability}`;
    const current = grouped.get(key) || { knowledge_point: item.knowledge_point, ability: item.ability, count: 0 };
    current.count += 1;
    grouped.set(key, current);
  }
  for (const value of grouped.values()) {
    const errorCount = value.count * 2 + 1;
    await client.query(
      `INSERT INTO user_weakness (user_id, knowledge_point, ability, error_count, last_updated)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (user_id, knowledge_point, ability)
       DO UPDATE SET error_count = EXCLUDED.error_count, last_updated = NOW()`,
      [userId, value.knowledge_point, value.ability, errorCount],
    );
  }
}

async function seedReviewAttempts(client, userId, insertedQuestions) {
  const subset = insertedQuestions.slice(0, 24);
  for (let i = 0; i < subset.length; i += 1) {
    const q = subset[i];
    const rating = pickRating(Number(q.mastery_level || 0));
    const isCorrect = rating !== 'forgot';
    const createdAt = new Date(Date.now() - ((i % 10) + 1) * 3600000).toISOString();
    await client.query(
      `INSERT INTO question_review_attempts (
        user_id, question_id, user_answer, selected_option_text, correct_answer, is_correct, rating, ai_diagnosis, next_review_date, created_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10
      )`,
      [
        userId,
        q.id,
        isCorrect ? q.correct_answer : '错误答案',
        null,
        q.correct_answer,
        isCorrect,
        rating,
        JSON.stringify({
          source: seedTag,
          error_pattern: q.error_type,
          why_wrong: `在${q.knowledge_point}上出现典型错误`,
          fix_strategy: `围绕${q.knowledge_point}做重复练习`,
          evidence: q.question_text,
        }),
        createdAt,
        createdAt,
      ],
    );
  }
}

async function seedPractice(client, userId) {
  const completed = await client.query(
    `INSERT INTO practice_sessions (
      user_id, subject, strategy, nodes, planned_amount, generated_amount, correct_count, wrong_count, total_elapsed_seconds, status, created_at, completed_at
    ) VALUES (
      $1,'英语',$2,$3::jsonb,8,8,5,3,780,'completed',NOW() - INTERVAL '2 day',NOW() - INTERVAL '2 day'
    )
    RETURNING id`,
    [userId, `${seedTag}-english`, JSON.stringify(['时态', '主谓一致', '细节理解'])],
  );
  const active = await client.query(
    `INSERT INTO practice_sessions (
      user_id, subject, strategy, nodes, planned_amount, generated_amount, correct_count, wrong_count, total_elapsed_seconds, status, created_at
    ) VALUES (
      $1,'C语言',$2,$3::jsonb,10,4,2,2,420,'active',NOW() - INTERVAL '5 hour'
    )
    RETURNING id`,
    [userId, `${seedTag}-clang`, JSON.stringify(['变量与数据类型', '运算符与表达式', '指针'])],
  );
  const completedId = completed.rows[0]?.id;
  const activeId = active.rows[0]?.id;
  if (!completedId || !activeId) return;
  for (let i = 0; i < 8; i += 1) {
    await client.query(
      `INSERT INTO practice_attempts (
        user_id, session_id, question_index, question_text, question_type, correct_answer, user_answer, is_correct, knowledge_point, duration_seconds, source_node, ai_prompt_version, response_time_ms, created_at
      ) VALUES (
        $1,$2,$3,$4,'choice',$5,$6,$7,$8,$9,$10,$11,$12,NOW() - ($13 || ' minutes')::interval
      )`,
      [
        userId,
        completedId,
        i + 1,
        `练习题 ${i + 1}`,
        'A',
        i % 3 === 0 ? 'B' : 'A',
        i % 3 !== 0,
        '时态',
        45 + i * 6,
        '时态',
        seedTag,
        1200 + i * 80,
        240 - i * 10,
      ],
    );
  }
  for (let i = 0; i < 4; i += 1) {
    await client.query(
      `INSERT INTO practice_attempts (
        user_id, session_id, question_index, question_text, question_type, correct_answer, user_answer, is_correct, knowledge_point, duration_seconds, source_node, ai_prompt_version, response_time_ms, created_at
      ) VALUES (
        $1,$2,$3,$4,'fill',$5,$6,$7,$8,$9,$10,$11,$12,NOW() - ($13 || ' minutes')::interval
      )`,
      [
        userId,
        activeId,
        i + 1,
        `C语言专项 ${i + 1}`,
        'int',
        i % 2 === 0 ? 'int' : 'float',
        i % 2 === 0,
        '变量与数据类型',
        50 + i * 8,
        '变量与数据类型',
        seedTag,
        980 + i * 70,
        90 - i * 10,
      ],
    );
  }
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userIds = await resolveUserIds(client);
    let seededQuestionCount = 0;
    for (const userId of userIds) {
      await client.query(
        `INSERT INTO auth.users (id, email)
         VALUES ($1::uuid, $2)
         ON CONFLICT (id) DO NOTHING`,
        [userId, `${seedTag}+${userId.slice(0, 8)}@local.dev`],
      );
      const insertedQuestions = await seedQuestions(client, userId);
      await seedWeakness(client, userId, insertedQuestions);
      await seedReviewAttempts(client, userId, insertedQuestions);
      await seedPractice(client, userId);
      seededQuestionCount += insertedQuestions.length;
    }
    await client.query('COMMIT');
    process.stdout.write(`seeded users: ${userIds.length}\n`);
    process.stdout.write(`seeded questions: ${seededQuestionCount}\n`);
    process.stdout.write('seed completed\n');
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
