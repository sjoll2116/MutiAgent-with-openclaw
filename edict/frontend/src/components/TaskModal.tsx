import { useEffect, useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  X, 
  Terminal, 
  Activity, 
  CheckCircle2, 
  Clock, 
  AlertTriangle, 
  ChevronRight, 
  Play, 
  Pause, 
  XCircle, 
  RefreshCcw, 
  ArrowUpCircle, 
  RotateCcw,
  Search,
  MessageSquare,
  Cpu,
  Zap,
  ShieldCheck,
  FastForward,
  MoreVertical,
  ClipboardList,
  FileText
} from 'lucide-react';
import { useStore, getPipeStatus, deptColor, stateLabel } from '../store';
import { api } from '../api';
import type { Task, TaskActivityData, SchedulerStateData, TodoItem, ActivityEntry } from '../api';
import { cn } from '../lib/utils';

// --- Sub-Components ---

function StatusBadge({ state }: { state: string }) {
  const variants: Record<string, string> = {
    Completed: "bg-neon-cyan/20 text-neon-cyan border-neon-cyan/30",
    Blocked: "bg-neon-glitch/20 text-neon-glitch border-neon-glitch/30",
    Executing: "bg-neon-violet/20 text-neon-violet border-neon-violet/30 animate-pulse",
    Planning: "bg-white/10 text-slate-muted border-white/5",
  };
  return (
    <span className={cn("px-3 py-1 rounded-full text-[10px] font-black uppercase border tracking-widest", variants[state] || "border-slate-line text-slate-muted")}>
      {state}
    </span>
  );
}

export default function TaskModal() {
  const modalTaskId = useStore((s) => s.modalTaskId);
  const setModalTaskId = useStore((s) => s.setModalTaskId);
  const liveStatus = useStore((s) => s.liveStatus);
  const loadAll = useStore((s) => s.loadAll);
  const toast = useStore((s) => s.toast);

  const [activityData, setActivityData] = useState<TaskActivityData | null>(null);
  const [schedData, setSchedData] = useState<SchedulerStateData | null>(null);
  const [activeSegment, setActiveSegment] = useState<'activity' | 'todos' | 'logs'>('activity');
  const logRef = useRef<HTMLDivElement>(null);

  const task = liveStatus?.tasks?.find((t) => t.id === modalTaskId) || null;

  const fetchData = useCallback(async () => {
    if (!modalTaskId) return;
    try {
      const [activity, sched] = await Promise.all([
        api.taskActivity(modalTaskId),
        api.schedulerState(modalTaskId)
      ]);
      setActivityData(activity);
      setSchedData(sched);
    } catch (e) {
      console.error('Failed to fetch task details', e);
    }
  }, [modalTaskId]);

  useEffect(() => {
    if (modalTaskId && task) {
      fetchData();
      if (!['Completed', 'Cancelled'].includes(task.state)) {
        const timer = setInterval(fetchData, 8000);
        return () => clearInterval(timer);
      }
    }
  }, [modalTaskId, task?.state, fetchData]);

  if (!modalTaskId || !task) return null;

  const close = () => setModalTaskId(null);
  const stages = getPipeStatus(task);
  const hb = task.heartbeat || { status: 'unknown', label: 'OFFLINE' };
  
  // Actions
  const doAction = async (action: string, reason: string | null = '') => {
    try {
      const r = await api.taskAction(task.id, action, reason || '');
      if (r.ok) { toast(`✅ ${r.message || 'Success'}`); loadAll(); fetchData(); }
      else toast(r.error || 'Action failed', 'err');
    } catch { toast('Connection error', 'err'); }
  };

  const handleManualAction = (action: string) => {
    const reason = prompt(`Reason for ${action}:`);
    if (reason !== null) doAction(action, reason);
  };

  const doReview = async (action: 'approve' | 'reject') => {
    const comment = prompt(`${action.toUpperCase()} task ${task.id}:`);
    if (comment === null) return;
    try {
      const r = await api.reviewAction(task.id, action, comment);
      if (r.ok) { toast(`✅ Task ${action}ed`); loadAll(); close(); }
      else toast(r.error || 'Review failed', 'err');
    } catch { toast('Connection error', 'err'); }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8 lg:p-12">
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={close}
          className="absolute inset-0 bg-black/80 backdrop-blur-md"
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative w-full max-w-6xl h-full glass-panel rounded-[2.5rem] border border-white/10 overflow-hidden flex flex-col shadow-2xl"
          onClick={e => e.stopPropagation()}
        >
          {/* --- Header --- */}
          <header className="p-8 border-b border-white/5 flex items-start justify-between bg-white/[0.02]">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-black text-neon-cyan tracking-widest">{task.id}</span>
                <StatusBadge state={task.state} />
              </div>
              <h2 className="text-2xl md:text-3xl font-black text-white leading-tight max-w-2xl">{task.title}</h2>
            </div>
            
                <div className="flex items-center gap-4">
                  <div className="hidden md:flex flex-col items-end mr-4">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "w-2 h-2 rounded-full",
                        hb.status === 'active' ? "bg-neon-cyan animate-pulse shadow-neon-cyan" : "bg-slate-line"
                      )} />
                      <span className="text-[10px] font-bold text-white uppercase">{hb.label || 'Standby'}</span>
                    </div>
                    <span className="text-[9px] text-slate-muted font-bold uppercase tracking-widest mt-1">
                      Heartbeat: {hb.status === 'active' ? 'Locked' : 'Stalled'}
                    </span>
                  </div>
                  <button 
                    onClick={close}
                    className="w-12 h-12 rounded-2xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-muted hover:text-white transition-all transition-colors"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>
          </header>

          <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
            {/* --- Left Column: Info & Control --- */}
            <div className="w-full lg:w-96 border-r border-white/5 p-8 overflow-y-auto no-scrollbar space-y-8 bg-black/20">
              
              {/* Fault Diagnosis Banner */}
              {task.last_error && (
                <div className="p-4 rounded-2xl bg-neon-glitch/10 border border-neon-glitch/30 neon-border-glitch animate-pulse-subtle">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-4 h-4 text-neon-glitch" />
                    <span className="text-[10px] font-black uppercase text-neon-glitch tracking-widest">Self-Healing Diagnosis</span>
                  </div>
                  <pre className="text-[9px] font-mono text-white/80 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                    {task.last_error}
                  </pre>
                </div>
              )}

              {/* Action Hub */}
              <div className="space-y-4">
                <h4 className="sub-title">Orchestrator Controls</h4>
                <div className="grid grid-cols-2 gap-2">
                  {['Planning', 'Executing', 'Dispatching', 'PlanReview', 'ResultReview'].includes(task.state) && (
                    <>
                      <button onClick={() => handleManualAction('stop')} className="btn-premium btn-outline flex items-center justify-center gap-2 text-[11px]">
                        <Pause className="w-3.5 h-3.5" /> Halt
                      </button>
                      <button onClick={() => handleManualAction('cancel')} className="btn-premium btn-outline flex items-center justify-center gap-2 text-[11px] hover:text-neon-glitch">
                        <XCircle className="w-3.5 h-3.5" /> Kill
                      </button>
                    </>
                  )}
                  {['Blocked', 'Cancelled'].includes(task.state) && (
                    <button onClick={() => doAction('resume')} className="col-span-2 btn-premium btn-cyan flex items-center justify-center gap-2 text-[11px]">
                      <Play className="w-3.5 h-3.5" /> Resume Mission
                    </button>
                  )}
                  {['ResultReview', 'PlanReview'].includes(task.state) && (
                    <>
                      <button onClick={() => doReview('approve')} className="btn-premium bg-neon-cyan/20 border-neon-cyan/40 text-neon-cyan flex items-center justify-center gap-2 text-[11px]">
                        Approve
                      </button>
                      <button onClick={() => doReview('reject')} className="btn-premium bg-neon-glitch/20 border-neon-glitch/40 text-neon-glitch flex items-center justify-center gap-2 text-[11px]">
                        Reject
                      </button>
                    </>
                  )}
                </div>
                
                <button 
                  onClick={async () => {
                    const comment = prompt("Manual override comment:");
                    if (comment !== null) {
                      const r = await api.advanceState(task.id, comment);
                      if (r.ok) { toast(`⏩ Advanced`); loadAll(); }
                      else toast(r.error || 'Advance failed', 'err');
                    }
                  }}
                  className="w-full btn-premium btn-outline border-neon-violet/30 text-neon-violet hover:bg-neon-violet/10 flex items-center justify-center gap-2 text-[11px]"
                >
                  <FastForward className="w-3.5 h-3.5" /> Force Advance Stage
                </button>
              </div>

              {/* Scheduler Metadata */}
              {schedData && (
                <div className="space-y-4">
                  <h4 className="sub-title">Scheduler Telemetry</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-black/40 rounded-xl border border-white/5">
                      <div className="text-[9px] font-bold text-slate-muted uppercase mb-1">Stall Timer</div>
                      <div className="text-sm font-black text-white">{schedData.stalledSec}s</div>
                    </div>
                    <div className="p-3 bg-black/40 rounded-xl border border-white/5">
                      <div className="text-[9px] font-bold text-slate-muted uppercase mb-1">Retries</div>
                      <div className="text-sm font-black text-white">{schedData.scheduler?.retryCount || 0}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => api.schedulerRetry(task.id, 'Manual Retry')} className="flex-1 px-3 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-[9px] font-bold uppercase transition-all tracking-wider text-slate-muted hover:text-white">Retry</button>
                    <button onClick={() => api.schedulerEscalate(task.id, 'Escalating')} className="flex-1 px-3 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-[9px] font-bold uppercase transition-all tracking-wider text-slate-muted hover:text-white">Escalate</button>
                    <button onClick={() => api.schedulerRollback(task.id, 'Rollback')} className="flex-1 px-3 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-[9px] font-bold uppercase transition-all tracking-wider text-slate-muted hover:text-white">Rollback</button>
                  </div>
                </div>
              )}

              {/* Basic Fields */}
              <div className="space-y-4">
                 <h4 className="sub-title">Operational Metadata</h4>
                 <div className="space-y-3">
                    <div className="flex items-center justify-between">
                       <span className="text-[10px] text-slate-muted font-bold uppercase">Assignee Org</span>
                       <span className="text-[10px] text-neon-cyan font-black">{task.org || 'UNASSIGNED'}</span>
                    </div>
                    {task.eta && (
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-muted font-bold uppercase">ETA</span>
                        <span className="text-[10px] text-white font-black">{task.eta}</span>
                      </div>
                    )}
                 </div>
              </div>
            </div>

            {/* --- Right Column: Activity & Logs --- */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Tabs */}
              <div className="flex px-8 pt-6 border-b border-white/5 gap-8">
                {[
                  { id: 'activity', label: 'Evolution Trace', icon: Activity },
                  { id: 'todos', label: 'Edict Steps', icon: ClipboardList },
                  { id: 'logs', label: 'Raw Activity', icon: FileText },
                ].map(tab => (
                  <button 
                    key={tab.id}
                    onClick={() => setActiveSegment(tab.id as any)}
                    className={cn(
                      "pb-4 flex items-center gap-2 text-xs font-bold transition-all relative",
                      activeSegment === tab.id ? "text-neon-cyan" : "text-slate-muted hover:text-slate-text"
                    )}
                  >
                    <tab.icon className="w-4 h-4" />
                    {tab.label}
                    {activeSegment === tab.id && (
                      <motion.div layoutId="tabMarker" className="absolute bottom-0 left-0 right-0 h-0.5 bg-neon-cyan shadow-neon-cyan" />
                    )}
                  </button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto p-8 no-scrollbar relative">
                <AnimatePresence mode="wait">
                  {activeSegment === 'activity' && (
                    <motion.div 
                      key="activity"
                      initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                      className="space-y-8"
                    >
                      {/* Modern Pipeline Visualization */}
                      <section className="space-y-4">
                        <h4 className="sub-title">Evolution Pipeline</h4>
                        <div className="flex items-center gap-1 overflow-x-auto pb-4 no-scrollbar">
                          {getPipeStatus(task).map((s, i, arr) => (
                            <div key={s.key} className="flex items-center gap-1 shrink-0">
                               <div className={cn(
                                 "flex flex-col items-center p-3 rounded-2xl min-w-[100px] transition-all",
                                 s.status === 'active' ? "bg-neon-violet/10 border-2 border-neon-violet shadow-neon-violet/20" : 
                                 s.status === 'done' ? "bg-neon-cyan/5 border border-neon-cyan/20 opacity-80" : 
                                 "bg-white/5 border border-white/5 opacity-30"
                               )}>
                                 <span className="text-2xl mb-1">{s.icon}</span>
                                 <span className={cn("text-[10px] font-black uppercase tracking-wider", s.status === 'active' ? "text-neon-violet" : s.status === 'done' ? "text-neon-cyan" : "text-slate-muted")}>
                                   {s.dept.slice(0, 4)}
                                 </span>
                                 <span className="text-[8px] text-slate-muted font-bold opacity-60">{s.action}</span>
                               </div>
                               {i < arr.length - 1 && <ChevronRight className="w-4 h-4 text-slate-line" />}
                            </div>
                          ))}
                        </div>
                      </section>

                      {/* Flow Log Timeline */}
                      <section className="space-y-4">
                        <h4 className="sub-title">Collaborative Flow Log</h4>
                        <div className="relative border-l border-slate-line pl-6 ml-2 space-y-6">
                           {task.flow_log?.map((fl, i) => (
                             <div key={i} className="relative">
                               <div className="absolute -left-[29px] top-1 w-2 h-2 rounded-full bg-neon-cyan shadow-neon-cyan shadow-sm" />
                               <div className="flex items-center gap-2 mb-1">
                                 <span className="text-[10px] font-black text-neon-cyan uppercase">{fl.from}</span>
                                 <ChevronRight className="w-3 h-3 text-slate-muted opacity-40" />
                                 <span className="text-[10px] font-black text-neon-violet uppercase">{fl.to}</span>
                                 <span className="ml-auto text-[9px] font-mono text-slate-muted">{fl.at?.substring(11, 16)}</span>
                               </div>
                               <p className="text-[11px] text-white/70 font-medium leading-relaxed italic border-l-2 border-white/5 pl-3">
                                 {fl.remark}
                               </p>
                             </div>
                           ))}
                        </div>
                      </section>
                    </motion.div>
                  )}

                  {activeSegment === 'todos' && (
                    <motion.div 
                      key="todos"
                      initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                      className="space-y-6"
                    >
                      <h4 className="sub-title">Step-by-Step Edicts</h4>
                      <div className="space-y-3">
                         {task.todos?.map(td => (
                           <div key={td.id} className={cn(
                             "p-4 rounded-2xl border transition-all",
                             td.status === 'completed' ? "bg-neon-cyan/5 border-neon-cyan/20 opacity-60 grayscale-[0.5]" : 
                             td.status === 'in-progress' ? "bg-neon-violet/10 border-neon-violet/30 neon-border-violet" :
                             "bg-white/5 border-white/5"
                           )}>
                             <div className="flex items-center justify-between mb-2">
                               <div className="flex items-center gap-3">
                                 {td.status === 'completed' ? <CheckCircle2 className="w-4 h-4 text-neon-cyan" /> : <Clock className="w-4 h-4 text-slate-muted" />}
                                 <span className="text-xs font-black text-white">{td.title}</span>
                               </div>
                               <span className="text-[9px] font-bold text-slate-muted uppercase">#{td.id}</span>
                             </div>
                             {td.detail && <p className="text-[10px] text-slate-muted pl-7">{td.detail}</p>}
                           </div>
                         ))}
                      </div>
                    </motion.div>
                  )}

                  {activeSegment === 'logs' && (
                    <motion.div 
                      key="logs"
                      initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                      className="h-full flex flex-col"
                    >
                      <h4 className="sub-title mb-4">Raw Swarm Intelligence Logs</h4>
                      <div className="flex-1 bg-black/40 rounded-3xl border border-white/5 p-4 font-mono text-[10px] overflow-y-auto space-y-4 no-scrollbar" ref={logRef}>
                        {activityData?.activity?.map((a, i) => (
                          <div key={i} className="flex gap-4 group">
                             <div className="w-16 shrink-0 text-right opacity-30 text-[9px]">{typeof a.at === 'string' ? a.at.substring(11, 19) : ''}</div>
                             <div className="flex-1 space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-neon-cyan font-black uppercase text-[8px]">{a.agent || 'SYSTEM'}</span>
                                  <span className="px-1.5 py-0.5 rounded bg-white/5 text-slate-muted text-[7px] uppercase font-black">{a.kind}</span>
                                </div>
                                <div className="text-slate-text leading-relaxed">
                                  {a.kind === 'assistant' && a.text}
                                  {a.kind === 'progress' && a.text}
                                  {a.kind === 'tool_result' && (
                                    <div className={cn("p-2 rounded bg-black/40 border border-white/5", a.exitCode === 0 ? "border-neon-cyan/20" : "border-neon-glitch/20")}>
                                      <span className="text-neon-cyan font-bold">[{a.tool}]</span> {a.output?.substring(0, 300)}
                                    </div>
                                  )}
                                  {a.kind === 'thinking' && <span className="opacity-40 italic">{a.text}</span>}
                                </div>
                             </div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
