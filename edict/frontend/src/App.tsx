import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Bell, 
  User, 
  Users,
  Wrench,
  Terminal,
  ShieldCheck,
  RefreshCcw,
  ChevronRight,
  LogOut,
  LayoutDashboard,
  Cpu,
  Bookmark,
  MessageSquare,
  Zap,
  Grid,
  FileText,
  Briefcase,
  History,
  Archive,
  Workflow,
  Globe,
  FolderTree,
  Sun,
  Sparkles
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
  const [authed, setAuthed] = useState(api.isAuthenticated());
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const liveStatus = useStore((s) => s.liveStatus);
  const countdown = useStore((s) => s.countdown);
  const loadAll = useStore((s) => s.loadAll);

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
  const activeTasks = (liveStatus?.tasks || []).filter(t => isEdict(t) && !isArchived(t));

  return (
    <div className="flex h-screen bg-obsidian-full overflow-hidden">
      {/* --- Sidebar Navigation --- */}
      <aside className="w-64 border-r border-slate-line bg-obsidian-panel/80 backdrop-blur-xl flex flex-col z-50">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-neon-cyan to-neon-violet flex items-center justify-center shadow-neon-cyan/20 shadow-lg">
              <Terminal className="w-5 h-5 text-obsidian-full" />
            </div>
            <h1 className="text-xl font-black bg-gradient-to-r from-white to-slate-muted bg-clip-text text-transparent">
              OPENCLAW
            </h1>
          </div>
          <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-slate-muted pl-11">
            MAS Control v2.0
          </p>
        </div>

        <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
          {TAB_DEFS.map((t) => {
            const Icon = ICON_MAP[t.key] || LayoutDashboard;
            const isActive = activeTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={cn(
                  "w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-300 group",
                  isActive 
                    ? "bg-white/5 text-neon-cyan shadow-sm" 
                    : "text-slate-muted hover:text-white hover:bg-white/5"
                )}
              >
                <div className="flex items-center gap-3">
                  <Icon className={cn("w-5 h-5 transition-transform duration-300", isActive && "scale-110")} />
                  <span className="text-sm font-semibold tracking-wide">{t.label}</span>
                </div>
                {isActive && (
                  <motion.div 
                    layoutId="activeTab" 
                    className="w-1.5 h-1.5 rounded-full bg-neon-cyan shadow-neon-cyan shadow-[0_0_8px_rgba(0,242,255,0.8)]" 
                  />
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-6 border-t border-slate-line space-y-4 bg-black/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className={cn("w-4 h-4", syncOk ? "text-neon-cyan" : "text-neon-glitch")} />
              <span className="text-[10px] font-bold text-slate-muted uppercase tracking-wider">
                {syncOk ? "Sync Active" : "Server Disconnected"}
              </span>
            </div>
            <span className="text-[10px] font-mono text-slate-muted">{countdown}s</span>
          </div>
          
          <button 
            onClick={() => api.logout()}
            className="w-full flex items-center gap-3 px-4 py-2 text-slate-muted hover:text-neon-glitch transition-colors text-xs font-semibold"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* --- Main Content Area --- */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {/* Background Aura */}
        <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] bg-neon-cyan/5 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] bg-neon-violet/5 rounded-full blur-[120px] pointer-events-none" />

        {/* Top bar */}
        <header className="h-16 px-8 flex items-center justify-between border-b border-slate-line/50 glass-panel z-40">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-bold text-white tracking-tight">
              {TAB_DEFS.find(t => t.key === activeTab)?.label}
            </h2>
            <div className="h-4 w-[1px] bg-slate-line" />
            <div className="flex items-center gap-2 px-3 py-1 bg-white/5 rounded-full border border-white/5">
              <div className="w-1.5 h-1.5 rounded-full bg-neon-cyan animate-pulse shadow-neon-cyan shadow-sm" />
              <span className="text-[10px] font-bold text-slate-muted uppercase">{activeTasks.length} Active Edicts</span>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={() => loadAll()}
              className="p-2 hover:bg-white/5 rounded-lg transition-colors text-slate-muted hover:text-white"
              title="Force Refresh"
            >
              <RefreshCcw className="w-4 h-4" />
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
              className="h-full"
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
