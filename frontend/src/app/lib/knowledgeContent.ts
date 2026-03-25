export type LearningDrawerContent = {
  title?: string;
  summary?: string;
  tables?: any[];
  markdown?: string;
};

export type LearningContentState = {
  tipsByNode: Record<string, string[]>;
  drawerByTag: Record<string, LearningDrawerContent>;
};

export const LEARNING_CONTENT_KEY = 'mistake_learning_content_v1';

export const KNOWLEDGE_DB: Record<string, any> = {
  时态: {
    title: '英语：时态',
    mastery: 58,
    summary: '重点区分一般现在时、一般过去时和现在完成时，先看时间状语再判定时态。',
    tables: [
      {
        title: '时态速查',
        type: 'definition',
        data: [
          { name: '一般现在时', desc: '经常性动作、客观事实' },
          { name: '一般过去时', desc: '过去某个时间发生的动作' },
          { name: '现在完成时', desc: '过去发生并对现在有影响' },
          { name: '过去进行时', desc: '过去某时正在进行的动作' },
          { name: '过去完成时', desc: '过去某时之前已经完成' },
        ],
      },
    ],
  },
  虚拟语气: {
    title: '英语：虚拟语气',
    mastery: 46,
    summary: '先判断是否与事实相反，再选对应时态：现在反事实用过去式，过去反事实用had done。',
    tables: [
      {
        title: '虚拟语气核心句型',
        type: 'definition',
        data: [
          { name: 'If + did', desc: '与现在事实相反，主句 would/could/might + do' },
          { name: 'If + had done', desc: '与过去事实相反，主句 would/could/might + have done' },
          { name: 'If + were to/should do', desc: '与将来事实相反或可能性极低' },
        ],
      },
    ],
  },
  指针: {
    title: 'C语言：指针',
    mastery: 45,
    summary: '先区分“地址”和“值”，再检查解引用前是否判空与越界。',
    tables: [
      {
        title: '指针核心概念',
        type: 'definition',
        data: [
          { name: 'int *p', desc: '声明一个指向整型的指针' },
          { name: '&a', desc: '取变量 a 的地址' },
          { name: '*p', desc: '解引用，读取 p 指向的值' },
          { name: 'NULL', desc: '空指针，不可直接解引用' },
        ],
      },
    ],
  },
  数组: {
    title: 'C语言：数组',
    mastery: 52,
    summary: '数组错误高发在下标越界，范围应始终是 0 到 n-1。',
    tables: [
      {
        title: '数组检查清单',
        type: 'definition',
        data: [
          { name: '下标范围', desc: '0 <= i < n' },
          { name: '循环边界', desc: '避免 i <= n 造成越界' },
          { name: '初始化', desc: '使用前初始化，避免脏数据' },
          { name: '长度传递', desc: '函数传参时显式携带长度' },
        ],
      },
    ],
  },
  文件操作: {
    title: 'C语言：文件操作',
    mastery: 65,
    summary: '文件操作错误多发生在打开模式和读写函数配对不当。',
    tables: [
      {
        title: '文件操作核心函数',
        type: 'definition',
        data: [
          { name: 'fopen()', desc: '打开文件', header: '<stdio.h>' },
          { name: 'fclose()', desc: '关闭文件', header: '<stdio.h>' },
          { name: 'fgets()', desc: '读取一行文本', header: '<stdio.h>' },
          { name: 'fputs()', desc: '写入一行文本', header: '<stdio.h>' },
          { name: 'fread()', desc: '二进制读取', header: '<stdio.h>' },
          { name: 'fwrite()', desc: '二进制写入', header: '<stdio.h>' },
          { name: 'fseek()', desc: '移动文件指针', header: '<stdio.h>' },
          { name: 'ftell()', desc: '获取指针位置', header: '<stdio.h>' },
          { name: 'rewind()', desc: '重置到文件起点', header: '<stdio.h>' },
        ],
      },
    ],
  },
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
