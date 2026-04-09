import React, { useState, useEffect } from 'react';
import { api, RAGDocument } from '../api';
import { useStore } from '../store';
import { Database, FileText, RefreshCcw, Trash2, Library, CheckCircle2 } from 'lucide-react';
import { cn } from '../lib/utils';

export const KnowledgeManager: React.FC = () => {
  const [docs, setDocs] = useState<RAGDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  
  const toast = useStore(s => s.toast);

  const fetchDocs = async () => {
    setLoading(true);
    try {
      const res = await api.listDocuments(page, 10);
      if (res && res.items) {
        setDocs(res.items);
      }
    } catch (err) {
      console.error('Failed to fetch documents', err);
      toast('Failed to fetch documents', 'err');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocs();
  }, [page]);

  const handleDelete = async (docId: string) => {
    if (!window.confirm('您确定要彻低删除该文档及其全部关联的向量索引库吗？')) return;
    try {
      await api.deleteDocument(docId);
      toast('✅ 结构化数据已被清除');
      fetchDocs();
    } catch (err) {
      toast('❌ Delete failed', 'err');
    }
  };

  return (
    <div className="flex flex-col h-full space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between pb-4 border-b border-slate-200 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 flex items-center justify-center bg-indigo-50 border border-indigo-100 rounded-xl text-indigo-600 shadow-sm">
            <Library className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800">本地知识库管理</h2>
            <p className="text-xs font-semibold text-slate-500">RAG 文档及相关向量集索引仓储</p>
          </div>
        </div>
        <button 
          onClick={fetchDocs} 
          disabled={loading}
          className="btn-secondary flex items-center gap-2"
        >
          <RefreshCcw className={cn("w-4 h-4", loading && "animate-spin text-primary-500")} /> 
          {loading ? '正在通信同步...' : '请求刷新系统数据'}
        </button>
      </div>

      <div className="flex-1 min-h-0 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm border-b border-slate-200">
              <tr>
                <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest w-[40%]">索引文件 / 知识段</th>
                <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest w-[15%]">数据格式层级</th>
                <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest w-[15%]">资源供应来源节点</th>
                <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest w-[20%]">首次入库时间</th>
                <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest text-right w-[10%]">管理或操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-20 text-center text-slate-400 font-medium">
                    <div className="flex flex-col items-center justify-center">
                       <Database className="w-10 h-10 mb-4 animate-pulse text-indigo-200" />
                       驱动向量网关正从本地集搜索获取...
                    </div>
                  </td>
                </tr>
              ) : docs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-20 text-center text-slate-400 font-medium bg-slate-50/50">
                    <div className="flex flex-col items-center justify-center">
                       <FileText className="w-10 h-10 mb-4 text-slate-300" strokeWidth={1} />
                       当前存储空间暂无知识储备。
                    </div>
                  </td>
                </tr>
              ) : docs.map(doc => (
                <tr key={doc.doc_id} className="group hover:bg-indigo-50/30 transition-colors">
                  <td className="py-4 px-6">
                    <div className="flex items-center gap-3">
                      <FileText className="w-5 h-5 text-indigo-400 shrink-0" />
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-slate-700 truncate max-w-[250px]" title={doc.file_name}>{doc.file_name}</span>
                        <div className="flex items-center gap-2 mt-1">
                           <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded uppercase tracking-wider">
                             <CheckCircle2 className="w-3 h-3" /> 向量映射就绪
                           </span>
                           {doc.is_temporary && (
                             <span className="px-1.5 py-0.5 bg-amber-50 text-amber-600 text-[10px] font-bold rounded border border-amber-200 uppercase tracking-wider">
                               临时存储 (易挥发)
                             </span>
                           )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="py-4 px-6">
                    <span className="text-[11px] font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded-md uppercase tracking-wider border border-slate-200">
                      {doc.file_type || 'Unknown'}
                    </span>
                  </td>
                  <td className="py-4 px-6">
                    <span className="text-xs font-semibold text-slate-600 truncate max-w-[150px] inline-block">{doc.source_agent || 'System'}</span>
                  </td>
                  <td className="py-4 px-6 text-xs text-slate-500 font-medium">
                    {new Date(doc.created_at).toLocaleString()}
                  </td>
                  <td className="py-4 px-6 text-right">
                    <button 
                      onClick={() => handleDelete(doc.doc_id)}
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all border border-transparent hover:border-red-200 shadow-sm hover:shadow"
                      title="Delete Vector Index"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-between items-center shrink-0">
          <span className="text-xs font-semibold text-slate-500">记录页码 {page}</span>
          <div className="flex gap-2">
            <button 
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
              className="btn-secondary px-4 py-1.5"
            >
              前一页
            </button>
            <button 
              onClick={() => setPage(p => p + 1)}
              disabled={docs.length < 10}
              className="btn-secondary px-4 py-1.5"
            >
              下一页
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
