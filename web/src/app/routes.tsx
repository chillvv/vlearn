import { createBrowserRouter, Navigate } from 'react-router';
import { lazy, Suspense } from 'react';
import { Layout } from './components/Layout';
import { useAuth } from './lib/auth';

const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const DraftReviewPage = lazy(() => import('./pages/DraftReviewPage').then(m => ({ default: m.DraftReviewPage })));
const MistakeBookPage = lazy(() => import('./pages/MistakeBookPage').then(m => ({ default: m.MistakeBookPage })));
const MistakeNodeHubPage = lazy(() => import('./pages/MistakeNodeHubPage').then(m => ({ default: m.MistakeNodeHubPage })));
const ReviewModePage = lazy(() => import('./pages/ReviewModePage').then(m => ({ default: m.ReviewModePage })));
const ReviewStatsPage = lazy(() => import('./pages/ReviewStatsPage').then(m => ({ default: m.ReviewStatsPage })));
const TargetedDrillPage = lazy(() => import('./pages/TargetedDrillPage').then(m => ({ default: m.TargetedDrillPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const LoginPage = lazy(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })));
const TestModePage = lazy(() => import('./pages/TestModePage').then(m => ({ default: m.TestModePage })));



function GlobalSkeleton() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-gray-50">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center shadow-lg animate-pulse">
          <svg className="w-7 h-7 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className="h-2 w-24 bg-gray-200 rounded-full animate-pulse"></div>
          <div className="h-2 w-16 bg-gray-200 rounded-full animate-pulse delay-75"></div>
        </div>
      </div>
    </div>
  );
}

function ProtectedLayout() {
  const { user, loading } = useAuth();
  if (loading) {
    return <GlobalSkeleton />;
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Layout />;
}

function withSuspense(Component: React.ComponentType) {
  return (
    <Suspense fallback={<GlobalSkeleton />}>
      <Component />
    </Suspense>
  );
}

export const router = createBrowserRouter([
  { path: '/login', element: withSuspense(LoginPage) },
  {
    path: '/',
    Component: ProtectedLayout,
    children: [
      { index: true, element: withSuspense(Dashboard) },
      { path: 'draft-review', element: withSuspense(DraftReviewPage) },
      { path: 'test', element: withSuspense(TestModePage) },
      { path: 'questions', element: withSuspense(MistakeBookPage) },
      { path: 'questions/node', element: withSuspense(MistakeNodeHubPage) },
      { path: 'practice', element: withSuspense(TargetedDrillPage) },
      { path: 'review', element: withSuspense(ReviewModePage) },
      { path: 'review/stats', element: withSuspense(ReviewStatsPage) },

      { path: 'settings', element: withSuspense(SettingsPage) },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
