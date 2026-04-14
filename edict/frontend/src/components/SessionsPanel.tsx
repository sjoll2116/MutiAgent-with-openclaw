import { useStore, isEdict, STATE_LABEL, timeAgo } from '../store';
import type { Task } from '../api';
import { useState } from 'react';
import { cn } from '../lib/utils';
import { X, MessageSquare, Globe, Clock, Send, Link as LinkIcon, Activity, Database, Bot, Command, AlignLeft, BotMessageSquare } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Agent maps built from agentConfig
function useAgentMaps() {
  const cfg = useStore((s) => s.agentConfig);
  const emojiMap: Record<string, string> = {};
  const labelMap: Record<string, string> = {};
  if (cfg?.agents) {
    cfg.agents.forEach((a) => {
      emojiMap[a.id] = a.emoji || '🏛️';
      labelMap[a.id] = a.label || a.id;
    });
  }
  return { emojiMap, labelMap };
}

function extractAgent(t: Task): string {
  const m = (t.id || '').match(/^OC-(\w+)-/);
  if (m) return m[1];
  return (t.org || '').replace(/省|部/g, '').toLowerCase();
}

function humanTitle(t: Task, labelMap: Record<string, string>): string {
  let title = t.title || '';
  if (title === 'heartbeat 会话') return '💓 心跳检测';
  const m = title.match(/^agent:(\w+):(\w+)/);
  if (m) {
    const agLabel = labelMap[m[1]] || m[1];
    if (m[2] === 'main') return agLabel + ' · 主干会话';
    if (m[2] === 'subagent') return agLabel + ' · 子任务执行';
    if (m[2] === 'cron') return agLabel + ' · 定时调度任务';
    return agLabel + ' · ' + m[2];
  }
  return title.replace(/ 会话$/, '') || t.id;
}

function channelLabel(t: Task): { icon: any; text: string; bg: string; color: string } {
  const now = t.now || '';
  if (now.includes('feishu/direct')) return { icon: MessageSquare, text: '飞书私聊', bg: 'bg-indigo-50', color: 'text-indigo-600' };
  if (now.includes('feishu')) return { icon: MessageSquare, text: '飞书群聊', bg: 'bg-blue-50', color: 'text-blue-600' };
  if (now.includes('webchat')) return { icon: Globe, text: '网页聊天', bg: 'bg-emerald-50', color: 'text-emerald-600' };
  if (now.includes('cron')) return { icon: Clock, text: '定时器', bg: 'bg-slate-100', color: 'text-slate-600' };
  if (now.includes('direct')) return { icon: Send, text: '同步分发', bg: 'bg-primary-50', color: 'text-primary-600' };
  return { icon: LinkIcon, text: '普通会话', bg: 'bg-slate-100', color: 'text-slate-500' };
}

function lastMessage(t: Task): string {
  const acts = t.activity || [];
  for (let i = acts.length - 1; i >= 0; i--) {
    const a = acts[i];
    if (a.kind === 'assistant') {
      let txt = a.text || '';
      if (txt.startsWith('NO_REPLY') || txt.startsWith('Reasoning:')) continue;
      txt = txt.replace(/\[\[.*?\]\]/g, '').replace(/\*\*/g, '').replace(/^#+\s/gm, '').trim();
      return txt.substring(0, 120) + (txt.length > 120 ? '…' : '');
    }
  }
  return '';
}

export default function SessionsPanel() {
  const liveStatus = useStore((s) => s.liveStatus);
  const sessFilter = useStore((s) => s.sessFilter);
  const setSessFilter = useStore((s) => s.setSessFilter);
  const { emojiMap, labelMap } = useAgentMaps();
  const [detailTask, setDetailTask] = useState<Task | null>(null);

  const tasks = liveStatus?.tasks || [];
  const sessions = tasks.filter((t) => !isEdict(t));

  let filtered = sessions;
  if (sessFilter === 'active') filtered = sessions.filter((t) => !['Completed', 'Cancelled'].includes(t.state));
  else if (sessFilter !== 'all') filtered = sessions.filter((t) => extractAgent(t) === sessFilter);

  // Unique agents for filter tabs
  const agentIds = [...new Set(sessions.map(extractAgent))].filter(Boolean);

  return (
    <div className="flex flex-col h-full space-y-6">
      {/* Filters */}
      <div className="flex items-center gap-2 pb-2 overflow-x-auto no-scrollbar border-b border-slate-200">
        {[
          { key: 'all', label: `所有会话 (${sessions.length})` },
          { key: 'active', label: '仅进行中' },
          ...agentIds.slice(0, 8).map((id) => ({ key: id, label: labelMap[id] || id })),
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setSessFilter(f.key)}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-semibold transition-all whitespace-nowrap",
              sessFilter === f.key 
                ? "bg-primary-600 text-white shadow-sm" 
                : "bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto min-h-0 pr-2 pb-6">
         {!filtered.length ? (
            <div className="flex flex-col items-center justify-center p-20 text-slate-400 opacity-70 bg-white rounded-2xl border border-dashed border-slate-200 h-64 mx-auto w-full max-w-2xl mt-10">
              <MessageSquare className="w-12 h-12 mb-4 text-slate-300" strokeWidth={1.5} />
              <p className="text-sm font-semibold uppercase tracking-widest">暂无进行中的会话</p>
            </div>
         ) : (
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
             {filtered.map((t) => {
               const agent = extractAgent(t);
               const emoji = emojiMap[agent] || '🏛️';
               const agLabel = labelMap[agent] || t.org || agent;
               const hb = t.heartbeat || { status: 'unknown' as const, label: '' };
               const ch = channelLabel(t);
               const title = humanTitle(t, labelMap);
               const msg = lastMessage(t);
               const sm = t.sourceMeta || {};
               const totalTk = (sm as Record<string, unknown>).totalTokens as number | undefined;
               const updatedAt = t.eta || '';
               const st = t.state || 'Unknown';

               return (
                 <div 
                   key={t.id} 
                   onClick={() => setDetailTask(t)}
                   className="panel p-4 flex flex-col hover:border-primary-300 hover:shadow-card cursor-pointer transition-all group"
                 >
                   <div className="flex items-start justify-between mb-3 gap-2">
                     <div className="flex items-center gap-3 min-w-0">
                       <div className="text-2xl w-10 h-10 flex items-center justify-center rounded-xl bg-slate-50 border border-slate-200 shrink-0 group-hover:scale-105 transition-transform shadow-sm">
                         {emoji}
                       </div>
                       <div className="min-w-0">
                         <div className="font-bold text-slate-800 truncate text-sm">{agLabel}</div>
                         <div className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded uppercase mt-0.5 w-fit flex items-center gap-1", ch.bg, ch.color)}>
                           <ch.icon className="w-3 h-3" /> {ch.text}
                         </div>
                       </div>
                     </div>

                     <div className="flex flex-col items-end gap-1 shrink-0">
                       <span className={cn(
                         "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border",
                         st === 'Completed' ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                         st === 'Executing' ? "bg-primary-50 text-primary-700 border-primary-200 animate-pulse" :
                         "bg-slate-50 text-slate-500 border-slate-200"
                       )}>
                         {STATE_LABEL[st] || st}
                       </span>
                        {hb.status === 'active' ? (
                          <span className="flex h-2.5 w-2.5 relative mt-1 mr-1">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                          </span>
                        ) : hb.status === 'stalled' ? (
                          <div className="w-2.5 h-2.5 rounded-full bg-red-500 mt-1 mr-1 shadow-sm" />
                        ) : null}
                     </div>
                   </div>

                   <h4 className="font-semibold text-slate-800 text-sm mb-2 line-clamp-2">{title}</h4>
                   
                   {msg ? (
                     <div className="text-xs text-slate-500 bg-slate-50 rounded-lg p-3 border border-slate-100 line-clamp-2 mb-4 leading-relaxed group-hover:bg-white transition-colors">
                       {msg}
                     </div>
                   ) : (
                     <div className="flex-1" />
                   )}

                   <div className="mt-auto flex items-center justify-between text-[11px] font-semibold text-slate-400 pt-3 border-t border-slate-100">
                     {totalTk ? <span className="flex items-center gap-1 text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100"><Database className="w-3 h-3" /> {totalTk.toLocaleString()}</span> : <span />}
                     <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {updatedAt ? timeAgo(updatedAt) : '刚刚'}</span>
                   </div>
                 </div>
               );
             })}
           </div>
         )}
      </div>

      {/* Session Detail Modal */}
      <AnimatePresence>
        {detailTask && (
          <SessionDetailModal task={detailTask} labelMap={labelMap} emojiMap={emojiMap} onClose={() => setDetailTask(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

function SessionDetailModal({
  task: t,
  labelMap,
  emojiMap,
  onClose,
}: {
  task: Task;
  labelMap: Record<string, string>;
  emojiMap: Record<string, string>;
  onClose: () => void;
}) {
  const agent = extractAgent(t);
  const emoji = emojiMap[agent] || '🏛️';
  const title = humanTitle(t, labelMap);
  const ch = channelLabel(t);
  const hb = t.heartbeat || { status: 'unknown' as const, label: '' };
  const sm = t.sourceMeta || {};
  const acts = t.activity || [];
  const st = t.state || 'Unknown';

  const totalTokens = (sm as Record<string, unknown>).totalTokens as number | undefined;
  const inputTokens = (sm as Record<string, unknown>).inputTokens as number | undefined;
  const outputTokens = (sm as Record<string, unknown>).outputTokens as number | undefined;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="relative w-full max-w-4xl max-h-[85vh] panel flex flex-col shadow-2xl bg-white" 
        onClick={(e) => e.stopPropagation()}
      >
        <header className="p-6 border-b border-slate-200 flex justify-between items-start bg-slate-50/50 rounded-t-xl shrink-0">
          <div className="pr-8">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-[10px] font-bold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded uppercase font-mono tracking-widest">{t.id}</span>
              <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded uppercase", ch.bg, ch.color)}>{ch.text}</span>
            </div>
            <h2 className="text-xl md:text-2xl font-bold text-slate-900 leading-tight flex items-center gap-3">
               <span className="p-1 px-1.5 bg-white border border-slate-200 rounded-lg shadow-sm text-2xl">{emoji}</span>
               {title}
            </h2>
            <div className="flex flex-wrap items-center gap-2 mt-4">
              <span className={cn(
                "text-[11px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider border shadow-sm",
                st === 'Completed' ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                st === 'Executing' ? "bg-primary-50 text-primary-700 border-primary-200" :
                "bg-white text-slate-600 border-slate-200"
              )}>
                {STATE_LABEL[st] || st}
              </span>
              {hb.label && <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200 shadow-sm flex items-center gap-1"><Activity className="w-3.5 h-3.5"/> {hb.label}</span>}
            </div>
          </div>
          <button className="w-8 h-8 flex items-center justify-center rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-500 transition-colors shadow-sm" onClick={onClose}>
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
          {/* Stats */}
          {(totalTokens != null || inputTokens != null || outputTokens != null) && (
            <div className="grid grid-cols-3 gap-4">
              {[
                { l: '消耗总计', v: totalTokens, c: 'text-primary-600', i: Database },
                { l: '输入', v: inputTokens, c: 'text-slate-700', i: AlignLeft },
                { l: '输出', v: outputTokens, c: 'text-indigo-600', i: Command },
              ].map((s, i) => s.v != null && (
                <div key={i} className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex flex-col items-center text-center shadow-sm">
                  <s.i className={cn("w-4 h-4 mb-2", s.c)} />
                  <div className={cn("text-xl md:text-2xl font-bold mb-1", s.c)}>{s.v.toLocaleString()}</div>
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{s.l}</div>
                </div>
              ))}
            </div>
          )}

          {/* Recent Activity */}
          <div className="flex-1 flex flex-col min-h-0">
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4 text-slate-400" /> 交互式日志 <span className="text-xs bg-slate-100 text-slate-500 px-2 rounded-full border border-slate-200 shadow-sm ml-1">{acts.length}</span>
            </h3>
            <div className="flex-1 bg-white border border-slate-200 rounded-xl overflow-y-auto shadow-inner no-scrollbar max-h-[400px]">
              {!acts.length ? (
                <div className="p-10 text-slate-400 text-sm font-medium flex flex-col items-center justify-center h-full opacity-70">
                  <BotMessageSquare className="w-10 h-10 mb-2 text-slate-300" strokeWidth={1} />
                  暂无交互历史记录
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {acts.slice().reverse().map((a, i) => {
                    const kind = a.kind || '';
                    const isAsst = kind === 'assistant';
                    const isTool = kind === 'tool';
                    const isUser = kind === 'user';
                    
                    return (
                      <div key={i} className={cn(
                        "p-5",
                        isAsst ? "bg-primary-50/30" : isUser ? "bg-white" : "bg-slate-50"
                      )}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className={cn(
                            "text-[10px] font-bold px-2 py-0.5 rounded uppercase flex items-center gap-1",
                            isAsst ? "bg-primary-100 text-primary-700" : isUser ? "bg-slate-200 text-slate-700" : "bg-slate-100 text-slate-500"
                          )}>
                            {isAsst ? <Bot className="w-3 h-3"/> : isUser ? <UserIcon/> : <Command className="w-3 h-3"/>}
                            {isAsst ? 'AI助手' : isUser ? '人类用户' : isTool ? '工具调用' : '系统事件'}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400 ml-auto bg-white px-1.5 rounded border border-slate-100">
                            {((a.at as string) || '').substring(11, 19)}
                          </span>
                        </div>
                        <div className="text-sm leading-relaxed text-slate-700 whitespace-pre-wrap word-break-all">
                          {a.text || <span className="italic text-slate-400">空载荷</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {t.output && t.output !== '-' && (
            <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs flex items-start gap-3">
              <Database className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="font-bold text-slate-700 mb-1">输出产物</div>
                <div className="text-slate-500 break-all font-mono">{t.output}</div>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function UserIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
  );
}
