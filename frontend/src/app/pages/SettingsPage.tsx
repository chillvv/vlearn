import { useState, useRef } from 'react';
import { useNavigate } from 'react-router';
import {
  User, Shield, Database, Download, Upload, Share2, LogOut,
  Copy, Check, Eye, EyeOff, Info, Cloud,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { authApi, syncApi, supabase, questionsApi } from '../lib/api';
import { toast } from 'sonner';

// Section wrapper
function Section({ title, icon: Icon, children }: {
  title: string; icon: React.FC<any>; children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center">
          <Icon className="w-4 h-4 text-blue-600" />
        </div>
        <h3 className="font-semibold text-gray-900 text-sm">{title}</h3>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

function Row({ label, desc, children }: { label: string; desc?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3.5 border-b border-gray-50 last:border-0">
      <div>
        <p className="text-sm font-medium text-gray-800">{label}</p>
        {desc && <p className="text-xs text-gray-400 mt-0.5">{desc}</p>}
      </div>
      <div className="flex-shrink-0 ml-4">{children}</div>
    </div>
  );
}

export function SettingsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Account
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [pwdLoading, setPwdLoading] = useState(false);

  // Share code
  const [shareCode, setShareCode] = useState('');
  const [shareCount, setShareCount] = useState(0);
  const [shareLoading, setShareLoading] = useState(false);
  const [importCode, setImportCode] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Import file
  const [exportLoading, setExportLoading] = useState(false);
  const [importFileLoading, setImportFileLoading] = useState(false);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const fileRef = useRef<HTMLInputElement>(null);

  const displayName = user?.user_metadata?.name || user?.email?.split('@')[0] || '用户';
  const initial = displayName[0]?.toUpperCase() || 'U';

  const handleChangePwd = async () => {
    if (!newPassword) return toast.error('请输入新密码');
    if (newPassword.length < 6) return toast.error('密码至少需要6位');
    if (newPassword !== confirmPassword) return toast.error('两次密码不一致');
    setPwdLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw new Error(error.message);
      toast.success('密码修改成功');
      setNewPassword(''); setConfirmPassword('');
    } catch (err: any) {
      toast.error(err.message || '密码修改失败');
    } finally {
      setPwdLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await authApi.logout();
      navigate('/login');
      toast.success('已退出登录');
    } catch (err: any) {
      toast.error(err?.message || '退出登录失败');
    }
  };

  const handleExport = async () => {
    setExportLoading(true);
    try {
      await syncApi.export();
      toast.success('导出成功，文件已下载');
    } catch (err: any) {
      toast.error(err.message || '导出失败');
    } finally {
      setExportLoading(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileLoading(true);
    try {
      const result = await syncApi.import(file, importMode);
      toast.success(`成功导入 ${result.imported} 道错题`);
    } catch (err: any) {
      toast.error(err.message || '导入失败，请检查文件格式');
    } finally {
      setImportFileLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleCreateShareCode = async () => {
    setShareLoading(true);
    try {
      const result = await syncApi.createShareCode();
      setShareCode(result.shareCode);
      setShareCount(result.count);
      toast.success(`分享码生成成功，包含 ${result.count} 道错题`);
    } catch (err: any) {
      toast.error(err.message || '生成分享码失败');
    } finally {
      setShareLoading(false);
    }
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(shareCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('分享码已复制');
  };

  const handleImportByCode = async () => {
    if (!importCode.trim()) return toast.error('请输入分享码');
    if (importCode.trim().length !== 8) return toast.error('分享码格式不正确（需要8位）');
    setImportLoading(true);
    try {
      const { questions } = await syncApi.importByCode(importCode.trim());
      let imported = 0;
      for (const q of questions) {
        try {
          await questionsApi.create(q);
          imported++;
        } catch { /* skip */ }
      }
      toast.success(`成功导入 ${imported} 道错题`);
      setImportCode('');
    } catch (err: any) {
      toast.error(err.message || '导入失败');
    } finally {
      setImportLoading(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">设置</h1>
          <p className="text-gray-500 text-sm mt-1">管理你的账户信息和数据</p>
        </div>

        {/* Account info */}
        <Section title="账户信息" icon={User}>
          <div className="flex items-center gap-4 mb-6 pb-6 border-b border-gray-50">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-2xl font-bold shadow-md shadow-blue-200 flex-shrink-0">
              {initial}
            </div>
            <div>
              <p className="font-bold text-gray-900 text-lg">{displayName}</p>
              <p className="text-gray-500 text-sm">{user?.email}</p>
              <div className="flex items-center gap-1.5 mt-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                <span className="text-xs text-green-600 font-medium">账户正常</span>
              </div>
            </div>
          </div>
          <Row label="邮箱" desc={user?.email}>
            <span className="text-xs text-gray-400 bg-gray-100 px-2.5 py-1 rounded-lg">已验证</span>
          </Row>
          <Row label="昵称" desc={displayName} />
          <Row label="注册时间" desc={user?.created_at ? new Date(user.created_at).toLocaleDateString('zh-CN') : '未知'} />
        </Section>

        {/* Security */}
        <Section title="账户安全" icon={Shield}>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">新密码</label>
                <div className="relative">
                  <input
                    type={showPwd ? 'text' : 'password'}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="至少6位字符"
                    className="w-full h-10 px-3 pr-9 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/30"
                  />
                  <button onClick={() => setShowPwd(!showPwd)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPwd ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">确认新密码</label>
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="再次输入密码"
                  className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/30"
                />
              </div>
            </div>
            <button
              onClick={handleChangePwd}
              disabled={pwdLoading || !newPassword || newPassword.length < 6 || newPassword !== confirmPassword}
              className="h-10 px-5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-2"
            >
              {pwdLoading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Shield className="w-4 h-4" />}
              修改密码
            </button>
          </div>

          <div className="mt-5 pt-5 border-t border-gray-100">
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 text-sm text-red-500 hover:text-red-600 font-medium px-4 py-2.5 rounded-xl hover:bg-red-50 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              退出登录
            </button>
          </div>
        </Section>

        {/* Data export/import */}
        <Section title="数据备份" icon={Database}>
          <div className="space-y-4">
            <Row label="导出错题库" desc="将所有错题导出为 JSON 文件，可用于备份或迁移">
              <button
                onClick={handleExport}
                disabled={exportLoading}
                className="flex items-center gap-1.5 h-9 px-4 bg-gray-900 hover:bg-gray-800 text-white rounded-xl text-xs font-semibold transition-colors disabled:opacity-50"
              >
                {exportLoading ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                导出 JSON
              </button>
            </Row>

            <div className="pt-2">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-medium text-gray-800">导入错题库</p>
                  <p className="text-xs text-gray-400 mt-0.5">从 JSON 文件中导入错题</p>
                </div>
                <div className="flex items-center gap-2 bg-gray-100 rounded-xl p-1">
                  {(['merge', 'replace'] as const).map(mode => (
                    <button
                      key={mode}
                      onClick={() => setImportMode(mode)}
                      className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-all ${importMode === mode ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      {mode === 'merge' ? '合并导入' : '覆盖导入'}
                    </button>
                  ))}
                </div>
              </div>
              <input type="file" accept=".json" ref={fileRef} onChange={handleImportFile} className="hidden" />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={importFileLoading}
                className="flex items-center gap-2 h-10 px-4 border-2 border-dashed border-gray-200 hover:border-blue-300 hover:bg-blue-50/50 text-gray-600 hover:text-blue-600 rounded-xl text-sm font-medium transition-all w-full justify-center"
              >
                {importFileLoading ? <div className="w-4 h-4 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" /> : <Upload className="w-4 h-4" />}
                {importFileLoading ? '导入中...' : '选择 JSON 文件'}
              </button>
            </div>
          </div>
        </Section>

        {/* Share */}
        <Section title="分享错题" icon={Cloud}>
          <div className="space-y-5">
            {/* Generate share code */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-medium text-gray-800">生成分享码</p>
                  <p className="text-xs text-gray-400 mt-0.5">将全部错题生成分享码，有效期 7 天</p>
                </div>
                <button
                  onClick={handleCreateShareCode}
                  disabled={shareLoading}
                  className="flex items-center gap-1.5 h-9 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  {shareLoading ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Share2 className="w-3.5 h-3.5" />}
                  生成分享码
                </button>
              </div>
              {shareCode && (
                <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-100 rounded-xl">
                  <div className="flex-1">
                    <p className="text-xs text-blue-500 mb-0.5">分享码（包含 {shareCount} 道错题）</p>
                    <p className="text-xl font-bold text-blue-700 font-mono tracking-widest">{shareCode}</p>
                  </div>
                  <button
                    onClick={handleCopyCode}
                    className={`h-9 px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${copied ? 'bg-green-100 text-green-700' : 'bg-white hover:bg-blue-100 text-blue-600'}`}
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? '已复制' : '复制'}
                  </button>
                </div>
              )}
            </div>

            {/* Import by code */}
            <div className="pt-4 border-t border-gray-50">
              <p className="text-sm font-medium text-gray-800 mb-1">通过分享码导入</p>
              <p className="text-xs text-gray-400 mb-3">输入其他同学分享给你的码，导入他们的错题</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={importCode}
                  onChange={e => setImportCode(e.target.value.toUpperCase())}
                  placeholder="输入8位分享码..."
                  maxLength={8}
                  className="flex-1 h-10 px-4 rounded-xl border border-gray-200 text-sm font-mono tracking-widest text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400/30 uppercase placeholder:normal-case placeholder:font-sans placeholder:tracking-normal"
                />
                <button
                  onClick={handleImportByCode}
                  disabled={importCode.trim().length !== 8 || importLoading}
                  className="h-10 px-5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-2"
                >
                  {importLoading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Download className="w-4 h-4" />}
                  导入
                </button>
              </div>
            </div>
          </div>
        </Section>

        {/* About */}
        <Section title="关于" icon={Info}>
          <div className="space-y-3">
            <Row label="应用版本" desc="AI 错题助手 v1.0.0" />
            <Row label="AI 引擎" desc="豆包大模型（Doubao Pro）" />
            <Row label="数据存储" desc="Supabase 云数据库，数据安全加密" />
            <Row label="技术栈" desc="React · TypeScript · Tailwind CSS · Deno" />
          </div>
        </Section>
      </div>
    </div>
  );
}
