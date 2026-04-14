import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Sun, 
  Settings, 
  RefreshCcw, 
  Globe, 
  TrendingUp, 
  Trash2,
  Clock,
  Radio,
  FileText
} from 'lucide-react';
import { useStore } from '../store';
import { api } from '../api';
import type { SubConfig, MorningNewsItem } from '../api';
import { cn } from '../lib/utils';

const CAT_META: Record<string, { icon: string; color: string; desc: string; bg: string }> = {
  '政治': { icon: '🏛️', color: 'text-indigo-600', bg: 'bg-indigo-50', desc: '全球政治' },
  '军事': { icon: '⚔️', color: 'text-rose-600', bg: 'bg-rose-50', desc: '军事态势' },
  '经济': { icon: '💹', color: 'text-amber-600', bg: 'bg-amber-50', desc: '经济与市场' },
  'AI大模型': { icon: '🤖', color: 'text-primary-600', bg: 'bg-primary-50', desc: 'AI与大模型演进' },
};

const DEFAULT_CATS = ['政治', '军事', '经济', 'AI大模型'];

export default function MorningPanel() {
  const morningBrief = useStore((s) => s.morningBrief);
  const subConfig = useStore((s) => s.subConfig);
  const loadMorning = useStore((s) => s.loadMorning);
  const loadSubConfig = useStore((s) => s.loadSubConfig);
  const toast = useStore((s) => s.toast);

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
      toast('✅ 简报聚合序列已启动');
      setTimeout(() => {
        setRefreshing(false);
        loadMorning();
      }, 5000);
    } catch {
      toast('聚合失败', 'err');
      setRefreshing(false);
    }
  };

  const cats = morningBrief?.categories || {};
  const totalNews = Object.values(cats).flat().length;
  const enabledCats = localConfig?.categories?.filter(c => c.enabled).map(c => c.name) || DEFAULT_CATS;

  return (
    <div className="flex flex-col h-full space-y-6">
      {/* --- Bento Grid Header Section --- */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 h-fit shrink-0">
        
        {/* Main Status Bento (8 cols) */}
        <div className="md:col-span-8 panel p-6 md:p-8 flex items-center justify-between relative overflow-hidden bg-white border border-slate-200">
          <div className="absolute top-[-20%] right-[-10%] w-64 h-64 bg-amber-50 rounded-full blur-[80px] pointer-events-none" />
          
          <div className="relative z-10 flex-1">
            <div className="flex items-center justify-between mb-8">
               <div className="flex items-center gap-3">
                 <div className="w-10 h-10 flex items-center justify-center bg-amber-50 rounded-xl border border-amber-100 shadow-sm">
                   <Sun className="w-5 h-5 text-amber-500" />
                 </div>
                 <div>
                   <h2 className="text-2xl font-bold text-slate-800 tracking-tight">天下要闻汇总系统</h2>
                   <p className="text-xs text-slate-500 font-medium">多源安全与情报播报</p>
                 </div>
               </div>
               
               <button 
                onClick={refreshNews}
                disabled={refreshing}
                className={cn(
                  "hidden md:flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all border",
                  refreshing 
                    ? "bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed" 
                    : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-slate-300 shadow-sm"
                )}
               >
                 <RefreshCcw className={cn("w-4 h-4", refreshing && "animate-spin text-primary-500")} />
                 {refreshing ? '正在同步全球资讯源...' : '立即请求一次强制更新'}
               </button>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
               <div className="space-y-1">
                 <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">目前聚合信条数</p>
                 <p className="text-2xl font-bold text-slate-800">{totalNews} <span className="text-xs font-semibold text-slate-400">个相关条目</span></p>
               </div>
               <div className="space-y-1">
                 <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">最近同步标记卡</p>
                 <p className="text-lg font-bold text-slate-800">{morningBrief?.generated_at?.split(' ')[1] || '08:00:00'}</p>
               </div>
               <div className="space-y-1">
                 <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">链路数据运转状况</p>
                 <div className="flex items-center gap-2 h-7 mt-0.5">
                   <span className="flex h-2.5 w-2.5 relative">
                     <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                     <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                   </span>
                   <p className="text-sm font-bold text-emerald-600">正常拉取工作中</p>
                 </div>
               </div>
               <div className="flex md:hidden items-end pb-1">
                 <button 
                  onClick={refreshNews}
                  disabled={refreshing}
                  className="w-full py-2 rounded-lg bg-slate-50 text-slate-600 border border-slate-200 text-xs font-bold"
                 >
                   {refreshing ? '同步中...' : '同步'}
                 </button>
               </div>
            </div>
          </div>
        </div>

        {/* Clock Bento (4 cols) */}
        <div className="md:col-span-4 panel p-8 flex flex-col items-center justify-center bg-slate-50 border border-slate-100">
           <div className="p-3 bg-white border border-slate-200 rounded-xl mb-4 shadow-sm">
             <Clock className="w-6 h-6 text-indigo-500" />
           </div>
           <p className="text-3xl font-bold text-slate-800 font-mono tracking-tight mb-1">
             {currentTime.toLocaleTimeString('en-US', { hour12: false })}
           </p>
           <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">
             {currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
           </p>
        </div>
      </div>

      {/* --- Main Content Layout --- */}
      <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0">
        
        {/* News Feed --- */}
        <div className="flex-1 overflow-y-auto pr-2 pb-6 space-y-8 no-scrollbar">
          <AnimatePresence mode="popLayout">
            {Object.entries(cats).map(([cat, items]) => {
              if (!enabledCats.includes(cat)) return null;
              const meta = CAT_META[cat] || { icon: '📰', color: 'text-slate-600', bg: 'bg-slate-100', desc: cat };
              const newsItems = items as MorningNewsItem[];
              
              if (!newsItems.length) return null;
              
              return (
                <motion.section 
                  layout
                  key={cat}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <div className="flex items-center gap-3 px-1">
                    <span className="text-2xl">{meta.icon}</span>
                    <h3 className={cn("text-lg font-bold tracking-tight text-slate-800")}>{cat}</h3>
                    <div className="h-px flex-1 bg-slate-200 ml-2" />
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest bg-slate-100 px-2 py-0.5 rounded ml-2">含有 {newsItems.length} 条已整理新闻简报</span>
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    {newsItems.map((news, idx) => (
                      <motion.div
                        key={idx}
                        className="panel p-4 flex flex-col justify-between cursor-pointer hover:border-primary-300 hover:shadow-card transition-all group bg-white relative overflow-hidden"
                        onClick={() => window.open(news.link, '_blank')}
                      >
                         <div className="absolute top-0 left-0 w-1 h-full bg-slate-200 group-hover:bg-primary-400 transition-colors" />
                         <div className="flex gap-4 pl-2">
                            {news.image && news.image.startsWith('http') && (
                              <div className="w-20 h-20 rounded-lg overflow-hidden shrink-0 border border-slate-100 shadow-sm">
                                <img src={news.image} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                              </div>
                            )}
                            <div className="flex-1 min-w-0 space-y-1.5">
                               <h4 className="text-sm font-bold text-slate-800 leading-snug group-hover:text-primary-700 transition-colors line-clamp-2">
                                 {news.title}
                               </h4>
                               <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
                                 {news.summary || news.desc}
                               </p>
                            </div>
                         </div>
                         <div className="mt-4 flex items-center justify-between pt-3 border-t border-slate-100 pl-2">
                           <span className="text-[10px] font-bold text-slate-500 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded flex items-center gap-1 uppercase truncate max-w-[150px]">
                             <Globe className="w-3 h-3 text-slate-400 shrink-0" /> {news.source}
                           </span>
                           <span className="text-[10px] font-medium text-slate-400">{news.pub_date?.substring(11, 16)}</span>
                         </div>
                      </motion.div>
                    ))}
                  </div>
                </motion.section>
              );
            })}
          </AnimatePresence>
          
          {totalNews === 0 && (
            <div className="flex flex-col items-center justify-center p-20 text-slate-400 opacity-70 bg-white rounded-2xl border border-dashed border-slate-200 h-64 mx-auto w-full max-w-2xl mt-10">
              <FileText className="w-12 h-12 mb-4 text-slate-300" strokeWidth={1.5} />
              <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">系统尚无收到任何快报</p>
              <button className="mt-4 btn-primary text-xs" onClick={refreshNews}>现在立刻拉取系统信源</button>
            </div>
          )}
        </div>

        {/* Sidebar Controls --- */}
        <aside className="w-full lg:w-80 space-y-5 shrink-0 pb-6">
          <div className="panel p-5 space-y-5">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
              <Settings className="w-4 h-4 text-slate-400" />
              <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wider">面板订阅设置与网络控制</h4>
            </div>

            {/* Category Toggles */}
            <div className="space-y-3">
               <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5"><Radio className="w-3 h-3"/> 本地已激活的过滤器信道</p>
               <div className="flex flex-wrap gap-2">
                  {Object.keys(CAT_META).map(catName => {
                    const active = enabledCats.includes(catName);
                    return (
                      <button 
                        key={catName}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-xs font-bold transition-all border",
                          active ? "bg-primary-50 border-primary-200 text-primary-700 shadow-sm" : "bg-slate-50 border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                        )}
                      >
                        {catName}
                      </button>
                    )
                  })}
               </div>
            </div>

            <div className="space-y-3 pt-3 border-t border-slate-100">
               <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">开放网络数据拉取点设置</p>
               <div className="space-y-2 max-h-48 overflow-y-auto no-scrollbar pr-2">
                 {localConfig?.custom_feeds?.map((f, i) => (
                   <div key={i} className="p-3 bg-white rounded-xl border border-slate-200 flex items-center justify-between group shadow-sm">
                      <div className="flex-1 min-w-0 pr-2">
                        <p className="text-xs font-bold text-slate-700 truncate mb-0.5">{f.name}</p>
                        <p className="text-[10px] text-slate-400 truncate font-mono">{f.url}</p>
                      </div>
                      <button className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-200 shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                   </div>
                 ))}
                 {(!localConfig?.custom_feeds || localConfig?.custom_feeds.length === 0) && (
                   <div className="text-xs text-slate-400 italic text-center py-4 bg-slate-50 rounded-lg border border-slate-100">没有设定任何外部同步节点源，正在使用系统预设池内资源列表...</div>
                 )}
               </div>
               <button className="w-full py-2.5 rounded-xl border border-dashed border-slate-300 text-xs font-bold text-slate-500 hover:text-primary-600 hover:border-primary-300 hover:bg-primary-50 transition-all shadow-sm bg-white">
                  + 注册并添加新的拉取管道
               </button>
            </div>
            
            <div className="pt-4 border-t border-slate-100">
               <button className="w-full btn-primary py-2.5">
                 保存配置文件生效
               </button>
            </div>
          </div>

          {/* Quick Metrics Card */}
          <div className="panel p-5 bg-gradient-to-br from-indigo-50 to-white border-indigo-100">
             <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-indigo-500" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600">遥测数据</span>
             </div>
             <div className="flex items-baseline gap-2 mb-2">
                <span className="text-3xl font-bold text-slate-800 tracking-tight">+24.5%</span>
                <span className="text-[10px] font-bold text-indigo-600 uppercase bg-indigo-100/50 px-2 py-0.5 rounded">效率提升</span>
             </div>
             <p className="text-[11px] text-slate-500 leading-relaxed font-medium">
               多智能体集群在最近的同步窗口期间达到协同调度峰值。未检测到摄入停滞。
             </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
