import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Play, 
  Pause, 
  XCircle, 
  ExternalLink, 
  Compass, 
  AlertCircle,
  Package,
  Layers,
  ChevronRight
} from 'lucide-react';
import { useStore, isEdict, isArchived, getPipeStatus, stateLabel, deptColor } from '../store';
import { api, type Task } from '../api';
import { cn } from '../lib/utils';

const STATE_ORDER: Record<string, number> = {
  Executing: 0, ResultReview: 1, Dispatching: 2, PlanReview: 3, Planning: 4,
  Queued: 5, Pending: 6, Blocked: 7, Next: 8, Completed: 9, Cancelled: 10,
};

function MiniPipe({ task }: { task: Task }) {
  const stages = getPipeStatus(task);
  return (
    <div className="flex items-center gap-1.5 mb-4 overflow-x-auto pb-2 no-scrollbar">
      {stages.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1.5 shrink-0">
          <div 
            className={cn(
              "px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-all text-xs font-semibold",
              s.status === 'done' && "bg-slate-100 text-slate-600 border border-slate-200",
              s.status === 'active' && "bg-primary-50 text-primary-700 border border-primary-200 shadow-sm",
              s.status === 'pending' && "bg-white text-slate-300 border border-slate-100"
            )}
            title={`${s.dept}: ${s.action}`}
          >
            <span>{s.icon}</span>
            <span className="hidden md:block">{s.dept.slice(0, 2)}</span>
          </div>
          {i < stages.length - 1 && (
            <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
          )}
        </div>
      ))}
    </div>
  );
}

function EdictCard({ task }: { task: Task }) {
  const setModalTaskId = useStore((s) => s.setModalTaskId);
  const toast = useStore((s) => s.toast);
  const loadAll = useStore((s) => s.loadAll);

  const hb = task.heartbeat || { status: 'unknown', label: '⚪' };
  const archived = isArchived(task);
  const isBlocked = task.block && task.block !== '无' && task.block !== '-';

  const todos = task.todos || [];
  const todoDone = todos.filter((x) => x.status === 'completed').length;
  const todoTotal = todos.length;
  const progress = todoTotal > 0 ? Math.round((todoDone / todoTotal) * 100) : 0;

  const handleAction = async (action: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmMsg = action === 'stop' ? 'Stop Reason' : 'Cancel Reason';
    const reason = prompt(`Enter ${confirmMsg}:`);
    if (reason === null) return;
    
    try {
      const r = await api.taskAction(task.id, action, reason);
      if (r.ok) { toast(`✅ ${r.message || 'Success'}`); loadAll(); }
      else toast(r.error || 'Action failed', 'err');
    } catch { toast('Network error', 'err'); }
  };

  const handleArchive = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const r = await api.archiveTask(task.id, !task.archived);
      if (r.ok) { toast('📦 Archive status updated'); loadAll(); }
      else toast(r.error || 'Action failed', 'err');
    } catch { toast('Network error', 'err'); }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ y: -4 }}
      className={cn(
        "panel p-5 cursor-pointer flex flex-col group transition-all duration-200",
        archived && "opacity-60 bg-slate-50 border-dashed border-slate-300",
        isBlocked && "border-red-200 shadow-sm",
        !isBlocked && !archived && "hover:shadow-card hover:border-primary-200"
      )}
      onClick={() => setModalTaskId(task.id)}
    >
      <MiniPipe task={task} />
      
      <div className="flex justify-between items-start mb-3">
        <span className="text-xs font-mono font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded">{task.id}</span>
        <div className="flex gap-2 items-center">
          {isBlocked && <AlertCircle className="w-4 h-4 text-red-500" />}
          <div className={cn(
            "w-2.5 h-2.5 rounded-full",
            hb.status === 'active' ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" : "bg-slate-300"
          )} />
        </div>
      </div>

      <h3 className="text-[15px] font-semibold text-slate-800 mb-4 line-clamp-2 leading-snug">
        {task.title || '(No Title)'}
      </h3>

      <div className="flex flex-wrap gap-2 mb-5">
        <span className={cn(
          "text-[11px] px-2.5 py-0.5 rounded-full font-semibold border",
          task.state === 'Completed' ? "bg-emerald-50 border-emerald-200 text-emerald-700" :
          task.state === 'Blocked' ? "bg-red-50 border-red-200 text-red-700" :
          task.state === 'Doing' || task.state === 'Executing' ? "bg-primary-50 border-primary-200 text-primary-700" :
          "border-slate-200 text-slate-600 bg-slate-50"
        )}>
          {stateLabel(task)}
        </span>
        {task.org && (
          <span className="text-[11px] px-2.5 py-0.5 rounded-full font-semibold border border-slate-200 text-slate-600 bg-slate-50">
            {task.org}
          </span>
        )}
      </div>

      {todoTotal > 0 && (
        <div className="space-y-2 mb-5 mt-auto">
          <div className="flex justify-between text-[11px] font-semibold text-slate-500">
            <span>Progress: {todoDone}/{todoTotal}</span>
            <span className={progress === 100 ? "text-emerald-600" : "text-primary-600"}>{progress}%</span>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200/50">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              className={cn(
                "h-full rounded-full transition-all duration-1000",
                progress === 100 ? "bg-emerald-500" : "bg-primary-500"
              )}
            />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-4 mt-auto border-t border-slate-100">
        <div className="flex items-center gap-2">
          <button 
            onClick={(e) => handleArchive(e)}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
            title={task.archived ? "Restore Task" : "Archive Task"}
          >
            {task.archived ? <ExternalLink className="w-4 h-4" /> : <Package className="w-4 h-4" />}
          </button>
        </div>
        
        <div className="flex gap-2" onClick={e => e.stopPropagation()}>
          {['Planning', 'Executing', 'Dispatching', 'PlanReview', 'ResultReview'].includes(task.state) ? (
            <>
              <button 
                onClick={e => handleAction('stop', e)}
                className="p-1.5 rounded-lg border border-transparent hover:border-amber-200 hover:bg-amber-50 text-slate-400 hover:text-amber-600 transition-colors"
                title="Pause Execution"
              >
                <Pause className="w-4 h-4" />
              </button>
              <button 
                onClick={e => handleAction('cancel', e)}
                className="p-1.5 rounded-lg border border-transparent hover:border-red-200 hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors"
                title="Cancel Task"
              >
                <XCircle className="w-4 h-4" />
              </button>
            </>
          ) : (
            (task.state === 'Blocked' || task.state === 'Cancelled') && (
              <button 
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    const r = await api.taskAction(task.id, 'resume', 'Restore Execution');
                    if (r.ok) { toast('▶ Task Resumed'); loadAll(); }
                    else toast(r.error || 'Resume failed', 'err');
                  } catch { toast('Network error', 'err'); }
                }}
                className="p-1.5 rounded-lg border border-transparent hover:border-emerald-200 hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 transition-colors"
                title="Resume Execution"
              >
                <Play className="w-4 h-4" />
              </button>
            )
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default function EdictBoard() {
  const liveStatus = useStore((s) => s.liveStatus);
  const edictFilter = useStore((s) => s.edictFilter);
  const setEdictFilter = useStore((s) => s.setEdictFilter);
  const toast = useStore((s) => s.toast);
  const loadAll = useStore((s) => s.loadAll);

  const tasks = liveStatus?.tasks || [];
  const allEdicts = tasks.filter(isEdict);
  
  const filteredEdicts = allEdicts.filter(t => {
    if (edictFilter === 'active') return !isArchived(t);
    if (edictFilter === 'archived') return isArchived(t);
    return true;
  }).sort((a, b) => (STATE_ORDER[a.state] ?? 9) - (STATE_ORDER[b.state] ?? 9));

  const handleScan = async () => {
    try {
      const r = await api.schedulerScan();
      if (r.ok) toast(`🧭 Scan Complete: ${r.count || 0} active jobs`);
      else toast(r.error || 'Scan Failed', 'err');
      loadAll();
    } catch { toast('Network Error', 'err'); }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex p-1 bg-slate-100 rounded-xl border border-slate-200 w-fit">
          {(['active', 'archived', 'all'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setEdictFilter(f)}
              className={cn(
                "px-4 py-1.5 rounded-lg text-sm font-semibold transition-all duration-200",
                edictFilter === f 
                  ? "bg-white text-primary-700 shadow-sm border border-slate-200 border-b-slate-300" 
                  : "text-slate-500 hover:text-slate-800"
              )}
            >
              {f === 'active' ? 'Active' : f === 'archived' ? 'Archived' : 'All Tasks'}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={handleScan}
            className="btn-secondary flex items-center gap-2 group"
          >
            <Compass className="w-4 h-4 text-slate-500 group-hover:rotate-45 transition-transform" />
            Central Scan
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        <AnimatePresence mode="popLayout">
          {filteredEdicts.length === 0 ? (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="col-span-full py-24 flex flex-col items-center justify-center panel border-dashed shadow-none bg-slate-50 text-slate-400"
            >
              <Package className="w-12 h-12 mb-4 text-slate-300" />
              <p className="font-semibold text-slate-600 text-sm tracking-wide uppercase">The Chamber is Empty</p>
              <p className="text-xs text-slate-500 mt-2">Deploy edicts to watch the swarm coordinate</p>
            </motion.div>
          ) : (
            filteredEdicts.map((t) => <EdictCard key={t.id} task={t} />)
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
