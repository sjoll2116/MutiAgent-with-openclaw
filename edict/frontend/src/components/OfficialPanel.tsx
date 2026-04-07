import { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Users, 
  Trophy, 
  Cpu, 
  Target, 
  Search, 
  Filter, 
  ChevronRight, 
  Zap, 
  Activity,
  BarChart3,
  Coins,
  History as LogHistory
} from 'lucide-react';
import { useStore, STATE_LABEL } from '../store';
import { cn } from '../lib/utils';

const MEDALS = ['🥇', '🥈', '🥉'];

const CATEGORIES = [
  { id: 'all', label: 'All Clusters', icon: Users },
  { id: 'engineering', label: 'Engineering', icon: Target },
  { id: 'academic', label: 'Academic', icon: Zap },
  { id: 'marketing', label: 'Marketing', icon: BarChart3 },
  { id: 'legal', label: 'Legal/Judicial', icon: Activity },
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
      <div className="h-full flex flex-col items-center justify-center opacity-30">
        <Cpu className="w-12 h-12 mb-4 animate-spin-slow" />
        <p className="text-sm font-bold uppercase tracking-widest">Initializing Expert Clusters...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full space-y-6">
      {/* --- KPI Stats --- */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Active Experts', val: officialsData.officials.length, color: 'text-neon-cyan', icon: Users },
          { label: 'Tasks Completed', val: totals.tasks_done, color: 'text-neon-violet', icon: Target },
          { label: 'Total Cost (CNY)', val: `¥${totals.cost_cny}`, color: 'text-neon-ember', icon: Coins },
          { label: 'Top Performer', val: officialsData.top_official || 'None', color: 'text-white', icon: Trophy },
        ].map((kpi, i) => (
          <div key={i} className="glass-card p-4 rounded-2xl flex flex-col items-center text-center">
            <kpi.icon className={cn("w-4 h-4 mb-2 opacity-50", kpi.color)} />
            <div className={cn("text-2xl font-black tracking-tight", kpi.color)}>{kpi.val}</div>
            <div className="text-[10px] font-bold text-slate-muted uppercase tracking-wider mt-1">{kpi.label}</div>
          </div>
        ))}
      </div>

      {/* --- Control Bar --- */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="flex p-1 bg-obsidian-panel/60 rounded-xl border border-slate-line overflow-x-auto no-scrollbar max-w-full">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCat(cat.id)}
              className={cn(
                "px-4 py-1.5 rounded-lg text-xs font-bold transition-all duration-300 flex items-center gap-2 whitespace-nowrap",
                activeCat === cat.id 
                  ? "bg-white/10 text-neon-cyan shadow-sm" 
                  : "text-slate-muted hover:text-white"
              )}
            >
              <cat.icon className="w-3.5 h-3.5" />
              {cat.label}
            </button>
          ))}
        </div>
        
        <div className="relative w-full md:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-muted" />
          <input 
            type="text" 
            placeholder="Search experts..." 
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input-premium pl-10 w-full text-xs" 
          />
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 flex-1 overflow-hidden">
        {/* --- Expert Grid --- */}
        <div className="flex-1 overflow-y-auto pr-2 space-y-3 no-scrollbar">
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
                    "glass-card p-4 rounded-2xl flex items-center gap-4 cursor-pointer group transition-all",
                    isActive ? "neon-border-cyan bg-neon-cyan/5" : "hover:border-slate-muted/30"
                  )}
                >
                  <div className="w-12 h-12 rounded-xl bg-obsidian-full flex items-center justify-center text-2xl border border-white/5 relative">
                    {o.emoji}
                    {hb.status === 'active' && (
                      <div className="absolute -top-1 -right-1 w-3 h-3 bg-neon-cyan rounded-full border-2 border-obsidian-full shadow-neon-cyan animate-pulse" />
                    )}
                  </div>
                  
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                       <span className="text-xs font-black text-white">{o.role}</span>
                       <span className="text-[9px] font-bold text-slate-muted uppercase opacity-40">{o.id}</span>
                    </div>
                    <div className="text-[10px] text-slate-muted font-medium">{o.label}</div>
                  </div>

                  <div className="text-right">
                    <div className="text-sm font-black text-neon-violet">{o.merit_score}</div>
                    <div className="text-[9px] font-bold text-slate-muted uppercase tracking-tighter">Merit Pts</div>
                  </div>
                  
                  <ChevronRight className={cn("w-4 h-4 text-slate-muted transition-transform", isActive && "rotate-90 text-neon-cyan")} />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {/* --- Detail Panel --- */}
        <div className="w-full lg:w-96 glass-panel rounded-3xl p-6 overflow-y-auto no-scrollbar border border-white/5">
          {selectedOfficialData ? (
            <div className="space-y-8">
              {/* Profile Header */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[40px] mb-2">{selectedOfficialData.emoji}</div>
                  <h3 className="text-xl font-black text-white leading-tight">{selectedOfficialData.role}</h3>
                  <p className="text-xs text-slate-muted font-bold mt-1 uppercase tracking-wider">{selectedOfficialData.label}</p>
                </div>
                <div className="text-right">
                  <div className={cn(
                    "inline-block px-3 py-1 rounded-full text-[10px] font-black uppercase border",
                    selectedOfficialData.heartbeat?.status === 'active' 
                      ? "bg-neon-cyan/10 border-neon-cyan/30 text-neon-cyan" 
                      : "bg-slate-line/50 border-slate-line text-slate-muted"
                  )}>
                    {selectedOfficialData.heartbeat?.label || 'Standby'}
                  </div>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Tasks Done', val: selectedOfficialData.tasks_done, color: 'text-neon-cyan' },
                  { label: 'Active Tasks', val: selectedOfficialData.tasks_active, color: 'text-neon-violet' },
                  { label: 'Sessions', val: selectedOfficialData.sessions, color: 'text-white' },
                  { label: 'Rank', val: selectedOfficialData.rank, color: 'text-neon-ember' },
                ].map((stat, i) => (
                  <div key={i} className="bg-obsidian-full/50 p-3 rounded-xl border border-white/5">
                    <div className={cn("text-lg font-black", stat.color)}>{stat.val}</div>
                    <div className="text-[9px] font-bold text-slate-muted uppercase tracking-widest">{stat.label}</div>
                  </div>
                ))}
              </div>

              {/* Token Consumption */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-neon-cyan" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-muted">Token Telemetry</span>
                </div>
                <div className="space-y-3">
                  {[
                    { l: 'Input', v: selectedOfficialData.tokens_in, color: 'bg-neon-cyan' },
                    { l: 'Output', v: selectedOfficialData.tokens_out, color: 'bg-neon-violet' },
                  ].map((bar, i) => (
                    <div key={i} className="space-y-1">
                      <div className="flex justify-between text-[9px] font-bold text-slate-muted">
                        <span>{bar.l}</span>
                        <span>{bar.v.toLocaleString()}</span>
                      </div>
                      <div className="h-1 bg-obsidian-full rounded-full overflow-hidden">
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
              <div className="space-y-4">
                 <div className="flex items-center gap-2">
                  <LogHistory className="w-4 h-4 text-neon-violet" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-muted">Activity History</span>
                </div>
                <div className="space-y-2">
                  {selectedOfficialData.participated_edicts?.map(e => (
                    <div 
                      key={e.id}
                      onClick={() => setModalTaskId(e.id)}
                      className="p-3 bg-obsidian-full/30 rounded-xl border border-white/5 hover:border-neon-cyan/30 cursor-pointer transition-all flex items-center justify-between"
                    >
                      <div className="flex-1">
                        <div className="text-[10px] font-mono text-neon-cyan font-bold mb-0.5">{e.id}</div>
                        <div className="text-[11px] font-bold text-white line-clamp-1">{e.title}</div>
                      </div>
                      <span className={cn(
                        "text-[9px] px-2 py-0.5 rounded-full font-bold uppercase border ml-3",
                        e.state === 'Completed' ? "border-neon-cyan/20 text-neon-cyan" : "border-slate-line text-slate-muted"
                      )}>
                        {e.state}
                      </span>
                    </div>
                  ))}
                  {(!selectedOfficialData.participated_edicts || selectedOfficialData.participated_edicts.length === 0) && (
                    <div className="text-center py-6 border border-dashed border-slate-line rounded-2xl opacity-30 text-[10px] font-bold uppercase">
                      No Records Yet
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-muted/30">
              <Users className="w-12 h-12 mb-4" />
              <p className="text-[10px] font-bold uppercase tracking-widest">Select an Expert</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
