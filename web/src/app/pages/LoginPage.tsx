import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Sparkles, Eye, EyeOff, ArrowRight, BookOpen, Brain, Zap } from 'lucide-react';
import { authApi, supabase } from '../lib/api';
import { toast } from 'sonner';

type Tab = 'login' | 'register';

export function LoginPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate('/', { replace: true });
    });
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return toast.error('请填写邮箱和密码');
    setLoading(true);
    try {
      if (tab === 'register') {
        const data = await authApi.register(email, password, name);
        if (data.user && !data.session) {
          toast.success('注册成功！请前往邮箱验证您的账号。');
          setTab('login');
        } else {
          toast.success('注册成功！正在登录...');
          await authApi.login(email, password);
          navigate('/', { replace: true });
        }
      } else {
        await authApi.login(email, password);
        toast.success('登录成功，欢迎回来！');
        navigate('/', { replace: true });
      }
    } catch (err: any) {
      toast.error(err.message || (tab === 'login' ? '登录失败，请检查邮箱和密码' : '注册失败'));
    } finally {
      setLoading(false);
    }
  };

  const features = [
    { icon: Brain, title: 'AI 智能分析', desc: '豆包大模型深度解析每道错题的知识点与错误原因' },
    { icon: BookOpen, title: '科学错题库', desc: '按科目、考点、错误类型多维分类，精准定位薄弱环节' },
    { icon: Zap, title: '间隔复习', desc: '基于记忆曲线算法，自动安排最优复习计划，高效巩固' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex">
      {/* Left decorative panel */}
      <div className="relative hidden w-[min(36vw,520px)] flex-shrink-0 flex-col justify-between overflow-hidden bg-gradient-to-br from-blue-600 to-blue-700 p-10 xl:flex">
        {/* Background decorations */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/30 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-purple-600/20 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-16">
            <div className="w-11 h-11 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shadow-lg">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-white font-bold text-xl">错题助手</p>
              <p className="text-blue-200 text-xs font-medium tracking-wider">AI WRONG QUESTION SYSTEM</p>
            </div>
          </div>

          <h1 className="text-4xl font-bold text-white leading-snug mb-6">
            用 AI 驱动<br />你的学习进步
          </h1>
          <p className="text-blue-100 text-lg leading-relaxed mb-12">
            智能分析你的错题，找出知识盲区，<br />制定个性化复习计划，快速提升成绩。
          </p>

          <div className="space-y-5">
            {features.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex items-start gap-4 group">
                <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center flex-shrink-0 group-hover:bg-white/25 transition-colors">
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-white font-semibold text-sm">{title}</p>
                  <p className="text-blue-200 text-xs mt-0.5 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10">
          <p className="text-blue-300 text-xs">© 2026 AI错题助手 · 让学习更高效</p>
        </div>
      </div>

      {/* Right login form */}
      <div className="flex flex-1 items-center justify-center px-4 py-8 sm:px-6 sm:py-12">
        <div className="w-full max-w-[440px]">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2 mb-10 justify-center">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-md">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-gray-900 text-xl">错题助手</span>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-1.5">
              {tab === 'login' ? '欢迎回来 👋' : '创建账户 🎉'}
            </h2>
            <p className="text-gray-500 text-sm">
              {tab === 'login' ? '登录你的账户，继续你的学习旅程' : '注册一个新账户，开始高效学习'}
            </p>
          </div>

          {/* Tab toggle */}
          <div className="flex bg-gray-100 rounded-xl p-1 mb-8">
            {(['login', 'register'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                  tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t === 'login' ? '登录' : '注册'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {tab === 'register' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">昵称</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="你的昵称（可选）"
                  className="w-full h-11 px-4 rounded-xl border border-gray-200 bg-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all placeholder:text-gray-400"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">邮箱</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                className="w-full h-11 px-4 rounded-xl border border-gray-200 bg-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all placeholder:text-gray-400"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">密码</label>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={tab === 'register' ? '至少6位字符' : '输入密码'}
                  required
                  className="w-full h-11 px-4 pr-12 rounded-xl border border-gray-200 bg-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all placeholder:text-gray-400"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(!showPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {showPwd ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 shadow-md shadow-blue-200 mt-2"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <span>{tab === 'login' ? '登录' : '创建账户'}</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-6">
            {tab === 'login' ? '还没有账户？' : '已有账户？'}
            <button
              onClick={() => setTab(tab === 'login' ? 'register' : 'login')}
              className="text-blue-600 hover:text-blue-700 font-medium ml-1"
            >
              {tab === 'login' ? '立即注册' : '去登录'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
