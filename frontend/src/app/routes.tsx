import { createBrowserRouter, Navigate } from 'react-router';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { DraftReviewPage } from './pages/DraftReviewPage';
import { MistakeBookPage } from './pages/MistakeBookPage';
import { MistakeNodeHubPage } from './pages/MistakeNodeHubPage';
import { KnowledgeDetailPage } from './pages/KnowledgeDetailPage';
import { ReviewModePage } from './pages/ReviewModePage';
import { TargetedDrillPage } from './pages/TargetedDrillPage';
import { SettingsPage } from './pages/SettingsPage';
import { LoginPage } from './pages/LoginPage';
import { TestModePage } from './pages/TestModePage';
import { useAuth } from './lib/auth';

function ProtectedLayout() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg animate-pulse">
            <svg className="w-7 h-7 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </div>
          <p className="text-gray-500 text-sm">加载中...</p>
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Layout />;
}

export const router = createBrowserRouter([
  { path: '/login', Component: LoginPage },
  {
    path: '/',
    Component: ProtectedLayout,
    children: [
      { index: true, Component: Dashboard },
      { path: 'draft-review', Component: DraftReviewPage },
      { path: 'test', Component: TestModePage },
      { path: 'questions', Component: MistakeBookPage },
      { path: 'questions/node', Component: MistakeNodeHubPage },
      { path: 'questions/node/knowledge', Component: KnowledgeDetailPage },
      { path: 'practice', Component: TargetedDrillPage },
      { path: 'review', Component: ReviewModePage },
      { path: 'settings', Component: SettingsPage },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
