import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import {
  LayoutDashboard, BookOpen, RotateCcw, Settings,
  Sparkles, LogOut, Moon, Sun, RefreshCw, Cloud, CloudOff, CloudUpload,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { authApi, userLearningStateApi } from '../lib/api';
import { getLearningSyncSnapshot, subscribeLearningSyncSnapshot, type LearningSyncSnapshot } from '../lib/learningSyncStatus';
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
    if (syncSnapshot.state === 'syncing') return <CloudUpload className="w-3.5 h-3.5 text-indigo-500 animate-pulse" />;
    if (syncSnapshot.state === 'synced') return <Cloud className="w-3.5 h-3.5 text-emerald-500" />;
    if (syncSnapshot.state === 'error') return <CloudOff className="w-3.5 h-3.5 text-rose-500" />;
    return <Cloud className="w-3.5 h-3.5 text-muted-foreground" />;
  };

  const syncText = syncSnapshot.state === 'syncing'
    ? '同步中'
    : syncSnapshot.state === 'synced'
      ? '已同步'
      : syncSnapshot.state === 'error'
        ? '同步失败'
        : '未同步';

  return (
    <Sidebar className="border-r border-border">
      <SidebarHeader className="px-5 py-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center shadow-md flex-shrink-0">
            <Sparkles className="w-4.5 h-4.5 text-primary-foreground" strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-foreground text-[15px] leading-tight">错题助手</div>
            <div className="text-[11px] text-primary/80 font-medium tracking-wide mt-0.5">AI Powered</div>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-3">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest px-3 mb-2 mt-1">主菜单</p>
        <SidebarMenu>
          {NAV_ITEMS.map(({ path, label, icon: Icon }) => {
            const isActive = path === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(path);
            
            return (
              <SidebarMenuItem key={path}>
                <SidebarMenuButton asChild isActive={isActive} tooltip={label} className="h-10 rounded-xl px-3 group">
                  <Link to={path} className="flex items-center w-full">
                    <Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}`} />
                    <span className={`text-sm font-medium ml-3 flex-1 ${isActive ? 'text-primary' : ''}`}>
                      {label}
                    </span>
                    {isActive && (
                      <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                    )}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter className="px-3 pb-4 pt-3 border-t border-border space-y-1">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={location.pathname === '/settings'} className="h-10 rounded-xl px-3 group">
              <Link to="/settings" className="flex items-center w-full">
                <Settings className={`w-5 h-5 flex-shrink-0 ${location.pathname === '/settings' ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}`} />
                <span className="text-sm font-medium ml-3 flex-1">设置</span>
                {location.pathname === '/settings' && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton 
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} 
              className="h-10 rounded-xl px-3 group cursor-pointer"
            >
              <div className="flex items-center w-full">
                {theme === 'dark' ? (
                  <Sun className="w-5 h-5 flex-shrink-0 text-muted-foreground group-hover:text-foreground" />
                ) : (
                  <Moon className="w-5 h-5 flex-shrink-0 text-muted-foreground group-hover:text-foreground" />
                )}
                <span className="text-sm font-medium ml-3 flex-1">切换主题</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="mx-1 mt-1 rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              {renderSyncIcon()}
              <span>{syncText}</span>
            </div>
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
              className="inline-flex h-6 items-center gap-1 rounded-md border border-border/70 px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-background disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${retrying ? 'animate-spin' : ''}`} />
              重试
            </button>
          </div>
        </div>

        <div className="mt-2 flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-muted/50 group cursor-default">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-bold flex-shrink-0 shadow-sm">
            {initial}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-foreground truncate leading-tight">{displayName}</p>
            <p className="text-[11px] text-muted-foreground truncate leading-tight mt-0.5">{user?.email}</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
            title="退出登录"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
