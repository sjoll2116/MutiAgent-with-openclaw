import { useEffect, useState, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Sun, 
  Settings, 
  RefreshCcw, 
  Newspaper, 
  Globe, 
  TrendingUp, 
  Hash, 
  Link as LinkIcon, 
  Plus, 
  Trash2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Zap,
  LayoutGrid,
  Clock
} from 'lucide-react';
import { useStore } from '../store';
import { api } from '../api';
import type { SubConfig, MorningNewsItem } from '../api';
import { cn } from '../lib/utils';

const CAT_META: Record<string, { icon: string; color: string; desc: string }> = {
  '政治': { icon: '🏛️', color: 'text-neon-cyan', desc: 'Global Politics' },
  '军事': { icon: '⚔️', color: 'text-neon-glitch', desc: 'Military Affairs' },
  '经济': { icon: '💹', color: 'text-neon-ember', desc: 'Economy & Markets' },
  'AI大模型': { icon: '🤖', color: 'text-neon-violet', desc: 'AI & LLM Evolution' },
};

const DEFAULT_CATS = ['政治', '军事', '经济', 'AI大模型'];

export default function MorningPanel() {
  const morningBrief = useStore((s) => s.morningBrief);
  const subConfig = useStore((s) => s.subConfig);
  const loadMorning = useStore((s) => s.loadMorning);
  const loadSubConfig = useStore((s) => s.loadSubConfig);
  const toast = useStore((s) => s.toast);

  const [showConfig, setShowConfig] = useState(false);
  const [localConfig, setLocalConfig] = useState<SubConfig | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    loadMorning();
    loadSubConfig();
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, [loadMorning, loadSubConfig]);

  useEffect(() => {
    if (subConfig) setLocalConfig(JSON.parse(JSON.stringify(subConfig)));
  }, [subConfig]);

  const refreshNews = async () => {
    setRefreshing(true);
    try {
      await api.refreshMorning();
      toast('✅ News gathering sequence initiated');
      // Simple timeout for refreshing state
      setTimeout(() => {
        setRefreshing(false);
        loadMorning();
      }, 5000);
    } catch {
      toast('Gathering failed', 'err');
      setRefreshing(false);
    }
  };

  const cats = morningBrief?.categories || {};
  const totalNews = Object.values(cats).flat().length;
  const enabledCats = localConfig?.categories?.filter(c => c.enabled).map(c => c.name) || DEFAULT_CATS;

  return (
    <div className="flex flex-col h-full space-y-6">
      {/* --- Bento Grid Header Section --- */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 h-fit">
        
        {/* Main Status Bento (6 cols) */}
        <div className="md:col-span-8 glass-panel p-8 rounded-3xl relative overflow-hidden group border border-white/5 bg-gradient-to-br from-obsidian-panel to-black">
          <div className="absolute top-[-20%] right-[-10%] w-64 h-64 bg-neon-cyan/10 rounded-full blur-[80px] group-hover:bg-neon-cyan/20 transition-all duration-1000" />
          
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-6">
               <div className="p-2 bg-neon-cyan/20 rounded-xl">
                 <Sun className="w-6 h-6 text-neon-cyan" />
               </div>
               <h2 className="text-3xl font-black text-white tracking-tight uppercase">Morning Nexus Brief</h2>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
               <div className="space-y-1">
                 <p className="sub-title">Intelligence Flow</p>
                 <p className="text-xl font-black text-white">{totalNews} <span className="text-xs text-slate-muted">Entries</span></p>
               </div>
               <div className="space-y-1">
                 <p className="sub-title">Last Ingest</p>
                 <p className="text-sm font-black text-neon-cyan uppercase">{morningBrief?.generated_at?.split(' ')[1] || '08:00:00'}</p>
               </div>
               <div className="space-y-1">
                 <p className="sub-title">Feed Status</p>
                 <div className="flex items-center gap-2">
                   <div className="w-2 h-2 rounded-full bg-neon-cyan shadow-neon-cyan animate-pulse" />
                   <p className="text-xs font-bold text-white uppercase tracking-widest">Global Sync</p>
                 </div>
               </div>
               <div className="flex justify-end items-end">
                 <button 
                  onClick={refreshNews}
                  disabled={refreshing}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-xl border border-neon-cyan/30 text-neon-cyan font-bold text-xs uppercase tracking-widest hover:bg-neon-cyan/10 transition-all",
                    refreshing && "opacity-50 cursor-not-allowed"
                  )}
                 >
                   <RefreshCcw className={cn("w-4 h-4", refreshing && "animate-spin")} />
                   {refreshing ? 'Syncing...' : 'Sync Global'}
                 </button>
               </div>
            </div>
          </div>
        </div>

        {/* Clock Bento (4 cols) */}
        <div className="md:col-span-4 glass-panel p-8 rounded-3xl flex flex-col items-center justify-center border border-white/5 bg-black/40">
           <div className="p-3 bg-neon-violet/20 rounded-2xl mb-4">
             <Clock className="w-8 h-8 text-neon-violet" />
           </div>
           <p className="text-4xl font-black text-white tracking-tighter mb-2">
             {currentTime.toLocaleTimeString('en-US', { hour12: false })}
           </p>
           <p className="text-xs font-bold text-slate-muted uppercase tracking-[0.3em]">
             {currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
           </p>
        </div>
      </div>

      {/* --- Main Content Layout --- */}
      <div className="flex flex-col lg:flex-row gap-6 flex-1 overflow-hidden">
        
        {/* News Feed --- */}
        <div className="flex-1 overflow-y-auto pr-2 space-y-10 no-scrollbar pb-20">
          <AnimatePresence mode="popLayout">
            {Object.entries(cats).map(([cat, items]) => {
              if (!enabledCats.includes(cat)) return null;
              const meta = CAT_META[cat] || { icon: '📰', color: 'text-slate-muted', desc: cat };
              
              return (
                <motion.section 
                  layout
                  key={cat}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <div className="flex items-center gap-4 px-2">
                    <span className="text-2xl">{meta.icon}</span>
                    <h3 className={cn("text-lg font-black uppercase tracking-widest", meta.color)}>{cat}</h3>
                    <div className="h-px flex-1 bg-white/5" />
                    <span className="text-[10px] font-bold text-slate-muted uppercase tracking-wider">{items.length} Bulletins</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {(items as MorningNewsItem[]).map((news, idx) => (
                      <motion.div
                        key={idx}
                        whileHover={{ y: -4, scale: 1.01 }}
                        className="glass-card p-5 rounded-2xl cursor-pointer group flex flex-col justify-between"
                        onClick={() => window.open(news.link, '_blank')}
                      >
                         <div className="flex gap-4">
                            {news.image && news.image.startsWith('http') && (
                              <div className="w-16 h-16 rounded-xl overflow-hidden shrink-0 border border-white/5">
                                <img src={news.image} alt="" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                              </div>
                            )}
                            <div className="flex-1 space-y-2">
                               <h4 className="text-sm font-bold text-white leading-snug group-hover:text-neon-cyan transition-colors">
                                 {news.title}
                               </h4>
                               <p className="text-[11px] text-slate-muted line-clamp-2 leading-relaxed">
                                 {news.summary || news.desc}
                               </p>
                            </div>
                         </div>
                         <div className="mt-4 flex items-center justify-between pt-4 border-t border-white/5">
                           <span className="text-[9px] font-bold text-neon-violet uppercase flex items-center gap-1.5">
                             <Globe className="w-3 h-3" /> {news.source}
                           </span>
                           <span className="text-[9px] font-mono text-slate-muted">{news.pub_date?.substring(11, 16)}</span>
                         </div>
                      </motion.div>
                    ))}
                  </div>
                </motion.section>
              );
            })}
          </AnimatePresence>
        </div>

        {/* Sidebar Controls --- */}
        <aside className="w-full lg:w-80 space-y-6">
          <div className="glass-panel p-6 rounded-3xl border border-white/5 space-y-6">
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-neon-cyan" />
              <h4 className="sub-title !mb-0">Intelligence Filters</h4>
            </div>

            {/* Category Toggles */}
            <div className="space-y-4">
               <p className="text-[9px] font-black text-slate-muted uppercase tracking-[0.2em]">Active Channels</p>
               <div className="flex flex-wrap gap-2">
                  {Object.keys(CAT_META).map(catName => {
                    const active = enabledCats.includes(catName);
                    return (
                      <button 
                        key={catName}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all border",
                          active ? "bg-neon-cyan/10 border-neon-cyan/40 text-neon-cyan" : "bg-white/5 border-white/5 text-slate-muted opacity-40 hover:opacity-100"
                        )}
                      >
                        {catName}
                      </button>
                    )
                  })}
               </div>
            </div>

            {/* News Feed Management */}
            <div className="space-y-4">
               <p className="text-[9px] font-black text-slate-muted uppercase tracking-[0.2em]">Custom Sources</p>
               <div className="space-y-2 max-h-48 overflow-y-auto no-scrollbar pr-2">
                 {localConfig?.custom_feeds?.map((f, i) => (
                   <div key={i} className="p-3 bg-black/40 rounded-xl border border-white/5 flex items-center justify-between group">
                      <div className="flex-1 truncate">
                        <p className="text-[10px] font-bold text-white truncate">{f.name}</p>
                        <p className="text-[8px] text-slate-muted truncate">{f.url}</p>
                      </div>
                      <button className="p-1 opacity-0 group-hover:opacity-100 text-neon-glitch transition-opacity">
                        <Trash2 className="w-3 h-3" />
                      </button>
                   </div>
                 ))}
               </div>
               <button className="w-full py-2 rounded-xl border border-dashed border-slate-line text-[10px] font-bold uppercase tracking-widest text-slate-muted hover:text-white hover:border-slate-muted transition-all">
                  + Integrate New Source
               </button>
            </div>
            
            <div className="pt-4 border-t border-white/5">
               <button className="w-full btn-premium btn-cyan text-xs">
                 Commit Filter Sync
               </button>
            </div>
          </div>

          {/* Quick Metrics Card */}
          <div className="glass-panel p-6 rounded-3xl border border-white/5 bg-gradient-to-br from-neon-violet/10 to-transparent">
             <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-4 h-4 text-neon-violet" />
                <span className="text-[9px] font-black uppercase tracking-widest text-white">MAS Global Trend</span>
             </div>
             <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black text-white">+24.5%</span>
                <span className="text-[10px] font-bold text-neon-cyan uppercase">Processing Efficiency</span>
             </div>
             <p className="text-[10px] text-slate-muted mt-4 leading-relaxed font-medium">
               Multi-agent cluster achieved peak utilization during 0800-0900 UTC sync window. No stalls detected.
             </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
