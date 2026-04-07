import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Folder, 
  File, 
  FileText, 
  FileCode, 
  ChevronRight, 
  ArrowLeft, 
  Download, 
  Search,
  HardDrive,
  Clock,
  ExternalLink,
  RefreshCcw,
  MoreVertical
} from 'lucide-react';
import { api, type WorkspaceFile } from '../api';
import { useStore } from '../store';
import { cn } from '../lib/utils';

export default function WorkspaceExplorer() {
  const [path, setPath] = useState('');
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const toast = useStore((s) => s.toast);

  const fetchFiles = async (p: string) => {
    setLoading(true);
    try {
      const res = await api.workspaceFiles(p);
      if (res.ok) {
        setFiles(res.files);
        setPath(p);
      } else {
        toast('Failed to load workspace files', 'err');
      }
    } catch {
      toast('Network error', 'err');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles('');
  }, []);

  const navigateTo = (name: string) => {
    const newPath = path ? `${path}/${name}` : name;
    fetchFiles(newPath);
  };

  const goBack = () => {
    const parts = path.split('/');
    parts.pop();
    fetchFiles(parts.join('/'));
  };

  const filteredFiles = files.filter(f => f.name.toLowerCase().includes(search.toLowerCase()));

  const getFileIcon = (f: WorkspaceFile) => {
    if (f.isDir) return <Folder className="w-5 h-5 text-neon-cyan" />;
    if (['.json', '.py', '.go', '.ts', '.tsx'].includes(f.ext)) return <FileCode className="w-5 h-5 text-neon-violet" />;
    return <FileText className="w-5 h-5 text-slate-muted" />;
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="flex flex-col h-full space-y-6">
      {/* Header & Breadcrumbs */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
           <div className="p-3 bg-neon-cyan/20 rounded-2xl">
             <HardDrive className="w-6 h-6 text-neon-cyan" />
           </div>
           <div>
             <h2 className="text-xl font-black text-white tracking-tight uppercase">Expert Shared Memory</h2>
             <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] font-bold text-slate-muted uppercase tracking-widest">Workspace</span>
                <ChevronRight className="w-3 h-3 text-slate-line" />
                <div className="flex items-center gap-1 text-[10px] font-mono text-neon-cyan">
                  {path || '/'}
                </div>
             </div>
           </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-muted" />
            <input 
              type="text" 
              placeholder="Search artifacts..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input-premium pl-10 text-xs w-48" 
            />
          </div>
          <button 
            onClick={() => fetchFiles(path)}
            className="p-2.5 rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 text-slate-muted hover:text-white transition-all"
          >
            <RefreshCcw className={cn("w-4 h-4", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Explorer Table */}
      <div className="flex-1 glass-panel rounded-3xl border border-white/5 overflow-hidden flex flex-col">
        {/* Table Header */}
        <div className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-white/5 bg-white/[0.02]">
          <div className="col-span-6 text-[10px] uppercase font-black tracking-widest text-slate-muted">Entity Name</div>
          <div className="col-span-2 text-[10px] uppercase font-black tracking-widest text-slate-muted">Size</div>
          <div className="col-span-3 text-[10px] uppercase font-black tracking-widest text-slate-muted">Modified</div>
          <div className="col-span-1"></div>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar">
          {path && (
            <div 
              onClick={goBack}
              className="flex items-center gap-4 px-6 py-3 border-b border-white/[0.02] hover:bg-white/5 cursor-pointer group transition-colors"
            >
              <div className="w-10 flex justify-center">
                <ArrowLeft className="w-4 h-4 text-neon-violet group-hover:-translate-x-1 transition-transform" />
              </div>
              <span className="text-xs font-bold text-slate-muted uppercase tracking-widest">Go Back / Parent</span>
            </div>
          )}

          <AnimatePresence mode="popLayout">
            {filteredFiles.map((f, i) => (
              <motion.div
                layout
                key={f.name}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02 }}
                onClick={() => f.isDir ? navigateTo(f.name) : null}
                className={cn(
                  "grid grid-cols-12 gap-4 px-6 py-4 border-b border-white/[0.02] hover:bg-white/5 group transition-colors items-center",
                  f.isDir ? "cursor-pointer" : "cursor-default"
                )}
              >
                <div className="col-span-6 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-black/40 flex items-center justify-center border border-white/5">
                    {getFileIcon(f)}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white group-hover:text-neon-cyan transition-colors">{f.name}</p>
                    <p className="text-[9px] text-slate-muted font-bold uppercase tracking-tighter">{f.isDir ? 'Directory cluster' : `${f.ext || 'binary'} stream`}</p>
                  </div>
                </div>

                <div className="col-span-2 text-xs font-mono text-slate-muted opacity-60">
                   {formatSize(f.size)}
                </div>

                <div className="col-span-3 flex items-center gap-2 text-xs font-mono text-slate-muted opacity-60">
                   <Clock className="w-3.5 h-3.5" />
                   {new Date(f.modTime).toLocaleString()}
                </div>

                <div className="col-span-1 flex justify-end">
                   {!f.isDir && (
                     <button className="p-2 opacity-0 group-hover:opacity-100 hover:bg-neon-cyan/20 rounded-lg text-neon-cyan transition-all">
                        <Download className="w-4 h-4" />
                     </button>
                   )}
                   {f.isDir && (
                     <ChevronRight className="w-4 h-4 text-slate-line" />
                   )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {filteredFiles.length === 0 && !loading && (
            <div className="h-full flex flex-col items-center justify-center opacity-20 py-20">
               <Folder className="w-12 h-12 mb-4" />
               <p className="text-sm font-bold uppercase tracking-[0.2em]">Zero artifacts in directory</p>
            </div>
          )}
        </div>
      </div>

      {/* Footer Info */}
      <div className="flex items-center justify-between px-6 py-4 glass-panel rounded-2xl border border-white/5">
         <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-widest text-slate-muted">
            <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-neon-cyan shadow-neon-cyan" /> Secure Mount Active</span>
            <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-neon-violet shadow-neon-violet" /> RW Permissions Locked</span>
         </div>
         <p className="text-[9px] font-mono text-slate-muted opacity-40">Managed by Orchestrator Virtual Disk Layer v1.0</p>
      </div>
    </div>
  );
}
