import { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Users, 
  Trophy, 
  Cpu, 
  Target, 
  Search, 
  ChevronRight, 
  Zap, 
  Activity,
  BarChart3,
  Coins,
  History as LogHistory
} from 'lucide-react';
import { useStore } from '../store';
import { cn } from '../lib/utils';

const CATEGORIES = [
  { id: 'all', label: '所有集群', icon: Users },
  { id: 'engineering', label: '工程开发', icon: Target },
  { id: 'academic', label: '理论学术', icon: Zap },
  { id: 'marketing', label: '市场营销', icon: BarChart3 },
  { id: 'legal', label: '法律合规', icon: Activity },
];

export default function OfficialPanel() {
  const officialsData = useStore((s) => s.officialsData);
  const selectedOfficial = useStore((s) => s.selectedOfficial);
  const setSelectedOfficial = useStore((s) => s.setSelectedOfficial);
  const loadOfficials = useStore((s) => s.loadOfficials);
  const setModalTaskId = useStore((s) => s.setModalTaskId);

  const [activeCat, setActiveCat] = useState('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadOfficials();
  }, [loadOfficials]);

  const offs = useMemo(() => {
    if (!officialsData?.officials) return [];
    return officialsData.officials.filter(o => {
      const matchesSearch = o.role.toLowerCase().includes(search.toLowerCase()) || 
                           o.label.toLowerCase().includes(search.toLowerCase());
      if (activeCat === 'all') return matchesSearch;
      return o.id.includes(activeCat) && matchesSearch;
    });
  }, [officialsData, activeCat, search]);

  const totals = officialsData?.totals || { tasks_done: 0, cost_cny: 0 };
  const maxTk = Math.max(...(officialsData?.officials?.map(o => o.tokens_in + o.tokens_out) || [1]), 1);
  const selId = selectedOfficial || offs[0]?.id;
  const selectedOfficialData = officialsData?.officials?.find(o => o.id === selId);

  if (!officialsData?.officials) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-400 opacity-60">
        <Cpu className="w-12 h-12 mb-4 animate-[spin_3s_linear_infinite]" />
        <p className="text-sm font-semibold uppercase tracking-widest">正在初始化专家集群...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full space-y-6">
      {/* --- KPI Stats --- */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: '活跃专家', val: officialsData.officials.length, color: 'text-primary-600', bg: 'bg-primary-50', icon: Users },
          { label: '完成任务数', val: totals.tasks_done, color: 'text-indigo-600', bg: 'bg-indigo-50', icon: Target },
          { label: '总消耗 (CNY)', val: `¥${totals.cost_cny}`, color: 'text-emerald-600', bg: 'bg-emerald-50', icon: Coins },
          { label: '最佳执行者', val: officialsData.top_official || '无', color: 'text-amber-600', bg: 'bg-amber-50', icon: Trophy },
        ].map((kpi, i) => (
          <div key={i} className="panel p-5 flex flex-col items-center text-center">
            <div className={cn("p-2.5 rounded-xl mb-3", kpi.bg)}>
              <kpi.icon className={cn("w-5 h-5", kpi.color)} />
            </div>
            <div className={cn("text-2xl font-bold tracking-tight mb-1 slate-800")}>{kpi.val}</div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{kpi.label}</div>
          </div>
        ))}
      </div>

      {/* --- Control Bar --- */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="flex p-1 bg-slate-100 rounded-xl border border-slate-200 overflow-x-auto no-scrollbar max-w-full">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCat(cat.id)}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 flex items-center gap-2 whitespace-nowrap",
                activeCat === cat.id 
                  ? "bg-white text-primary-700 shadow-sm border border-slate-200 border-b-slate-300" 
                  : "text-slate-500 hover:text-slate-800"
              )}
            >
              <cat.icon className="w-4 h-4" />
              {cat.label}
            </button>
          ))}
        </div>
        
        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input 
            type="text" 
            placeholder="搜索专家..." 
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input-field pl-10" 
          />
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0">
        {/* --- Expert Grid --- */}
        <div className="flex-1 overflow-y-auto pr-2 space-y-3 no-scrollbar pb-6">
          <AnimatePresence mode="popLayout">
            {offs.map((o) => {
              const hb = o.heartbeat || { status: 'idle' };
              const isActive = selId === o.id;
              return (
                <motion.div
                  layout
                  key={o.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  onClick={() => setSelectedOfficial(o.id)}
                  className={cn(
                    "panel p-4 flex items-center gap-4 cursor-pointer group transition-all",
                    isActive ? "border-primary-300 bg-primary-50/50 shadow-md ring-1 ring-primary-100" : "hover:border-primary-300 hover:shadow-card"
                  )}
                >
                  <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-2xl border border-slate-200 relative group-hover:scale-105 transition-transform shrink-0">
                    {o.emoji}
                    {hb.status === 'active' && (
                      <div className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white shadow-sm animate-pulse" />
                    )}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                       <span className="text-sm font-bold text-slate-800 truncate">{o.role}</span>
                       <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded uppercase shrink-0">{o.id}</span>
                    </div>
                    <div className="text-xs text-slate-500 font-medium truncate">{o.label}</div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="text-base font-bold text-indigo-600">{o.merit_score}</div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">贡献点</div>
                  </div>
                  
                  <ChevronRight className={cn("w-5 h-5 text-slate-300 transition-transform shrink-0", isActive && "rotate-90 text-primary-500")} />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {/* --- Detail Panel --- */}
        <div className="w-full lg:w-[400px] panel p-6 overflow-y-auto no-scrollbar flex flex-col shrink-0">
          {selectedOfficialData ? (
            <div className="space-y-8">
              {/* Profile Header */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-5xl mb-3 p-3 bg-slate-50 border border-slate-100 rounded-2xl inline-block shadow-sm">
                    {selectedOfficialData.emoji}
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 leading-tight">{selectedOfficialData.role}</h3>
                  <p className="text-xs text-slate-500 font-semibold mt-1 uppercase tracking-wider">{selectedOfficialData.label}</p>
                </div>
                <div className="text-right">
                  <div className={cn(
                    "inline-block px-3 py-1 rounded-full text-xs font-bold uppercase border",
                    selectedOfficialData.heartbeat?.status === 'active' 
                      ? "bg-emerald-50 border-emerald-200 text-emerald-700 shadow-sm" 
                      : "bg-slate-100 border-slate-200 text-slate-500"
                  )}>
                    {selectedOfficialData.heartbeat?.label || '待命'}
                  </div>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: '已完成任务', val: selectedOfficialData.tasks_done, color: 'text-primary-600' },
                  { label: '进行中任务', val: selectedOfficialData.tasks_active, color: 'text-indigo-600' },
                  { label: '会话数', val: selectedOfficialData.sessions, color: 'text-emerald-600' },
                  { label: '职级', val: selectedOfficialData.rank, color: 'text-amber-600' },
                ].map((stat, i) => (
                  <div key={i} className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <div className={cn("text-xl font-bold mb-1", stat.color)}>{stat.val}</div>
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{stat.label}</div>
                  </div>
                ))}
              </div>

              {/* Token Consumption */}
              <div className="space-y-4 pt-4 border-t border-slate-100">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-primary-500" />
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-700">Token 消耗遥测</span>
                </div>
                <div className="space-y-4">
                  {[
                    { l: '输入', v: selectedOfficialData.tokens_in, color: 'bg-primary-500' },
                    { l: '输出', v: selectedOfficialData.tokens_out, color: 'bg-indigo-500' },
                  ].map((bar, i) => (
                    <div key={i} className="space-y-1.5">
                      <div className="flex justify-between text-xs font-medium text-slate-600">
                        <span>{bar.l}</span>
                        <span className="font-bold text-slate-800">{bar.v.toLocaleString()}</span>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200/50">
                        <div 
                          className={cn("h-full rounded-full transition-all duration-1000", bar.color)} 
                          style={{ width: `${(bar.v / maxTk) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent Participations */}
              <div className="space-y-4 pt-4 border-t border-slate-100">
                 <div className="flex items-center gap-2">
                  <LogHistory className="w-4 h-4 text-indigo-500" />
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-700">活动历史记录</span>
                </div>
                <div className="space-y-3">
                  {selectedOfficialData.participated_edicts?.map(e => (
                    <div 
                      key={e.id}
                      onClick={() => setModalTaskId(e.id)}
                      className="p-4 bg-white rounded-xl border border-slate-200 hover:border-primary-300 hover:shadow-subtle cursor-pointer transition-all flex items-center justify-between group"
                    >
                      <div className="flex-1 pr-4">
                        <div className="text-[10px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded w-fit mb-1.5 font-semibold group-hover:text-primary-600 transition-colors">{e.id}</div>
                        <div className="text-sm font-semibold text-slate-800 line-clamp-1">{e.title}</div>
                      </div>
                      <span className={cn(
                        "text-[10px] px-2.5 py-1 rounded-full font-bold uppercase border shrink-0",
                        e.state === 'Completed' ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-slate-50 border-slate-200 text-slate-500"
                      )}>
                        {e.state}
                      </span>
                    </div>
                  ))}
                  {(!selectedOfficialData.participated_edicts || selectedOfficialData.participated_edicts.length === 0) && (
                    <div className="text-center py-8 border border-dashed border-slate-300 rounded-xl bg-slate-50 text-slate-400 text-sm font-medium">
                      暂无记录
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 opacity-60">
              <Users className="w-16 h-16 mb-4 text-slate-300" strokeWidth={1} />
              <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">选择一个专家智能体</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
