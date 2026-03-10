/**
 * Zustand Store — OpenClaw MAS看板状态管理
 * HTTP 5s 轮询，无 WebSocket
 */

import { create } from 'zustand';
import {
  api,
  type Task,
  type LiveStatus,
  type AgentConfig,
  type OfficialsData,
  type AgentsStatusData,
  type MorningBrief,
  type SubConfig,
  type ChangeLogEntry,
} from './api';

// ── Pipeline Definition (PIPE) ──

export const PIPE = [
  { key: 'Pending', dept: '用户', icon: '👤', action: '下发任务' },
  { key: 'Queued', dept: '协调中枢', icon: '🤖', action: '分拣' },
  { key: 'Planning', dept: '任务编排引擎', icon: '📋', action: '起草' },
  { key: 'PlanReview', dept: '安全审查引擎', icon: '🔍', action: '审议' },
  { key: 'Dispatching', dept: '任务调度引擎', icon: '📮', action: '派发' },
  { key: 'Executing', dept: '执行部门', icon: '⚙️', action: '执行' },
  { key: 'ResultReview', dept: '任务调度引擎', icon: '🔎', action: '汇总' },
  { key: 'Completed', dept: '任务总结', icon: '✅', action: '完成' },
] as const;

export const PIPE_STATE_IDX: Record<string, number> = {
  Pending: 0, Queued: 1, Planning: 2, PlanReview: 3,
  Dispatching: 4, Next: 4, Executing: 5, ResultReview: 6, Completed: 7, Blocked: 5, Cancelled: 5,
};

export const DEPT_COLOR: Record<string, string> = {
  '协调中枢': '#e8a040', '任务编排引擎': '#a07aff', '安全审查引擎': '#6a9eff', '任务调度引擎': '#6aef9a',
  '文档编写员': '#f5c842', '数据分析师': '#ff9a6a', '代码架构师': '#ff5270', '质量保证师': '#cc4444',
  '部署运维师': '#44aaff', '资源调配员': '#9b59b6', '用户': '#ffd700', '任务汇报': '#2ecc8a',
};

export const STATE_LABEL: Record<string, string> = {
  Pending: '待处理', Queued: '待路由', Planning: '编排起草',
  PlanReview: '安全审查', Dispatching: '调度派发中', Next: '待执行',
  Executing: '执行中', ResultReview: '待审查',
  Completed: '已完成', Blocked: '阻塞', Cancelled: '已取消',
};

export function deptColor(d: string): string {
  return DEPT_COLOR[d] || '#6a9eff';
}

export function stateLabel(t: Task): string {
  const r = t.review_round || 0;
  if (t.state === 'PlanReview' && r > 1) return `安全审查（第${r}轮）`;
  if (t.state === 'Planning' && r > 0) return `编排修订（第${r}轮）`;
  return STATE_LABEL[t.state] || t.state;
}

export function isEdict(t: Task): boolean {
  return /^(JJC|MAS)-/i.test(t.id || '');
}

export function isSession(t: Task): boolean {
  return /^(OC-|MC-)/i.test(t.id || '');
}

export function isArchived(t: Task): boolean {
  return t.archived || ['Completed', 'Cancelled'].includes(t.state);
}

export type PipeStatus = { key: string; dept: string; icon: string; action: string; status: 'done' | 'active' | 'pending' };

export function getPipeStatus(t: Task): PipeStatus[] {
  const stateIdx = PIPE_STATE_IDX[t.state] ?? 4;
  return PIPE.map((stage, i) => ({
    ...stage,
    status: (i < stateIdx ? 'done' : i === stateIdx ? 'active' : 'pending') as 'done' | 'active' | 'pending',
  }));
}

// ── Tabs ──

export type TabKey =
  | 'edicts' | 'monitor' | 'officials' | 'models'
  | 'skills' | 'sessions' | 'memorials' | 'templates' | 'morning';

export const TAB_DEFS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'edicts', label: '任务看板', icon: '📋' },
  { key: 'monitor', label: '节点调度', icon: '🏛️' },
  { key: 'officials', label: 'Agent 总览', icon: '👔' },
  { key: 'models', label: '模型配置', icon: '🤖' },
  { key: 'skills', label: '技能配置', icon: '🎯' },
  { key: 'sessions', label: '会话列表', icon: '💬' },
  { key: 'memorials', label: '任务归档', icon: '📜' },
  { key: 'templates', label: '指令库', icon: '📋' },
  { key: 'morning', label: '天下要闻', icon: '🌅' },
];

// ── DEPTS for monitor ──

export const DEPTS = [
  { id: 'coordinator', label: '协调中枢', emoji: '🤴', role: '协调中枢', rank: '核心' },
  { id: 'planner', label: '任务编排引擎', emoji: '📜', role: '规划引擎', rank: '核心' },
  { id: 'reviewer', label: '安全审查引擎', emoji: '🔍', role: '审核引擎', rank: '核心' },
  { id: 'dispatcher', label: '任务调度引擎', emoji: '📮', role: '调度引擎', rank: '核心' },
  { id: 'doc_writer', label: '文档编写员', emoji: '📚', role: '文档撰写', rank: '执行' },
  { id: 'data_analyst', label: '数据分析师', emoji: '💰', role: '数据分析', rank: '执行' },
  { id: 'software_engineer', label: '代码架构师', emoji: '🔧', role: '软件研发', rank: '执行' },
  { id: 'qa_engineer', label: '质量保证师', emoji: '⚖️', role: '质量保障', rank: '执行' },
  { id: 'monitor', label: '情报监控员', emoji: '📰', role: '系统监控', rank: '外围' },
];

// ── Templates ──

export interface TemplateParam {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select';
  default?: string;
  required?: boolean;
  options?: string[];
}

export interface Template {
  id: string;
  cat: string;
  icon: string;
  name: string;
  desc: string;
  depts: string[];
  est: string;
  cost: string;
  params: TemplateParam[];
  command: string;
}

export const TEMPLATES: Template[] = [
  {
    id: 'tpl-weekly-report', cat: '日常办公', icon: '📝', name: '周报生成',
    desc: '基于本周看板数据和各部产出，自动生成结构化周报',
    depts: ['数据分析师', '文档编写员'], est: '~10分钟', cost: '¥0.5',
    params: [
      { key: 'date_range', label: '报告周期', type: 'text', default: '本周', required: true },
      { key: 'focus', label: '重点关注（逗号分隔）', type: 'text', default: '项目进展,下周计划' },
      { key: 'format', label: '输出格式', type: 'select', options: ['Markdown', '飞书文档'], default: 'Markdown' },
    ],
    command: '生成{date_range}的周报，重点覆盖{focus}，输出为{format}格式',
  },
  {
    id: 'tpl-code-review', cat: '工程开发', icon: '🔍', name: '代码审查',
    desc: '对指定代码仓库/文件进行质量审查，输出问题清单和改进建议',
    depts: ['代码架构师', '质量保证师'], est: '~20分钟', cost: '¥2',
    params: [
      { key: 'repo', label: '仓库/文件路径', type: 'text', required: true },
      { key: 'scope', label: '审查范围', type: 'select', options: ['全量', '增量(最近commit)', '指定文件'], default: '增量(最近commit)' },
      { key: 'focus', label: '重点关注（可选）', type: 'text', default: '安全漏洞,错误处理,性能' },
    ],
    command: '对 {repo} 进行代码审查，范围：{scope}，重点关注：{focus}',
  },
  {
    id: 'tpl-api-design', cat: '工程开发', icon: '⚡', name: 'API 设计与实现',
    desc: '从需求描述到 RESTful API 设计、实现、测试一条龙',
    depts: ['任务编排引擎', '代码架构师'], est: '~45分钟', cost: '¥3',
    params: [
      { key: 'requirement', label: '需求描述', type: 'textarea', required: true },
      { key: 'tech', label: '技术栈', type: 'select', options: ['Python/FastAPI', 'Node/Express', 'Go/Gin'], default: 'Python/FastAPI' },
      { key: 'auth', label: '鉴权方式', type: 'select', options: ['JWT', 'API Key', '无'], default: 'JWT' },
    ],
    command: '设计并实现一个 {tech} 的 RESTful API：{requirement}。鉴权方式：{auth}',
  },
  {
    id: 'tpl-competitor', cat: '数据分析', icon: '📊', name: '竞品分析',
    desc: '爬取竞品网站数据，分析对比，生成结构化报告',
    depts: ['代码架构师', '数据分析师', '文档编写员'], est: '~60分钟', cost: '¥5',
    params: [
      { key: 'targets', label: '竞品名称/URL（每行一个）', type: 'textarea', required: true },
      { key: 'dimensions', label: '分析维度', type: 'text', default: '产品功能,定价策略,用户评价' },
      { key: 'format', label: '输出格式', type: 'select', options: ['Markdown报告', '表格对比'], default: 'Markdown报告' },
    ],
    command: '对以下竞品进行分析：\n{targets}\n\n分析维度：{dimensions}，输出格式：{format}',
  },
  {
    id: 'tpl-data-report', cat: '数据分析', icon: '📈', name: '数据报告',
    desc: '对给定数据集进行清洗、分析、可视化，输出分析报告',
    depts: ['数据分析师', '文档编写员'], est: '~30分钟', cost: '¥2',
    params: [
      { key: 'data_source', label: '数据源描述/路径', type: 'text', required: true },
      { key: 'questions', label: '分析问题（每行一个）', type: 'textarea' },
      { key: 'viz', label: '是否需要可视化图表', type: 'select', options: ['是', '否'], default: '是' },
    ],
    command: '对数据 {data_source} 进行分析。{questions}\n需要可视化：{viz}',
  },
  {
    id: 'tpl-blog', cat: '内容创作', icon: '✍️', name: '博客文章',
    desc: '给定主题和要求，生成高质量博客文章',
    depts: ['文档编写员'], est: '~15分钟', cost: '¥1',
    params: [
      { key: 'topic', label: '文章主题', type: 'text', required: true },
      { key: 'audience', label: '目标读者', type: 'text', default: '技术人员' },
      { key: 'length', label: '期望字数', type: 'select', options: ['~1000字', '~2000字', '~3000字'], default: '~2000字' },
      { key: 'style', label: '风格', type: 'select', options: ['技术教程', '观点评论', '案例分析'], default: '技术教程' },
    ],
    command: '写一篇关于「{topic}」的博客文章，面向{audience}，{length}，风格：{style}',
  },
  {
    id: 'tpl-deploy', cat: '工程开发', icon: '🚀', name: '部署方案',
    desc: '生成完整的部署检查单、Docker配置、CI/CD流程',
    depts: ['代码架构师', '部署运维师'], est: '~25分钟', cost: '¥2',
    params: [
      { key: 'project', label: '项目名称/描述', type: 'text', required: true },
      { key: 'env', label: '部署环境', type: 'select', options: ['Docker', 'K8s', 'VPS', 'Serverless'], default: 'Docker' },
      { key: 'ci', label: 'CI/CD 工具', type: 'select', options: ['GitHub Actions', 'GitLab CI', '无'], default: 'GitHub Actions' },
    ],
    command: '为项目「{project}」生成{env}部署方案，CI/CD使用{ci}',
  },
  {
    id: 'tpl-email', cat: '内容创作', icon: '📧', name: '邮件/通知文案',
    desc: '根据场景和目的，生成专业邮件或通知文案',
    depts: ['文档编写员'], est: '~5分钟', cost: '¥0.3',
    params: [
      { key: 'scenario', label: '使用场景', type: 'select', options: ['商务邮件', '产品发布', '客户通知', '内部公告'], default: '商务邮件' },
      { key: 'purpose', label: '目的/内容', type: 'textarea', required: true },
      { key: 'tone', label: '语调', type: 'select', options: ['正式', '友好', '简洁'], default: '正式' },
    ],
    command: '撰写一封{scenario}，{tone}语调。内容：{purpose}',
  },
  {
    id: 'tpl-standup', cat: '日常办公', icon: '🗓️', name: '每日站会摘要',
    desc: '汇总各部今日进展和明日计划，生成站会摘要',
    depts: ['任务调度引擎'], est: '~5分钟', cost: '¥0.3',
    params: [
      { key: 'range', label: '汇总范围', type: 'select', options: ['今天', '最近24小时', '昨天+今天'], default: '今天' },
    ],
    command: '汇总{range}各部工作进展和待办，生成工作站会摘要',
  },
];

export const TPL_CATS = [
  { name: '全部', icon: '📋' },
  { name: '日常办公', icon: '💼' },
  { name: '数据分析', icon: '📊' },
  { name: '工程开发', icon: '⚙️' },
  { name: '内容创作', icon: '✍️' },
];

// ── Main Store ──

interface AppStore {
  // Data
  liveStatus: LiveStatus | null;
  agentConfig: AgentConfig | null;
  changeLog: ChangeLogEntry[];
  officialsData: OfficialsData | null;
  agentsStatusData: AgentsStatusData | null;
  morningBrief: MorningBrief | null;
  subConfig: SubConfig | null;

  // UI State
  activeTab: TabKey;
  edictFilter: 'active' | 'archived' | 'all';
  sessFilter: string;
  tplCatFilter: string;
  selectedOfficial: string | null;
  modalTaskId: string | null;
  countdown: number;

  // Toast
  toasts: { id: number; msg: string; type: 'ok' | 'err' }[];

  // Actions
  setActiveTab: (tab: TabKey) => void;
  setEdictFilter: (f: 'active' | 'archived' | 'all') => void;
  setSessFilter: (f: string) => void;
  setTplCatFilter: (f: string) => void;
  setSelectedOfficial: (id: string | null) => void;
  setModalTaskId: (id: string | null) => void;
  setCountdown: (n: number) => void;
  toast: (msg: string, type?: 'ok' | 'err') => void;

  // Data fetching
  loadLive: () => Promise<void>;
  loadAgentConfig: () => Promise<void>;
  loadOfficials: () => Promise<void>;
  loadAgentsStatus: () => Promise<void>;
  loadMorning: () => Promise<void>;
  loadSubConfig: () => Promise<void>;
  loadAll: () => Promise<void>;
}

let _toastId = 0;

export const useStore = create<AppStore>((set, get) => ({
  liveStatus: null,
  agentConfig: null,
  changeLog: [],
  officialsData: null,
  agentsStatusData: null,
  morningBrief: null,
  subConfig: null,

  activeTab: 'edicts',
  edictFilter: 'active',
  sessFilter: 'all',
  tplCatFilter: '全部',
  selectedOfficial: null,
  modalTaskId: null,
  countdown: 5,

  toasts: [],

  setActiveTab: (tab) => {
    set({ activeTab: tab });
    const s = get();
    if (['models', 'skills', 'sessions'].includes(tab) && !s.agentConfig) s.loadAgentConfig();
    if (tab === 'officials' && !s.officialsData) s.loadOfficials();
    if (tab === 'monitor') s.loadAgentsStatus();
    if (tab === 'morning' && !s.morningBrief) s.loadMorning();
  },
  setEdictFilter: (f) => set({ edictFilter: f }),
  setSessFilter: (f) => set({ sessFilter: f }),
  setTplCatFilter: (f) => set({ tplCatFilter: f }),
  setSelectedOfficial: (id) => set({ selectedOfficial: id }),
  setModalTaskId: (id) => set({ modalTaskId: id }),
  setCountdown: (n) => set({ countdown: n }),

  toast: (msg, type = 'ok') => {
    const id = ++_toastId;
    set((s) => ({ toasts: [...s.toasts, { id, msg, type }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 3000);
  },

  loadLive: async () => {
    try {
      const data = await api.liveStatus();
      set({ liveStatus: data });
      // Also preload officials for monitor tab
      const s = get();
      if (!s.officialsData) {
        api.officialsStats().then((d) => set({ officialsData: d })).catch(() => { });
      }
    } catch {
      // silently fail
    }
  },

  loadAgentConfig: async () => {
    try {
      const cfg = await api.agentConfig();
      const log = await api.modelChangeLog();
      set({ agentConfig: cfg, changeLog: log });
    } catch {
      // silently fail
    }
  },

  loadOfficials: async () => {
    try {
      const data = await api.officialsStats();
      set({ officialsData: data });
    } catch {
      // silently fail
    }
  },

  loadAgentsStatus: async () => {
    try {
      const data = await api.agentsStatus();
      set({ agentsStatusData: data });
    } catch {
      set({ agentsStatusData: null });
    }
  },

  loadMorning: async () => {
    try {
      const [brief, config] = await Promise.all([api.morningBrief(), api.morningConfig()]);
      set({ morningBrief: brief, subConfig: config });
    } catch {
      // silently fail
    }
  },

  loadSubConfig: async () => {
    try {
      const config = await api.morningConfig();
      set({ subConfig: config });
    } catch {
      // silently fail
    }
  },

  loadAll: async () => {
    const s = get();
    await s.loadLive();
    const tab = s.activeTab;
    if (['models', 'skills'].includes(tab)) await s.loadAgentConfig();
  },
}));

// ── Countdown & Polling ──

let _ws: WebSocket | null = null;
let _wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function startPolling() {
  if (_ws) return;
  useStore.getState().loadAll();

  const connect = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    _ws = new WebSocket(`${protocol}//${host}/ws/live-status`);

    _ws.onopen = () => {
      console.log('WS connected');
      if (_wsReconnectTimer) clearTimeout(_wsReconnectTimer);
    };

    _ws.onmessage = (event) => {
      // Whenever Redis streams broadcast something, we reload state
      const s = useStore.getState();
      s.loadAll();
      s.setCountdown(5); // Reset UI countdown indicator
      window.dispatchEvent(new CustomEvent('ws_message', { detail: event.data }));
    };

    _ws.onclose = () => {
      console.log('WS disconnected, reconnecting in 3s...');
      _ws = null;
      _wsReconnectTimer = setTimeout(connect, 3000);
    };

    _ws.onerror = (err) => {
      console.error('WS error', err);
      if (_ws) _ws.close();
    };
  };

  connect();
}

export function stopPolling() {
  if (_ws) {
    _ws.close();
    _ws = null;
  }
  if (_wsReconnectTimer) {
    clearTimeout(_wsReconnectTimer);
    _wsReconnectTimer = null;
  }
}

// ── Utility ──

export function esc(s: string | undefined | null): string {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function timeAgo(iso: string | undefined): string {
  if (!iso) return '';
  try {
    const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) return '';
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return '刚刚';
    if (mins < 60) return mins + '分钟前';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + '小时前';
    return Math.floor(hrs / 24) + '天前';
  } catch {
    return '';
  }
}

