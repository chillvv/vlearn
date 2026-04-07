import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  LayoutDashboard, BookOpen, RotateCcw, Settings,
  Sparkles, LogOut, Moon, Sun, RefreshCw, Cloud, CloudOff, CloudUpload
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { authApi, userLearningStateApi } from '../lib/api';
import { getLearningSyncSnapshot, subscribeLearningSyncSnapshot, type LearningSyncSnapshot } from '../lib/learningSyncStatus';
import { buildLearningSessionNavigation, createLearningSessionProposal } from '../lib/learningSession';
import { toast } from 'sonner';
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from './ui/sidebar';
import { useTheme } from './theme-provider';

const NAV_ITEMS = [
  { path: '/',          label: '首页',    icon: LayoutDashboard },
  { path: '/questions', label: '错题库',  icon: BookOpen },
  { path: '/draft-review', label: 'AI 管家', icon: Sparkles },
  { path: '/practice',  label: '专项练习', icon: Sparkles },
  { path: '/review',    label: '复习中心', icon: RotateCcw },
];

export function SidebarComponent() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const [syncSnapshot, setSyncSnapshot] = useState<LearningSyncSnapshot>(getLearningSyncSnapshot());
  const [retrying, setRetrying] = useState(false);

  const displayName = user?.user_metadata?.name || user?.email?.split('@')[0] || '用户';
  const initial = displayName[0]?.toUpperCase() || 'U';

  const handleLogout = async () => {
    await authApi.logout();
    navigate('/login');
    toast.success('已退出登录');
  };

  useEffect(() => subscribeLearningSyncSnapshot(setSyncSnapshot), []);

  const renderSyncIcon = () => {
    if (syncSnapshot.state === 'syncing') return <CloudUpload className="w-3.5 h-3.5 text-orange-500 animate-pulse" />;
    if (syncSnapshot.state === 'synced') return <Cloud className="w-3.5 h-3.5 text-emerald-500" />;
    if (syncSnapshot.state === 'error') return <CloudOff className="w-3.5 h-3.5 text-slate-400" />;
    return <Cloud className="w-3.5 h-3.5 text-slate-400" />;
  };

  const syncText = syncSnapshot.state === 'syncing'
    ? '同步中'
    : syncSnapshot.state === 'synced'
      ? '已同步'
      : syncSnapshot.state === 'error'
        ? '同步失败'
        : '未同步';
  const practiceEntry = buildLearningSessionNavigation(createLearningSessionProposal({
    sessionKind: 'practice',
    sourceSurface: 'sidebar',
    sourceReason: '用户从侧边栏进入专项练习',
    objectiveCode: 'custom_scope',
    explanationSummary: '从侧边栏进入专项练习页',
    returnPath: {
      pathname: '/',
      search: '',
      label: '回到首页',
    },
  }));
  const reviewEntry = buildLearningSessionNavigation(createLearningSessionProposal({
    sessionKind: 'review',
    sourceSurface: 'sidebar',
    sourceReason: '用户从侧边栏进入复习中心',
    objectiveCode: 'review_due',
    explanationSummary: '从侧边栏进入复习中心',
    scope: {
      subject: '英语',
      amount: 10,
      reviewScope: 'due',
      sortBy: 'nearestDue',
    },
    returnPath: {
      pathname: '/',
      search: '',
      label: '回到首页',
    },
  }));

  return (
    <Sidebar className="!border-r-0 bg-[#FDFDFD] dark:bg-slate-950 shadow-[2px_0_24px_rgba(0,0,0,0.04)] dark:shadow-[2px_0_24px_rgba(0,0,0,0.4)] relative z-10">
      <SidebarHeader className="px-6 py-8">
        <div className="flex items-center gap-3.5">
          <div className="flex items-center justify-center flex-shrink-0 w-8 h-8">
            <span className="text-[24px] drop-shadow-sm">✨</span>
          </div>
          <div className="min-w-0">
            <div className="font-extrabold text-slate-900 dark:text-white text-[16px] tracking-tight leading-tight">错题助手</div>
            <div className="text-[10px] text-amber-500 dark:text-amber-400 font-bold tracking-[0.15em] mt-1 uppercase">AI Powered</div>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-4">
        <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-[0.15em] px-4 mb-3 mt-2">主菜单</p>
        <SidebarMenu className="gap-1.5">
          {NAV_ITEMS.map(({ path, label, icon: Icon }) => {
            const isActive = path === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(path);
            
            return (
              <SidebarMenuItem key={path}>
                <SidebarMenuButton
                  type="button"
                  tooltip={label}
                  className={`py-3.5 px-4 rounded-[16px] transition-all duration-200 ease-in-out active:scale-[0.98] group relative overflow-hidden ${
                    isActive
                      ? 'bg-[#EBEBEB] text-slate-900 dark:bg-slate-800 dark:text-white font-semibold'
                      : 'text-[#475467] hover:bg-[#F2F4F7] hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200'
                  }`}
                  onClick={() => {
                    if (path === '/practice') {
                      navigate(
                        { pathname: practiceEntry.pathname, search: practiceEntry.search },
                        { state: practiceEntry.state },
                      );
                      return;
                    }
                    if (path === '/review') {
                      navigate(
                        { pathname: reviewEntry.pathname, search: reviewEntry.search },
                        { state: reviewEntry.state },
                      );
                      return;
                    }
                    navigate(path);
                  }}
                >
                  <div className="flex items-center w-full gap-3.5">
                    <Icon className={`w-5 h-5 flex-shrink-0 transition-all duration-300 ease-out group-hover:-translate-y-[1px] group-hover:scale-105 ${isActive ? 'text-slate-900 dark:text-white' : 'text-[#475467] dark:text-slate-400 dark:group-hover:text-slate-300'}`} />
                    <span className={`text-[14px] flex-1 ${isActive ? 'font-semibold' : 'font-medium'}`}>
                      {label}
                    </span>
                  </div>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter className="px-4 pb-6 pt-4 border-t border-slate-100 dark:border-slate-800/60 space-y-2">
        <SidebarMenu className="gap-1.5">
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              className={`py-3.5 px-4 rounded-[16px] transition-all duration-200 ease-in-out active:scale-[0.98] group relative overflow-hidden ${
                location.pathname === '/settings'
                  ? 'bg-[#EBEBEB] text-slate-900 dark:bg-slate-800 dark:text-white font-semibold'
                  : 'text-[#475467] hover:bg-[#F2F4F7] hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200'
              }`}
              onClick={() => navigate('/settings')}
            >
              <div className="flex items-center w-full gap-3.5">
                <Settings className={`w-5 h-5 flex-shrink-0 transition-all duration-300 ease-out group-hover:-translate-y-[1px] group-hover:scale-105 ${location.pathname === '/settings' ? 'text-slate-900 dark:text-white' : 'text-[#475467] dark:text-slate-400 dark:group-hover:text-slate-300'}`} />
                <span className={`text-[14px] flex-1 ${location.pathname === '/settings' ? 'font-semibold' : 'font-medium'}`}>设置</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton 
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} 
              className="py-3.5 px-4 rounded-[16px] transition-all duration-200 ease-in-out active:scale-[0.98] group cursor-pointer text-[#475467] hover:bg-[#F2F4F7] hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200"
            >
              <div className="flex items-center w-full gap-3.5">
                {theme === 'dark' ? (
                  <Sun className="w-5 h-5 flex-shrink-0 transition-all duration-300 ease-out group-hover:-translate-y-[1px] group-hover:scale-105 text-[#475467] dark:text-slate-400 dark:group-hover:text-slate-300" />
                ) : (
                  <Moon className="w-5 h-5 flex-shrink-0 transition-all duration-300 ease-out group-hover:-translate-y-[1px] group-hover:scale-105 text-[#475467] dark:text-slate-400 dark:group-hover:text-slate-300" />
                )}
                <span className="text-[14px] font-medium flex-1">切换主题</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        <div className="mx-2 mt-4 flex items-center justify-between">
          <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
            syncSnapshot.state === 'synced' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400' :
            syncSnapshot.state === 'error' ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400' :
            'bg-[#F2F4F7] text-[#475467] dark:bg-slate-800 dark:text-slate-400'
          }`}>
            {renderSyncIcon()}
            <span>{syncText}</span>
          </div>
          
          {syncSnapshot.state !== 'synced' && (
            <button
              onClick={async () => {
                if (!userLearningStateApi.hasPendingSync()) {
                  toast.info('当前没有待重试的同步内容');
                  return;
                }
                try {
                  setRetrying(true);
                  await userLearningStateApi.retryPending();
                  toast.success('同步已完成');
                } catch (error: any) {
                  toast.error(error?.message || '重试失败');
                } finally {
                  setRetrying(false);
                }
              }}
              disabled={retrying}
              className="inline-flex h-6 items-center justify-center rounded-full bg-[#F2F4F7] hover:bg-[#E4E7EC] dark:bg-slate-800/60 dark:hover:bg-slate-700/60 px-2.5 text-[10px] font-medium text-[#475467] dark:text-slate-400 transition-colors disabled:opacity-50 active:scale-[0.96]"
            >
              <RefreshCw className={`w-3 h-3 mr-1 ${retrying ? 'animate-spin' : ''}`} />
              重试
            </button>
          )}
        </div>

        <div 
          onClick={handleLogout}
          className="mt-3 flex items-center gap-3 px-2.5 py-2.5 rounded-[16px] hover:bg-[#F2F4F7] dark:hover:bg-slate-800/60 transition-all duration-200 ease-in-out active:scale-[0.98] group cursor-pointer border border-transparent"
        >
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white text-[14px] font-bold flex-shrink-0 shadow-sm shadow-orange-500/20">
            {initial}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold text-slate-700 dark:text-slate-200 truncate leading-tight group-hover:text-slate-900 dark:group-hover:text-white transition-colors">{displayName}</p>
            <p className="text-[11px] font-medium text-[#475467] dark:text-slate-500 truncate mt-0.5">{user?.email}</p>
          </div>
          <div
            className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-slate-400 transition-all duration-200 ease-in-out opacity-0 group-hover:opacity-100 group-hover:translate-x-[2px]"
            title="退出登录"
          >
            <LogOut className="w-4 h-4" />
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
