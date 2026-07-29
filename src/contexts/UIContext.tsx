import React, { createContext, useContext, useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, AlertCircle, Info, X, AlertTriangle } from 'lucide-react';
import { cn } from '../lib/utils';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
}

interface UIContextType {
  showToast: (message: string, type?: ToastType) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const UIContext = createContext<UIContextType | undefined>(undefined);

export const UIProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    options: ConfirmOptions;
    resolve: (value: boolean) => void;
  } | null>(null);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({
        isOpen: true,
        options,
        resolve,
      });
    });
  }, []);

  const handleConfirm = (value: boolean) => {
    if (confirmState) {
      confirmState.resolve(value);
      setConfirmState(null);
    }
  };

  return (
    <UIContext.Provider value={{ showToast, confirm }}>
      {children}
      
      {/* Toast Container */}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 20, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 20, scale: 0.95 }}
              className={cn(
                "flex items-center gap-3 rounded-2xl border p-4 shadow-xl backdrop-blur-md min-w-[300px] max-w-md",
                toast.type === 'success' ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-100 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-200" :
                toast.type === 'error' ? "bg-rose-50 dark:bg-rose-950/40 border-rose-100 dark:border-rose-900/50 text-rose-800 dark:text-rose-200" :
                toast.type === 'warning' ? "bg-amber-50 dark:bg-amber-950/40 border-amber-100 dark:border-amber-900/50 text-amber-800 dark:text-amber-200" :
                "bg-blue-50 dark:bg-blue-950/40 border-blue-100 dark:border-blue-900/50 text-blue-800 dark:text-blue-200"
              )}
            >
              {toast.type === 'success' && <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />}
              {toast.type === 'error' && <AlertCircle className="h-5 w-5 text-rose-500 shrink-0" />}
              {toast.type === 'warning' && <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />}
              {toast.type === 'info' && <Info className="h-5 w-5 text-blue-500 shrink-0" />}
              
              <p className="text-sm font-bold flex-1">{toast.message}</p>
              
              <button 
                onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
                className="rounded-lg p-1 hover:bg-black/5 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Confirm Modal */}
      <AnimatePresence>
        {confirmState?.isOpen && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              onClick={() => handleConfirm(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md rounded-3xl bg-surface dark:bg-gray-900 p-8 shadow-2xl border border-line dark:border-gray-800"
            >
              <div className="flex items-center gap-4 mb-6">
                <div className={cn(
                  "flex h-12 w-12 items-center justify-center rounded-2xl",
                  confirmState.options.variant === 'danger' ? "bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400" : "bg-primary/10 dark:bg-primary/20 text-primary"
                )}>
                  {confirmState.options.variant === 'danger' ? <AlertTriangle className="h-6 w-6" /> : <Info className="h-6 w-6" />}
                </div>
                <h3 className="text-xl font-black text-content dark:text-gray-100 tracking-tight">
                  {confirmState.options.title}
                </h3>
              </div>
              
              <p className="text-content-subtle dark:text-gray-400 font-medium leading-relaxed mb-8">
                {confirmState.options.message}
              </p>
              
              <div className="flex gap-3">
                <button
                  onClick={() => handleConfirm(false)}
                  className="flex-1 rounded-2xl border border-line dark:border-gray-700 py-3 text-sm font-bold text-content-muted dark:text-gray-400 hover:bg-surface-muted dark:hover:bg-gray-800 transition-all"
                >
                  {confirmState.options.cancelLabel || 'Cancelar'}
                </button>
                <button
                  onClick={() => handleConfirm(true)}
                  className={cn(
                    "flex-1 rounded-2xl py-3 text-sm font-bold text-white shadow-lg transition-all",
                    confirmState.options.variant === 'danger' 
                      ? "bg-rose-600 shadow-rose-200 hover:bg-rose-700" 
                      : "bg-primary shadow-primary/20 hover:bg-primary/90"
                  )}
                >
                  {confirmState.options.confirmLabel || 'Confirmar'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </UIContext.Provider>
  );
};

export const useUI = () => {
  const context = useContext(UIContext);
  if (context === undefined) {
    throw new Error('useUI must be used within a UIProvider');
  }
  return context;
};
