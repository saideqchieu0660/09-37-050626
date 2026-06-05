import React, { useEffect, useState } from "react";
import { AlertCircle, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

interface ApiError {
  message: string;
  path: string;
  stack?: string;
  id: string; // for unique keys
}

export function GlobalErrorToast() {
  const [errors, setErrors] = useState<ApiError[]>([]);

  useEffect(() => {
    const handleGlobalError = (event: Event) => {
      const customEvent = event as CustomEvent;
      const newError: ApiError = {
        ...customEvent.detail,
        id: Math.random().toString(36).substring(7),
      };

      setErrors((prev) => [...prev, newError]);

      // Auto dismiss after 7 seconds
      setTimeout(() => {
        setErrors((prev) => prev.filter((e) => e.id !== newError.id));
      }, 7000);
    };

    window.addEventListener("global-api-error", handleGlobalError);
    return () => window.removeEventListener("global-api-error", handleGlobalError);
  }, []);

  const removeError = (id: string) => {
    setErrors((prev) => prev.filter((e) => e.id !== id));
  };

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 max-w-[320px] md:max-w-sm w-full">
      <AnimatePresence>
        {errors.map((error) => (
          <motion.div
            key={error.id}
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
            className="bg-red-50 dark:bg-red-950/80 border-l-4 border-red-500 p-4 rounded-xl shadow-2xl relative overflow-hidden flex flex-col"
          >
            <button 
              onClick={() => removeError(error.id)}
              className="absolute top-2 right-2 p-1 text-red-500/70 hover:text-red-700 dark:hover:text-red-300 pointer-events-auto rounded-full hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-start gap-3 w-full">
              <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0 pr-6 w-full">
                <h4 className="font-bold text-red-800 dark:text-red-200 text-sm mb-1 truncate">Lỗi Máy Chủ</h4>
                <p className="text-xs text-red-600 dark:text-red-300 font-medium mb-1.5 break-words line-clamp-3">
                  {error.message}
                </p>
                {error.path && (
                  <p className="text-[10px] font-mono text-red-500 dark:text-red-400/80 truncate bg-red-100/50 dark:bg-red-900/30 px-1.5 py-0.5 rounded inline-block max-w-full">
                    {error.path}
                  </p>
                )}
                {/* Expand support code trace in dev mode */}
                {process.env.NODE_ENV === "development" && error.stack && (
                  <details className="mt-2 text-xs">
                    <summary className="text-red-400 cursor-pointer opacity-80 hover:opacity-100">Chi tiết Trace</summary>
                    <pre className="mt-1 p-2 bg-black/10 dark:bg-black/40 rounded overflow-x-auto text-[10px] text-red-700 dark:text-red-400 font-mono leading-tight max-h-32">
                      {error.stack}
                    </pre>
                  </details>
                )}
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
