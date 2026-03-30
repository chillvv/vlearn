import { useState, useEffect, useRef } from 'react';
import { ImagePlus, Send, Sparkles, X, FileText, CheckCircle, GraduationCap, BrainCircuit, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router';
import { buildCopilotLearningProfile, chatApi, questionsApi } from '../lib/api';
import { approveNewTags, getCanonicalTagDictionary, hydrateTagExtensionsFromCloud, normalizeMistakeDraft, parseCopilotAction, stripActionBlock, type CopilotActionProposal } from '../lib/copilot';
import type { Question } from '../lib/types';
import { toast } from 'sonner';
import { useConfirm } from '../components/business/ConfirmProvider';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

type DraftChatMessage = {
  role: 'assistant' | 'user';
  content: string;
  image?: string;
  action?: CopilotActionProposal;
  draft?: Partial<Question>;
  isError?: boolean;
  originalAsk?: string;
  reasoningContent?: string;
};

const SUGGESTIONS = [
  { icon: <ImagePlus className="h-5 w-5 text-indigo-500" />, text: '上传错题图片并解析' },
  { icon: <CheckCircle className="h-5 w-5 text-emerald-500" />, text: '帮我归纳常见错因' },
  { icon: <FileText className="h-5 w-5 text-blue-500" />, text: '帮我生成今天的复习计划' },
  { icon: <GraduationCap className="h-5 w-5 text-purple-500" />, text: '给我 10 道同类练习' },
];

export function DraftReviewPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [dictionary, setDictionary] = useState(getCanonicalTagDictionary());
  const [messages, setMessages] = useState<DraftChatMessage[]>(() => {
    try {
      const savedChat = sessionStorage.getItem('vlearn_ai_manager_temp_chat');
      return savedChat ? JSON.parse(savedChat) : [];
    } catch (error) {
      console.error('Failed to parse chat history', error);
      return [];
    }
  });
  const [input, setInput] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [executingIdx, setExecutingIdx] = useState<number | null>(null);
  const [executedActions, setExecutedActions] = useState<Record<number, boolean>>({});
  const [draftEdits, setDraftEdits] = useState<Record<number, Partial<Question>>>({});
  const [deepThinking, setDeepThinking] = useState(false);
  const [expandedThinking, setExpandedThinking] = useState<Record<number, boolean>>({});
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      // 限制最大存储条数，防止撑爆存储 (例如只保留最近 50 条)
      const messagesToSave = messages.slice(-50);
      sessionStorage.setItem('vlearn_ai_manager_temp_chat', JSON.stringify(messagesToSave));
    } catch (error) {
      console.warn('Session storage is full or unavailable', error);
      try {
        // 如果因为图片太大导致超限，尝试清理图片后保存
        const withoutImages = messages.slice(-50).map(m => ({ ...m, image: undefined }));
        sessionStorage.setItem('vlearn_ai_manager_temp_chat', JSON.stringify(withoutImages));
      } catch (e2) {
        console.warn('Still failed to save chat to session storage', e2);
      }
    }
  }, [messages]);

  const adjustHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  };

  useEffect(() => {
    adjustHeight();
  }, [input]);

  useEffect(() => {
    void (async () => {
      await hydrateTagExtensionsFromCloud();
      setDictionary(getCanonicalTagDictionary());
    })();
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleUpload = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setImagePreview(result);
      toast.success('图片已附加，请输入你的问题或直接发送');
    };
    reader.readAsDataURL(file);
  };

  const buildContextPrompt = (ask: string, learningProfile: string, hasImage: boolean) => {
    const imageHint = hasImage
      ? '用户已上传题目图片（在前端会话中可见），请结合用户描述完成分析。'
      : '用户暂未上传图片。';
    return `${learningProfile}
当前页面：AI 管家
${imageHint}
用户请求：${ask}`;
  };

  const collectTagAdditions = (draft?: Partial<Question>) => {
    const additions: { knowledge_point: string[]; ability: string[]; error_type: string[] } = {
      knowledge_point: [],
      ability: [],
      error_type: [],
    };
    if (!draft) return additions;
    if (draft.knowledge_point && !dictionary.knowledge_point.includes(String(draft.knowledge_point))) {
      additions.knowledge_point.push(String(draft.knowledge_point));
    }
    if (draft.ability && !dictionary.ability.includes(String(draft.ability))) {
      additions.ability.push(String(draft.ability));
    }
    if (draft.error_type && !dictionary.error_type.includes(String(draft.error_type))) {
      additions.error_type.push(String(draft.error_type));
    }
    return additions;
  };

  const executeAction = async (action: CopilotActionProposal, draft?: Partial<Question>) => {
    if (action.type === 'create_mistake') {
      const additions = collectTagAdditions(draft);
      const hasAdditions = additions.knowledge_point.length > 0 || additions.ability.length > 0 || additions.error_type.length > 0;
      if (hasAdditions) {
        const approved = await confirm({
          title: '检测到新标签',
          confirmText: '确认添加并入库',
          cancelText: '取消',
          description: (
            <div className="space-y-3">
              <p>AI 识别到当前词库中不存在的新标签，确认后将加入并与本题绑定。</p>
              {additions.knowledge_point.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-gray-500">知识点</p>
                  <div className="flex flex-wrap gap-2">
                    {additions.knowledge_point.map(item => (
                      <span key={item} className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">{item}</span>
                    ))}
                  </div>
                </div>
              )}
              {additions.error_type.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-gray-500">错误标签</p>
                  <div className="flex flex-wrap gap-2">
                    {additions.error_type.map(item => (
                      <span key={item} className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">{item}</span>
                    ))}
                  </div>
                </div>
              )}
              {additions.ability.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-gray-500">能力维度</p>
                  <div className="flex flex-wrap gap-2">
                    {additions.ability.map(item => (
                      <span key={item} className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">{item}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ),
        });
        if (!approved) {
          throw new Error('用户取消操作');
        }
      }
      if (hasAdditions) {
        approveNewTags(additions);
        setDictionary(getCanonicalTagDictionary());
      }
      const normalized = normalizeMistakeDraft({
        subject: '英语' as any,
        question_text: draft?.question_text || '来自 AI 管家会话',
        image_url: draft?.image_url || undefined,
        knowledge_point: '时态',
        ability: '规则应用',
        error_type: '时态',
        note: '由 AI 聊天生成',
        ...(action.payload || {}),
        ...draft,
      });

      // Check for duplicates
      const allQs = await questionsApi.getAll();
      const normalizeText = (t: string) => t.replace(/[\s\p{P}]/gu, '').toLowerCase();
      const newText = normalizeText(normalized.question_text || '');
      if (newText.length > 5) {
        const isDuplicate = allQs.some(q => {
          const existText = normalizeText(q.question_text || '');
          if (existText.length > 5) {
            if (existText.includes(newText) || newText.includes(existText)) return true;
            
            // Simple Levenshtein distance for close matches (e.g. OCR minor differences)
            if (Math.abs(existText.length - newText.length) <= 5) {
              let diff = 0;
              const len = Math.min(existText.length, newText.length);
              for (let i = 0; i < len; i++) {
                if (existText[i] !== newText[i]) diff++;
              }
              if (diff <= 3) return true;
            }
          }
          return false;
        });

        if (isDuplicate) {
          const confirmDuplicate = await confirm({
            title: '发现相似错题',
            description: '错题库中似乎已经存在这道题（题干高度相似）。是否仍要继续入库？',
            confirmText: '继续入库',
            cancelText: '取消',
          });
          if (!confirmDuplicate) return;
        }
      }

      await questionsApi.create(normalized);
      toast.success('已存入错题库');
      return;
    }
    if (action.type === 'start_review') {
      const payload = action.payload?.preset || { subject: '英语', scope: 'due', amount: 10, sortBy: 'nearestDue' };
      const approved = await confirm({
        title: '确认生成复习计划',
        confirmText: '确认并开始',
        cancelText: '取消',
        description: (
          <div className="space-y-3 text-sm text-gray-700">
            <div className="rounded-xl bg-gray-50 px-3 py-2">
              <span className="text-gray-500">科目：</span>
              <span className="font-medium text-gray-900">{payload.subject || '英语'}</span>
            </div>
            <div className="rounded-xl bg-gray-50 px-3 py-2">
              <span className="text-gray-500">范围：</span>
              <span className="font-medium text-gray-900">{payload.scope === 'due' ? '待复习' : '全部'}</span>
            </div>
          </div>
        ),
      });
      if (!approved) return;
      navigate('/review', {
        state: {
          preset: payload,
          autoStart: true,
        },
      });
      return;
    }
    if (action.type === 'start_drill') {
      const payload = action.payload?.preset || { subject: '英语', nodes: ['时态'], amount: 10, strategy: '递进' };
      const approved = await confirm({
        title: '确认生成专项练习',
        confirmText: '确认并开始',
        cancelText: '取消',
        description: (
          <div className="space-y-3 text-sm text-gray-700">
            <div className="rounded-xl bg-gray-50 px-3 py-2">
              <span className="text-gray-500">科目：</span>
              <span className="font-medium text-gray-900">{payload.subject || '英语'}</span>
            </div>
            <div className="rounded-xl bg-gray-50 px-3 py-2">
              <span className="text-gray-500">题数：</span>
              <span className="font-medium text-gray-900">{payload.amount || 10}</span>
            </div>
            <div className="rounded-xl bg-gray-50 px-3 py-2">
              <span className="text-gray-500">策略：</span>
              <span className="font-medium text-gray-900">{payload.strategy || '递进'}</span>
            </div>
            <div className="rounded-xl bg-gray-50 px-3 py-2">
              <span className="text-gray-500">涉及考点：</span>
              <span className="font-medium text-gray-900">{(payload.nodes || []).join('、') || '未指定'}</span>
            </div>
          </div>
        ),
      });
      if (!approved) return;
      navigate('/practice', {
        state: {
          preset: payload,
          autoStart: true,
        },
      });
      return;
    }
    if (action.type === 'update_tags') {
      toast.info('AI 管家仅支持新建错题，请到错题详情页执行标签更新。');
      return;
    }
    if (action.type === 'update_learning_content') {
      toast.info('该动作适用于错题详情页知识抽屉，请在详细页执行。');
      return;
    }
    if (action.type === 'delete_mistake') {
      toast.info('AI 管家不支持删除错题。');
    }
  };

  const handleSend = async (quickInput?: string) => {
    const ask = (quickInput || input).trim() || (imagePreview ? '请根据我上传的题图帮我分析并给出下一步建议。' : '');
    if (!ask || sending) return;
    setSending(true);
    
    const currentImage = imagePreview;
    setImagePreview(null);
    
    const baseMessages = [...messages, { role: 'user' as const, content: ask, image: currentImage || undefined }];
    setMessages(baseMessages);
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    const placeholderIndex = baseMessages.length;
    setMessages(prev => [...prev, { role: 'assistant', content: deepThinking ? '' : '正在思考...', reasoningContent: deepThinking ? '正在深度思考中...' : undefined }]);
    if (deepThinking) {
      setExpandedThinking(prev => ({ ...prev, [placeholderIndex]: true }));
    }
    const learningProfile = await buildCopilotLearningProfile();
    
    await new Promise<void>((resolve) => {
      const contextPrompt = buildContextPrompt(ask, learningProfile, Boolean(currentImage));
      const requestMessages: Array<{ role: string; content: any }> = [
        ...baseMessages.map(item => ({ role: item.role, content: item.content })),
      ];
      if (currentImage) {
        requestMessages.push({
          role: 'user',
          content: [
            { type: 'text', text: contextPrompt },
            { type: 'image_url', image_url: { url: currentImage } },
          ],
        });
      } else {
        requestMessages.push({ role: 'user', content: contextPrompt });
      }
      chatApi.streamCopilot(
        requestMessages,
        (chunk, isReasoning) => {
          setMessages(prev => {
            const next = [...prev];
            const current = next[placeholderIndex];
            if (!current) return prev;
            if (isReasoning) {
              next[placeholderIndex] = { ...current, reasoningContent: (current.reasoningContent === '正在深度思考中...' ? '' : current.reasoningContent || '') + chunk };
            } else {
              next[placeholderIndex] = { ...current, content: (current.content === '正在思考...' ? '' : current.content) + chunk };
            }
            return next;
          });
        },
        (full) => {
          const action = parseCopilotAction(full);
          const cleaned = stripActionBlock(full) || '我已经完成分析，请查看建议。';
          const rawDraft = action?.type === 'create_mistake' || action?.type === 'update_tags'
            ? {
              subject: '英语' as any,
              question_text: '来自 AI 管家会话',
              image_url: currentImage || undefined,
              knowledge_point: '时态',
              ability: '规则应用',
              error_type: '时态',
              note: '由 AI 聊天生成',
              ...(action.payload || {}),
            }
            : undefined;
          setMessages(prev => {
            const next = [...prev];
            const current = next[placeholderIndex];
            next[placeholderIndex] = { ...current, role: 'assistant', content: cleaned, action: action || undefined, draft: rawDraft };
            return next;
          });
          setExpandedThinking(prev => ({ ...prev, [placeholderIndex]: false }));
          resolve();
        },
        (error) => {
          setMessages(prev => {
            const next = [...prev];
            const current = next[placeholderIndex];
            next[placeholderIndex] = { ...current, role: 'assistant', content: `请求失败：${error}`, isError: true, originalAsk: ask };
            return next;
          });
          setExpandedThinking(prev => ({ ...prev, [placeholderIndex]: false }));
          resolve();
        },
        { injectLearningProfile: true, enableThinking: deepThinking, model: currentImage ? 'qwen3-vl-flash' : undefined }
      );
    });
    setSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imageItem = Array.from(e.clipboardData.items).find(item => item.type.startsWith('image/'));
    if (!imageItem) return;
    const imageFile = imageItem.getAsFile();
    if (!imageFile) return;
    e.preventDefault();
    handleUpload(imageFile);
  };

  return (
    <div className="relative flex flex-1 flex-col bg-white">
      <div className="flex shrink-0 items-center justify-between border-b border-gray-100 bg-white/95 px-5 py-4 backdrop-blur sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-sm">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[15px] font-bold text-gray-900">AI 错题管家</p>
            <p className="text-[11px] font-medium text-gray-500">拍照或输入题目，我会帮你解析并入库</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDeepThinking(!deepThinking)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              deepThinking
                ? 'bg-indigo-50 text-indigo-600 border border-indigo-200'
                : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'
            }`}
          >
            <BrainCircuit className="h-3.5 w-3.5" />
            深度思考
          </button>
          <button onClick={() => navigate(-1)} className="rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Scrollable Chat Area */}
      <div className="flex-1 overflow-y-auto px-4 pb-48 pt-8 sm:px-6">
        <div className="mx-auto max-w-3xl">
          {messages.length === 0 ? (
            // Empty State
            <div className="flex flex-col items-center justify-center pt-16 md:pt-24 transition-all duration-500">
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white shadow-lg shadow-purple-500/20">
                <Sparkles className="h-8 w-8" />
              </div>
              <h1 className="mb-12 text-2xl font-semibold text-gray-900 md:text-3xl">今天想解决哪道错题？</h1>
              
              <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
                {SUGGESTIONS.map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSend(item.text)}
                    className="flex flex-col items-start gap-3 rounded-xl bg-[#F3F4F6] p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:bg-gray-200 hover:shadow-sm"
                  >
                    <div className="rounded-lg bg-white p-2 shadow-sm">{item.icon}</div>
                    <span className="text-sm font-medium text-gray-700">{item.text}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            // Chat Stream
            <div className="space-y-8">
              {messages.map((msg, idx) => (
                <div key={`${msg.role}-${idx}`} className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'user' ? (
                    <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-gray-100 px-5 py-3.5 text-gray-900 transition-all duration-300 animate-in fade-in slide-in-from-bottom-2">
                      <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{msg.content}</p>
                      {msg.image && (
                        <img src={msg.image} alt="upload" className="mt-3 max-h-64 rounded-xl border border-gray-200 object-contain shadow-sm bg-white" />
                      )}
                    </div>
                  ) : (
                    <div className="flex w-full gap-4 transition-all duration-300 animate-in fade-in slide-in-from-bottom-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-sm">
                        <Sparkles className="h-4 w-4" />
                      </div>
                      <div className="flex-1 space-y-4 pt-1 min-w-0">
                        {msg.reasoningContent && (
                          <div className="mb-3 rounded-xl border border-gray-200 bg-gray-50/50 overflow-hidden">
                            <button
                              onClick={() => setExpandedThinking(prev => ({ ...prev, [idx]: !prev[idx] }))}
                              className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100/50 transition-colors"
                            >
                              <div className="flex items-center gap-2">
                                <BrainCircuit className="h-4 w-4 text-indigo-500" />
                                {expandedThinking[idx] ? '深度思考过程' : '已完成深度思考'}
                              </div>
                              {expandedThinking[idx] ? (
                                <ChevronDown className="h-4 w-4 text-gray-400" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-gray-400" />
                              )}
                            </button>
                            {expandedThinking[idx] && (
                              <div className="px-4 pb-3 pt-1 border-t border-gray-100">
                                <div className="prose prose-sm prose-gray max-w-none text-gray-500 text-[13px] leading-relaxed opacity-80">
                                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                                    {msg.reasoningContent}
                                  </ReactMarkdown>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        <div className="prose prose-sm md:prose-base prose-gray max-w-none leading-relaxed text-gray-800 break-words">
                          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                        
                        {msg.isError && (
                          <div className="mt-2">
                            <button
                              onClick={() => {
                                // Remove the error message and the previous user message
                                setMessages(prev => prev.slice(0, -2));
                                handleSend(msg.originalAsk);
                              }}
                              className="text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline flex items-center gap-1"
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                              重新发送
                            </button>
                          </div>
                        )}

                        {msg.action && (
                          <div className="mt-4 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm ring-1 ring-black/5 transition-all hover:shadow-md">
                            <div className="border-b border-gray-50 bg-gray-50/50 px-4 py-3">
                              <p className="text-sm font-semibold text-gray-900">{msg.action.title || '执行建议'}</p>
                              <p className="mt-0.5 text-xs text-gray-500">{msg.action.description || '请确认后执行'}</p>
                            </div>
                            <div className="p-4">
                              {msg.draft && (
                                <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                                  <label className="flex flex-col gap-1.5 z-10">
                                    <span className="text-xs font-medium text-gray-500">知识点</span>
                                    <input
                                      value={(draftEdits[idx]?.knowledge_point as string) ?? (msg.draft.knowledge_point || '')}
                                      onChange={e => setDraftEdits(prev => ({ ...prev, [idx]: { ...prev[idx], knowledge_point: e.target.value } }))}
                                      list={`kp-${idx}`}
                                      className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm outline-none transition-all focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                                    />
                                    <datalist id={`kp-${idx}`}>
                                      {dictionary.knowledge_point.map(item => <option key={item} value={item} />)}
                                    </datalist>
                                  </label>
                                  <label className="flex flex-col gap-1.5 z-10">
                                    <span className="text-xs font-medium text-gray-500">能力维度</span>
                                    <input
                                      value={(draftEdits[idx]?.ability as string) ?? (msg.draft.ability || '')}
                                      onChange={e => setDraftEdits(prev => ({ ...prev, [idx]: { ...prev[idx], ability: e.target.value } }))}
                                      list={`ability-${idx}`}
                                      className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm outline-none transition-all focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                                    />
                                    <datalist id={`ability-${idx}`}>
                                      {dictionary.ability.map(item => <option key={item} value={item} />)}
                                    </datalist>
                                  </label>
                                  <label className="flex flex-col gap-1.5 z-10">
                                    <span className="text-xs font-medium text-gray-500">错因</span>
                                    <input
                                      value={(draftEdits[idx]?.error_type as string) ?? (msg.draft.error_type || '')}
                                      onChange={e => setDraftEdits(prev => ({ ...prev, [idx]: { ...prev[idx], error_type: e.target.value } }))}
                                      list={`err-${idx}`}
                                      className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm outline-none transition-all focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                                    />
                                    <datalist id={`err-${idx}`}>
                                      {dictionary.error_type.map(item => <option key={item} value={item} />)}
                                    </datalist>
                                  </label>
                                </div>
                              )}
                              <div className="flex items-center gap-3">
                                <button
                                  disabled={executingIdx === idx || executedActions[idx]}
                                  onClick={async () => {
                                    if (executingIdx === idx || executedActions[idx]) return;
                                    setExecutingIdx(idx);
                                    try {
                                      await executeAction(msg.action!, draftEdits[idx] || msg.draft);
                                      setExecutedActions(prev => ({ ...prev, [idx]: true }));
                                      setMessages(prev => [...prev, { role: 'assistant', content: '✅ 错题已成功写入数据库。你可以到错题库中查看，还需要我继续安排下一步吗？' }]);
                                    } catch (error: any) {
                                      if (error?.message === '用户取消操作') {
                                        return;
                                      }
                                      toast.error(error?.message || '执行失败');
                                    } finally {
                                      setExecutingIdx(null);
                                    }
                                  }}
                                  className={`rounded-xl px-4 py-2 text-sm font-medium text-white transition-all ${
                                    executedActions[idx]
                                      ? 'bg-emerald-500 cursor-default'
                                      : executingIdx === idx
                                      ? 'bg-indigo-400 cursor-wait'
                                      : 'bg-gray-900 hover:bg-gray-800 hover:shadow-md active:scale-95'
                                  }`}
                                >
                                  {executedActions[idx] ? (
                                    <span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4" /> 已执行</span>
                                  ) : executingIdx === idx ? (
                                    <span className="flex items-center gap-1.5"><RefreshCw className="h-4 w-4 animate-spin" /> 正在写入库...</span>
                                  ) : (
                                    '确认执行'
                                  )}
                                </button>
                                {!executedActions[idx] && (
                                  <span className="text-xs text-gray-400">
                                    {msg.action.risk === 'high' ? '⚠️ 高风险动作将触发二次确认' : '建议先确认再执行'}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} className="h-1" />
            </div>
          )}
        </div>
      </div>

      {/* Sticky Bottom Input Area */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-white via-white/95 to-transparent pb-6 pt-12">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          {imagePreview && (
            <div className="mb-3 flex w-fit items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm transition-all animate-in fade-in slide-in-from-bottom-2">
              <ImagePlus className="h-4 w-4 text-indigo-500" />
              <span className="text-xs font-medium text-gray-700">已附加题图</span>
              <button onClick={() => setImagePreview(null)} className="ml-1 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          
          <div className="relative flex items-end gap-2 rounded-3xl border border-gray-200 bg-white p-2 shadow-sm transition-all duration-200 focus-within:border-indigo-400 focus-within:shadow-md focus-within:ring-4 focus-within:ring-indigo-50">
            <label className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700">
              <ImagePlus className="h-5 w-5" />
              <input type="file" accept="image/*" className="hidden" onChange={e => handleUpload(e.target.files?.[0] || null)} />
            </label>
            
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              rows={1}
              className="max-h-32 min-h-[40px] flex-1 resize-none bg-transparent py-2 text-[15px] text-gray-900 outline-none placeholder:text-gray-400"
              placeholder="输入你的问题，或上传图片..."
            />
            
            <button
              onClick={() => handleSend()}
              disabled={sending || (!input.trim() && !imagePreview)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-900 text-white transition-all hover:bg-gray-800 disabled:bg-gray-100 disabled:text-gray-400 disabled:shadow-none shadow-sm"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-3 text-center text-xs text-gray-400">AI 可能会犯错，请结合实际情况参考解析。</p>
        </div>
      </div>
    </div>
  );
}
