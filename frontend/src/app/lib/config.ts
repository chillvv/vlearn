import { projectId } from '../../../utils/supabase/info';

// 优先：运行时注入（同一构建包部署到不同环境时使用）
const runtimeApiBase = typeof window !== 'undefined'
  ? (window as any).__APP_CONFIG__?.API_BASE
  : undefined;
const runtimeFunctionName = typeof window !== 'undefined'
  ? (window as any).__APP_CONFIG__?.SUPABASE_FUNCTION_NAME
  : undefined;

// 次优：构建期环境变量（Next/Vite 会在前端用静态替换）
// Support both VITE_ (Vite standard) and NEXT_PUBLIC_ (Next.js standard)
// Use type assertion or optional chaining to avoid TS errors if types are missing
const viteEnv = (import.meta as any).env || {};
const envApiBase = viteEnv.VITE_API_BASE || viteEnv.NEXT_PUBLIC_API_BASE;
const envFunctionName = viteEnv.VITE_SUPABASE_FUNCTION_NAME || viteEnv.NEXT_PUBLIC_SUPABASE_FUNCTION_NAME;

// 安全默认：从 projectId + 函数名组合
const defaultFunctionName = 'make-server-794e3fa7'; // Keep the existing function name for now as default
const defaultApiBase = 'http://localhost:8080/api'; // Point to local Java Backend

export const apiBase = (
  runtimeApiBase
  || envApiBase
  || defaultApiBase
) as string;

export function assertApiBase() {
  if (!apiBase) {
    throw new Error('API Base URL is not configured. Please check VITE_API_BASE or __APP_CONFIG__.API_BASE');
  }
  if (!apiBase.startsWith('http')) {
    console.warn('API Base URL does not start with http(s)://', apiBase);
  }
}
