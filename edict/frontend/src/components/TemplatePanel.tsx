import { useState } from 'react';
import { useStore, TEMPLATES, TPL_CATS } from '../store';
import type { Template } from '../store';
import { api } from '../api';
import { cn } from '../lib/utils';
import { 
  Play, 
  Settings2, 
  Upload, 
  Eye, 
  FileText, 
  X, 
  AlertTriangle,
  BrainCircuit,
  MessageSquare,
  Clock,
  TerminalSquare
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function TemplatePanel() {
  const tplCatFilter = useStore((s) => s.tplCatFilter);
  const setTplCatFilter = useStore((s) => s.setTplCatFilter);
  const toast = useStore((s) => s.toast);
  const loadAll = useStore((s) => s.loadAll);

  const [formTpl, setFormTpl] = useState<Template | null>(null);
  const [formVals, setFormVals] = useState<Record<string, string>>({});
  const [previewCmd, setPreviewCmd] = useState('');
  const [fileToIngest, setFileToIngest] = useState<File | null>(null);
  const [ingesting, setIngesting] = useState(false);

  let tpls = TEMPLATES;
  if (tplCatFilter !== '全部') tpls = tpls.filter((t) => t.cat === tplCatFilter);

  const openForm = (tpl: Template) => {
    const vals: Record<string, string> = {};
    tpl.params.forEach((p) => {
      vals[p.key] = p.default || '';
    });
    setFormVals(vals);
    setFormTpl(tpl);
    setPreviewCmd('');
    setFileToIngest(null);
  };

  const buildCmd = (tpl: Template) => {
    let cmd = tpl.command;
    for (const p of tpl.params) {
      cmd = cmd.replace(new RegExp('\\{' + p.key + '\\}', 'g'), formVals[p.key] || p.default || '');
    }
    return cmd;
  };

  const preview = () => {
    if (!formTpl) return;
    setPreviewCmd(buildCmd(formTpl));
  };

  const execute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTpl) return;
    const cmd = buildCmd(formTpl);
    if (!cmd.trim()) {
      toast('Please fill in required fields', 'err');
      return;
    }

    try {
      const st = await api.agentsStatus();
      if (st.ok && st.gateway && !st.gateway.alive) {
        toast('⚠️ Gateway offline, dispatch will stall', 'err');
        if (!confirm('Gateway is not alive. Proceed anyway?')) return;
      }
    } catch {
      // ignore
    }

    if (!confirm(`Confirm Edict Dispatch?\n\n${cmd.substring(0, 200)}${cmd.length > 200 ? '…' : ''}`)) return;

    try {
      if (fileToIngest) {
        setIngesting(true);
        toast(`📤 Uploading context file: ${fileToIngest.name}...`, 'ok');
        const ir = await api.ragIngestFile(fileToIngest, '', false);
        setIngesting(false);
        if (!ir.ok) {
          toast(`❌ Context ingestion failed: ${ir.error}`, 'err');
          if (!confirm('Context upload failed. Dispatch task anyway?')) return;
        } else {
          toast('✅ Context primed', 'ok');
        }
      }

      const params: Record<string, string> = {};
      for (const p of formTpl.params) {
        params[p.key] = formVals[p.key] || p.default || '';
      }
      const r = await api.createTask({
        title: cmd.substring(0, 120),
        org: 'Mission Control',
        target_dept: formTpl.depts[0] || '',
        priority: 'normal',
        templateId: formTpl.id,
        params,
        meta: fileToIngest ? { uploaded_files: [fileToIngest.name] } : {},
      });
      if (r.ok) {
        toast(`✅ Edict Dispatched Successfully`, 'ok');
        setFormTpl(null);
        setFileToIngest(null);
        loadAll();
      } else {
        toast(r.error || 'Dispatch failed', 'err');
      }
    } catch (err) {
      setIngesting(false);
      toast('⚠️ Operation failed', 'err');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setFileToIngest(null);
      return;
    }
    
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const supported = ['pdf', 'docx', 'pptx', 'ppt', 'xlsx', 'xls', 'csv', 'png', 'jpg', 'jpeg', 'bmp', 'tiff', 'txt', 'md', 'json', 'py', 'go'];
    if (!supported.includes(ext)) {
      toast(`❌ Unsupported format: .${ext}`, 'err');
      e.target.value = '';
      return;
    }

    setFileToIngest(file);
    toast(`📄 Context ready: ${file.name} (${Math.round(file.size / 1024)} KB)`, 'ok');
  };

  return (
    <div className="flex flex-col h-full space-y-6">
      {/* Category filter */}
      <div className="flex items-center gap-2 pb-2 overflow-x-auto no-scrollbar border-b border-slate-200">
        {TPL_CATS.map((c) => (
          <button
            key={c.name}
            onClick={() => setTplCatFilter(c.name)}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-semibold transition-all whitespace-nowrap flex items-center gap-2",
              tplCatFilter === c.name 
                ? "bg-primary-600 text-white shadow-sm" 
                : "bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            )}
          >
            <span>{c.icon}</span> {c.name}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto min-h-0 pr-2 pb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {/* Custom Arbitrary Task Card */}
          <div className="panel p-5 flex flex-col hover:border-primary-400 hover:shadow-card group cursor-pointer border-dashed border-2 bg-slate-50/50 hover:bg-white transition-all" onClick={() => openForm({
            id: 'tpl-custom', cat: '自定义', icon: '✨', name: '自由发布任务',
            desc: '抛开常驻固定模板，直接用自然语言描述你需要多智能体系统协助完成的任何复杂事项。',
            depts: ['任务编排引擎'], est: '动态评估', cost: '按量推算',
            params: [{ key: 'prompt', label: '您的具体需求描述', type: 'textarea', required: true }],
            command: '{prompt}'
          })}>
             <div className="flex items-start gap-4 mb-3">
               <div className="w-12 h-12 flex items-center justify-center text-3xl bg-white border border-slate-200 rounded-xl group-hover:scale-105 transition-transform shrink-0 shadow-sm">
                 ✨
               </div>
               <div className="flex-1 min-w-0 pt-0.5">
                 <h3 className="text-base font-bold text-slate-800 truncate group-hover:text-primary-700 transition-colors mb-1">自由编排任务</h3>
                 <div className="flex flex-wrap gap-1.5">
                    <span className="text-[10px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded font-bold uppercase tracking-wider border border-slate-300">智能调度集群</span>
                 </div>
               </div>
             </div>
             
             <p className="text-sm text-slate-500 font-medium mb-5 line-clamp-2 leading-relaxed">
               直接用大白话输入复杂的、需要跨部门协同的宏观意图与工作。
             </p>
             <div className="mt-auto pt-4 flex items-center justify-center text-primary-600 font-bold text-sm bg-white border border-primary-200 rounded-lg py-2 group-hover:bg-primary-50 transition-colors">
               <MessageSquare className="w-4 h-4 mr-2" /> 起草自由指令
             </div>
          </div>

          {/* Built-in Templates */}
          {tpls.map((t) => (
            <div className="panel p-5 flex flex-col hover:border-primary-300 hover:shadow-card group cursor-pointer transition-all bg-white" key={t.id} onClick={() => openForm(t)}>
              <div className="flex items-start gap-4 mb-3">
                <div className="w-12 h-12 flex items-center justify-center text-3xl bg-slate-50 border border-slate-200 rounded-xl group-hover:scale-105 transition-transform shrink-0 shadow-sm">
                  {t.icon}
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <h3 className="text-base font-bold text-slate-800 truncate group-hover:text-primary-700 transition-colors mb-1">{t.name}</h3>
                   <div className="flex flex-wrap gap-1.5">
                     {t.depts.slice(0, 2).map((d) => (
                       <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-bold uppercase tracking-wider border border-slate-200 truncate max-w-[100px]" key={d}>{d}</span>
                     ))}
                   </div>
                </div>
              </div>
              
              <p className="text-sm text-slate-500 font-medium mb-5 line-clamp-2 leading-relaxed h-[42px]">
                {t.desc}
              </p>
              
              <div className="mt-auto pt-4 border-t border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3 text-[11px] font-semibold text-slate-400">
                  <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5"/> {t.est}</span>
                  <span className="flex items-center gap-1">💸 {t.cost}</span>
                </div>
                <button className="flex items-center gap-1 text-xs font-bold text-primary-600 bg-primary-50 hover:bg-primary-100 px-3 py-1.5 rounded-lg transition-colors border border-primary-200">
                  <Play className="w-3 h-3" /> Execute
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Template Form Modal */}
      <AnimatePresence>
        {formTpl && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" onClick={() => { if (!ingesting) setFormTpl(null); }}>
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-2xl max-h-[90vh] panel flex flex-col shadow-2xl bg-white" 
              onClick={(e) => e.stopPropagation()}
            >
              <header className="p-6 border-b border-slate-200 flex justify-between items-start bg-slate-50/50 rounded-t-xl shrink-0">
                <div className="pr-8">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-[10px] font-bold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded uppercase font-mono tracking-widest flex items-center gap-1.5"><TerminalSquare className="w-3.5 h-3.5" /> Edict Protocol</span>
                  </div>
                  <h2 className="text-xl md:text-2xl font-bold text-slate-900 leading-tight mb-2">
                    {formTpl.icon} {formTpl.name}
                  </h2>
                  <p className="text-sm text-slate-500 font-medium">{formTpl.desc}</p>
                  
                  <div className="flex flex-wrap items-center gap-2 mt-4">
                    {formTpl.depts.map((d) => (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200" key={d}>{d}</span>
                    ))}
                    <span className="text-[11px] font-semibold text-slate-400 ml-2">Est: {formTpl.est} | Cost: {formTpl.cost}</span>
                  </div>
                </div>
                {!ingesting && (
                  <button className="w-8 h-8 flex items-center justify-center rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-500 transition-colors shadow-sm" onClick={() => setFormTpl(null)}>
                    <X className="w-5 h-5" />
                  </button>
                )}
              </header>

              <div className="flex-1 overflow-y-auto p-6 md:p-8 bg-white">
                <form id="edict-form" onSubmit={execute} className="space-y-6">
                  {formTpl.params.map((p) => (
                    <div key={p.key} className="space-y-1.5">
                      <label className="text-sm font-bold text-slate-700 flex items-center gap-1">
                        {p.label}
                        {p.required && <span className="text-red-500">*</span>}
                      </label>
                      {p.type === 'textarea' ? (
                        <textarea
                          className="input-field min-h-[100px] resize-y"
                          required={p.required}
                          value={formVals[p.key] || ''}
                          onChange={(e) => setFormVals((v) => ({ ...v, [p.key]: e.target.value }))}
                          placeholder={`Enter ${p.label.toLowerCase()}...`}
                        />
                      ) : p.type === 'select' ? (
                        <select
                          className="input-field cursor-pointer"
                          value={formVals[p.key] || p.default || ''}
                          onChange={(e) => setFormVals((v) => ({ ...v, [p.key]: e.target.value }))}
                        >
                          {(p.options || []).map((o) => (
                            <option key={o}>{o}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className="input-field"
                          type="text"
                          required={p.required}
                          value={formVals[p.key] || ''}
                          onChange={(e) => setFormVals((v) => ({ ...v, [p.key]: e.target.value }))}
                          placeholder={`Enter ${p.label.toLowerCase()}...`}
                        />
                      )}
                    </div>
                  ))}

                  {/* Context Ingestion */}
                  <div className="pt-6 border-t border-slate-100 space-y-3">
                    <label className="text-sm font-bold text-slate-800 flex items-center gap-2">
                      <BrainCircuit className="w-4 h-4 text-indigo-500" /> Context Injection (RAG)
                    </label>
                    <p className="text-xs text-slate-500 font-medium">
                      Attach documents (PDF, Word, PPT, Excel, Images, Code) to provide context for this edict.
                    </p>
                    
                    <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                      <input
                        type="file"
                        accept=".pdf,.docx,.pptx,.ppt,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.bmp,.tiff,.txt,.md,.json,.py,.go"
                        onChange={handleFileChange}
                        id="rag-file-upload"
                        className="hidden"
                      />
                      <label
                        htmlFor="rag-file-upload"
                        className="btn-secondary flex items-center justify-center gap-2 px-6 py-2 cursor-pointer w-full sm:w-auto"
                      >
                        <Upload className="w-4 h-4" /> {fileToIngest ? 'Change File' : 'Select Context File'}
                      </label>
                      {fileToIngest && (
                        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200">
                          <FileText className="w-4 h-4" /> {fileToIngest.name}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Preview Render */}
                  <AnimatePresence>
                    {previewCmd && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-6 bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-inner">
                          <div className="text-[10px] font-bold text-slate-400 mb-3 flex items-center gap-2 uppercase tracking-widest">
                            <TerminalSquare className="w-3.5 h-3.5" /> Generated Instruction Payload
                          </div>
                          <div className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed font-mono">{previewCmd}</div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </form>
              </div>

              <footer className="p-4 md:p-6 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row gap-3 justify-end rounded-b-xl shrink-0">
                <button type="button" className="btn-secondary" onClick={preview} disabled={ingesting}>
                  <Eye className="w-4 h-4 mr-2 inline" /> Preview Payload
                </button>
                <button type="submit" form="edict-form" className="btn-primary min-w-[140px]" disabled={ingesting}>
                  {ingesting ? 'Injecting RAG...' : <><Play className="w-4 h-4 mr-2 inline" /> Dispatch Edict</>}
                </button>
              </footer>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
