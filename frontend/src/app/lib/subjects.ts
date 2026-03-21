export const SUBJECTS = [
  { name: '数学', emoji: '📐', colorKey: 'purple' },
  { name: '英语', emoji: '📝', colorKey: 'green' },
  { name: '物理', emoji: '⚡', colorKey: 'blue' },
  { name: '化学', emoji: '🧪', colorKey: 'orange' },
  { name: '生物', emoji: '🧬', colorKey: 'emerald' },
  { name: '历史', emoji: '📜', colorKey: 'amber' },
  { name: '地理', emoji: '🌍', colorKey: 'cyan' },
  { name: '政治', emoji: '🏛️', colorKey: 'rose' },
  { name: 'C语言', emoji: '💻', colorKey: 'indigo' },
] as const;

export const SUB_TOPICS: Record<string, string[]> = {
  数学: ['函数与导数', '三角函数', '数列', '概率与统计', '立体几何', '解析几何', '不等式', '复数', '集合与逻辑'],
  英语: ['完型填空', '语法填空', '阅读理解', '书面表达', '词汇运用', '听力理解', '翻译'],
  物理: ['运动学', '力学', '电磁学', '光学与波动', '热学', '量子物理', '电路分析'],
  化学: ['有机化学', '无机化学', '化学反应原理', '电化学', '元素周期律', '化学实验'],
  生物: ['细胞生物学', '遗传学', '生态学', '进化论', '生命活动调节', '生物技术'],
  历史: ['中国古代史', '中国近代史', '中国现代史', '世界古代史', '世界近现代史'],
  地理: ['自然地理', '人文地理', '区域地理', '地图与工具'],
  政治: ['马克思主义哲学', '政治经济学', '政治学', '文化学'],
  C语言: ['变量与数据类型', '运算符与表达式', '选择结构', '循环结构', '函数', '数组与字符串', '指针', '结构体', '文件操作', '排序与查找'],
};

export const COMMON_ERROR_TAGS = [
  '知识盲区', '粗心大意', '审题不清', '时间不够', '状态不佳'
];

export const SUBJECT_ERROR_TAGS: Record<string, string[]> = {
  数学: ['计算错误', '公式记错', '概念混淆', '逻辑漏洞', '步骤缺失', '分类讨论遗漏'],
  英语: ['单词拼写', '时态错误', '语态错误', '主谓不一致', '搭配不当', '理解偏差', '语法结构'],
  物理: ['受力分析', '公式错用', '单位换算', '模型构建', '实验原理', '图像分析'],
  化学: ['方程式配平', '反应条件', '物质性质', '实验现象', '计算错误', '离子共存'],
  生物: ['概念辨析', '图表分析', '实验设计', '遗传规律', '代谢过程'],
  历史: ['时间混淆', '因果倒置', '史实错误', '观点偏颇', '材料误读'],
  地理: ['定位错误', '成因分析', '特征描述', '规律应用', '读图错误'],
  政治: ['原理错用', '主体混淆', '表述不当', '逻辑混乱', '时政结合'],
  C语言: ['语法错误', '逻辑错误', '边界条件', '指针错误', '数组越界', '内存管理', '算法复杂度'],
};

export const ERROR_TAGS = COMMON_ERROR_TAGS; // Fallback

export type ErrorTag = string;

// Subject color system
export interface SubjectColor {
  bg: string;
  text: string;
  border: string;
  light: string;
  dot: string;
}

export const SUBJECT_COLORS: Record<string, SubjectColor> = {
  数学:  { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-200', light: 'bg-purple-50', dot: 'bg-purple-500' },
  英语:  { bg: 'bg-green-100',  text: 'text-green-700',  border: 'border-green-200',  light: 'bg-green-50',  dot: 'bg-green-500' },
  物理:  { bg: 'bg-blue-100',   text: 'text-blue-700',   border: 'border-blue-200',   light: 'bg-blue-50',   dot: 'bg-blue-500' },
  化学:  { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-200', light: 'bg-orange-50', dot: 'bg-orange-500' },
  生物:  { bg: 'bg-emerald-100',text: 'text-emerald-700',border: 'border-emerald-200',light: 'bg-emerald-50',dot: 'bg-emerald-500' },
  历史:  { bg: 'bg-amber-100',  text: 'text-amber-700',  border: 'border-amber-200',  light: 'bg-amber-50',  dot: 'bg-amber-500' },
  地理:  { bg: 'bg-cyan-100',   text: 'text-cyan-700',   border: 'border-cyan-200',   light: 'bg-cyan-50',   dot: 'bg-cyan-500' },
  政治:  { bg: 'bg-rose-100',   text: 'text-rose-700',   border: 'border-rose-200',   light: 'bg-rose-50',   dot: 'bg-rose-500' },
  C语言:  { bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-200', light: 'bg-indigo-50', dot: 'bg-indigo-500' },
};

export const DEFAULT_COLOR: SubjectColor = {
  bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-200', light: 'bg-gray-50', dot: 'bg-gray-500',
};

export function getSubjectColor(subject: string): SubjectColor {
  return SUBJECT_COLORS[subject] || DEFAULT_COLOR;
}

// Error tag colors
export const ERROR_TAG_COLORS: Record<string, { bg: string; text: string }> = {
  知识盲区: { bg: 'bg-red-100',    text: 'text-red-700' },
  粗心大意: { bg: 'bg-yellow-100', text: 'text-yellow-700' },
  概念混淆: { bg: 'bg-orange-100', text: 'text-orange-700' },
  计算失误: { bg: 'bg-amber-100',  text: 'text-amber-700' },
  方法不熟: { bg: 'bg-purple-100', text: 'text-purple-700' },
  审题失误: { bg: 'bg-blue-100',   text: 'text-blue-700' },
  语法时态: { bg: 'bg-green-100',  text: 'text-green-700' },
  公式记错: { bg: 'bg-indigo-100', text: 'text-indigo-700' },
};

export function getErrorTagColor(tag: string) {
  return ERROR_TAG_COLORS[tag] || { bg: 'bg-gray-100', text: 'text-gray-700' };
}

// Difficulty
export const DIFFICULTY_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  简单: { label: '简单', bg: 'bg-green-100',  text: 'text-green-700' },
  中等: { label: '中等', bg: 'bg-yellow-100', text: 'text-yellow-700' },
  困难: { label: '困难', bg: 'bg-red-100',    text: 'text-red-700' },
  easy:   { label: '简单', bg: 'bg-green-100',  text: 'text-green-700' },
  medium: { label: '中等', bg: 'bg-yellow-100', text: 'text-yellow-700' },
  hard:   { label: '困难', bg: 'bg-red-100',    text: 'text-red-700' },
};

export function getDifficultyConfig(d: string) {
  return DIFFICULTY_CONFIG[d] || { label: d, bg: 'bg-gray-100', text: 'text-gray-700' };
}

// Mastery level
export function getMasteryInfo(level: number) {
  if (level >= 86) return { label: '已掌握', color: 'bg-green-500', textColor: 'text-green-600' };
  if (level >= 61) return { label: '较熟练', color: 'bg-blue-500', textColor: 'text-blue-600' };
  if (level >= 31) return { label: '巩固中', color: 'bg-yellow-500', textColor: 'text-yellow-600' };
  return { label: '未掌握', color: 'bg-red-500', textColor: 'text-red-600' };
}
