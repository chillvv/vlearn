import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';

type ConfirmTone = 'default' | 'danger';

type ConfirmOptions = {
  title: string;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  tone?: ConfirmTone;
};

type ConfirmContextValue = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
};

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const resolverRef = useRef<((value: boolean) => void) | null>(null);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Required<ConfirmOptions>>({
    title: '',
    description: '',
    confirmText: '确认',
    cancelText: '取消',
    tone: 'default',
  });

  const settle = useCallback((value: boolean) => {
    setOpen(false);
    const resolver = resolverRef.current;
    resolverRef.current = null;
    resolver?.(value);
  }, []);

  const confirm = useCallback((nextOptions: ConfirmOptions) => {
    if (resolverRef.current) {
      resolverRef.current(false);
      resolverRef.current = null;
    }
    setOptions({
      title: nextOptions.title,
      description: nextOptions.description ?? '',
      confirmText: nextOptions.confirmText ?? '确认',
      cancelText: nextOptions.cancelText ?? '取消',
      tone: nextOptions.tone ?? 'default',
    });
    setOpen(true);
    return new Promise<boolean>(resolve => {
      resolverRef.current = resolve;
    });
  }, []);

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      <AlertDialog open={open} onOpenChange={nextOpen => !nextOpen && settle(false)}>
        <AlertDialogContent className="w-full max-w-md overflow-hidden rounded-2xl border border-gray-100 p-0 shadow-2xl">
          <AlertDialogHeader className="border-b border-gray-100 px-5 py-4 text-left">
            <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <TriangleAlert className="h-4.5 w-4.5" />
            </div>
            <AlertDialogTitle className="text-base font-bold text-gray-900">{options.title}</AlertDialogTitle>
          </AlertDialogHeader>
          <div className="px-5 py-4">
            <AlertDialogDescription asChild>
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-600">{options.description}</div>
            </AlertDialogDescription>
          </div>
          <AlertDialogFooter className="border-t border-gray-100 px-5 py-4 sm:flex-row sm:justify-end">
            <AlertDialogCancel
              onClick={() => settle(false)}
              className="mt-0 rounded-lg border-gray-200 px-4 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              {options.cancelText}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => settle(true)}
              className={`rounded-lg px-4 text-sm font-semibold text-white ${
                options.tone === 'danger' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-gray-900 hover:bg-gray-800'
              }`}
            >
              {options.confirmText}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error('useConfirm must be used within ConfirmProvider');
  }
  return context.confirm;
}
