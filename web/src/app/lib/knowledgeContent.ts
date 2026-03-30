import { userLearningStateApi } from './api';
import type { LearningContentState, LearningDrawerContent } from './types';
export type { LearningContentState, LearningDrawerContent } from './types';

export const LEARNING_CONTENT_KEY = 'mistake_learning_content_v1';

function createDefinitionTable(title: string, data: Array<{ name: string; desc: string; header?: string }>) {
  return {
    title,
    type: 'definition',
    data,
  };
}

function createKnowledgeCard(
  title: string,
  mastery: number,
  summary: string,
  primaryTips: Array<{ name: string; desc: string; header?: string }>,
  extraTips: Array<{ name: string; desc: string; header?: string }> = [],
) {
  return {
    title,
    mastery,
    summary,
    tables: [
      createDefinitionTable('基础技巧', primaryTips),
      ...(extraTips.length > 0 ? [createDefinitionTable('常见失误提醒', extraTips)] : []),
    ],
  };
}

export const KNOWLEDGE_DB: Record<string, any> = {
  时态: createKnowledgeCard(
    '英语：时态',
    58,
    '先看时间状语，再判断动作发生的时间和与现在的关系；做题时优先排除“时间线不匹配”的选项。',
    [
      { name: '找时间标志', desc: 'yesterday、since、for、by the time 往往先决定时态方向' },
      { name: '画时间线', desc: '把动作标成过去、现在、将来，避免完成时和一般时混淆' },
      { name: '看主从先后', desc: '两个动作并存时先判断谁先发生，谁持续影响现在' },
      { name: '核对谓语形式', desc: '确认助动词、过去分词和动词原形是否搭配完整' },
    ],
    [
      { name: '忽略 since/for', desc: '出现时间段常提示完成时，不能只看动词原形' },
      { name: '误把 by the time 当一般将来', desc: 'by the time 常与将来完成时或过去完成时搭配' },
      { name: '完成时少 have', desc: '现在完成时必须有 have/has + done' },
    ],
  ),
  主谓一致: createKnowledgeCard(
    '英语：主谓一致',
    56,
    '先锁定真正主语，再决定谓语单复数；不要被插入语、介词短语和并列结构干扰。',
    [
      { name: '先找核心主语', desc: '主语后的 with、as well as、along with 通常不影响谓语数' },
      { name: '就近原则', desc: 'either...or、neither...nor、not only...but also 往往看最近主语' },
      { name: '集合名词单独判断', desc: 'family、team 强调整体常看作单数' },
      { name: '不定代词重点记', desc: 'everyone、each、someone 常接单数谓语' },
    ],
    [
      { name: '被修饰语迷惑', desc: '真正控制谓语的是主语，不是后面的名词' },
      { name: 'and 一律看复数', desc: '表示同一人或整体概念时未必是复数' },
      { name: '百分数机械套规则', desc: '分数、百分比要看 of 后面的中心名词' },
    ],
  ),
  虚拟语气: createKnowledgeCard(
    '英语：虚拟语气',
    46,
    '先判断是否与事实相反，再选对应时态；现在反事实常用 did/were，过去反事实常用 had done。',
    [
      { name: '先判真实与否', desc: '若是假设、愿望、建议，多半要考虑虚拟语气' },
      { name: '现在反事实', desc: 'if 从句常用过去式，主句常用 would/could/might + do' },
      { name: '过去反事实', desc: 'if 从句常用 had done，主句常用 would/could/might + have done' },
      { name: '固定句型单独记', desc: 'wish、if only、would rather、It is important that 常有固定搭配' },
    ],
    [
      { name: 'was/were 混用', desc: '与现在事实相反时 be 动词常优先用 were' },
      { name: '主从句时态同时改错', desc: '主句和 if 从句的形式必须成套出现' },
      { name: '忽视 suggest/insist', desc: '这类词后宾语从句常用 should do 或动词原形' },
    ],
  ),
  从句: createKnowledgeCard(
    '英语：从句',
    54,
    '先判断从句在句中充当什么成分，再选连接词；做题时可先分清名词性、定语和状语从句。',
    [
      { name: '先看功能', desc: '作主语、宾语、表语通常是名词性从句；修饰名词多为定语从句' },
      { name: '再看先行词', desc: '定语从句里先看先行词指人还是物，再选 who/which/that' },
      { name: '看从句是否缺成分', desc: '缺主语宾语常选关系代词，不缺成分常选关系副词或连词' },
      { name: '状语从句抓逻辑', desc: '时间、原因、让步、条件等逻辑决定连接词' },
    ],
    [
      { name: 'that/what 混淆', desc: 'what 在从句中本身充当成分，that 通常不充当成分' },
      { name: 'where/which 混淆', desc: '先看从句是否缺地点状语而不是只看先行词' },
      { name: '把 because 和 because of 混用', desc: 'because 后接句子，because of 后接名词短语' },
    ],
  ),
  被动语态: createKnowledgeCard(
    '英语：被动语态',
    60,
    '先判断主语是动作执行者还是承受者，再决定是否使用被动；被动结构核心是 be done。',
    [
      { name: '先看主语角色', desc: '主语承受动作时优先考虑被动语态' },
      { name: '抓住 be done', desc: '任何时态变化都先体现在 be 的形式上' },
      { name: '保留时态信息', desc: '一般时、完成时、情态动词都要先改 be，再接 done' },
      { name: '注意及物动词', desc: '能变被动的通常是及物动词或动词短语' },
    ],
    [
      { name: '漏写 be', desc: '只写过去分词不算完整被动结构' },
      { name: '主动宾语没提升', desc: '变被动后原宾语通常成为新主语' },
      { name: '不及物动词硬改被动', desc: '如 happen、arrive 这类词一般不能直接变被动' },
    ],
  ),
  非谓语动词: createKnowledgeCard(
    '英语：非谓语动词',
    49,
    '先判断动词在句中是否作谓语，再根据时间、主动被动和固定搭配选择 to do、doing 或 done。',
    [
      { name: '先找谓语', desc: '一个简单句通常只有一个谓语，其余动词多考虑非谓语形式' },
      { name: '看主动被动', desc: '主动常用 doing/to do，被动常用 done 或 to be done' },
      { name: '看时间先后', desc: '动作已完成常倾向 done 或 having done' },
      { name: '记固定搭配', desc: 'decide to do、avoid doing、be seen to do 等搭配要熟记' },
    ],
    [
      { name: 'doing 和 to do 只凭语感选', desc: '要回到搭配和句子逻辑判断' },
      { name: '忘记逻辑主语', desc: '分词作状语时默认主语应与主句主语一致' },
      { name: '完成式乱用', desc: 'having done 强调先于谓语动作发生' },
    ],
  ),
  介词: createKnowledgeCard(
    '英语：介词',
    57,
    '介词题先看固定搭配，再看时间、地点或逻辑关系；不要把介词当连词使用。',
    [
      { name: '优先查搭配', desc: 'be responsible for、depend on、in charge of 等要整体记忆' },
      { name: '时间介词分层', desc: 'at 点、on 具体某天、in 较长时间段' },
      { name: '地点介词画空间', desc: 'in 表内部，on 表接触表面，at 表点位' },
      { name: '抽象关系靠语义', desc: 'for 原因目的，with 伴随方式，by 手段途径' },
    ],
    [
      { name: '受中文直译影响', desc: '英汉表达并非一一对应，先记英语固定搭配' },
      { name: '把介词后误接句子', desc: '介词后通常接名词、代词或 doing' },
      { name: '时间介词混用', desc: '具体日期常用 on，不用 in' },
    ],
  ),
  冠词: createKnowledgeCard(
    '英语：冠词',
    55,
    '先判断名词是否可数、是否第一次提及、是否特指，再决定用 a/an、the 或零冠词。',
    [
      { name: '先判可数性', desc: '单数可数名词通常不能裸用' },
      { name: '再判特指泛指', desc: '首次泛指常用 a/an，再次提及或特指常用 the' },
      { name: '固定结构单独记', desc: 'play the piano、go to school、in a hurry 等要整体记' },
      { name: '元音音素看发音', desc: 'a/an 取决于读音而不是首字母' },
    ],
    [
      { name: 'useful 前误用 an', desc: 'useful 读音以辅音开头，应用 a' },
      { name: '抽象名词乱加 the', desc: '泛指概念时常用零冠词' },
      { name: '专有名词一概不用冠词', desc: 'the United States 等特殊情况需单独记' },
    ],
  ),
  代词: createKnowledgeCard(
    '英语：代词',
    53,
    '先找代词所指对象，再核对人称、数和格；模糊指代往往就是命题点。',
    [
      { name: '先找先行对象', desc: '代词必须有清晰指向，避免 it、they 指代不明' },
      { name: '核对主宾格', desc: '主语位置用 I/he/she，宾语位置用 me/him/her' },
      { name: '单复数一致', desc: 'everyone、each 这类单数不定代词要特别注意' },
      { name: '物主代词分清', desc: '形容词性物主代词后接名词，名词性可独立使用' },
    ],
    [
      { name: 'their 和 his or her 混用', desc: '考试里常按传统一致性原则命题' },
      { name: 'it 和 one 混淆', desc: 'it 指同一事物，one 常指同类中的一个' },
      { name: '反身代词乱用', desc: '只有主语和宾语同指时才常用 myself、themselves' },
    ],
  ),
  词形变化: createKnowledgeCard(
    '英语：词形变化',
    50,
    '先判断空格需要哪类词，再依据词根添加前后缀；不要只记词义不记词性。',
    [
      { name: '先定词性', desc: '名词前多填形容词，系动词后常填形容词，动词后常填副词或名词' },
      { name: '抓常见后缀', desc: '-tion、-ment 常成名词，-ful、-ive 常成形容词，-ly 常成副词' },
      { name: '注意否定形式', desc: 'un-、im-、dis- 等否定前缀经常是考点' },
      { name: '看句法位置', desc: '同一词根能变多种词性，句中位置最关键' },
    ],
    [
      { name: '只看中文词义', desc: '意义对但词性错也算错误' },
      { name: '副词和形容词混用', desc: '修饰动词通常用副词，作表语常用形容词' },
      { name: '过去分词当形容词忽略', desc: 'interested、confused 这类形式需整体记忆' },
    ],
  ),
  词义辨析: createKnowledgeCard(
    '英语：词义辨析',
    52,
    '词义辨析先看搭配，再看语境色彩和逻辑对象；不要只背中文近义解释。',
    [
      { name: '比较搭配对象', desc: 'relieve pain、release pressure、remove dirt 这类搭配差异很常考' },
      { name: '看情感色彩', desc: '有些词带褒义、贬义或正式色彩' },
      { name: '回到上下文', desc: '前后句逻辑比中文释义更能决定答案' },
      { name: '整理最小差异', desc: '把常混词写成成对笔记，比单词表更有效' },
    ],
    [
      { name: '只认第一个中文义', desc: '同一个中文可能对应多个英语词' },
      { name: '忽略动词及物性', desc: '有的词后要直接接宾语，有的要接介词' },
      { name: '把书面和口语混用', desc: '正式场景选词常更精确' },
    ],
  ),
  固定搭配: createKnowledgeCard(
    '英语：固定搭配',
    59,
    '固定搭配重在整体记忆和场景复现，遇到熟悉动词时优先联想其常见介词或副词。',
    [
      { name: '按词块背诵', desc: '不要拆开记，像 carry out、take part in 要整体存储' },
      { name: '按主题归类', desc: '学习、会议、结果、态度等场景分类更容易迁移' },
      { name: '重复造句', desc: '固定搭配至少自己造一到两个句子' },
      { name: '对比相近短语', desc: 'look for / look after / look into 最好成组记忆' },
    ],
    [
      { name: '凭中文随意拼介词', desc: '英语短语搭配常没有直译规律' },
      { name: '记得意思忘了形式', desc: '考试常考介词、副词这类细节' },
      { name: '近义短语不区分语境', desc: 'carry on 和 carry out 的语义侧重点不同' },
    ],
  ),
  主旨理解: createKnowledgeCard(
    '英语：主旨理解',
    51,
    '主旨题先看首尾段和高频重复信息，再概括作者真正想强调的中心观点。',
    [
      { name: '先抓主题句', desc: '首段首句、尾段结论句常直接点明中心' },
      { name: '找重复概念', desc: '反复出现的对象、态度和结果往往就是主旨' },
      { name: '选项比范围', desc: '主旨题常错在选项过窄、过偏或只覆盖细节' },
      { name: '先排细节项', desc: '只涉及某一例子或某一段内容的通常不是主旨' },
    ],
    [
      { name: '把例子当中心', desc: '例子是服务观点，不是文章主题本身' },
      { name: '被标题党干扰', desc: '夸张或绝对化表达常是错误选项' },
      { name: '忽视作者态度', desc: '中心常和作者评价方向绑定' },
    ],
  ),
  细节理解: createKnowledgeCard(
    '英语：细节理解',
    57,
    '细节题先回文定位，再比对题干关键词和同义替换；不要凭记忆印象作答。',
    [
      { name: '题干先圈关键词', desc: '人物、时间、原因、数字和转折词最适合定位' },
      { name: '回原文精确匹配', desc: '细节题答案通常能在原文找到依据' },
      { name: '留意同义改写', desc: '正确项常不是原文原词复现，而是同义表达' },
      { name: '逐项排除', desc: '先排无关项，再排偷换对象和强加因果的选项' },
    ],
    [
      { name: '凭常识替代原文', desc: '阅读题只以文章信息为准' },
      { name: '看见同词就选', desc: '干扰项常复制关键词但改变逻辑' },
      { name: '漏看否定和范围词', desc: 'not、only、at least 等决定细节真伪' },
    ],
  ),
  推理判断: createKnowledgeCard(
    '英语：推理判断',
    48,
    '推理题要基于原文证据做“最小一步推断”，不能跳出文本凭个人经验扩展。',
    [
      { name: '先找显性依据', desc: '推理必须建立在文中已给信息上' },
      { name: '做最小推断', desc: '优先选择和原文距离最近、延伸最少的选项' },
      { name: '看态度倾向', desc: '作者措辞、评价词和例证方向常能支持推断' },
      { name: '警惕绝对表达', desc: 'must、always、completely 这类词往往过度推断' },
    ],
    [
      { name: '拿常识代替推断', desc: '常识只能辅助理解，不能覆盖文本证据' },
      { name: '把细节题当推理题', desc: '推理题答案通常不是原句原样复现' },
      { name: '过度延伸', desc: '从一个现象推出宏大结论往往错误' },
    ],
  ),
  句子结构: createKnowledgeCard(
    '英语：句子结构',
    53,
    '长难句先切主干，再分层看从句、非谓语和插入语；主谓宾永远是第一抓手。',
    [
      { name: '先找谓语动词', desc: '每找到一个真正谓语，就能初步划分句子层次' },
      { name: '再找主干', desc: '先还原主语、谓语、宾语，再处理修饰成分' },
      { name: '标连接词', desc: 'that、which、when、because 等可快速提示从句边界' },
      { name: '删修饰看骨架', desc: '先忽略介词短语、同位语和插入语，结构会更清晰' },
    ],
    [
      { name: '把非谓语当谓语', desc: 'doing、done、to do 不一定是句子主谓核心' },
      { name: '修饰语嵌套丢主干', desc: '回到最简骨架能避免分析跑偏' },
      { name: '连词作用看错', desc: '同一个词在不同句型中语法功能不同' },
    ],
  ),
  逻辑连接: createKnowledgeCard(
    '英语：逻辑连接',
    55,
    '逻辑连接题核心是判断上下文关系，是转折、因果、递进还是并列，再选最匹配的连接词。',
    [
      { name: '先判逻辑关系', desc: '上下句是相反、结果、补充还是让步，决定选词方向' },
      { name: '看标点位置', desc: '分号、逗号和句首位置会限制连接副词的用法' },
      { name: '区分 however/therefore', desc: 'however 表转折，therefore 表结果' },
      { name: '联系篇章语气', desc: '递进和总结类连接词常带有明显篇章功能' },
    ],
    [
      { name: '只按中文意思选', desc: '还要看语法位置和标点搭配' },
      { name: '转折和让步混淆', desc: 'although 是连词，however 常作连接副词' },
      { name: '因果方向看反', desc: '要分清原因在前还是结果在前' },
    ],
  ),
  表达准确: createKnowledgeCard(
    '英语：表达准确',
    50,
    '改写和写作题先保住语法正确，再追求自然表达；检查主谓一致、时态、搭配和冗余是高性价比步骤。',
    [
      { name: '先改硬错误', desc: '主谓一致、时态、单复数、冠词是最先处理的底层错误' },
      { name: '再改搭配', desc: '如 have trouble doing、be good at、depend on' },
      { name: '保持信息不丢', desc: '改写时不要为了顺口删掉原句关键信息' },
      { name: '读一遍是否自然', desc: '修改后通读能快速发现词序和冗余问题' },
    ],
    [
      { name: '只改一个错误', desc: '很多病句同时有语法和搭配问题' },
      { name: '中式直译明显', desc: '优先用英语常见结构而不是逐词对应' },
      { name: '忘记名词复数', desc: '数量变化和泛指时常伴随复数问题' },
    ],
  ),
  变量与数据类型: createKnowledgeCard(
    'C语言：变量与数据类型',
    61,
    '先明确数据范围和用途，再选类型；写代码时注意字面量、格式化输出和类型转换是否匹配。',
    [
      { name: '先看取值范围', desc: '整数、浮点、字符各有不同表示能力' },
      { name: '字面量要对齐', desc: '9.8f 更适合 float，字符要用单引号包裹' },
      { name: '格式控制符匹配', desc: '%d、%f、%c 应与变量类型一致' },
      { name: '算术转换提前想', desc: '表达式中混合类型会发生自动提升和截断' },
    ],
    [
      { name: '把浮点赋给 int', desc: '会丢失小数部分，很多题专门考截断' },
      { name: 'scanf 参数忘取地址', desc: '除字符串数组外，大多输入都需要 &' },
      { name: 'char 和字符串混淆', desc: '单个字符与字符数组完全不同' },
    ],
  ),
  运算符与表达式: createKnowledgeCard(
    'C语言：运算符与表达式',
    58,
    '表达式题先看优先级和结合性，再考虑整数除法、取模和类型提升；复杂表达式最好手动分步。',
    [
      { name: '先加括号理解', desc: '考试里可先按优先级把表达式拆开' },
      { name: '注意整数除法', desc: '两个整数相除会先做整除再参与后续运算' },
      { name: '取模看符号和范围', desc: 'a % b 只适用于整数运算' },
      { name: '赋值表达式慎用', desc: 'if (x = 3) 这类写法合法但常是逻辑错误' },
    ],
    [
      { name: '把 = 当 ==', desc: '条件判断里最容易因赋值和比较混淆出错' },
      { name: '忽略自增时机', desc: '前置和后置自增返回值不同' },
      { name: '优先级全靠感觉', desc: '不确定时主动补括号最安全' },
    ],
  ),
  选择结构: createKnowledgeCard(
    'C语言：选择结构',
    57,
    'if、else、switch 题先确认条件真假，再跟踪执行路径；写代码时尽量让每个分支职责清晰。',
    [
      { name: '条件先求值', desc: 'C 里非 0 为真，0 为假' },
      { name: '区分赋值和比较', desc: '判断条件里常考 = 与 ==' },
      { name: 'switch 配 break', desc: '没有 break 会继续向下贯穿执行' },
      { name: '范围判断分顺序', desc: '多重 if-else 的顺序会影响最终结果' },
    ],
    [
      { name: 'else 归属看错', desc: '默认匹配最近且未配对的 if' },
      { name: 'case 值重复或类型不当', desc: 'case 常量要互不重复且可比较' },
      { name: '条件表达式写反', desc: '区间题尤其容易漏掉等号边界' },
    ],
  ),
  循环结构: createKnowledgeCard(
    'C语言：循环结构',
    56,
    '循环题先写出初值、条件和步长，再模拟关键几轮；最常见错误是边界、更新位置和死循环。',
    [
      { name: '三要素分开看', desc: '初始化、继续条件、更新语句缺一不可' },
      { name: '模拟前两轮', desc: '先算 i 初值和第一次更新，能快速发现 off-by-one 错误' },
      { name: 'while/do while 区分', desc: 'do while 至少执行一次' },
      { name: '循环体职责单一', desc: '计数、累加、输入输出最好分清变量用途' },
    ],
    [
      { name: 'i<=n 与 i<n 混淆', desc: '这是边界题最高频失误' },
      { name: '更新变量放错位置', desc: 'continue 前后会影响更新是否执行' },
      { name: '死循环没退出条件', desc: '特别注意浮点比较和变量未变化的情况' },
    ],
  ),
  函数: createKnowledgeCard(
    'C语言：函数',
    60,
    '函数题先看声明、定义和调用是否一致，再检查参数个数、类型和返回值处理。',
    [
      { name: '原型先对齐', desc: '函数声明中的参数类型和返回类型要与定义一致' },
      { name: '调用核对参数', desc: '参数个数、顺序和类型都要匹配' },
      { name: '明确传值本质', desc: '普通参数默认是值传递，修改形参不会直接改实参' },
      { name: '返回值有去处', desc: '非 void 函数应保证所有路径都返回合理值' },
    ],
    [
      { name: '忘记函数声明', desc: '老式默认返回 int 的思路已不可靠' },
      { name: '想在函数内直接改实参', desc: '需要传地址或返回新值' },
      { name: '递归缺终止条件', desc: '会导致无限调用和栈溢出' },
    ],
  ),
  数组: createKnowledgeCard(
    'C语言：数组',
    52,
    '数组错误高发在下标越界和长度传递；写题时始终先确认有效区间是 0 到 n-1。',
    [
      { name: '先写合法区间', desc: '0 <= i < n 是最核心的检查式' },
      { name: '长度单独保存', desc: '数组传参后需要额外传长度' },
      { name: '初始化后再使用', desc: '未初始化数组元素会保留不确定值' },
      { name: '排序遍历分清边界', desc: '双层循环里尤其要检查 j 的终止条件' },
    ],
    [
      { name: '把 n 当最大下标', desc: '长度为 n 的数组最大下标是 n-1' },
      { name: '循环终止条件多等号', desc: 'i <= n 常直接造成越界' },
      { name: '数组名误当普通变量', desc: '数组名多数场景会退化为首元素地址' },
    ],
  ),
  字符串: createKnowledgeCard(
    'C语言：字符串',
    54,
    'C 字符串本质是以 \\0 结尾的字符数组，做题时长度、结束符和输入函数最容易出错。',
    [
      { name: '预留结束符', desc: '字符串长度要把末尾 \\0 一并考虑' },
      { name: '区分字符与字符串', desc: '\'a\' 是字符，"a" 是字符串常量' },
      { name: '常用函数记参数', desc: 'strlen 不算 \\0，strcpy 目标数组必须足够大' },
      { name: '输入方式要安全', desc: '优先考虑 fgets，避免无边界输入' },
    ],
    [
      { name: '数组空间少一位', desc: '"hello" 需要 6 个字节而不是 5 个' },
      { name: '忘记字符串结束符', desc: '缺少 \\0 会导致遍历越界或输出乱码' },
      { name: '用 == 比较字符串', desc: '应使用 strcmp 比较内容' },
    ],
  ),
  指针: createKnowledgeCard(
    'C语言：指针',
    45,
    '先区分“地址”和“值”，再检查解引用前是否判空、初始化和指向是否合法。',
    [
      { name: '声明先读懂', desc: 'int *p 表示 p 是指向 int 的指针' },
      { name: '地址和值分离', desc: '&a 取地址，*p 取 p 指向地址中的值' },
      { name: '解引用先判空', desc: 'NULL 和野指针都不能直接使用' },
      { name: '配合数组理解', desc: '指针运算的步长由所指类型大小决定' },
    ],
    [
      { name: '未初始化就解引用', desc: '这是指针题最常见崩溃来源' },
      { name: '地址类型不匹配', desc: '不同类型指针强行混用会带来风险' },
      { name: '把 * 和 & 作用搞反', desc: '一个是取值，一个是取地址' },
    ],
  ),
  结构体: createKnowledgeCard(
    'C语言：结构体',
    59,
    '结构体题先看定义方式，再分清对象访问用 . 还是指针访问用 ->。',
    [
      { name: '先看变量类型', desc: '结构体变量直接用 . ，结构体指针用 ->' },
      { name: '成员初始化分层', desc: '初始化时要按成员顺序或显式指定' },
      { name: 'typedef 简化记忆', desc: '别名能减少书写错误，但本质类型没变' },
      { name: '数组与结构体结合', desc: '结构体数组常与循环、排序一起出题' },
    ],
    [
      { name: '. 和 -> 混用', desc: '看到指针变量就优先想到 ->' },
      { name: '拷贝以为是引用', desc: '结构体直接赋值默认是值拷贝' },
      { name: '字符串成员未妥善处理', desc: 'char 数组成员常涉及 strcpy 和空间长度' },
    ],
  ),
  文件操作: createKnowledgeCard(
    'C语言：文件操作',
    65,
    '文件操作错误多发生在打开模式、读写函数配对和返回值检查不足。',
    [
      { name: '模式先匹配任务', desc: '读用 r，写用 w，追加用 a，二进制读写要加 b' },
      { name: '打开后先判空', desc: 'fopen 失败会返回 NULL，后续必须先检查' },
      { name: '读写函数配对', desc: '文本处理常用 fgets/fputs，二进制常用 fread/fwrite' },
      { name: '结束后及时关闭', desc: 'fclose 能刷新缓冲并释放文件资源' },
    ],
    [
      { name: '打开模式写错', desc: 'w 会清空原文件，a 才是追加' },
      { name: '把 feof 当读取条件', desc: '应先判断读取函数返回值' },
      { name: '二进制文本函数混用', desc: '不同数据格式应使用不同接口' },
    ],
  ),
  排序与查找: createKnowledgeCard(
    'C语言：排序与查找',
    58,
    '排序查找题先明确算法前提和循环不变量，二分查找尤其依赖有序数组和边界收缩。',
    [
      { name: '先记前提条件', desc: '二分查找要求数组已排序，线性查找则没有此限制' },
      { name: '画 low/high/mid', desc: '每轮都更新区间，能防止边界混乱' },
      { name: '排序关注交换条件', desc: '冒泡、选择、插入排序的比较方向要统一' },
      { name: '复杂度有概念', desc: '知道 O(n) 和 O(log n) 有助于判断方法选择' },
    ],
    [
      { name: 'mid 更新后区间不缩小', desc: '会导致死循环或漏掉目标' },
      { name: '排序循环层数写错', desc: '内外层边界决定比较次数' },
      { name: '有序前提被忽略', desc: '未排序数组不能直接用二分查找' },
    ],
  ),
  内存管理: createKnowledgeCard(
    'C语言：内存管理',
    47,
    '动态内存题关键是“申请、使用、释放、置空”四步完整闭环，任何一步漏掉都容易出错。',
    [
      { name: '申请后先判空', desc: 'malloc、calloc 返回值必须检查是否为 NULL' },
      { name: '大小按类型算', desc: '优先写 sizeof(*p) 或 sizeof(type) * count' },
      { name: '释放后置空', desc: 'free 后把指针设为 NULL 可降低悬空风险' },
      { name: '谁申请谁负责', desc: '明确内存所有权，避免重复释放或无人释放' },
    ],
    [
      { name: '忘记 free', desc: '长流程程序会积累内存泄漏' },
      { name: '重复释放', desc: 'double free 可能直接崩溃' },
      { name: '释放后继续使用', desc: '悬空指针是高频隐蔽错误' },
    ],
  ),
  边界条件: createKnowledgeCard(
    'C语言：边界条件',
    51,
    '边界条件题要主动检查最小值、最大值、空输入和临界循环次数，很多代码逻辑只在边界处出错。',
    [
      { name: '先问最小输入', desc: 'n=0、n=1、空字符串、NULL 都应单独考虑' },
      { name: '再问最大输入', desc: '数组容量、整数范围和缓冲区长度要提前核对' },
      { name: '循环终止再检查', desc: '是否多做一次或少做一次通常就在边界上暴露' },
      { name: '手算临界样例', desc: '用 0、1、最后一个元素测试最能发现问题' },
    ],
    [
      { name: '只测普通样例', desc: '中间值通过不代表边界安全' },
      { name: '忽略空数组空指针', desc: '很多函数在空输入时需要提前返回' },
      { name: '整数上溢下溢没考虑', desc: '极端范围常引发隐藏错误' },
    ],
  ),
  文件操作专项: createKnowledgeCard(
    'C语言专项：文件操作高频陷阱',
    44,
    '文件题重点盯住“打开模式、读写返回值、指针定位和feof陷阱”，按流程检查最稳妥。',
    [
      { name: 'feof 使用时机', desc: 'feof 在读失败后才为真，不能直接作为循环先验条件' },
      { name: '定位三件套', desc: 'fseek 定位、ftell 取位置、rewind 回到开头' },
      { name: '二进制读写配套', desc: 'fread/fwrite 必须关注元素大小、数量和返回值' },
      { name: '模式区分', desc: '文本和二进制、覆盖和追加模式不能混用' },
    ],
    [
      { name: 'while(!feof(fp)) 误用', desc: '会多读一次，应该以读取函数返回值为循环条件' },
      { name: 'fseek 基准写错', desc: 'SEEK_SET/SEEK_CUR/SEEK_END 语义必须和偏移量匹配' },
      { name: '忽略 fwrite 返回值', desc: '未写全数据时会静默失败，需立刻判错' },
    ],
  ),
  字符串存储: createKnowledgeCard(
    'C语言专项：字符串存储本质',
    42,
    '牢记“字符串字面量是地址，数组名在多数表达式中会衰减为首地址”，先分清类型再写赋值。',
    [
      { name: '字面量本质', desc: '"abcd" 的值是首地址，不是逐字符赋值动作' },
      { name: '*s 与 s[0]', desc: '两者都是单个字符，类型通常是 char' },
      { name: '数组与指针区别', desc: 'char s[] 可改内容；char *p 指向常量区时通常不可写' },
      { name: '正确赋值方式', desc: '数组初始化或 strcpy，不能把地址直接赋给单个字符' },
    ],
    [
      { name: '*s = "abcd" 类型错误', desc: '左边是 char，右边是 char*' },
      { name: '把字符串当可变常量', desc: '字面量区写入会触发未定义行为' },
      { name: '混淆 sizeof 和 strlen', desc: 'sizeof 关注存储大小，strlen 统计有效字符长度' },
    ],
  ),
  概念填空题: createKnowledgeCard(
    'C语言专项：概念填空题',
    46,
    '概念题先“术语标准化”再作答：定义一句话 + 关键条件 + 一个反例，能明显提升得分稳定性。',
    [
      { name: '三步作答模板', desc: '先定义术语，再写适用条件，最后补一句常见误区' },
      { name: '高频术语清单', desc: '标识符、常量、变量、作用域、存储期、预处理、指针、数组' },
      { name: '把口语改书面语', desc: '避免“差不多、就是”这类模糊表达' },
      { name: '概念配一行代码', desc: '能用最短代码举例时，判分更稳定' },
    ],
    [
      { name: '只会算不会表述', desc: '概念题主要扣在术语不规范和定义不完整' },
      { name: '把现象当定义', desc: '先写本质，再写结果，逻辑不能倒置' },
      { name: '忽略边界条件', desc: '很多概念在特殊情形下才显出差异' },
    ],
  ),
  二维数组与数组指针: createKnowledgeCard(
    'C语言专项：二维数组与数组指针',
    43,
    '先建立三层地址模型：a、a[0]、a[0][0]；再判断指针类型和步长，最后做越界检查。',
    [
      { name: '三层地址模型', desc: 'a 是首行地址，a[0] 是第一行首元素地址，a[0][0] 是元素值' },
      { name: '数组指针定义', desc: 'int (*p)[n] 表示“指向含 n 个 int 的一维数组”' },
      { name: '访问等价式', desc: 'pa[i][j] 等价于 *(*(pa + i) + j)' },
      { name: '越界判断', desc: '先判行 i，再判列 j，任何一层越界都非法' },
    ],
    [
      { name: '把 a 当 int*', desc: '二维数组首地址类型不是元素指针而是行指针' },
      { name: '步长按元素算错', desc: '行指针加1会跨整行，不是跨一个元素' },
      { name: '漏判列边界', desc: '行合法不代表列也合法' },
    ],
  ),
  存储类别: createKnowledgeCard(
    'C语言专项：存储类别',
    48,
    '存储类别题先从“作用域+存储期+默认初值+能否取地址/优化限制”四维记忆。',
    [
      { name: 'auto', desc: '默认局部变量，块作用域，进入块分配，未初始化值不确定' },
      { name: 'static', desc: '静态存储期，程序运行期常驻，未显式初始化时默认 0' },
      { name: 'extern', desc: '声明外部变量，连接到定义处，不分配新存储' },
      { name: 'register', desc: '建议放寄存器，通常不能对其取地址' },
    ],
    [
      { name: 'extern 当定义用', desc: 'extern 主要是声明，定义应在某个翻译单元出现' },
      { name: 'static 局部变量重复初始化', desc: '仅首次初始化，后续保留上次值' },
      { name: 'register 一定进寄存器', desc: '只是建议，是否采用由编译器决定' },
    ],
  ),
  进制转换: createKnowledgeCard(
    'C语言专项：进制转换',
    47,
    '进制题高效做法是“十进制↔二进制双向熟练 + 二进制与十六进制四位分组”。',
    [
      { name: '前缀规则', desc: '十六进制常用 0x，八进制常用 0，二进制在标准C中通常不直接用 0b' },
      { name: '二转十', desc: '按位权求和：每位乘 2 的幂再相加' },
      { name: '十转二', desc: '除2取余，逆序写出' },
      { name: '二转十六', desc: '从低位起四位一组，不足补0再映射' },
    ],
    [
      { name: '把 0 开头十进制误判', desc: 'C 中前导 0 可能表示八进制字面量' },
      { name: '分组方向写反', desc: '二进制转十六进制应从低位向高位分组' },
      { name: '幂次表不熟', desc: '2^0 到 2^10 需快速心算' },
    ],
  ),
  default: {
    title: '知识点卡片',
    mastery: 50,
    summary: '该知识点正在持续补充中，建议先看关联错题再做同类训练。',
    tables: [],
  },
};

export function readLearningContentState(): LearningContentState {
  if (typeof window === 'undefined') return { tipsByNode: {}, drawerByTag: {} };
  try {
    const raw = window.localStorage.getItem(LEARNING_CONTENT_KEY);
    if (!raw) return { tipsByNode: {}, drawerByTag: {} };
    const parsed = JSON.parse(raw);
    return {
      tipsByNode: parsed?.tipsByNode || {},
      drawerByTag: parsed?.drawerByTag || {},
    };
  } catch {
    return { tipsByNode: {}, drawerByTag: {} };
  }
}

export function writeLearningContentState(next: LearningContentState) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LEARNING_CONTENT_KEY, JSON.stringify(next));
  void persistLearningContentState(next);
}

export async function hydrateLearningContentStateFromCloud() {
  if (typeof window === 'undefined') return;
  try {
    const local = readLearningContentState();
    const remote = await userLearningStateApi.get();
    const content = remote.learning_content || { tipsByNode: {}, drawerByTag: {} };
    if (hasLearningContent(content)) {
      window.localStorage.setItem(LEARNING_CONTENT_KEY, JSON.stringify(content));
      return;
    }
    if (hasLearningContent(local)) {
      await persistLearningContentState(local);
    }
  } catch {
  }
}

export async function persistLearningContentState(state?: LearningContentState) {
  if (typeof window === 'undefined') return;
  const payload = state || readLearningContentState();
  try {
    await userLearningStateApi.upsert({
      learning_content: payload,
    });
  } catch {
  }
}

function hasLearningContent(state?: LearningContentState) {
  if (!state) return false;
  return Object.keys(state.tipsByNode || {}).length > 0 || Object.keys(state.drawerByTag || {}).length > 0;
}

export function normalizeKnowledgeMarkdown(input: string) {
  return String(input || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildKnowledgeMarkdownFromData(data: { title?: string; summary?: string; tables?: any[] }, tag: string) {
  const lines: string[] = [];
  const title = data.title || tag;
  lines.push(`# ${title}`);
  if (data.summary) {
    lines.push('');
    lines.push('## AI 总结');
    lines.push('');
    lines.push(data.summary);
  }
  if (Array.isArray(data.tables) && data.tables.length > 0) {
    data.tables.forEach((table: any) => {
      lines.push('');
      lines.push(`## ${table.title || '知识点速查表'}`);
      lines.push('');
      if (table.type === 'definition' && Array.isArray(table.data)) {
        table.data.forEach((item: any) => {
          lines.push(`- **${item.name || '概念'}**：${item.desc || ''}`);
        });
      }
      if (table.type === 'matrix' && Array.isArray(table.columns) && Array.isArray(table.data)) {
        lines.push(`| ${table.columns.join(' | ')} |`);
        lines.push(`| ${table.columns.map(() => '---').join(' | ')} |`);
        table.data.forEach((row: string[]) => {
          lines.push(`| ${row.join(' | ')} |`);
        });
      }
    });
  }
  return normalizeKnowledgeMarkdown(lines.join('\n'));
}

export function getMergedKnowledgeContent(tag: string, drawerOverrides: Record<string, LearningDrawerContent>) {
  const baseData = KNOWLEDGE_DB[tag] || { ...KNOWLEDGE_DB.default, title: tag };
  const override = drawerOverrides[tag] || {};
  const merged = {
    ...baseData,
    ...override,
    tables: override.tables || baseData.tables,
  };
  const markdown = normalizeKnowledgeMarkdown(
    override.markdown || buildKnowledgeMarkdownFromData(merged, tag),
  );
  return {
    ...merged,
    markdown,
  };
}
