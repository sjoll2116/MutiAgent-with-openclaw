import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Play, 
  Pause, 
  XCircle, 
  Archive, 
  ExternalLink, 
  Compass, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  Package,
  Layers
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
    <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-2 no-scrollbar">
      {stages.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1 shrink-0">
          <div 
            className={cn(
              "px-2 py-1 rounded-md flex items-center gap-1.5 transition-all duration-300",
              s.status === 'done' && "bg-neon-cyan/10 border border-neon-cyan/20 text-neon-cyan",
              s.status === 'active' && "bg-neon-violet/20 border border-neon-violet/50 text-neon-violet shadow-neon-violet",
              s.status === 'pending' && "opacity-20 grayscale border border-transparent"
            )}
            title={`${s.dept}: ${s.action}`}
          >
            <span className="text-[14px]">{s.icon}</span>
            <span className="text-[9px] font-bold uppercase tracking-wider hidden md:block">{s.dept.slice(0, 2)}</span>
          </div>
          {i < stages.length - 1 && (
            <div className="text-slate-line text-[10px]">
              <Layers className="w-2.5 h-2.5 opacity-20" />
            </div>
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
    const confirmMsg = action === 'stop' ? '叫停原因' : '取消原因';
    const reason = prompt(`请输入${confirmMsg}：`);
    if (reason === null) return;
    
    try {
      const r = await api.taskAction(task.id, action, reason);
      if (r.ok) { toast(`✅ ${r.message || '操作成功'}`); loadAll(); }
      else toast(r.error || '操作失败', 'err');
    } catch { toast('服务器连接失败', 'err'); }
  };

  const handleArchive = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const r = await api.archiveTask(task.id, !task.archived);
      if (r.ok) { toast('📦 归档状态已更新'); loadAll(); }
      else toast(r.error || '操作失败', 'err');
    } catch { toast('服务器连接失败', 'err'); }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ y: -4 }}
      className={cn(
        "glass-card p-5 cursor-pointer relative group overflow-hidden rounded-2xl",
        archived && "opacity-40 grayscale-[0.5] border-dashed",
        isBlocked && "border-neon-glitch/30"
      )}
      onClick={() => setModalTaskId(task.id)}
    >
      {/* Visual Glint Effect */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      
      <MiniPipe task={task} />
      
      <div className="flex justify-between items-start mb-2">
        <span className="text-[10px] font-mono font-bold text-neon-cyan tracking-wider">{task.id}</span>
        <div className="flex gap-2">
          {isBlocked && <AlertCircle className="w-4 h-4 text-neon-glitch animate-pulse" />}
          <div className={cn(
            "w-2 h-2 rounded-full",
            hb.status === 'active' ? "bg-neon-cyan shadow-neon-cyan shadow-[0_0_8px]" : "bg-slate-line"
          )} />
        </div>
      </div>

      <h3 className="text-sm font-bold text-white mb-4 line-clamp-2 min-h-[2.5rem]">
        {task.title || '(No Title)'}
      </h3>

      <div className="flex flex-wrap gap-2 mb-4">
        <span className={cn(
          "text-[10px] px-2 py-0.5 rounded-full font-bold uppercase border transition-colors",
          task.state === 'Completed' ? "bg-neon-cyan/10 border-neon-cyan/30 text-neon-cyan" :
          task.state === 'Blocked' ? "bg-neon-glitch/10 border-neon-glitch/30 text-neon-glitch" :
          "border-slate-line text-slate-muted"
        )}>
          {stateLabel(task)}
        </span>
        {task.org && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold border border-slate-line text-slate-muted bg-black/20">
            {task.org}
          </span>
        )}
      </div>

      {todoTotal > 0 && (
        <div className="space-y-1.5 mb-5">
          <div className="flex justify-between text-[10px] font-bold text-slate-muted">
            <span>Progress: {todoDone}/{todoTotal}</span>
            <span>{progress}%</span>
          </div>
          <div className="h-1 bg-obsidian-full rounded-full overflow-hidden border border-white/5">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              className={cn(
                "h-full rounded-full transition-all duration-1000",
                progress === 100 ? "bg-neon-cyan shadow-neon-cyan" : "bg-neon-violet shadow-neon-violet"
              )}
            />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-4 border-t border-slate-line">
        <div className="flex items-center gap-3">
          <button 
            onClick={(e) => handleArchive(e)}
            className="p-1.5 rounded-lg hover:bg-white/5 text-slate-muted hover:text-white transition-colors"
            title={task.archived ? "Restore" : "Archive"}
          >
            {task.archived ? <ExternalLink className="w-3.5 h-3.5" /> : <Package className="w-3.5 h-3.5" />}
          </button>
        </div>
        
        <div className="flex gap-2" onClick={e => e.stopPropagation()}>
          {['Planning', 'Executing', 'Dispatching', 'PlanReview', 'ResultReview'].includes(task.state) ? (
            <>
              <button 
                onClick={e => handleAction('stop', e)}
                className="p-1.5 rounded-lg hover:bg-neon-ember/10 text-slate-muted hover:text-neon-ember transition-colors"
                title="Pause / Halt"
              >
                <Pause className="w-3.5 h-3.5" />
              </button>
              <button 
                onClick={e => handleAction('cancel', e)}
                className="p-1.5 rounded-lg hover:bg-neon-glitch/10 text-slate-muted hover:text-neon-glitch transition-colors"
                title="Slay Task"
              >
                <XCircle className="w-3.5 h-3.5" />
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
                  } catch { toast('Network Error', 'err'); }
                }}
                className="p-1.5 rounded-lg hover:bg-neon-cyan/10 text-slate-muted hover:text-neon-cyan transition-colors"
                title="Resume"
              >
                <Play className="w-3.5 h-3.5" />
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
      if (r.ok) toast(`🧭 Scan Complete: Found ${r.count || 0} sync points`);
      else toast(r.error || 'Scan Failed', 'err');
      loadAll();
    } catch { toast('Network Error', 'err'); }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex p-1 bg-obsidian-panel/60 rounded-xl border border-slate-line w-fit">
          {(['active', 'archived', 'all'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setEdictFilter(f)}
              className={cn(
                "px-4 py-1.5 rounded-lg text-xs font-bold transition-all duration-300",
                edictFilter === f 
                  ? "bg-white/10 text-neon-cyan shadow-sm" 
                  : "text-slate-muted hover:text-white"
              )}
            >
              {f === 'active' ? 'Active' : f === 'archived' ? 'Archived' : 'All Tasks'}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={handleScan}
            className="flex items-center gap-2 px-4 py-1.5 rounded-xl border border-slate-line text-xs font-bold text-slate-muted hover:text-neon-violet hover:border-neon-violet/50 transition-all group"
          >
            <Compass className="w-3.5 h-3.5 group-hover:rotate-45 transition-transform" />
            Central Scan
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-6">
        <AnimatePresence mode="popLayout">
          {filteredEdicts.length === 0 ? (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="col-span-full py-20 flex flex-col items-center justify-center glass-panel rounded-3xl border-dashed opacity-50"
            >
              <Package className="w-12 h-12 text-slate-muted mb-4 opacity-20" />
              <p className="text-slate-muted font-bold text-sm tracking-widest uppercase">The Chamber is Empty</p>
              <p className="text-[10px] text-slate-muted/60 mt-2">Deploy edicts to watch the swarm coordinate</p>
            </motion.div>
          ) : (
            filteredEdicts.map((t) => <EdictCard key={t.id} task={t} />)
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
