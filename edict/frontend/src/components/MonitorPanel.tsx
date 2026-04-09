import { useEffect } from 'react';
import { useStore, isEdict, stateLabel } from '../store';
import { api, type OfficialInfo } from '../api';
import { cn } from '../lib/utils';
import { RefreshCcw, Zap, Terminal, Clock, Server, CheckCircle2, AlertCircle, XCircle, HelpCircle } from 'lucide-react';

export default function MonitorPanel() {
  const liveStatus = useStore((s) => s.liveStatus);
  const agentsStatusData = useStore((s) => s.agentsStatusData);
  const officialsData = useStore((s) => s.officialsData);
  const loadAgentsStatus = useStore((s) => s.loadAgentsStatus);
  const setModalTaskId = useStore((s) => s.setModalTaskId);
  const toast = useStore((s) => s.toast);
  const getDepts = useStore((s) => s.getDepts);

  useEffect(() => {
    loadAgentsStatus();
  }, [loadAgentsStatus]);

  const tasks = liveStatus?.tasks || [];
  const activeTasks = tasks.filter((t) => isEdict(t) && t.state !== 'Completed' && t.state !== 'Next');

  // Build official map
  const offMap: Record<string, OfficialInfo> = {};
  if (officialsData?.officials) {
    officialsData.officials.forEach((o) => { offMap[o.id] = o; });
  }

  // Agent wake
  const handleWake = async (agentId: string) => {
    try {
      const r = await api.agentWake(agentId);
      toast(r.message || 'Wake command sent');
      setTimeout(() => loadAgentsStatus(), 30000);
    } catch { toast('Wake failed', 'err'); }
  };

  const handleWakeAll = async () => {
    if (!agentsStatusData) return;
    const toWake = agentsStatusData.agents.filter(
      (a) => a.id !== 'main' && a.status !== 'running' && a.status !== 'unconfigured'
    );
    if (!toWake.length) { toast('All Agents are online'); return; }
    toast(`Waking ${toWake.length} Agents...`);
    for (const a of toWake) {
      try { await api.agentWake(a.id); } catch { /* ignore */ }
    }
    toast(`${toWake.length} wake commands sent, refreshing in 30s`);
    setTimeout(() => loadAgentsStatus(), 30000);
  };

  // Agent Status Panel
  const asData = agentsStatusData;
  const filtered = asData?.agents?.filter((a) => a.id !== 'main') || [];
  const running = filtered.filter((a) => a.status === 'running').length;
  const idle = filtered.filter((a) => a.status === 'idle').length;
  const offline = filtered.filter((a) => a.status === 'offline').length;
  const unconf = filtered.filter((a) => a.status === 'unconfigured').length;
  const gw = asData?.gateway;

  const gwStatusColor = gw?.probe ? 'text-emerald-600 bg-emerald-50 border-emerald-200' : 
                        gw?.alive ? 'text-amber-600 bg-amber-50 border-amber-200' : 
                        'text-red-600 bg-red-50 border-red-200';

  const getStatusIcon = (status: string) => {
    if (status === 'running') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />;
    if (status === 'idle') return <HelpCircle className="w-3.5 h-3.5 text-amber-500" />;
    if (status === 'offline') return <XCircle className="w-3.5 h-3.5 text-red-500" />;
    return <AlertCircle className="w-3.5 h-3.5 text-slate-400" />;
  };

  return (
    <div className="space-y-6">
      {/* Agent Status Panel */}
      {asData && asData.ok && (
         <div className="panel">
           <div className="px-6 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-4">
             <div className="flex items-center gap-4">
               <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                 <Server className="w-5 h-5 text-indigo-500" /> Agent Status
               </h3>
               <div className={cn("px-2.5 py-1 text-xs font-semibold rounded-full border", gwStatusColor)}>
                 Gateway: {gw?.status || 'Unknown'}
               </div>
             </div>
             
             <div className="flex items-center gap-3">
               {(offline + unconf > 0) && (
                 <button onClick={handleWakeAll} className="btn-secondary flex items-center gap-2 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-300">
                   <Zap className="w-4 h-4" /> Wake All Offline
                 </button>
               )}
               <button onClick={() => loadAgentsStatus()} className="btn-secondary flex items-center gap-2">
                 <RefreshCcw className="w-4 h-4" /> Refresh
               </button>
             </div>
           </div>

           <div className="px-6 py-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
             {filtered.map((a) => {
               const canWake = a.status !== 'running' && a.status !== 'unconfigured' && gw?.alive;
               const isRunning = a.status === 'running';

               return (
                 <div key={a.id} className={cn(
                   "relative p-4 rounded-xl border transition-all duration-200 flex flex-col items-center text-center",
                   isRunning ? "bg-white border-emerald-200 shadow-[0_4px_12px_-4px_rgba(16,185,129,0.1)] hover:border-emerald-300" :
                   "bg-slate-50 border-slate-200 pb-12 hover:shadow-subtle"
                 )}>
                   <div className="absolute top-3 right-3 flex justify-end">
                     {getStatusIcon(a.status)}
                   </div>
                   
                   <div className="text-3xl mb-2">{a.emoji}</div>
                   <div className="text-sm font-bold text-slate-900 mb-0.5">{a.label}</div>
                   <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1">{a.role}</div>
                   
                   <div className={cn(
                     "text-xs font-semibold px-2 py-0.5 rounded-full mb-3",
                     isRunning ? "bg-emerald-50 text-emerald-700" : "bg-slate-200 text-slate-600"
                   )}>
                     {a.statusLabel}
                   </div>
                   
                   <div className="text-[10px] text-slate-500 mt-auto flex items-center gap-1">
                     <Clock className="w-3 h-3" />
                     {a.lastActive ? a.lastActive : 'No Activity'}
                   </div>

                   {canWake && (
                     <div className="absolute bottom-3 left-0 right-0 flex justify-center">
                       <button 
                         className="px-3 py-1 bg-white border border-primary-200 text-primary-600 text-xs font-medium rounded shadow-sm hover:bg-primary-50 transition-colors"
                         onClick={(e) => { e.stopPropagation(); handleWake(a.id); }}
                       >
                         ⚡ Wake Up
                       </button>
                     </div>
                   )}
                 </div>
               );
             })}
           </div>

           <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex flex-wrap items-center gap-4 text-xs font-medium text-slate-600">
             <span className="flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-emerald-500"/> {running} Running</span>
             <span className="flex items-center gap-1.5"><HelpCircle className="w-4 h-4 text-amber-500"/> {idle} Idle</span>
             {offline > 0 && <span className="flex items-center gap-1.5"><XCircle className="w-4 h-4 text-red-500"/> {offline} Offline</span>}
             {unconf > 0 && <span className="flex items-center gap-1.5"><AlertCircle className="w-4 h-4 text-slate-400"/> {unconf} Unconfigured</span>}
             
             <span className="ml-auto text-slate-400 tracking-wide">
               Last checked: {(asData.checkedAt || '').substring(11, 19)}
             </span>
           </div>
         </div>
      )}

      {/* Duty Grid */}
      <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mt-8 mb-4">
        <Terminal className="w-5 h-5 text-indigo-500" /> Active Orgs & Duties
      </h3>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {getDepts().map((d: any) => {
          const myTasks = activeTasks.filter((t) => t.org === d.label);
          const isActive = myTasks.some((t) => t.state === 'Doing');
          const isBlocked = myTasks.some((t) => t.state === 'Blocked');
          const off = offMap[d.id];
          const hb = off?.heartbeat || { status: 'idle', label: '⚪' };
          
          const dotColor = isBlocked ? 'bg-red-500' : isActive ? 'bg-primary-500' : hb.status === 'active' ? 'bg-emerald-500' : 'bg-slate-300';
          const statusText = isBlocked ? '⚠️ Blocked' : isActive ? '⚙️ Executing' : hb.status === 'active' ? '🟢 Active' : '⚪ Standby';
          
          return (
            <div key={d.id} className={cn(
              "panel flex flex-col",
              isBlocked ? "border-red-200" : isActive ? "border-primary-200 shadow-[0_4px_12px_-4px_rgba(59,130,246,0.15)]" : ""
            )}>
              <div className="p-4 border-b border-slate-100 flex items-start gap-4">
                <div className="text-4xl">{d.emoji}</div>
                <div className="flex-1">
                  <h4 className="font-bold text-slate-900 leading-tight">{d.label}</h4>
                  <p className="text-xs font-semibold text-primary-600 tracking-wide mt-0.5">{d.role} · {d.rank}</p>
                </div>
                <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 whitespace-nowrap">
                  <span className={cn("w-2 h-2 rounded-full", dotColor, isActive && "animate-pulse")} />
                  {statusText}
                </div>
              </div>
              
              <div className="flex-1 p-4 bg-slate-50 flex flex-col gap-3 min-h-[120px]">
                {myTasks.length > 0 ? (
                  myTasks.map((t) => (
                    <div 
                      key={t.id} 
                      onClick={() => setModalTaskId(t.id)}
                      className="bg-white border border-slate-200 rounded-lg p-3 hover:border-primary-300 hover:shadow-subtle cursor-pointer transition-all"
                    >
                      <div className="flex justify-between items-start mb-1">
                         <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-1 py-0.5 rounded">{t.id}</span>
                         <span className={cn(
                           "text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-full border",
                           t.state === 'Blocked' ? "bg-red-50 text-red-600 border-red-200" : 
                           t.state === 'Doing' ? "bg-primary-50 text-primary-700 border-primary-200" : "bg-slate-100 text-slate-600 border-slate-200"
                         )}>
                           {stateLabel(t)}
                         </span>
                      </div>
                      <h5 className="text-sm font-semibold text-slate-800 line-clamp-1 mb-1">{t.title || '(No Title)'}</h5>
                      
                      {t.now && t.now !== '-' && (
                        <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">{t.now}</p>
                      )}
                      
                      {t.block && t.block !== '无' && t.block !== 'None' && (
                        <div className="mt-2 text-[11px] font-medium text-red-600 bg-red-50 border border-red-100 px-2 py-1 rounded inline-flex items-center gap-1">
                          🚫 {t.block}
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2 opacity-60">
                    <span className="text-3xl grayscale">🪭</span>
                    <span className="text-sm font-medium tracking-widest uppercase">Idle</span>
                  </div>
                )}
              </div>
              
              <div className="p-3 border-t border-slate-100 bg-white flex items-center justify-between text-[11px] font-medium text-slate-500">
                <span className="flex items-center gap-1.5">🤖 {off?.model_short || 'Not Configured'}</span>
                {off?.last_active && <span className="flex items-center gap-1.5"><Clock className="w-3 h-3" /> {off.last_active}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
