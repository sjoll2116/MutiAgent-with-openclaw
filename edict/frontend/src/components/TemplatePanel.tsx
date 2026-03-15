import { useState } from 'react';
import { useStore, TEMPLATES, TPL_CATS } from '../store';
import type { Template } from '../store';
import { api } from '../api';

export default function TemplatePanel() {
  const tplCatFilter = useStore((s) => s.tplCatFilter);
  const setTplCatFilter = useStore((s) => s.setTplCatFilter);
  const toast = useStore((s) => s.toast);
  const loadAll = useStore((s) => s.loadAll);

  const [formTpl, setFormTpl] = useState<Template | null>(null);
  const [formVals, setFormVals] = useState<Record<string, string>>({});
  const [previewCmd, setPreviewCmd] = useState('');
  const [fileToIngest, setFileToIngest] = useState<{ name: string; content: string } | null>(null);
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
      toast('请填写必填参数', 'err');
      return;
    }

    // Pre-check gateway
    try {
      const st = await api.agentsStatus();
      if (st.ok && st.gateway && !st.gateway.alive) {
        toast('⚠️ Gateway 未启动，任务将无法派发！', 'err');
        if (!confirm('Gateway 未启动，继续？')) return;
      }
    } catch {
      /* ignore */
    }

    if (!confirm(`确认下发任务？\n\n${cmd.substring(0, 200)}${cmd.length > 200 ? '…' : ''}`)) return;

    try {
      // 1. 如果有上传文件，先执行 RAG 注入
      if (fileToIngest) {
        setIngesting(true);
        toast(`📤 正在注入知识库: ${fileToIngest.name}...`, 'ok');
        const ir = await api.ragIngest({
          doc_id: `upload-${Date.now()}-${fileToIngest.name}`,
          content: fileToIngest.content,
          filename: fileToIngest.name,
          metadata: { filename: fileToIngest.name, source: 'user-upload', at: new Date().toISOString() }
        });
        setIngesting(false);
        if (!ir.ok) {
          toast(`❌ 知识注入失败: ${ir.error}`, 'err');
          if (!confirm('知识注入失败，是否仍要继续下发任务？')) return;
        } else {
          toast('✅ 知识库已更新', 'ok');
        }
      }

      // 2. 下发任务
      const params: Record<string, string> = {};
      for (const p of formTpl.params) {
        params[p.key] = formVals[p.key] || p.default || '';
      }
      const r = await api.createTask({
        title: cmd.substring(0, 120),
        org: '任务编排引擎',
        targetDept: formTpl.depts[0] || '',
        priority: 'normal',
        templateId: formTpl.id,
        params,
        meta: fileToIngest ? { uploaded_files: [fileToIngest.name] } : {},
      });
      if (r.ok) {
        toast(`✅ 任务指令已下达`, 'ok');
        setFormTpl(null);
        setFileToIngest(null);
        loadAll();
      } else {
        toast(r.error || '下发任务失败', 'err');
      }
    } catch (err) {
      setIngesting(false);
      toast('⚠️ 操作失败', 'err');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setFileToIngest(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      setFileToIngest({ name: file.name, content });
      toast(`📄 文件已就绪: ${file.name} (${Math.round(content.length / 1024)} KB)`, 'ok');
    };
    reader.readAsText(file);
  };

  return (
    <div>
      {/* Category filter */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {TPL_CATS.map((c) => (
          <span
            key={c.name}
            className={`tpl-cat${tplCatFilter === c.name ? ' active' : ''}`}
            onClick={() => setTplCatFilter(c.name)}
          >
            {c.icon} {c.name}
          </span>
        ))}
      </div>

      {/* Grid */}
      <div className="tpl-grid">
        {tpls.map((t) => (
          <div className="tpl-card" key={t.id}>
            <div className="tpl-top">
              <span className="tpl-icon">{t.icon}</span>
              <span className="tpl-name">{t.name}</span>
            </div>
            <div className="tpl-desc">{t.desc}</div>
            <div className="tpl-footer">
              {t.depts.map((d) => (
                <span className="tpl-dept" key={d}>{d}</span>
              ))}
              <span className="tpl-est">
                {t.est} · {t.cost}
              </span>
              <button className="tpl-go" onClick={() => openForm(t)}>
                下发任务
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Template Form Modal */}
      {formTpl && (
        <div className="modal-bg open" onClick={() => { if (!ingesting) setFormTpl(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setFormTpl(null)}>✕</button>
            <div className="modal-body">
              <div style={{ fontSize: 11, color: 'var(--acc)', fontWeight: 700, letterSpacing: '.04em', marginBottom: 4 }}>
                指令模板
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>
                {formTpl.icon} {formTpl.name}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 18 }}>{formTpl.desc}</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
                {formTpl.depts.map((d) => (
                  <span className="tpl-dept" key={d}>{d}</span>
                ))}
                <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>
                  {formTpl.est} · {formTpl.cost}
                </span>
              </div>

              <form className="tpl-form" onSubmit={execute}>
                {formTpl.params.map((p) => (
                  <div className="tpl-field" key={p.key}>
                    <label className="tpl-label">
                      {p.label}
                      {p.required && <span style={{ color: '#ff5270' }}> *</span>}
                    </label>
                    {p.type === 'textarea' ? (
                      <textarea
                        className="tpl-input"
                        style={{ minHeight: 80, resize: 'vertical' }}
                        required={p.required}
                        value={formVals[p.key] || ''}
                        onChange={(e) => setFormVals((v) => ({ ...v, [p.key]: e.target.value }))}
                      />
                    ) : p.type === 'select' ? (
                      <select
                        className="tpl-input"
                        value={formVals[p.key] || p.default || ''}
                        onChange={(e) => setFormVals((v) => ({ ...v, [p.key]: e.target.value }))}
                      >
                        {(p.options || []).map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="tpl-input"
                        type="text"
                        required={p.required}
                        value={formVals[p.key] || ''}
                        onChange={(e) => setFormVals((v) => ({ ...v, [p.key]: e.target.value }))}
                      />
                    )}
                  </div>
                ))}

                {/* 知识上传区域 */}
                <div className="tpl-field" style={{ borderTop: '1px solid var(--line)', paddingTop: 16, marginTop: 8 }}>
                  <label className="tpl-label">
                    🧠 知识注入 (可选)
                    <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--muted)', marginLeft: 8 }}>
                      将文档上传到 RAG 知识库，供 Agent 检索
                    </span>
                  </label>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <input
                      type="file"
                      accept=".txt,.md,.json,.py,.go"
                      onChange={handleFileChange}
                      id="rag-file-upload"
                      style={{ display: 'none' }}
                    />
                    <label
                      htmlFor="rag-file-upload"
                      style={{
                        padding: '8px 14px',
                        background: 'var(--panel)',
                        border: '1px solid var(--line)',
                        borderRadius: 8,
                        cursor: 'pointer',
                        fontSize: 12,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6
                      }}
                    >
                      {fileToIngest ? '📁 更改文件' : '➕ 选择文档'}
                    </label>
                    {fileToIngest && (
                      <span style={{ fontSize: 11, color: 'var(--ok)' }}>
                        {fileToIngest.name}
                      </span>
                    )}
                  </div>
                </div>

                {previewCmd && (
                  <div
                    style={{
                      background: 'var(--panel2)',
                      border: '1px solid var(--line)',
                      borderRadius: 8,
                      padding: 12,
                      marginBottom: 14,
                      fontSize: 12,
                      color: 'var(--muted)',
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
                      📋 将发送给任务编排引擎的指令：
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{previewCmd}</div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10 }}>
                  <button type="button" className="btn btn-g" onClick={preview} style={{ padding: '8px 16px', fontSize: 12 }}>
                    👁 预览指令
                  </button>
                  <button type="submit" className="tpl-go" disabled={ingesting} style={{ padding: '8px 20px', fontSize: 13, opacity: ingesting ? 0.6 : 1 }}>
                    {ingesting ? '📤 正在注入...' : '🚀 下发任务'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
