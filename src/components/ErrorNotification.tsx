import React from 'react';
import { AlertCircle, RefreshCw, Lock, Server } from 'lucide-react';

interface ErrorNotificationProps {
  message: string;
  onRetry: () => void;
}

export default function ErrorNotification({ message, onRetry }: ErrorNotificationProps) {
  let icon = <AlertCircle className="w-5 h-5" />;
  let title = "Đã có lỗi xảy ra";

  if (message.toLowerCase().includes('timeout') || message.toLowerCase().includes('time out')) {
    icon = <Clock className="w-5 h-5" />;
    title = "Thời gian chờ kết nối quá lâu";
  } else if (message.includes('401') || message.includes('403')) {
    icon = <Lock className="w-5 h-5" />;
    title = "Lỗi xác thực (Authentication)";
  } else if (message.includes('500') || message.includes('model')) {
    icon = <Server className="w-5 h-5" />;
    title = "Lỗi từ mô hình AI";
  }

  return (
    <div className="bg-red-500/10 border border-red-500/50 text-red-700 dark:text-red-300 p-4 rounded-xl mt-4 space-y-3">
      <div className="flex items-center gap-2 font-bold text-sm">
        {icon}
        {title}
      </div>
      <p className="text-sm opacity-90">{message}</p>
      <button 
        onClick={onRetry}
        className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-red-700 transition"
      >
        <RefreshCw className="w-3.5 h-3.5" /> Thử lại
      </button>
    </div>
  );
}

// Re-import Clock because it was missing in the icon imports
import { Clock } from 'lucide-react';
