import type { Subject } from './types';

export type KnowledgeNodeMeta = {
  category: string;
  branch: string;
  node: string;
};

const ENGLISH_CATEGORY_MAP: Record<string, KnowledgeNodeMeta> = {
  时态: { category: '语法', branch: '动词系统', node: '时态' },
  主谓一致: { category: '语法', branch: '句法一致', node: '主谓一致' },
  虚拟语气: { category: '语法', branch: '动词系统', node: '虚拟语气' },
  从句: { category: '语法', branch: '句法结构', node: '从句' },
  被动语态: { category: '语法', branch: '动词系统', node: '被动语态' },
  非谓语动词: { category: '语法', branch: '动词系统', node: '非谓语动词' },
  介词: { category: '词法', branch: '词性与用法', node: '介词' },
  冠词: { category: '词法', branch: '词性与用法', node: '冠词' },
  代词: { category: '词法', branch: '词性与用法', node: '代词' },
  词形变化: { category: '词法', branch: '词形规则', node: '词形变化' },
  词义辨析: { category: '词汇', branch: '词义语境', node: '词义辨析' },
  固定搭配: { category: '词汇', branch: '固定搭配', node: '固定搭配' },
  主旨理解: { category: '阅读', branch: '篇章理解', node: '主旨理解' },
  细节理解: { category: '阅读', branch: '篇章理解', node: '细节理解' },
  推理判断: { category: '阅读', branch: '篇章理解', node: '推理判断' },
  句子结构: { category: '阅读', branch: '句子分析', node: '句子结构' },
  逻辑连接: { category: '阅读', branch: '篇章逻辑', node: '逻辑连接' },
  表达准确: { category: '写作', branch: '表达规范', node: '表达准确' },
};

const C_CATEGORY_MAP: Record<string, KnowledgeNodeMeta> = {
  变量与数据类型: { category: '基础语法', branch: '类型系统', node: '变量与数据类型' },
  运算符与表达式: { category: '基础语法', branch: '表达式规则', node: '运算符与表达式' },
  选择结构: { category: '流程控制', branch: '分支判断', node: '选择结构' },
  循环结构: { category: '流程控制', branch: '循环迭代', node: '循环结构' },
  函数: { category: '函数与模块', branch: '函数设计', node: '函数' },
  数组: { category: '数据结构', branch: '顺序存储', node: '数组' },
  字符串: { category: '数据结构', branch: '字符处理', node: '字符串' },
  指针: { category: '内存与指针', branch: '地址与引用', node: '指针' },
  结构体: { category: '数据结构', branch: '复合类型', node: '结构体' },
  文件操作: { category: '输入输出', branch: '文件读写', node: '文件操作' },
  排序与查找: { category: '算法基础', branch: '排序查找', node: '排序与查找' },
  内存管理: { category: '内存与指针', branch: '内存生命周期', node: '内存管理' },
  边界条件: { category: '调试与健壮性', branch: '边界与异常', node: '边界条件' },
};

const DEFAULT_NODE: KnowledgeNodeMeta = {
  category: '未分类',
  branch: '其他',
  node: '其他',
};

export function getKnowledgeNodeMeta(subject: Subject, knowledgePoint?: string): KnowledgeNodeMeta {
  if (!knowledgePoint) return DEFAULT_NODE;
  if (subject === 'C语言') {
    return C_CATEGORY_MAP[knowledgePoint] || { category: 'C语言其他', branch: '其他', node: knowledgePoint };
  }
  return ENGLISH_CATEGORY_MAP[knowledgePoint] || { category: '英语其他', branch: '其他', node: knowledgePoint };
}

// 允许在运行时动态注册分类映射
export function registerCustomKnowledgeTaxonomy(knowledgePoint: string, category: string, branch: string, subject: Subject) {
  if (subject === 'C语言') {
    C_CATEGORY_MAP[knowledgePoint] = { category, branch, node: knowledgePoint };
  } else {
    ENGLISH_CATEGORY_MAP[knowledgePoint] = { category, branch, node: knowledgePoint };
  }
}
