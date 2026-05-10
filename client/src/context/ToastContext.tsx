import React, { createContext, useContext, useMemo, useRef, useState } from "react";
import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";

type ToastTone = "success" | "error" | "info";

type Toast = {
  id: number;
  title: string;
  description?: string;
  tone: ToastTone;
};

type ShowToastOptions = {
  title: string;
  description?: string;
  tone?: ToastTone;
  durationMs?: number;
};

type ToastContextValue = {
  showToast: (options: ShowToastOptions) => void;
};

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const toastIcons = {
  success: CheckCircle2,
  error: TriangleAlert,
  info: Info,
} satisfies Record<ToastTone, React.ComponentType<{ size?: number; className?: string }>>;

export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextIdRef = useRef(1);

  const dismissToast = (id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  };

  const showToast = ({ title, description, tone = "info", durationMs = 4500 }: ShowToastOptions) => {
    const id = nextIdRef.current++;
    setToasts((current) => [...current, { id, title, description, tone }]);
    window.setTimeout(() => dismissToast(id), durationMs);
  };

  const value = useMemo(() => ({ showToast }), []);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" aria-live="polite" aria-atomic="true">
        {toasts.map((toast) => {
          const Icon = toastIcons[toast.tone];
          return (
            <div key={toast.id} className={`toast-card ${toast.tone}`}>
              <div className="toast-card-icon">
                <Icon size={18} />
              </div>
              <div className="toast-card-body">
                <strong>{toast.title}</strong>
                {toast.description && <p>{toast.description}</p>}
              </div>
              <button
                className="toast-card-dismiss"
                onClick={() => dismissToast(toast.id)}
                aria-label="Dismiss notification"
              >
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }

  return context;
};
