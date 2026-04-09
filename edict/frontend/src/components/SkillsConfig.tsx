import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { api, RemoteSkillItem } from '../api';
import { cn } from '../lib/utils';
import {
  Wrench,
  Globe,
  Plus,
  RefreshCcw,
  X,
  PackageSearch,
  ExternalLink,
  Trash2,
  Download,
  TerminalSquare
} from 'lucide-react';

const COMMUNITY_SOURCES = [
  {
    label: 'obra/superpowers',
    emoji: '⚡',
    stars: '66.9k',
    desc: '全流程开发专家技能',
    skills: [
      { name: '头脑风暴(brainstorming)', url: 'https://raw.githubusercontent.com/obra/superpowers/refs/heads/main/skills/brainstorming/SKILL.md' },
      { name: 'test-driven-development', url: 'https://raw.githubusercontent.com/obra/superpowers/refs/heads/main/skills/test-driven-development/SKILL.md' },
      { name: 'systematic-debugging', url: 'https://raw.githubusercontent.com/obra/superpowers/refs/heads/main/skills/systematic-debugging/SKILL.md' },
      { name: 'writing-plans', url: 'https://raw.githubusercontent.com/obra/superpowers/refs/heads/main/skills/writing-plans/SKILL.md' },
    ],
  },
  {
    label: 'anthropics/skills',
    emoji: '🏛️',
    stars: '官方推荐',
    desc: 'Anthropic 官方技能库',
    skills: [
      { name: 'docx', url: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/docx/SKILL.md' },
      { name: 'pdf', url: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/pdf/SKILL.md' },
      { name: 'xlsx', url: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/xlsx/SKILL.md' },
      { name: 'frontend-design', url: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md' },
      { name: 'webapp-testing', url: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/webapp-testing/SKILL.md' },
    ],
  },
  {
    label: 'ComposioHQ/skills',
    emoji: '🌐',
    stars: '39.2k',
    desc: '100+ 社区精选技能',
    skills: [
      { name: 'github-integration', url: 'https://raw.githubusercontent.com/ComposioHQ/awesome-claude-skills/master/github-integration/SKILL.md' },
      { name: 'data-analysis', url: 'https://raw.githubusercontent.com/ComposioHQ/awesome-claude-skills/master/data-analysis/SKILL.md' },
    ],
  },
];

export default function SkillsConfig() {
  const agentConfig = useStore((s) => s.agentConfig);
  const loadAgentConfig = useStore((s) => s.loadAgentConfig);
  const toast = useStore((s) => s.toast);

  // Modals / Forms
  const [skillModal, setSkillModal] = useState<{ agentId: string; name: string; content: string; path: string } | null>(null);
  const [addForm, setAddForm] = useState<{ agentId: string; agentLabel: string } | null>(null);
  const [formData, setFormData] = useState({ name: '', desc: '', trigger: '' });
  const [submitting, setSubmitting] = useState(false);

  // Tabs
  const [activeTab, setActiveTab] = useState<'local' | 'remote'>('local');

  // Remote State
  const [remoteSkills, setRemoteSkills] = useState<RemoteSkillItem[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [addRemoteForm, setAddRemoteForm] = useState(false);
  const [remoteFormData, setRemoteFormData] = useState({ agentId: '', skillName: '', sourceUrl: '', description: '' });
  const [remoteSubmitting, setRemoteSubmitting] = useState(false);
  const [updatingSkill, setUpdatingSkill] = useState<string | null>(null);
  const [removingSkill, setRemovingSkill] = useState<string | null>(null);
  const [quickPickSource, setQuickPickSource] = useState<(typeof COMMUNITY_SOURCES)[0] | null>(null);
  const [quickPickAgent, setQuickPickAgent] = useState('');

  useEffect(() => {
    loadAgentConfig();
  }, [loadAgentConfig]);

  useEffect(() => {
    if (activeTab === 'remote') loadRemoteSkills();
  }, [activeTab]);

  const loadRemoteSkills = async () => {
    setRemoteLoading(true);
    try {
      const r = await api.remoteSkillsList();
      if (r.ok) setRemoteSkills(r.remoteSkills || []);
    } catch {
      toast('Failed to load remote skills', 'err');
    }
    setRemoteLoading(false);
  };

  const openSkill = async (agentId: string, skillName: string) => {
    setSkillModal({ agentId, name: skillName, content: '⟳ Loading...', path: '' });
    try {
      const r = await api.skillContent(agentId, skillName);
      if (r.ok) {
        setSkillModal({ agentId, name: skillName, content: r.content || '', path: r.path || '' });
      } else {
        setSkillModal({ agentId, name: skillName, content: '❌ ' + (r.error || 'Read failed'), path: '' });
      }
    } catch {
      setSkillModal({ agentId, name: skillName, content: '❌ 服务器连接失败', path: '' });
    }
  };

  const submitAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addForm || !formData.name) return;
    setSubmitting(true);
    try {
      const r = await api.addSkill(addForm.agentId, formData.name, formData.desc, formData.trigger);
      if (r.ok) {
        toast(`✅ Skill ${formData.name} added to ${addForm.agentLabel}`, 'ok');
        setAddForm(null);
        loadAgentConfig();
      } else {
        toast(r.error || 'Creation failed', 'err');
      }
    } catch {
      toast('Connection failed', 'err');
    }
    setSubmitting(false);
  };

  const submitAddRemote = async (e: React.FormEvent) => {
    e.preventDefault();
    const { agentId, skillName, sourceUrl, description } = remoteFormData;
    if (!agentId || !skillName || !sourceUrl) return;
    setRemoteSubmitting(true);
    try {
      const r = await api.addRemoteSkill(agentId, skillName, sourceUrl, description);
      if (r.ok) {
        toast(`✅ Remote skill ${skillName} added to ${agentId}`, 'ok');
        setAddRemoteForm(false);
        setRemoteFormData({ agentId: '', skillName: '', sourceUrl: '', description: '' });
        loadRemoteSkills();
        loadAgentConfig();
      } else {
        toast(r.error || 'Addition failed', 'err');
      }
    } catch {
      toast('Connection failed', 'err');
    }
    setRemoteSubmitting(false);
  };

  const handleUpdate = async (skill: RemoteSkillItem) => {
    const key = `${skill.agentId}/${skill.skillName}`;
    setUpdatingSkill(key);
    try {
      const r = await api.updateRemoteSkill(skill.agentId, skill.skillName);
      if (r.ok) {
        toast(`✅ Skill ${skill.skillName} updated`, 'ok');
        loadRemoteSkills();
      } else {
        toast(r.error || 'Update failed', 'err');
      }
    } catch {
      toast('Connection error', 'err');
    }
    setUpdatingSkill(null);
  };

  const handleRemove = async (skill: RemoteSkillItem) => {
    const key = `${skill.agentId}/${skill.skillName}`;
    setRemovingSkill(key);
    try {
      const r = await api.removeRemoteSkill(skill.agentId, skill.skillName);
      if (r.ok) {
        toast(`🗑️ Skill ${skill.skillName} removed`, 'ok');
        loadRemoteSkills();
        loadAgentConfig();
      } else {
        toast(r.error || 'Removal failed', 'err');
      }
    } catch {
      toast('Connection failed', 'err');
    }
    setRemovingSkill(null);
  };

  const handleQuickImport = async (skillUrl: string, skillName: string) => {
    if (!quickPickAgent) { toast('Please select a target Agent', 'err'); return; }
    try {
      const r = await api.addRemoteSkill(quickPickAgent, skillName, skillUrl, '');
      if (r.ok) {
        toast(`✅ ${skillName} imported for ${quickPickAgent}`, 'ok');
        loadRemoteSkills();
        loadAgentConfig();
      } else {
        toast(r.error || 'Import failed', 'err');
      }
    } catch {
      toast('Connection failed', 'err');
    }
  };

  if (!agentConfig?.agents) {
    return (
      <div className="flex flex-col items-center justify-center p-20 text-slate-400 opacity-60 bg-white rounded-3xl border border-slate-200">
        <Wrench className="w-12 h-12 mb-4 animate-[spin_3s_linear_infinite]" />
        <p className="text-sm font-semibold uppercase tracking-widest">等待服务器响应...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Primary Tabs */}
      <div className="flex gap-2 border-b border-slate-200 pb-[1px] relative z-10">
        {[
          { key: 'local', label: '本地技能', count: agentConfig.agents.reduce((n, a) => n + (a.skills?.length || 0), 0), icon: TerminalSquare },
          { key: 'remote', label: '远程货架库', count: remoteSkills.length, icon: Globe },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key as any)}
            className={cn(
              "px-5 py-3 text-sm font-semibold transition-all rounded-t-lg flex items-center gap-2",
              activeTab === t.key
                ? "bg-white text-primary-700 border-x border-t border-slate-200 shadow-[0_-4px_6px_-3px_rgba(0,0,0,0.02)] translate-y-[1px]"
                : "text-slate-500 hover:text-slate-800 bg-slate-50 border border-transparent"
            )}
          >
            <t.icon className={cn("w-4 h-4", activeTab === t.key ? "text-primary-500" : "text-slate-400")} />
            {t.label}
            {t.count > 0 && (
              <span className={cn(
                "ml-1 text-[10px] px-2 py-0.5 rounded-full font-bold",
                activeTab === t.key ? "bg-primary-100 text-primary-700" : "bg-slate-200 text-slate-500"
              )}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="pt-2">
        {/* ── Local Skills Panel ── */}
        {activeTab === 'local' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {agentConfig.agents.map((ag) => (
              <div className="panel flex flex-col" key={ag.id}>
                <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 flex items-center justify-center text-2xl bg-white border border-slate-200 rounded-lg shadow-sm">
                      {ag.emoji || '🏛️'}
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-800">{ag.label}</h3>
                      <p className="text-xs text-slate-500 font-medium">Id: {ag.id}</p>
                    </div>
                  </div>
                  <div className="text-xs font-bold text-slate-500 bg-white border border-slate-200 px-2.5 py-1 rounded-lg shadow-sm">
                    {(ag.skills || []).length} 个技能
                  </div>
                </div>

                <div className="flex-1 p-4 bg-white flex flex-col gap-2 min-h-[200px] overflow-y-auto max-h-[350px]">
                  {!(ag.skills || []).length ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 py-10 opacity-70">
                      <PackageSearch className="w-10 h-10 mb-2 text-slate-300" strokeWidth={1.5} />
                      <span className="text-sm font-semibold">暂无配置的技能</span>
                    </div>
                  ) : (
                    (ag.skills || []).map((sk) => (
                      <div
                        className="group flex flex-col p-3 rounded-xl border border-slate-100 hover:border-primary-200 hover:shadow-subtle cursor-pointer transition-all bg-slate-50 hover:bg-white"
                        key={sk.name}
                        onClick={() => openSkill(ag.id, sk.name)}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-bold text-slate-700 group-hover:text-primary-700 transition-colors">📦 {sk.name}</span>
                          <ExternalLink className="w-3.5 h-3.5 text-slate-300 group-hover:text-primary-400" />
                        </div>
                        <span className="text-xs text-slate-500 line-clamp-1">{sk.description || '暂无详细描述'}</span>
                      </div>
                    ))
                  )}
                </div>

                <div className="p-3 border-t border-slate-100 bg-slate-50">
                  <button
                    className="w-full btn-secondary border-dashed border-slate-300 hover:border-primary-300 hover:text-primary-600 bg-white flex items-center justify-center gap-2 py-2.5"
                    onClick={() => setAddForm({ agentId: ag.id, agentLabel: ag.label })}
                  >
                    <Plus className="w-4 h-4" /> 创建本地技能
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Remote Skills Panel ── */}
        {activeTab === 'remote' && (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-3 items-center">
              <button className="btn-primary flex items-center gap-2" onClick={() => { setAddRemoteForm(true); setQuickPickSource(null); }}>
                <Plus className="w-4 h-4" /> 自定义远程技能
              </button>
              <button className="btn-secondary flex items-center gap-2" onClick={loadRemoteSkills}>
                <RefreshCcw className={cn("w-4 h-4 text-slate-500", remoteLoading && "animate-spin")} /> 刷新同步状态
              </button>
            </div>

            {/* Quick Connect Market */}
            <div className="panel p-6 border-indigo-100 bg-indigo-50/30">
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Globe className="w-4 h-4 text-indigo-500" /> 社区发现广场
              </h3>
              <div className="flex flex-wrap gap-3 mb-6">
                {COMMUNITY_SOURCES.map((src) => (
                  <div
                    key={src.label}
                    onClick={() => setQuickPickSource(quickPickSource?.label === src.label ? null : src)}
                    className={cn(
                      "px-4 py-2.5 rounded-xl border cursor-pointer transition-all flex items-center gap-3",
                      quickPickSource?.label === src.label
                        ? "bg-indigo-600 border-indigo-700 shadow-md text-white scale-[1.02]"
                        : "bg-white border-slate-200 hover:border-indigo-300 hover:shadow-sm"
                    )}
                  >
                    <span className="text-xl">{src.emoji}</span>
                    <div className="flex flex-col">
                      <span className={cn("font-bold text-sm", quickPickSource?.label === src.label ? "text-white" : "text-slate-800")}>{src.label}</span>
                      <span className={cn("text-[10px] font-semibold mt-0.5", quickPickSource?.label === src.label ? "text-indigo-200" : "text-slate-500")}>
                        ★ {src.stars} • {src.desc}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {quickPickSource && (
                <div className="bg-white rounded-xl border border-indigo-200 p-5 shadow-sm">
                  <div className="flex flex-col md:flex-row md:items-center gap-4 mb-5 pb-4 border-b border-slate-100">
                    <span className="text-sm font-bold text-slate-700">目标接收智能体：</span>
                    <select
                      value={quickPickAgent}
                      onChange={(e) => setQuickPickAgent(e.target.value)}
                      className="input-field w-full md:w-64 border-indigo-200 focus:ring-indigo-500/20 focus:border-indigo-500"
                    >
                      <option value="">— 请选择接收方 —</option>
                      {agentConfig.agents.map((ag) => (
                        <option key={ag.id} value={ag.id}>{ag.emoji} {ag.label} ({ag.id})</option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[300px] overflow-y-auto pr-2">
                    {quickPickSource.skills.map((sk) => {
                      const alreadyAdded = remoteSkills.some((r) => r.skillName === sk.name && r.agentId === quickPickAgent);
                      return (
                        <div key={sk.name} className="flex flex-col p-3 bg-slate-50 border border-slate-200 rounded-xl justify-between gap-3">
                          <div>
                            <div className="text-sm font-bold text-slate-800 mb-1 flex items-center gap-2">📦 {sk.name}</div>
                            <div className="text-[10px] font-mono text-slate-400 break-all bg-white px-2 py-1 rounded border border-slate-100">
                              {sk.url.split('/').slice(-3).join('/')}
                            </div>
                          </div>
                          <div className="flex justify-end">
                            {alreadyAdded ? (
                              <span className="text-[11px] text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded font-bold">✓ 已导入</span>
                            ) : (
                              <button
                                onClick={() => handleQuickImport(sk.url, sk.name)}
                                className="btn-primary py-1.5 px-3 text-xs flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 border-indigo-700"
                              >
                                <Download className="w-3.5 h-3.5" /> 挂载该技能
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Active Remote List */}
            {remoteLoading ? (
              <div className="text-center py-20 text-slate-400 font-medium">加载同步状态中...</div>
            ) : remoteSkills.length === 0 ? (
              <div className="panel py-20 flex flex-col items-center border-dashed opacity-70">
                <Globe className="w-16 h-16 text-slate-300 mb-4" />
                <p className="text-base font-semibold text-slate-600">未发现绑定的远程库</p>
                <p className="text-sm text-slate-500 mt-1">请通过上方的社区选择并导入或自定义填写 GitHub Raw 地址</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {remoteSkills.map((sk) => {
                  const key = `${sk.agentId}/${sk.skillName}`;
                  const isUpdating = updatingSkill === key;
                  const isRemoving = removingSkill === key;
                  const agInfo = agentConfig.agents.find((a) => a.id === sk.agentId);

                  return (
                    <div key={key} className="panel p-5 flex flex-col hover:border-indigo-200 transition-colors">
                      <div className="flex items-start justify-between mb-3 border-b border-slate-100 pb-3">
                        <div className="min-w-0 pr-4">
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <span className="text-base font-bold text-slate-800">📦 {sk.skillName}</span>
                            <span className={cn(
                              "text-[10px] font-bold px-2 py-0.5 rounded-full border",
                              sk.status === 'valid' ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-600 border-red-200"
                            )}>
                              {sk.status === 'valid' ? '✓ 链接正常' : '✗ 同步异常'}
                            </span>
                          </div>
                          <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-slate-100 border border-slate-200 rounded text-[11px] font-semibold text-slate-600">
                            {agInfo?.emoji} {agInfo?.label || sk.agentId}
                          </div>
                        </div>
                      </div>

                      {sk.description && <p className="text-sm text-slate-600 mb-3 line-clamp-2">{sk.description}</p>}

                      <div className="mt-auto space-y-3">
                        <div className="text-[10px] font-mono text-slate-500 bg-slate-50 p-2 rounded border border-slate-100 break-all leading-relaxed">
                          <a href={sk.sourceUrl} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline hover:text-primary-700">{sk.sourceUrl}</a>
                        </div>

                        <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
                          <span>同步日期: {sk.lastUpdated ? sk.lastUpdated.slice(0, 10) : sk.addedAt?.slice(0, 10)}</span>

                          <div className="flex gap-2">
                            <button onClick={() => openSkill(sk.agentId, sk.skillName)} className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
                              查看内容
                            </button>
                            <button onClick={() => handleUpdate(sk)} disabled={isUpdating} className="px-3 py-1.5 rounded-lg border border-primary-200 text-primary-600 bg-primary-50 hover:bg-primary-100 transition-colors flex items-center gap-1">
                              {isUpdating ? <RefreshCcw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />} 强制更新
                            </button>
                            <button onClick={() => handleRemove(sk)} disabled={isRemoving} className="px-3 py-1.5 rounded-lg border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 transition-colors">
                              {isRemoving ? '...' : <Trash2 className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* --- Global Modals --- */}

      {/* Skill Inspect Modal */}
      {skillModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" onClick={() => setSkillModal(null)}>
          <div className="relative w-full max-w-4xl max-h-[85vh] panel flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            <header className="p-5 border-b border-slate-200 flex justify-between items-center bg-white rounded-t-xl shrink-0">
              <div>
                <div className="text-[10px] font-bold text-primary-600 uppercase tracking-widest bg-primary-50 px-2 py-0.5 rounded w-fit mb-1 border border-primary-100">
                  {skillModal.agentId}
                </div>
                <h2 className="text-xl font-bold text-slate-800">📦 {skillModal.name}</h2>
              </div>
              <button className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 transition-colors" onClick={() => setSkillModal(null)}>
                <X className="w-5 h-5" />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
              <pre className="font-mono text-[11px] lg:text-xs leading-relaxed text-slate-700 bg-white p-5 rounded-xl border border-slate-200 shadow-sm whitespace-pre-wrap word-break-all">
                {skillModal.content}
              </pre>
              {skillModal.path && (
                <div className="mt-4 text-xs font-semibold text-slate-400 flex items-center gap-2">
                  📂 <span className="bg-white px-2 py-1 rounded border border-slate-200">{skillModal.path}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add Local Skill Modal */}
      {addForm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" onClick={() => setAddForm(null)}>
          <div className="relative w-full max-w-lg panel shadow-2xl bg-white" onClick={e => e.stopPropagation()}>
            <header className="p-5 border-b border-slate-100 flex justify-between items-center">
              <div>
                <div className="text-[10px] font-bold text-primary-600 uppercase tracking-widest bg-primary-50 px-2 py-0.5 rounded w-fit mb-1 border border-primary-100">
                  Target: {addForm.agentLabel}
                </div>
                <h2 className="text-xl font-bold text-slate-800">New Local Skill</h2>
              </div>
              <button className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors" onClick={() => setAddForm(null)}>
                <X className="w-5 h-5" />
              </button>
            </header>
            <form onSubmit={submitAdd} className="p-6 space-y-5">
              <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-xl text-xs text-indigo-800 leading-relaxed font-medium">
                <strong className="text-indigo-900 block mb-1.5 text-sm uppercase tracking-wide">本地构建规则</strong>
                • 标识符限定为 <strong className="text-indigo-900">小写字母和数字及短划线组合</strong>。<br />
                • 确认后系统将在该节点配置路径中生成自动的 SKILL.md 初始化结构以供进一步开发。
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">功能标识符 <span className="text-red-500">*</span></label>
                  <input type="text" required placeholder="如：data-analysis" className="input-field"
                    value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">功用短述</label>
                  <input type="text" placeholder="简洁表述该技能的作用" className="input-field"
                    value={formData.desc} onChange={e => setFormData(p => ({ ...p, desc: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">自唤醒预设条件</label>
                  <input type="text" placeholder="在何种情景满足时触发该工作流..." className="input-field"
                    value={formData.trigger} onChange={e => setFormData(p => ({ ...p, trigger: e.target.value }))}
                  />
                </div>
              </div>

              <div className="flex gap-3 justify-end pt-5 mt-2 border-t border-slate-100">
                <button type="button" className="btn-secondary" onClick={() => setAddForm(null)}>撤销及取消</button>
                <button type="submit" disabled={submitting} className="btn-primary min-w-[120px]">
                  {submitting ? '环境配置中...' : '核准并部署技能'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Remote Skill Modal */}
      {addRemoteForm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" onClick={() => setAddRemoteForm(false)}>
          <div className="relative w-full max-w-xl panel shadow-2xl bg-white" onClick={e => e.stopPropagation()}>
            <header className="p-5 border-b border-slate-100 flex justify-between items-center">
              <div>
                <div className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest bg-indigo-50 px-2 py-0.5 rounded w-fit mb-1 border border-indigo-100">
                  Registry Sync
                </div>
                <h2 className="text-xl font-bold text-slate-800">Add Remote Hook</h2>
              </div>
              <button className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors" onClick={() => setAddRemoteForm(false)}>
                <X className="w-5 h-5" />
              </button>
            </header>

            <form onSubmit={submitAddRemote} className="p-6 space-y-5">
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 leading-relaxed font-medium font-mono text-center break-all">
                支持以原始文档解析的终端指向 (如 GitHub Raw 等格式)
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">目标指派集群节点 <span className="text-red-500">*</span></label>
                  <select required className="input-field cursor-pointer"
                    value={remoteFormData.agentId} onChange={e => setRemoteFormData(p => ({ ...p, agentId: e.target.value }))}
                  >
                    <option value="">— 选择接收源头 —</option>
                    {agentConfig.agents.map((ag) => (
                      <option key={ag.id} value={ag.id}>{ag.emoji} {ag.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">自定义网络技能符 <span className="text-red-500">*</span></label>
                  <input type="text" required placeholder="例如：brainstorming" className="input-field"
                    value={remoteFormData.skillName} onChange={e => setRemoteFormData(p => ({ ...p, skillName: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">载荷网络 URL <span className="text-red-500">*</span></label>
                  <input type="url" required placeholder="https://raw.githubusercontent.com/..." className="input-field font-mono text-xs"
                    value={remoteFormData.sourceUrl} onChange={e => setRemoteFormData(p => ({ ...p, sourceUrl: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">补充简述注解</label>
                  <input type="text" placeholder="描述该模块功用" className="input-field"
                    value={remoteFormData.description} onChange={e => setRemoteFormData(p => ({ ...p, description: e.target.value }))}
                  />
                </div>
              </div>

              <div className="flex gap-3 justify-end pt-5 mt-2 border-t border-slate-100">
                <button type="button" className="btn-secondary" onClick={() => setAddRemoteForm(false)}>放弃设定</button>
                <button type="submit" disabled={remoteSubmitting} className="btn-primary min-w-[120px] bg-indigo-600 hover:bg-indigo-700 border-indigo-700">
                  {remoteSubmitting ? '握手同步中...' : '注册远程挂载点'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
