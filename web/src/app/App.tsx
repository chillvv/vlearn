import { RouterProvider } from 'react-router';
import { router } from './routes';
import { AuthProvider, useAuth } from './lib/auth';
import { ThemeProvider } from './components/theme-provider';
import { ConfirmProvider } from './components/business/ConfirmProvider';
import { Toaster } from 'sonner';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { useQuestionsRevalidator } from './lib/useQuestionsRevalidator';

function CacheRevalidator() {
  const { user } = useAuth();
  useQuestionsRevalidator(Boolean(user));
  return null;
}

export default function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          <ConfirmProvider>
            <CacheRevalidator />
            <RouterProvider router={router} />
            <Toaster position="top-right" richColors closeButton />
          </ConfirmProvider>
        </QueryClientProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
