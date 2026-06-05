import React, { useState, useEffect } from "react";
import { Key, AlertCircle, CheckCircle, Clock } from "lucide-react";

interface KeyState {
  index: number;
  maskedKey: string;
  status: "active" | "rate_limited" | "failed";
  usageCount: number;
  errorCount: number;
  lastUsed: string | null;
}

export default function AdminKeysDashboard() {
  const [adminKey, setAdminKey] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [keys, setKeys] = useState<KeyState[]>([]);
  const [totalKeys, setTotalKeys] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Auto-fill from env for easy local testing, but still require button click
  // In a real app, you wouldn't expose VITE_ADMIN_KEY, but it's required here by prompt constraints.
  useEffect(() => {
    if (import.meta.env.VITE_ADMIN_KEY) {
      setAdminKey(import.meta.env.VITE_ADMIN_KEY);
    }
  }, []);

  const fetchKeysStatus = async (keyToUse: string) => {
    setIsLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/keys-status", {
        headers: {
          "x-admin-key": keyToUse
        }
      });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || "Failed to authenticate");
      }
      
      setKeys(data.keys);
      setTotalKeys(data.totalKeys);
      setCurrentIndex(data.currentIndex);
      setIsAuthenticated(true);
    } catch (err: any) {
      setError(err.message);
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    fetchKeysStatus(adminKey);
  };

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-4">
        <div className="card-3d p-8 rounded-2xl w-full max-w-md mx-auto">
          <div className="flex flex-col items-center mb-6">
            <div className="p-3 bg-stone-100 dark:bg-zinc-800 rounded-full mb-4">
              <Key className="w-8 h-8 text-amber-500" />
            </div>
            <h1 className="text-2xl font-display font-bold">Admin Portal</h1>
            <p className="text-stone-500 dark:text-stone-400 text-sm mt-1">Requires VITE_ADMIN_KEY</p>
          </div>
          
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <input
                type="password"
                placeholder="Enter Admin Key"
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                className="input-3d w-full p-3 text-center"
              />
            </div>
            {error && (
              <p className="text-red-500 text-sm text-center font-medium">{error}</p>
            )}
            <button 
              type="submit" 
              disabled={isLoading || !adminKey}
              className="btn-3d-primary w-full py-3 disabled:opacity-50"
            >
              {isLoading ? "Verifying..." : "Access Dashboard"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl mx-auto p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold flex items-center gap-3">
            <Key className="w-8 h-8 text-amber-500" />
            API Keys Rotation Status
          </h1>
          <p className="text-stone-500 dark:text-stone-400 mt-2">
            Monitoring {totalKeys} API keys. Round-Robin Queue is currently pointing to index: <span className="font-mono bg-stone-200 dark:bg-zinc-800 px-2 py-0.5 rounded">{currentIndex}</span>
          </p>
        </div>
        <button 
          onClick={() => fetchKeysStatus(adminKey)}
          className="btn-3d px-4 py-2 bg-stone-200 dark:bg-zinc-800 rounded-lg hover:bg-stone-300 dark:hover:bg-zinc-700"
        >
          Refresh Status
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {keys.map((k) => (
          <div 
            key={k.index} 
            className={`card-3d p-5 rounded-xl border flex flex-col gap-4 ${
              k.index === currentIndex ? 'ring-2 ring-blue-500 border-blue-500' : ''
            }`}
          >
            <div className="flex justify-between items-start">
              <span className="text-sm font-bold bg-stone-200 dark:bg-zinc-800 px-2.5 py-1 rounded-md">
                Key #{k.index}
              </span>
              {k.status === "active" && <CheckCircle className="w-5 h-5 text-green-500" />}
              {k.status === "rate_limited" && <Clock className="w-5 h-5 text-amber-500" />}
              {k.status === "failed" && <AlertCircle className="w-5 h-5 text-red-500" />}
            </div>
            
            <div>
              <div className="text-xs text-stone-500 dark:text-stone-400 mb-1 uppercase tracking-wider">Masked Key</div>
              <div className="font-mono text-sm">{k.maskedKey}</div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm mt-auto border-t border-stone-200 dark:border-zinc-800 pt-3">
              <div>
                <div className="text-stone-500 text-xs">Usage Count</div>
                <div className="font-medium text-lg">{k.usageCount}</div>
              </div>
              <div>
                <div className="text-stone-500 text-xs">Error Count</div>
                <div className="font-medium text-red-500 text-lg">{k.errorCount}</div>
              </div>
            </div>
            
            <div className="text-xs text-stone-400 dark:text-stone-500 mt-2">
              Last Used: {k.lastUsed ? new Date(k.lastUsed).toLocaleTimeString() : 'Never'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
