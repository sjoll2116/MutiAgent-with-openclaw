import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  LayoutDashboard,
  Cpu,
  MessageSquare,
  Zap,
  History,
  Sparkles,
  Globe,
  FolderTree,
  Terminal,
  ShieldCheck,
  RefreshCcw,
  LogOut,
  Users,
  Wrench
} from 'lucide-react';
import { useStore, TAB_DEFS, startPolling, stopPolling, isEdict, isArchived } from './store';
import { api } from './api';
import { cn } from './lib/utils';

// --- Page Components ---
import EdictBoard from './components/EdictBoard';
import MonitorPanel from './components/MonitorPanel';
import OfficialPanel from './components/OfficialPanel';
import ModelConfig from './components/ModelConfig';
import SkillsConfig from './components/SkillsConfig';
import SessionsPanel from './components/SessionsPanel';
import MemorialPanel from './components/MemorialPanel';
import TemplatePanel from './components/TemplatePanel';
import MorningPanel from './components/MorningPanel';
import WorkspaceExplorer from './components/WorkspaceExplorer';
import TaskModal from './components/TaskModal';
import Toaster from './components/Toaster';
import LoginPage from './components/LoginPage';

const ICON_MAP: Record<string, any> = {
  edicts: LayoutDashboard,
  monitor: Zap,
  officials: Users,
  models: Cpu,
  skills: Wrench,
  sessions: MessageSquare,
  memorials: History,
  templates: Sparkles,
  morning: Globe,
  workspace: FolderTree
};

export default function App() {
  const [authed, setAuthed] = useState(() => {
    try {
      return api.isAuthenticated();
    } catch {
      return false;
    }
  });
  
  const activeTab = useStore((s: any) => s.activeTab);
  const setActiveTab = useStore((s: any) => s.setActiveTab);
  const liveStatus = useStore((s: any) => s.liveStatus);
  const countdown = useStore((s: any) => s.countdown);
  const loadAll = useStore((s: any) => s.loadAll);

  // Monitor Authentication
  useEffect(() => {
    const handleAuth = () => setAuthed(false);
    window.addEventListener('auth_required', handleAuth);
    return () => window.removeEventListener('auth_required', handleAuth);
  }, []);

  // Polling Lifecycle
  useEffect(() => {
    if (authed) {
      startPolling();
      const timer = setInterval(loadAll, 15000);
      return () => {
        stopPolling();
        clearInterval(timer);
      };
    }
  }, [authed, loadAll]);

  if (!authed) return <LoginPage onLogin={() => setAuthed(true)} />;

  const syncOk = liveStatus?.syncStatus?.ok;
  const activeTasks = (liveStatus?.tasks || []).filter((t: any) => isEdict(t) && !isArchived(t));

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans text-slate-900">
      {/* --- Sidebar Navigation --- */}
      <aside className="w-64 border-r border-slate-200 bg-white flex flex-col z-50 shadow-subtle shrink-0">
        <div className="p-6 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-50 text-primary-600 flex items-center justify-center border border-primary-100">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 tracking-tight">OPENCLAW</h1>
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-widest">MAS Control v2.0</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto">
          {TAB_DEFS.map((t) => {
            const Icon = ICON_MAP[t.key] || LayoutDashboard;
            const isActive = activeTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-all duration-200 group text-sm font-medium",
                  isActive 
                    ? "bg-primary-50 text-primary-700" 
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <div className="flex items-center gap-3">
                  <Icon className={cn(
                    "w-[18px] h-[18px] transition-colors", 
                    isActive ? "text-primary-600" : "text-slate-400 group-hover:text-slate-600"
                  )} />
                  <span>{t.label}</span>
                </div>
                {isActive && (
                  <motion.div 
                    layoutId="activeTabIndicator" 
                    className="w-1.5 h-1.5 rounded-full bg-primary-500" 
                  />
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 bg-slate-50/50 space-y-4">
          <div className="flex items-center justify-between bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2">
              <ShieldCheck className={cn("w-4 h-4", syncOk ? "text-emerald-500" : "text-red-500")} />
              <span className="text-xs font-semibold text-slate-700">
                {syncOk ? "系统联机" : "失去连接"}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                {syncOk && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                <span className={cn("relative inline-flex rounded-full h-2 w-2", syncOk ? "bg-emerald-500" : "bg-red-500")}></span>
              </span>
              <span className="text-[10px] font-mono text-slate-500">{countdown}s</span>
            </div>
          </div>
          
          <button 
            onClick={() => api.logout()}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 text-slate-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors text-sm font-medium"
          >
            <LogOut className="w-4 h-4" />
            退出登录
          </button>
        </div>
      </aside>

      {/* --- Main Content Area --- */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative bg-slate-50/50">
        {/* Top bar */}
        <header className="h-16 px-8 flex items-center justify-between border-b border-slate-200 bg-white z-40 shrink-0">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-semibold text-slate-800">
              {TAB_DEFS.find(t => t.key === activeTab)?.label}
            </h2>
            <div className="h-5 w-[1px] bg-slate-300" />
            <div className="flex items-center gap-2 px-3 py-1 bg-slate-100 rounded-full border border-slate-200">
              <div className="w-2 h-2 rounded-full bg-primary-500 animate-pulse" />
              <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">{activeTasks.length} 个正在执行的指令</span>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <button 
              onClick={() => loadAll()}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 hover:text-slate-900 rounded-lg transition-all shadow-subtle"
              title="强制拉取状态"
            >
              <RefreshCcw className="w-4 h-4" />
              <span>手动同步</span>
            </button>
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-8 relative">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="h-full max-w-7xl mx-auto w-full"
            >
              {activeTab === 'edicts' && <EdictBoard />}
              {activeTab === 'monitor' && <MonitorPanel />}
              {activeTab === 'officials' && <OfficialPanel />}
              {activeTab === 'models' && <ModelConfig />}
              {activeTab === 'skills' && <SkillsConfig />}
              {activeTab === 'sessions' && <SessionsPanel />}
              {activeTab === 'memorials' && <MemorialPanel />}
              {activeTab === 'templates' && <TemplatePanel />}
              {activeTab === 'morning' && <MorningPanel />}
              {activeTab === 'workspace' && <WorkspaceExplorer />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* --- Global Overlays --- */}
      <TaskModal />
      <Toaster />
    </div>
  );
}
