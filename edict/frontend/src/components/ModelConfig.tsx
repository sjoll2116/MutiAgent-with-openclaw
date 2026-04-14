import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import { cn } from '../lib/utils';
import { Cpu, Server, History, CheckCircle2, XCircle, RotateCcw } from 'lucide-react';

const FALLBACK_MODELS = [
  { id: 'anthropic/claude-sonnet-4-6', l: 'Claude Sonnet 4.6', p: 'Anthropic' },
  { id: 'anthropic/claude-opus-4-5', l: 'Claude Opus 4.5', p: 'Anthropic' },
  { id: 'anthropic/claude-haiku-3-5', l: 'Claude Haiku 3.5', p: 'Anthropic' },
  { id: 'openai/gpt-4o', l: 'GPT-4o', p: 'OpenAI' },
  { id: 'openai/gpt-4o-mini', l: 'GPT-4o Mini', p: 'OpenAI' },
  { id: 'google/gemini-2.5-pro', l: 'Gemini 2.5 Pro', p: 'Google' },
];

export default function ModelConfig() {
  const agentConfig = useStore((s) => s.agentConfig);
  const changeLog = useStore((s) => s.changeLog);
  const loadAgentConfig = useStore((s) => s.loadAgentConfig);
  const toast = useStore((s) => s.toast);

  const [selMap, setSelMap] = useState<Record<string, string>>({});
  const [statusMap, setStatusMap] = useState<Record<string, { cls: 'pending' | 'ok' | 'err'; text: string }>>({});

  useEffect(() => {
    loadAgentConfig();
  }, [loadAgentConfig]);

  useEffect(() => {
    if (agentConfig?.agents) {
      const m: Record<string, string> = {};
      agentConfig.agents.forEach((ag) => {
        m[ag.id] = ag.model;
      });
      setSelMap(m);
    }
  }, [agentConfig]);

  if (!agentConfig?.agents) {
    return (
      <div className="flex flex-col items-center justify-center p-20 text-slate-400 opacity-60 bg-white rounded-3xl border border-slate-200 shadow-sm">
        <Server className="w-12 h-12 mb-4" />
        <p className="text-sm font-semibold uppercase tracking-widest">等待服务器响应...</p>
      </div>
    );
  }

  const models = agentConfig.knownModels?.length
    ? agentConfig.knownModels.map((m) => ({ id: m.id, l: m.label, p: m.provider }))
    : FALLBACK_MODELS;

  const handleSelect = (agentId: string, val: string) => {
    setSelMap((p) => ({ ...p, [agentId]: val }));
  };

  const resetMC = (agentId: string) => {
    const ag = agentConfig.agents.find((a) => a.id === agentId);
    if (ag) setSelMap((p) => ({ ...p, [agentId]: ag.model }));
  };

  const applyModel = async (agentId: string) => {
    const model = selMap[agentId];
    if (!model) return;
    setStatusMap((p) => ({ ...p, [agentId]: { cls: 'pending', text: '⟳ 正在提交...' } }));
    try {
      const r = await api.setModel(agentId, model);
      if (r.ok) {
        setStatusMap((p) => ({ ...p, [agentId]: { cls: 'ok', text: '✅ 部署成功，网关重启中 (5秒)' } }));
        toast(agentId + ' 模型已更新', 'ok');
        setTimeout(() => loadAgentConfig(), 5500);
      } else {
        setStatusMap((p) => ({ ...p, [agentId]: { cls: 'err', text: '❌ ' + (r.error || '未知错误') } }));
      }
    } catch {
      setStatusMap((p) => ({ ...p, [agentId]: { cls: 'err', text: '❌ 无法连接' } }));
    }
  };

  return (
    <div className="space-y-8 max-w-6xl">
      <div className="flex items-center gap-3 border-b border-slate-200 pb-4">
        <Cpu className="w-6 h-6 text-indigo-500" />
        <div>
          <h2 className="text-lg font-bold text-slate-800">专家模型配给中心</h2>
          <p className="text-xs text-slate-500 mt-0.5">为系统内的智能体集群动态指派基座大模型</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {agentConfig.agents.map((ag) => {
          const sel = selMap[ag.id] || ag.model;
          const changed = sel !== ag.model;
          const st = statusMap[ag.id];
          return (
            <div className="panel p-5 flex flex-col" key={ag.id}>
              <div className="flex items-start gap-4 mb-5 border-b border-slate-100 pb-4">
                <div className="w-12 h-12 flex items-center justify-center text-3xl bg-slate-50 rounded-xl border border-slate-200 shadow-sm shrink-0">
                  {ag.emoji || '🏛️'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="text-sm font-bold text-slate-800 truncate">{ag.label}</div>
                    <div className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded uppercase">{ag.id}</div>
                  </div>
                  <div className="text-xs text-slate-500 font-medium truncate">{ag.role}</div>
                </div>
              </div>
              
              <div className="space-y-3 flex-1">
                <div>
                  <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">当前在用模型</div>
                  <div className="text-sm font-semibold text-primary-700 bg-primary-50 px-3 py-1.5 rounded-lg border border-primary-100 line-clamp-1">
                    {ag.model}
                  </div>
                </div>

                <div>
                   <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 mt-4">覆写配置</div>
                   <select 
                     className="input-field w-full cursor-pointer focus:ring-primary-500/30" 
                     value={sel} 
                     onChange={(e) => handleSelect(ag.id, e.target.value)}
                   >
                     {models.map((m) => (
                       <option key={m.id} value={m.id}>
                         {m.l} ({m.p})
                       </option>
                     ))}
                   </select>
                </div>
              </div>

              <div className="mt-5 pt-4 border-t border-slate-100 flex items-center gap-3">
                <button 
                  className={cn("flex-1 px-4 py-2 text-sm font-semibold rounded-lg transition-colors flex justify-center", 
                    changed ? "bg-primary-600 text-white hover:bg-primary-700 shadow-sm" : "bg-slate-100 text-slate-400 cursor-not-allowed"
                  )} 
                  disabled={!changed} 
                  onClick={() => applyModel(ag.id)}
                >
                  应用覆写设定
                </button>
                <button 
                  className="p-2 bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 rounded-lg transition-colors disabled:opacity-50" 
                  disabled={!changed}
                  onClick={() => resetMC(ag.id)}
                  title="重置为当前模型"
                >
                  <RotateCcw className="w-5 h-5" />
                </button>
              </div>
              
              {st && (
                <div className={cn("mt-3 text-xs font-semibold px-3 py-2 rounded-lg text-center break-words", 
                  st.cls === 'ok' ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : 
                  st.cls === 'err' ? "bg-red-50 text-red-600 border border-red-100" : 
                  "bg-amber-50 text-amber-600 border border-amber-100"
                )}>
                  {st.text}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Change Log */}
      <div className="panel p-6 mt-8 max-w-4xl">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-4 uppercase tracking-wider">
          <History className="w-4 h-4 text-slate-400" />
          模型分配历史记录
        </h3>
        
        <div className="space-y-0 relative border-l border-slate-200 ml-2 pl-4">
          {!changeLog?.length ? (
            <div className="text-sm text-slate-400 italic py-4">近期暂无模型变更记录。</div>
          ) : (
            [...changeLog]
              .reverse()
              .slice(0, 15)
              .map((e, i) => (
                <div className="relative py-4 group" key={i}>
                  <div className="absolute -left-[21px] top-[22px] w-2.5 h-2.5 rounded-full bg-slate-300 group-hover:bg-primary-400 transition-colors border-2 border-white" />
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6">
                     <span className="text-xs font-mono text-slate-500 w-36 shrink-0 mt-0.5">{(e.at || '').substring(0, 16).replace('T', ' ')}</span>
                     <span className="text-[11px] font-bold bg-slate-100 px-2 py-0.5 rounded text-slate-600 uppercase tracking-widest shrink-0 w-24 text-center">{e.agentId}</span>
                     
                     <div className="flex items-center gap-2 flex-1 flex-wrap text-sm">
                       <span className="font-medium text-slate-600 truncate max-w-[150px]" title={e.oldModel}>{e.oldModel}</span>
                       <span className="text-slate-300">→</span>
                       <span className="font-bold text-primary-700 truncate max-w-[150px]" title={e.newModel}>{e.newModel}</span>
                       
                       {e.rolledBack && (
                         <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded uppercase tracking-wider">
                           <XCircle className="w-3 h-3" />
                           发生回滚
                         </span>
                       )}
                     </div>
                  </div>
                </div>
              ))
          )}
        </div>
      </div>
    </div>
  );
}
