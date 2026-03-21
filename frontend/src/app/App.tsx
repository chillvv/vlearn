import { RouterProvider } from 'react-router';
import { router } from './routes';
import { AuthProvider } from './lib/auth';
import { ThemeProvider } from './components/theme-provider';
import { Toaster } from 'sonner';

export default function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
      <AuthProvider>
        <RouterProvider router={router} />
        <Toaster position="top-right" richColors closeButton />
      </AuthProvider>
    </ThemeProvider>
  );
}
