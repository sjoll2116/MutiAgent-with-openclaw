import { useState } from 'react';
import { useStore, isEdict, STATE_LABEL } from '../store';
import type { Task, FlowEntry } from '../api';
import { cn } from '../lib/utils';
import { 
  FileText, 
  CheckCircle2, 
  XCircle, 
  Copy, 
  X, 
  User, 
  Map, 
  ShieldCheck, 
  Cog, 
  Send,
  History,
  Archive
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function MemorialPanel() {
  const liveStatus = useStore((s: any) => s.liveStatus);
  const [filter, setFilter] = useState('all');
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const toast = useStore((s: any) => s.toast);

  const tasks = liveStatus?.tasks || [];
  let mems = tasks.filter((t: any) => isEdict(t) && ['Completed', 'Cancelled'].includes(t.state));
  if (filter !== 'all') mems = mems.filter((t: any) => t.state === filter);

  const exportMemorial = (t: Task) => {
    const fl = t.flow_log || [];
    let md = `# 📄 Task Memorial · ${t.title}\n\n`;
    md += `- **ID**: ${t.id}\n`;
    md += `- **Status**: ${t.state}\n`;
    md += `- **Department**: ${t.org}\n`;
    if (fl.length) {
      const startAt = fl[0].at ? fl[0].at.substring(0, 19).replace('T', ' ') : 'Unknown';
      const endAt = fl[fl.length - 1].at ? fl[fl.length - 1].at.substring(0, 19).replace('T', ' ') : 'Unknown';
      md += `- **Started At**: ${startAt}\n`;
      md += `- **Ended At**: ${endAt}\n`;
    }
    md += `\n## Collaborative Flow Log\n\n`;
    for (const f of fl) {
      md += `- **${f.from}** → **${f.to}**  \n  ${f.remark}  \n  _${(f.at || '').substring(0, 19)}_\n\n`;
    }
    if (t.output && t.output !== '-') md += `## Output Artifacts\n\n\`${t.output}\`\n`;
    navigator.clipboard.writeText(md).then(
      () => toast('✅ Memorial copied to Markdown', 'ok'),
      () => toast('Copy failed', 'err')
    );
  };

  return (
    <div className="flex flex-col h-full space-y-6">
      {/* Filter */}
      <div className="flex items-center gap-2 pb-2">
        <span className="text-sm font-semibold text-slate-500 mr-2 flex items-center gap-2"><History className="w-4 h-4"/> Filter:</span>
        {[
          { key: 'all', label: `All Archives (${mems.length})`, icon: null },
          { key: 'Completed', label: 'Completed', icon: CheckCircle2 },
          { key: 'Cancelled', label: 'Cancelled', icon: XCircle },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 border",
              filter === f.key 
                ? "bg-slate-800 text-white border-slate-800 shadow-sm" 
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
            )}
          >
            {f.icon && <f.icon className={cn("w-4 h-4", filter === f.key ? "text-white" : f.key === 'Completed' ? "text-emerald-500" : "text-red-500")} />}
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto min-h-0 pr-2">
        {!mems.length ? (
          <div className="flex flex-col items-center justify-center p-20 text-slate-400 opacity-70 bg-white rounded-2xl border border-dashed border-slate-200 h-64 mx-auto w-full max-w-2xl mt-10">
            <Archive className="w-12 h-12 mb-4 text-slate-300" strokeWidth={1.5} />
            <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">No memorials yet</p>
            <p className="text-xs text-slate-400 mt-1">Edicts automatically archive here once completed.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {mems.map((t: any) => {
              const fl = t.flow_log || [];
              const depts: string[] = [...new Set(fl.map((f: any) => f.from).concat(fl.map((f: any) => f.to)).filter((x: any) => !!x && x !== '用户'))] as string[];
              const firstAt = fl.length ? (fl[0].at || '').substring(0, 16).replace('T', ' ') : '';
              const lastAt = fl.length ? (fl[fl.length - 1].at || '').substring(0, 16).replace('T', ' ') : '';
              const isCompleted = t.state === 'Completed';

              return (
                <div 
                  key={t.id} 
                  onClick={() => setDetailTask(t)}
                  className={cn(
                    "panel p-5 flex flex-col hover:shadow-card cursor-pointer transition-all border-l-4 group flex-shrink-0",
                    isCompleted ? "border-l-emerald-400 hover:border-emerald-300" : "border-l-red-400 hover:border-red-300"
                  )}
                >
                  <div className="flex items-start gap-4 mb-4">
                    <div className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border group-hover:scale-105 transition-transform",
                      isCompleted ? "bg-emerald-50 border-emerald-100 text-emerald-600" : "bg-red-50 border-red-100 text-red-600"
                    )}>
                      <FileText className="w-5 h-5" />
                    </div>
                    
                    <div className="flex-1 min-w-0 pt-0.5">
                      <h4 className={cn("text-base font-bold mb-1 truncate", isCompleted ? "text-slate-800" : "text-slate-600 line-through decoration-slate-300")}>
                        {t.title || t.id}
                      </h4>
                      <div className="text-[11px] font-semibold text-slate-500 flex items-center gap-2">
                        <span className="uppercase tracking-widest font-mono">{t.id}</span>
                        <span>•</span>
                        <span>{t.org || 'Unassigned'}</span>
                        <span>•</span>
                        <span>{fl.length} steps</span>
                      </div>
                    </div>
                  </div>

                  {depts.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-5 pl-14">
                      {depts.slice(0, 4).map((d) => (
                        <span key={d} className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border border-slate-200 truncate max-w-[100px]">
                          {d}
                        </span>
                      ))}
                      {depts.length > 4 && <span className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded text-[10px] font-bold border border-slate-200">+{depts.length - 4}</span>}
                    </div>
                  )}
                  <div className="flex-1" />
                  
                  <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 border-t border-slate-100 pt-3 mt-auto">
                    <span>{firstAt}</span>
                    {lastAt !== firstAt && (
                      <div className="flex items-center gap-2">
                        <span className="text-slate-300">→</span>
                        <span>{lastAt}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      <AnimatePresence>
        {detailTask && (
          <MemorialDetailModal task={detailTask} onClose={() => setDetailTask(null)} onExport={exportMemorial} />
        )}
      </AnimatePresence>
    </div>
  );
}

function MemorialDetailModal({
  task: t,
  onClose,
  onExport,
}: {
  task: Task;
  onClose: () => void;
  onExport: (t: Task) => void;
}) {
  const fl = t.flow_log || [];
  const st = t.state || 'Unknown';
  const isCompleted = st === 'Completed';
  const depts = [...new Set(fl.map((f) => f.from).concat(fl.map((f) => f.to)).filter((x) => x && x !== '用户'))];

  // Reconstruct phases
  const originLog: FlowEntry[] = [];
  const planLog: FlowEntry[] = [];
  const reviewLog: FlowEntry[] = [];
  const execLog: FlowEntry[] = [];
  const resultLog: FlowEntry[] = [];
  
  for (const f of fl) {
    if (f.from === '用户') originLog.push(f);
    else if (f.to === '任务编排引擎' || f.from === '任务编排引擎') planLog.push(f);
    else if (f.to === '安全审查引擎' || f.from === '安全审查引擎') reviewLog.push(f);
    else if (f.remark && (f.remark.includes('完成') || f.remark.includes('任务汇报'))) resultLog.push(f);
    else execLog.push(f);
  }

  const renderPhase = (title: string, icon: any, items: FlowEntry[]) => {
    if (!items.length) return null;
    const Icon = icon;
    return (
      <div className="mb-8">
        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-widest mb-4 flex items-center gap-2">
          <Icon className="w-4 h-4 text-slate-400" /> {title}
        </h3>
        <div className="relative border-l-2 border-slate-100 pl-5 ml-2 space-y-6">
          {items.map((f, i) => {
             const isGreen = f.remark?.includes('✅');
             const isRed = f.remark?.includes('驳') || f.remark?.includes('🚫') || f.remark?.includes('Fail');
             return (
               <div className="relative" key={i}>
                 <div className={cn(
                   "absolute -left-[27px] top-1.5 w-3 h-3 rounded-full border-[3px] shadow-sm",
                   isGreen ? "bg-white border-emerald-500" : isRed ? "bg-white border-red-500" : "bg-white border-slate-300"
                 )} />
                 <div className="flex items-center gap-2 mb-2 bg-slate-50 w-fit px-2 py-1 rounded-lg border border-slate-200">
                   <span className="text-[10px] font-bold uppercase text-slate-600 tracking-wider break-words max-w-[150px] truncate" title={f.from}>{f.from}</span>
                   <span className="text-slate-300">→</span>
                   <span className="text-[10px] font-bold uppercase text-primary-600 tracking-wider break-words max-w-[150px] truncate" title={f.to}>{f.to}</span>
                 </div>
                 <div className="text-sm text-slate-700 leading-relaxed bg-white p-4 rounded-xl border border-slate-100 shadow-subtle mb-1 whitespace-pre-wrap word-break-all">
                   {f.remark}
                 </div>
                 <div className="text-[10px] font-mono text-slate-400 font-semibold">{(f.at || '').substring(0, 19).replace('T', ' ')}</div>
               </div>
             );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="relative w-full max-w-3xl max-h-[85vh] panel flex flex-col shadow-2xl bg-white" 
        onClick={(e) => e.stopPropagation()}
      >
        <header className="p-6 border-b border-slate-100 flex justify-between items-start bg-slate-50/50 rounded-t-xl shrink-0">
          <div className="pr-8">
             <div className="flex items-center gap-3 mb-2">
               <span className="text-[10px] font-bold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded uppercase font-mono tracking-widest">{t.id}</span>
             </div>
             <h2 className="text-2xl font-bold text-slate-900 leading-tight mb-4 flex items-center gap-3">
               {isCompleted ? <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0"/> : <XCircle className="w-6 h-6 text-red-500 shrink-0"/>}
               {t.title || t.id}
             </h2>
             <div className="flex flex-wrap items-center gap-2">
               <span className={cn(
                 "text-[11px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider border shadow-sm",
                 isCompleted ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"
               )}>
                 {STATE_LABEL[st] || st}
               </span>
               <span className="text-[11px] font-bold text-slate-600 bg-white border border-slate-200 px-2.5 py-1 rounded-full uppercase shadow-sm">
                 {t.org}
               </span>
               <span className="text-[11px] font-bold text-slate-500 bg-white border border-slate-200 px-2.5 py-1 rounded-full shadow-sm">
                 {fl.length} Workflow Steps
               </span>
             </div>
             {depts.length > 0 && (
               <div className="flex flex-wrap gap-1.5 mt-3">
                  {depts.map((d) => (
                    <span key={d} className="bg-slate-100/80 text-slate-500 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border border-slate-200">
                      {d}
                    </span>
                  ))}
               </div>
             )}
          </div>
          <button className="w-8 h-8 flex items-center justify-center rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-500 transition-colors shadow-sm" onClick={onClose}>
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-8 flex flex-col min-h-0 bg-slate-50/20">
          {t.now && (
            <div className="bg-slate-800 text-slate-300 font-mono text-xs p-4 rounded-xl mb-8 flex gap-3 items-start shadow-inner">
               <span className="mt-0.5 shrink-0 text-slate-500">$</span>
               <div className="whitespace-pre-wrap break-all">{t.now}</div>
            </div>
          )}

          <div className="max-w-2xl w-full mx-auto pb-4">
            {renderPhase('Original Directive', User, originLog)}
            {renderPhase('Orchestration & Planning', Map, planLog)}
            {renderPhase('Security & Compliance Review', ShieldCheck, reviewLog)}
            {renderPhase('Execution Pipeline', Cog, execLog)}
            {renderPhase('Final Report', Send, resultLog)}
          </div>

          {t.output && t.output !== '-' && (
            <div className="mt-4 pt-6 border-t border-slate-100">
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-widest mb-3 flex items-center gap-2">
                <FileText className="w-4 h-4 text-slate-400" /> Artifacts
              </h3>
              <div className="bg-slate-100 border border-slate-200 p-4 rounded-xl text-xs font-mono text-slate-700 break-all shadow-inner">
                {t.output}
              </div>
            </div>
          )}
        </div>
        
        <footer className="p-4 border-t border-slate-100 bg-slate-50 rounded-b-xl flex justify-end shrink-0">
          <button className="btn-secondary flex items-center gap-2 border-slate-300" onClick={() => onExport(t)}>
            <Copy className="w-4 h-4" /> Copy Markdown Report
          </button>
        </footer>
      </motion.div>
    </div>
  );
}
