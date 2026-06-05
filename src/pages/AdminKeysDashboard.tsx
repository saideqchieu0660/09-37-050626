import React, { useState, useEffect, useRef } from "react";
import { Key, AlertCircle, CheckCircle, Clock, RefreshCw } from "lucide-react";
import * as d3 from 'd3';

interface KeyState {
  index: number;
  maskedKey: string;
  status: "active" | "rate_limited" | "failed";
  usageCount: number;
  errorCount: number;
  lastUsed: string | null;
}

function D3Sparkline({ data, color }: { data: number[], color: string }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || data.length === 0) return;

    const width = 80;
    const height = 24;
    const margin = { top: 2, right: 4, bottom: 2, left: 2 };

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const x = d3.scaleLinear()
      .domain([0, data.length - 1])
      .range([margin.left, width - margin.right]);

    const yMax = Math.max(d3.max(data) || 0, 1) + 1; // At least 2 to give some headroom
    const y = d3.scaleLinear()
      .domain([0, yMax])
      .range([height - margin.bottom, margin.top]);

    const line = d3.line<number>()
      .x((_, i) => x(i))
      .y(d => y(d))
      .curve(d3.curveMonotoneX);

    svg.append("path")
      .datum(data)
      .attr("fill", "none")
      .attr("stroke", color)
      .attr("stroke-width", 1.5)
      .attr("stroke-linecap", "round")
      .attr("d", line);
      
    // Add dot at the end
    svg.append("circle")
       .attr("cx", x(data.length - 1))
       .attr("cy", y(data[data.length - 1]))
       .attr("r", 2.5)
       .attr("fill", color);
  }, [data, color]);

  return (
    <div className="flex flex-col items-end">
       <svg ref={svgRef} width={80} height={24} className="overflow-visible" />
    </div>
  );
}

interface RotationLog {
  id: string;
  timestamp: string;
  fromKeyIndex?: number;
  toKeyIndex: number;
  reason: string;
}

function ServiceMonitor({ adminKey }: { adminKey: string }) {
  const [keys, setKeys] = useState<KeyState[]>([]);
  const [totalKeys, setTotalKeys] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [error, setError] = useState("");
  const [isPolling, setIsPolling] = useState(true);
  const [logs, setLogs] = useState<RotationLog[]>([]);
  const [activeTab, setActiveTab] = useState<'monitor' | 'logs'>('monitor');
  
  const [usageHistory, setUsageHistory] = useState<Record<number, number[]>>({});
  const prevKeysRef = useRef<KeyState[]>([]);

  const fetchKeysStatus = async () => {
    try {
      const res = await fetch("/api/admin/keys-status", {
        headers: {
          "x-admin-key": adminKey
        }
      });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch keys status");
      }
      
      setUsageHistory(prevHistory => {
        const newHistory = { ...prevHistory };
        data.keys.forEach((k: KeyState) => {
          const prevKey = prevKeysRef.current.find(pk => pk.index === k.index);
          const currentUsage = k.usageCount;
          let delta = 0;
          if (prevKey) {
            delta = Math.max(0, currentUsage - prevKey.usageCount);
          }
          
          if (!newHistory[k.index]) {
             newHistory[k.index] = Array(20).fill(0);
          }
          newHistory[k.index] = [...newHistory[k.index].slice(1), delta];
        });
        return newHistory;
      });

      prevKeysRef.current = data.keys;

      setKeys(data.keys);
      setTotalKeys(data.totalKeys);
      setCurrentIndex(data.currentIndex);
      setLogs(data.logs || []);
      setError("");
    } catch (err: any) {
      setError(err.message);
    }
  };

  useEffect(() => {
    fetchKeysStatus();
    
    let interval: NodeJS.Timeout;
    if (isPolling) {
      interval = setInterval(fetchKeysStatus, 5000); // Polling every 5 seconds
    }
    
    return () => clearInterval(interval);
  }, [adminKey, isPolling]);

  const activeCount = keys.filter(k => k.status === 'active').length;
  const limitedCount = keys.filter(k => k.status === 'rate_limited').length;
  const failedCount = keys.filter(k => k.status === 'failed').length;
  const statusScore = keys.length === 0 ? 100 : ((activeCount * 1 + limitedCount * 0.5 + failedCount * 0) / keys.length) * 100;
  const healthScore = Math.round(statusScore);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card-3d p-6 rounded-xl border border-stone-200 dark:border-zinc-800 flex flex-col items-center justify-center text-center">
          <div className="text-sm font-bold opacity-60 uppercase mb-2">System Health Score</div>
          <div className="text-5xl font-display font-bold mb-2">
            <span className={healthScore >= 80 ? 'text-green-500' : healthScore >= 50 ? 'text-amber-500' : 'text-red-500'}>
               {healthScore}%
            </span>
          </div>
          <div className="w-full bg-stone-200 dark:bg-zinc-800 rounded-full h-2 mt-4 overflow-hidden flex">
            {keys.length > 0 && (
              <>
                <div className="h-full bg-green-500 transition-all duration-500" style={{ width: `${(activeCount / keys.length) * 100}%` }}></div>
                <div className="h-full bg-amber-500 transition-all duration-500" style={{ width: `${(limitedCount / keys.length) * 100}%` }}></div>
                <div className="h-full bg-red-500 transition-all duration-500" style={{ width: `${(failedCount / keys.length) * 100}%` }}></div>
              </>
            )}
          </div>
          <div className="flex gap-4 justify-center mt-3 text-xs w-full text-stone-500 dark:text-stone-400">
             <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-green-500"></div> {activeCount} Active</div>
             <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-amber-500"></div> {limitedCount} Lim</div>
             <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-red-500"></div> {failedCount} Fail</div>
          </div>
        </div>

        <div className="lg:col-span-2 flex flex-col justify-center bg-stone-50 dark:bg-zinc-900 p-6 rounded-xl border border-stone-200 dark:border-zinc-800">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold flex items-center gap-2">
                <RefreshCw className={`w-5 h-5 text-blue-500 ${isPolling ? 'animate-spin' : ''}`} />
                Real-time Health Monitor
              </h2>
              <p className="text-stone-500 dark:text-stone-400 text-sm mt-1">
                Monitoring {totalKeys} API keys. Round-Robin Queue is currently pointing to index: <span className="font-mono bg-stone-200 dark:bg-zinc-800 px-2 py-0.5 rounded">{currentIndex}</span>
              </p>
            </div>
            
            <div className="flex flex-wrap items-center gap-3">
              {error && <span className="text-red-500 text-sm w-full text-right block">{error}</span>}
              <button 
                onClick={() => setIsPolling(!isPolling)}
                className={`btn-3d px-4 py-2 rounded-lg text-sm font-bold ${isPolling ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-green-500 hover:bg-green-600 text-white'}`}
              >
                {isPolling ? 'Stop Polling' : 'Start Polling'}
              </button>
              <button 
                onClick={fetchKeysStatus}
                className="btn-3d px-4 py-2 bg-stone-200 dark:bg-zinc-800 rounded-lg hover:bg-stone-300 dark:hover:bg-zinc-700 text-sm font-bold"
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="flex bg-stone-200/50 dark:bg-zinc-800/50 p-1 rounded-lg mt-6 w-max self-end sm:self-auto">
            <button
              onClick={() => setActiveTab('monitor')}
              className={`px-6 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'monitor' ? 'bg-white dark:bg-zinc-700 shadow-sm text-stone-900 dark:text-stone-100' : 'text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200'}`}
            >
              Monitor Grid
            </button>
            <button
              onClick={() => setActiveTab('logs')}
              className={`px-6 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'logs' ? 'bg-white dark:bg-zinc-700 shadow-sm text-stone-900 dark:text-stone-100' : 'text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200'}`}
            >
              Rotation Logs
            </button>
          </div>
        </div>
      </div>

      {activeTab === 'monitor' ? (
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
                <div className="flex items-center gap-3">
                   <D3Sparkline 
                      data={usageHistory[k.index] || Array(20).fill(0)} 
                      color={k.status === 'rate_limited' ? '#f59e0b' : k.status === 'failed' ? '#ef4444' : '#3b82f6'} 
                   />
                   {k.status === "active" && <span className="flex items-center gap-1 text-xs font-bold text-green-500 bg-green-100 dark:bg-green-900/30 px-2 py-1 rounded-full"><CheckCircle className="w-3.5 h-3.5" /> ACTIVE</span>}
                   {k.status === "rate_limited" && <span className="flex items-center gap-1 text-xs font-bold text-amber-500 bg-amber-100 dark:bg-amber-900/30 px-2 py-1 rounded-full"><Clock className="w-3.5 h-3.5" /> RATE LIMITED</span>}
                   {k.status === "failed" && <span className="flex items-center gap-1 text-xs font-bold text-red-500 bg-red-100 dark:bg-red-900/30 px-2 py-1 rounded-full"><AlertCircle className="w-3.5 h-3.5" /> FAILED</span>}
                </div>
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
              
              <div className="mt-1">
                 <div className="flex justify-between text-xs mb-1.5">
                   <span className="text-stone-500 dark:text-stone-400">Est. Daily Quota</span>
                   <span className="font-medium">{Math.min(Math.round((k.usageCount / 1500) * 100), 100)}%</span>
                 </div>
                 <div className="w-full bg-stone-200 dark:bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                   <div 
                     className={`h-full rounded-full transition-all duration-500 ${
                       k.status === 'rate_limited' || (k.usageCount / 1500) >= 0.9 
                         ? 'bg-amber-500' 
                         : k.status === 'failed' 
                           ? 'bg-red-500' 
                           : 'bg-blue-500'
                     }`} 
                     style={{ width: `${Math.min((k.usageCount / 1500) * 100, 100)}%` }}
                   ></div>
                 </div>
              </div>

              <div className="text-xs text-stone-400 dark:text-stone-500 mt-1">
                Last Used: {k.lastUsed ? new Date(k.lastUsed).toLocaleTimeString() : 'Never'}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card-3d rounded-xl border border-stone-200 dark:border-zinc-800 overflow-hidden">
          <div className="p-4 bg-stone-50 border-b border-stone-200 dark:bg-zinc-900/50 dark:border-zinc-800 font-bold">
            Recent API Rotation Events
          </div>
          {logs.length === 0 ? (
            <div className="p-8 text-center text-stone-500 dark:text-stone-400">
              No rotation events logged yet.
            </div>
          ) : (
            <div className="divide-y divide-stone-200 dark:divide-zinc-800">
              {logs.map((log) => (
                <div key={log.id} className="p-4 flex flex-col md:flex-row md:items-center gap-4 hover:bg-stone-50 dark:hover:bg-zinc-900/30 transition-colors">
                  <div className="text-sm font-mono text-stone-500 shrink-0 w-32">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                     {log.fromKeyIndex !== undefined && (
                        <>
                          <span className="font-mono bg-stone-100 dark:bg-zinc-800 px-2 py-0.5 rounded text-xs">
                            Key #{log.fromKeyIndex}
                          </span>
                          <span className="text-stone-400">→</span>
                        </>
                     )}
                    <span className="font-mono bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 px-2 py-0.5 rounded text-xs font-bold">
                      Key #{log.toKeyIndex}
                    </span>
                  </div>
                  <div className="text-sm">
                    {log.reason}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminKeysDashboard() {
  const [adminKey, setAdminKey] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/keys-status", {
        headers: {
          "x-admin-key": adminKey
        }
      });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || "Failed to authenticate");
      setIsAuthenticated(true);
    } catch (err: any) {
      setError(err.message);
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
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
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-display font-bold flex items-center gap-3">
          <Key className="w-8 h-8 text-amber-500" />
          API Keys Rotation Status
        </h1>
      </div>

      <ServiceMonitor adminKey={adminKey} />
    </div>
  );
}
