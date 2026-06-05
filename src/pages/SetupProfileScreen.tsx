import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { User, Key, Loader2, AlertCircle, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { dbService } from '../lib/firebase';
import { store } from '../lib/store';
import { auth } from '../lib/firebase';

export default function SetupProfileScreen() {
  React.useEffect(() => {
    document.title = "Henosis Web";
  }, []);

  const [username, setUsername] = useState('');
  const [adminKey, setAdminKey] = useState('');
  const [showAdminKey, setShowAdminKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      setError("Vui lòng nhập tên hiển thị.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Không tìm thấy người dùng.");

      const correctAdminKey = import.meta.env.VITE_ADMIN_KEY || "seneca";
      const isTeacher = adminKey === correctAdminKey;
      const role = isTeacher ? "teacher" : "student";

      await dbService.updateUserProfile(user.uid, {
        name: username.trim(),
        role: role,
        email: user.email || ""
      });

      const profile = await dbService.getUserProfile(user.uid);
      const currentUser = store.getCurrentUser();
      if (currentUser) {
          currentUser.role = role as any;
          currentUser.name = username.trim();
      }

      navigate(role === 'teacher' ? '/teacher' : '/dashboard');
    } catch (err: any) {
      setError(err.message || "Đã xảy ra lỗi khi thiết lập hồ sơ.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md glass p-8 rounded-[12px] shadow-2xl border border-amber-600/30">
        <h2 className="text-2xl font-bold text-center mb-6 text-stone-800 dark:text-stone-100">Thiết lập hồ sơ</h2>
        {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
        <form onSubmit={handleSetup} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase tracking-widest pl-1">Tên hiển thị</label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-3 bg-white/50 dark:bg-black/30 border border-amber-500/30 rounded-lg text-stone-900 dark:text-stone-100"
              placeholder="Tên của bạn"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase tracking-widest pl-1">Admin Key (Nếu là Giáo viên)</label>
            <div className="relative">
                <input
                    type={showAdminKey ? "text" : "password"}
                    value={adminKey}
                    onChange={(e) => setAdminKey(e.target.value)}
                    className="w-full px-4 py-3 bg-white/50 dark:bg-black/30 border border-amber-500/30 rounded-lg pr-10 text-stone-900 dark:text-stone-100"
                    placeholder="Mã phân quyền"
                />
                <button
                    type="button"
                    onClick={() => setShowAdminKey(!showAdminKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 opacity-50"
                 >
                    {showAdminKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
            </div>
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-gradient-to-r from-amber-500 to-yellow-600 text-white font-bold py-3 rounded-lg flex items-center justify-center gap-2"
          >
            {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Hoàn tất <ArrowRight className="w-5 h-5" /></>}
          </button>
        </form>
      </div>
    </div>
  );
}
