// 优先：运行时注入（同一构建包部署到不同环境时使用）
const runtimeApiBase = typeof window !== 'undefined'
  ? (window as any).__APP_CONFIG__?.API_BASE
  : undefined;

// 次优：构建期环境变量（Next/Vite 会在前端用静态替换）
// Support both VITE_ (Vite standard) and NEXT_PUBLIC_ (Next.js standard)
// Use type assertion or optional chaining to avoid TS errors if types are missing
const viteEnv = (import.meta as any).env || {};
const envApiBase = viteEnv.VITE_API_BASE || viteEnv.NEXT_PUBLIC_API_BASE;
const envDataAccessMode = String(viteEnv.VITE_DATA_ACCESS_MODE || viteEnv.NEXT_PUBLIC_DATA_ACCESS_MODE || '').trim();

// 安全默认：走同源 /api，避免固定 localhost 在非本机环境下连接失败
const defaultApiBase = '/api';

function normalizeApiBase(base: string): string {
  const trimmed = String(base || '').trim();
  if (!trimmed) return '/api';
  return trimmed.replace(/\/+$/, '');
}

export const apiBase = normalizeApiBase(
  (
    runtimeApiBase
    || envApiBase
    || defaultApiBase
  ) as string,
);

const requestedDataAccessMode = envDataAccessMode === 'local_api' ? 'local_api' : 'supabase';
export const dataAccessMode = requestedDataAccessMode;

function parseBooleanFlag(value: unknown, fallback = false) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false;
  return fallback;
}

function parseNumberFlag(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const envReviewAiPlannerEnabled = viteEnv.VITE_REVIEW_AI_PLANNER_ENABLED || viteEnv.NEXT_PUBLIC_REVIEW_AI_PLANNER_ENABLED;
const envReviewAiShadowMode = viteEnv.VITE_REVIEW_AI_SHADOW_MODE || viteEnv.NEXT_PUBLIC_REVIEW_AI_SHADOW_MODE;
const envReviewAiFallbackEnabled = viteEnv.VITE_REVIEW_AI_FALLBACK_ENABLED || viteEnv.NEXT_PUBLIC_REVIEW_AI_FALLBACK_ENABLED;
const envReviewAiGrayPercent = viteEnv.VITE_REVIEW_AI_GRAY_PERCENT || viteEnv.NEXT_PUBLIC_REVIEW_AI_GRAY_PERCENT;
const envReviewAiDueMinRatio = viteEnv.VITE_REVIEW_AI_DUE_MIN_RATIO || viteEnv.NEXT_PUBLIC_REVIEW_AI_DUE_MIN_RATIO;

export const reviewAiPlannerEnabled = parseBooleanFlag(envReviewAiPlannerEnabled, false);
export const reviewAiShadowMode = parseBooleanFlag(envReviewAiShadowMode, true);
export const reviewAiFallbackEnabled = parseBooleanFlag(envReviewAiFallbackEnabled, true);
export const reviewAiGrayPercent = parseNumberFlag(envReviewAiGrayPercent, 0, 0, 100);
export const reviewAiDueMinRatio = parseNumberFlag(envReviewAiDueMinRatio, 0.4, 0, 1);

export function assertApiBase() {
  if (!apiBase) {
    throw new Error('API Base URL is not configured. Please check VITE_API_BASE or __APP_CONFIG__.API_BASE');
  }
  if (!apiBase.startsWith('http') && !apiBase.startsWith('/')) {
    console.warn('API Base URL does not start with http(s)://', apiBase);
  }
}
