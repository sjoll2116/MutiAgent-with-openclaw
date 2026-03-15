import React, { useState, useEffect } from 'react';
import { api, RAGDocument } from '../api';
import { useStore } from '../store';

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
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocs();
  }, [page]);

  const handleDelete = async (docId: string) => {
    if (!window.confirm('确定要删除该文档及其所有向量索引吗？')) return;
    try {
      await api.deleteDocument(docId);
      toast('✅ 文档已删除');
      fetchDocs();
    } catch (err) {
      toast('❌ 删除失败', 'err');
    }
  };

  return (
    <div className="p-6 bg-white rounded-xl shadow-sm border border-gray-100 dark:bg-gray-900 dark:border-gray-800">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">📚 知识库管理</h2>
        <button 
          onClick={fetchDocs} 
          className="px-3 py-1 bg-gray-50 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg text-sm transition-colors"
        >
          刷新
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800 text-gray-400 text-sm">
              <th className="pb-3 font-medium">文件名</th>
              <th className="pb-3 font-medium">类型</th>
              <th className="pb-3 font-medium">来源</th>
              <th className="pb-3 font-medium">上传时间</th>
              <th className="pb-3 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
            {loading ? (
              <tr><td colSpan={5} className="py-8 text-center text-gray-400">正在加载...</td></tr>
            ) : docs.length === 0 ? (
              <tr><td colSpan={5} className="py-8 text-center text-gray-400">暂无文档</td></tr>
            ) : docs.map(doc => (
              <tr key={doc.doc_id} className="group hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                <td className="py-4">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-700 dark:text-gray-200 font-medium">{doc.file_name}</span>
                    {doc.is_temporary && (
                      <span className="px-1.5 py-0.5 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-500 text-[10px] rounded border border-yellow-100 dark:border-yellow-900/30 uppercase">临时</span>
                    )}
                  </div>
                </td>
                <td className="py-4 text-gray-500 text-sm uppercase">{doc.file_type}</td>
                <td className="py-4 text-gray-500 text-sm">{doc.source_agent}</td>
                <td className="py-4 text-gray-500 text-sm">{new Date(doc.created_at).toLocaleString()}</td>
                <td className="py-4 text-right">
                  <button 
                    onClick={() => handleDelete(doc.doc_id)}
                    className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 flex justify-center gap-2">
        <button 
          disabled={page === 1}
          onClick={() => setPage(p => p - 1)}
          className="px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg disabled:opacity-30 text-gray-600 dark:text-gray-400"
        >
          上一页
        </button>
        <button 
          onClick={() => setPage(p => p + 1)}
          className="px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-400"
        >
          下一页
        </button>
      </div>
    </div>
  );
};
