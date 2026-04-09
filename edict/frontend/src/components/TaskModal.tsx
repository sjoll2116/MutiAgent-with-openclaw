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
  FastForward,
  ClipboardList,
  FileText,
  ShieldCheck,
  Server
} from 'lucide-react';
import { useStore, getPipeStatus, deptColor, stateLabel } from '../store';
import { api } from '../api';
import type { Task, TaskActivityData, SchedulerStateData, TodoItem, ActivityEntry } from '../api';
import { cn } from '../lib/utils';

// --- Sub-Components ---

function StatusBadge({ state }: { state: string }) {
  const variants: Record<string, string> = {
    Completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
    Blocked: "bg-red-50 text-red-700 border-red-200",
    Executing: "bg-primary-50 text-primary-700 border-primary-200 animate-pulse",
    Planning: "bg-slate-100 text-slate-600 border-slate-200",
    Doing: "bg-primary-50 text-primary-700 border-primary-200",
  };
  return (
    <span className={cn("px-3 py-1 rounded-full text-[11px] font-bold uppercase border tracking-wider", variants[state] || "bg-slate-50 border-slate-200 text-slate-500")}>
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
          className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative w-full max-w-6xl h-full panel flex flex-col shadow-2xl overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          {/* --- Header --- */}
          <header className="p-6 md:p-8 border-b border-slate-200 flex items-start justify-between bg-white shrink-0">
            <div className="space-y-1.5 flex-1 pr-6">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">{task.id}</span>
                <StatusBadge state={task.state} />
              </div>
              <h2 className="text-xl md:text-2xl font-bold text-slate-900 leading-tight line-clamp-2">{task.title}</h2>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="hidden md:flex flex-col items-end mr-4">
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "w-2.5 h-2.5 rounded-full",
                    hb.status === 'active' ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)] animate-pulse" : "bg-slate-300"
                  )} />
                  <span className="text-[11px] font-bold text-slate-700 uppercase">{hb.label || 'Standby'}</span>
                </div>
                <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mt-1">
                  Heartbeat: {hb.status === 'active' ? 'Locked' : 'Stalled'}
                </span>
              </div>
              <button 
                onClick={close}
                className="w-10 h-10 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 hover:text-slate-800 transition-colors"
                title="Close Modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </header>

          <div className="flex-1 overflow-hidden flex flex-col lg:flex-row bg-slate-50/50">
            {/* --- Left Column: Info & Control --- */}
            <div className="w-full lg:w-96 border-r border-slate-200 p-6 md:p-8 overflow-y-auto bg-white space-y-8 flex-shrink-0">
              
              {/* Fault Diagnosis Banner */}
              {task.last_error && (
                <div className="p-4 rounded-xl bg-red-50 border border-red-200">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-4 h-4 text-red-600" />
                    <span className="text-xs font-bold uppercase text-red-700 tracking-wider">Self-Healing Diagnosis</span>
                  </div>
                  <pre className="text-[11px] font-mono text-red-800/80 overflow-x-auto whitespace-pre-wrap leading-relaxed bg-red-100/50 p-3 rounded-lg border border-red-100">
                    {task.last_error}
                  </pre>
                </div>
              )}

              {/* Action Hub */}
              <div className="space-y-4">
                <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-slate-400" /> Orchestrator Controls
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  {['Planning', 'Executing', 'Dispatching', 'PlanReview', 'ResultReview'].includes(task.state) && (
                    <>
                      <button onClick={() => handleManualAction('stop')} className="btn-secondary flex items-center justify-center gap-2">
                        <Pause className="w-4 h-4" /> Halt
                      </button>
                      <button onClick={() => handleManualAction('cancel')} className="btn-secondary border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 hover:text-red-700 flex items-center justify-center gap-2">
                        <XCircle className="w-4 h-4" /> Kill
                      </button>
                    </>
                  )}
                  {['Blocked', 'Cancelled'].includes(task.state) && (
                    <button onClick={() => doAction('resume')} className="col-span-2 btn-primary flex items-center justify-center gap-2">
                      <Play className="w-4 h-4" /> Resume Mission
                    </button>
                  )}
                  {['ResultReview', 'PlanReview'].includes(task.state) && (
                    <>
                      <button onClick={() => doReview('approve')} className="px-4 py-2 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium text-sm hover:bg-emerald-100 transition-colors flex items-center justify-center gap-2">
                        Approve
                      </button>
                      <button onClick={() => doReview('reject')} className="px-4 py-2 rounded-lg bg-red-50 text-red-700 border border-red-200 font-medium text-sm hover:bg-red-100 transition-colors flex items-center justify-center gap-2">
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
                      if (r.ok) { toast(`⏩ Advanced Stage manually`); loadAll(); }
                      else toast(r.error || 'Advance failed', 'err');
                    }
                  }}
                  className="w-full px-4 py-2 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 font-medium text-sm hover:bg-indigo-100 transition-colors flex items-center justify-center gap-2"
                >
                  <FastForward className="w-4 h-4" /> Force Advance Stage
                </button>
              </div>

              {/* Scheduler Metadata */}
              {schedData && (
                <div className="space-y-4">
                  <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                    <Server className="w-4 h-4 text-slate-400" /> Scheduler Telemetry
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                      <div className="text-xs font-semibold text-slate-500 uppercase mb-1">Stall Timer</div>
                      <div className="text-lg font-bold text-slate-800">{schedData.stalledSec}s</div>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                      <div className="text-xs font-semibold text-slate-500 uppercase mb-1">Retries</div>
                      <div className="text-lg font-bold text-slate-800">{schedData.scheduler?.retryCount || 0}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => api.schedulerRetry(task.id, 'Manual Retry')} className="flex-1 btn-secondary text-xs">Retry</button>
                    <button onClick={() => api.schedulerEscalate(task.id, 'Escalating')} className="flex-1 btn-secondary text-xs">Escalate</button>
                    <button onClick={() => api.schedulerRollback(task.id, 'Rollback')} className="flex-1 btn-secondary text-xs border-red-200 hover:bg-red-50 hover:text-red-600">Rollback</button>
                  </div>
                </div>
              )}

              {/* Basic Fields */}
              <div className="space-y-4 pt-4 border-t border-slate-100">
                 <div className="space-y-3">
                    <div className="flex items-center justify-between">
                       <span className="text-xs text-slate-500 font-medium">Assignee Org</span>
                       <span className="text-xs text-primary-700 bg-primary-50 border border-primary-100 px-2.5 py-0.5 rounded font-semibold">{task.org || 'UNASSIGNED'}</span>
                    </div>
                    {task.eta && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-500 font-medium">ETA</span>
                        <span className="text-xs text-slate-800 font-medium bg-slate-100 px-2 py-0.5 rounded">{task.eta}</span>
                      </div>
                    )}
                 </div>
              </div>

              {/* Task Result / Output */}
              <div className="space-y-3 pt-4 border-t border-slate-100">
                 <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                   <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Deliverable Output
                 </h4>
                 {task.output ? (
                   <div className="text-xs text-slate-700 bg-slate-50 p-4 rounded-xl border border-slate-200 whitespace-pre-wrap max-h-[32rem] overflow-y-auto break-words shadow-inner font-mono leading-relaxed">
                     {task.output}
                   </div>
                 ) : (
                   <div className="text-xs text-slate-400 italic bg-slate-50/50 p-4 rounded-xl border-dashed border border-slate-200 text-center">
                     尚未生成任何交互输出 / No output generated yet.
                   </div>
                 )}
              </div>
            </div>

            {/* --- Right Column: Activity & Logs --- */}
            <div className="flex-1 flex flex-col min-w-0">
              {/* Tabs */}
              <div className="flex px-8 pt-4 border-b border-slate-200 gap-8 bg-white shrink-0 shadow-sm z-10">
                {[
                  { id: 'activity', label: 'Evolution Trace', icon: Activity },
                  { id: 'todos', label: 'Edict Steps', icon: ClipboardList },
                  { id: 'logs', label: 'Raw Activity', icon: FileText },
                ].map(tab => (
                  <button 
                    key={tab.id}
                    onClick={() => setActiveSegment(tab.id as any)}
                    className={cn(
                      "pb-4 pt-2 flex items-center gap-2 text-sm font-semibold transition-all relative",
                      activeSegment === tab.id ? "text-primary-600" : "text-slate-500 hover:text-slate-800"
                    )}
                  >
                    <tab.icon className="w-4 h-4" />
                    {tab.label}
                    {activeSegment === tab.id && (
                      <motion.div layoutId="tabMarker" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-600" />
                    )}
                  </button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto p-6 md:p-8 relative">
                <AnimatePresence mode="wait">
                  {activeSegment === 'activity' && (
                    <motion.div 
                      key="activity"
                      initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }}
                      className="space-y-10"
                    >
                      {/* Modern Pipeline Visualization */}
                      <section className="space-y-5">
                        <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Evolution Pipeline</h4>
                        <div className="flex items-center gap-1.5 overflow-x-auto pb-4 pt-2 px-1 no-scrollbar">
                          {getPipeStatus(task).map((s, i, arr) => (
                            <div key={s.key} className="flex items-center gap-1.5 shrink-0">
                               <div className={cn(
                                 "flex flex-col items-center p-4 rounded-xl min-w-[120px] transition-all border",
                                 s.status === 'active' ? "bg-primary-50 border-primary-200 shadow-md transform -translate-y-1" : 
                                 s.status === 'done' ? "bg-emerald-50 border-emerald-100 opacity-90" : 
                                 "bg-white border-slate-100 opacity-60"
                               )}>
                                 <span className="text-3xl mb-2 grayscale opacity-90">{s.icon}</span>
                                 <span className={cn("text-xs font-bold uppercase tracking-wider mb-0.5", 
                                   s.status === 'active' ? "text-primary-700" : 
                                   s.status === 'done' ? "text-emerald-700" : "text-slate-500"
                                 )}>
                                   {s.dept.slice(0, 10)}
                                 </span>
                                 <span className="text-[10px] uppercase text-slate-500 font-semibold">{s.action}</span>
                               </div>
                               {i < arr.length - 1 && <ChevronRight className="w-5 h-5 text-slate-300" />}
                            </div>
                          ))}
                        </div>
                      </section>

                      {/* Flow Log Timeline */}
                      <section className="space-y-5">
                        <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Collaborative Flow Log</h4>
                        <div className="relative border-l-2 border-slate-200 pl-6 ml-3 space-y-8">
                           {task.flow_log?.length === 0 && <p className="text-sm text-slate-500 italic">No collaborative logs recorded yet.</p>}
                           {task.flow_log?.map((fl, i) => (
                             <div key={i} className="relative">
                               <div className="absolute -left-[31px] top-1.5 w-3 h-3 rounded-full bg-white border-[3px] border-primary-500 shadow-sm" />
                               <div className="flex items-center gap-2 mb-2 p-1.5 bg-slate-100 w-fit rounded-lg border border-slate-200/60">
                                 <span className="text-[10px] font-bold text-slate-700 uppercase px-1">{fl.from}</span>
                                 <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                                 <span className="text-[10px] font-bold text-primary-700 uppercase px-1">{fl.to}</span>
                                 <span className="ml-2 text-[10px] font-mono text-slate-500">{fl.at?.substring(11, 19)}</span>
                               </div>
                               <p className="text-sm text-slate-700 leading-relaxed bg-white p-4 rounded-xl border border-slate-200 shadow-subtle">
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
                      initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }}
                      className="space-y-6"
                    >
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Step-by-Step Edicts</h4>
                      </div>
                      
                      <div className="space-y-3">
                         {task.todos?.length === 0 && <p className="text-sm text-slate-500 italic text-center py-10">No specific steps defined for this edict.</p>}
                         {task.todos?.map(td => (
                           <div key={td.id} className={cn(
                             "p-5 rounded-2xl border transition-all shadow-subtle",
                             td.status === 'completed' ? "bg-slate-50 border-slate-200 opacity-60" : 
                             td.status === 'in-progress' ? "bg-white border-primary-300 shadow-md ring-1 ring-primary-50" :
                             "bg-white border-slate-200"
                           )}>
                             <div className="flex items-start justify-between mb-2 gap-4">
                               <div className="flex items-start gap-3 mt-0.5">
                                 {td.status === 'completed' ? <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" /> : <Clock className="w-5 h-5 text-slate-300 shrink-0" />}
                                 <span className={cn(
                                   "text-sm font-bold",
                                   td.status === 'completed' ? "text-slate-500 line-through decoration-slate-300" : "text-slate-800"
                                 )}>{td.title}</span>
                               </div>
                               <div className="flex gap-2 shrink-0">
                                 {td.agent && (
                                   <span className="text-[10px] font-bold text-primary-600 bg-primary-50 border border-primary-100 px-2 py-0.5 rounded uppercase">
                                     {td.agent}
                                   </span>
                                 )}
                                 <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded uppercase">
                                   #{td.id}
                                 </span>
                               </div>
                             </div>
                             {td.detail && (
                               <p className="text-[12px] text-slate-600 pl-8 leading-relaxed mt-1">{td.detail}</p>
                             )}
                           </div>
                         ))}
                      </div>
                    </motion.div>
                  )}

                  {activeSegment === 'logs' && (
                    <motion.div 
                      key="logs"
                      initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }}
                      className="h-[600px] flex flex-col"
                    >
                      <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-4">Raw Swarm Intelligence Logs</h4>
                      <div className="flex-1 bg-slate-900 rounded-2xl border border-slate-800 p-4 font-mono text-[11px] overflow-y-auto space-y-4 no-scrollbar shadow-inner" ref={logRef}>
                        {activityData?.activity?.length === 0 && <div className="text-slate-500 text-center py-10 opacity-70">No raw activity recorded.</div>}
                        {activityData?.activity?.map((a, i) => (
                           <div key={i} className="flex gap-4 group">
                              <div className="w-16 shrink-0 text-right text-slate-500 text-[10px] mt-0.5">{typeof a.at === 'string' ? a.at.substring(11, 19) : ''}</div>
                              <div className="flex-1 space-y-1.5 pb-2 border-b border-white/5">
                                 <div className="flex items-center gap-2">
                                   <span className="text-primary-400 font-bold uppercase text-[9px]">{a.agent || 'SYSTEM'}</span>
                                   <span className="px-1.5 py-0.5 rounded bg-white/10 text-slate-300 text-[8px] uppercase font-bold">{a.kind}</span>
                                 </div>
                                 <div className="text-slate-300 leading-relaxed max-w-3xl whitespace-pre-wrap break-words">
                                   {a.kind === 'assistant' && a.text}
                                   {a.kind === 'progress' && <span className="text-blue-300">ℹ {a.text}</span>}
                                   {a.kind === 'tool_result' && (
                                     <div className={cn("p-3 mt-1 rounded bg-black/60 border", a.exitCode === 0 ? "border-emerald-500/30" : "border-red-500/30")}>
                                       <div className="text-emerald-400 font-bold mb-1">[{a.tool}]</div> 
                                       <div className="text-slate-400 font-mono text-[10px]">{a.output?.substring(0, 1000)}{a.output && a.output.length > 1000 ? '\n...[truncated]' : ''}</div>
                                     </div>
                                   )}
                                   {a.kind === 'thinking' && <span className="text-slate-500 italic block border-l-2 border-slate-700 pl-2">"{a.text}"</span>}
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
