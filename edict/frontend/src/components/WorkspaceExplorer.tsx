import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Folder, 
  FileText, 
  FileCode, 
  ChevronRight, 
  ArrowLeft, 
  Download, 
  Search,
  HardDrive,
  Clock,
  RefreshCcw,
  MoreVertical,
  Database
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
        // Fix: fallback to empty array if res.files is undefined/null
        setFiles(res.files || []);
        setPath(p);
      } else {
        toast('加载工作区文件失败', 'err');
        setFiles([]); // Reset state gracefully on error
      }
    } catch {
      toast('网络异常导致加载失败', 'err');
      setFiles([]);
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

  const filteredFiles = files.filter(f => 
    f && f.name && f.name.toLowerCase().includes(search.toLowerCase())
  );

  const getFileIcon = (f: WorkspaceFile) => {
    if (f.isDir) return <Folder className="w-5 h-5 text-primary-500 fill-primary-100/50" />;
    if (['.json', '.py', '.go', '.ts', '.tsx'].includes(f.ext)) return <FileCode className="w-5 h-5 text-orange-500" />;
    return <FileText className="w-5 h-5 text-slate-400" />;
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
      <div className="panel px-6 py-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
           <div className="p-3 bg-indigo-50 rounded-xl border border-indigo-100">
             <Database className="w-6 h-6 text-indigo-600" />
           </div>
           <div>
             <h2 className="text-xl font-bold text-slate-900">智能体共享存储工作区</h2>
             <div className="flex items-center gap-2 mt-1">
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">存储基准点</span>
                <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
                <div className="flex items-center gap-1 text-[13px] font-mono text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                  {path || '/'}
                </div>
             </div>
           </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-slate-400" />
            <input 
              type="text" 
              placeholder="检索存储产物..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input-field pl-10 w-64" 
            />
          </div>
          <button 
            onClick={() => fetchFiles(path)}
            className="btn-secondary flex items-center justify-center p-2.5"
            title="刷新获取最新"
          >
            <RefreshCcw className={cn("w-4 h-4 text-slate-600", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Explorer Table */}
      <div className="panel flex-1 flex flex-col min-h-0">
        {/* Table Header */}
        <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-slate-200 bg-slate-50/80">
          <div className="col-span-6 text-xs font-semibold text-slate-500 uppercase tracking-wider">资源名称</div>
          <div className="col-span-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">文件基准大小</div>
          <div className="col-span-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">最近一次操作时间</div>
          <div className="col-span-1"></div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {path && (
            <div 
              onClick={goBack}
              className="flex items-center gap-4 px-6 py-3.5 border-b border-slate-100 hover:bg-slate-50 cursor-pointer group transition-colors"
            >
              <div className="w-10 flex justify-center">
                <ArrowLeft className="w-4 h-4 text-slate-400 group-hover:-translate-x-1 transition-transform" />
              </div>
              <span className="text-sm font-medium text-slate-600">返回上一层级目录设定</span>
            </div>
          )}

          <AnimatePresence mode="popLayout">
            {filteredFiles.map((f, i) => (
              <motion.div
                layout
                key={`${f.name}-${i}`}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.02, 0.2) }}
                onClick={() => f.isDir ? navigateTo(f.name) : null}
                className={cn(
                  "grid grid-cols-12 gap-4 px-6 py-3.5 border-b border-slate-100 hover:bg-sky-50/50 group transition-colors items-center",
                  f.isDir ? "cursor-pointer" : "cursor-default"
                )}
              >
                <div className="col-span-6 flex items-center gap-3">
                  <div className="flex items-center justify-center p-2 rounded-lg bg-white border border-slate-100 shadow-sm">
                    {getFileIcon(f)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-900 group-hover:text-primary-600 transition-colors">{f.name}</p>
                    <p className="text-xs text-slate-500">{f.isDir ? '文件夹目录' : `${f.ext || '未知格式'} 文件`}</p>
                  </div>
                </div>

                <div className="col-span-2 text-sm text-slate-500">
                   {formatSize(f.size)}
                </div>

                <div className="col-span-3 flex items-center gap-2 text-sm text-slate-500">
                   <Clock className="w-4 h-4 text-slate-400" />
                   {new Date(f.modTime).toLocaleDateString()} {new Date(f.modTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </div>

                <div className="col-span-1 flex justify-end">
                   {!f.isDir ? (
                     <button className="p-2 opacity-0 group-hover:opacity-100 hover:bg-slate-100 rounded-lg text-slate-600 transition-all">
                        <Download className="w-[18px] h-[18px]" />
                     </button>
                   ) : (
                     <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-primary-400 transition-colors" />
                   )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {filteredFiles.length === 0 && !loading && (
            <div className="h-full flex flex-col items-center justify-center opacity-60 py-24 text-slate-400">
               <HardDrive className="w-16 h-16 mb-4 text-slate-300" strokeWidth={1} />
               <p className="text-base font-medium text-slate-600">该锚点路径下未探寻到相关的产物内容</p>
               <p className="text-sm mt-1">请验证当前指令路径是否包含正确文件类型内容，亦或检索无匹配结果。</p>
            </div>
          )}
        </div>
      </div>

      {/* Footer Info */}
      <div className="flex items-center justify-between px-6 py-3 panel shrink-0">
         <div className="flex items-center gap-4 text-xs font-semibold text-slate-600">
            <span className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500" /> 存储卷挂载正常
            </span>
            <span className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-slate-300" /> 受限制只读读取策略
            </span>
         </div>
         <p className="text-xs text-slate-400">底层系统支持虚拟驱动</p>
      </div>
    </div>
  );
}
