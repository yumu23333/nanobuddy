// ================================================================
//  core.js — 核心工具与全局状态（优化版）
//  提供：全局状态管理、认证工具、API 请求、图标系统、弹窗、工具加载等
// ================================================================

// ---------- 常量与配置 ----------

const CONFIG = {
  SCROLL_THRESHOLD: 120,
  TOAST_DURATION: 3000,
  MIN_API_KEY_LENGTH: 8,
  DEBUG_EVENTS_MAX: 500,
  TOOL_PANEL_DELAY: 300,
};

// ---------- 状态管理 ----------

const AppState = {
  currentPage: 'chat',
  sessionId: '',
  conversationId: '',
  currentConvId: '',
  splitConvId: '',
  isStreaming: false,
  isSplitStreaming: false,
  currentReader: null,
  fbHistory: [],
  debugEvents: [],
  debugActiveTab: 'events',
  currentPlan: null,
  agentMode: localStorage.getItem('nanobuddy_agent_mode') || 'react',
  _toolsLoaded: false,
};

// 认证状态（挂载到 window 保持兼容）
window.nanobuddyCurrentUser = null;
window.nanobuddyAuthReady = false;

// ---------- DOM 引用缓存 ----------

const DOM = {
  get statusDot() { return document.getElementById('statusDot'); },
  get statusText() { return document.getElementById('statusText'); },
  get toastContainer() { return document.getElementById('toastContainer'); },
  get toolPanel() { return document.getElementById('toolPanel'); },
  get toolPanelInner() { return document.getElementById('toolPanelInner'); },
  get toolMenuBtn() { return document.getElementById('toolMenuBtn'); },
  get loginOverlay() { return document.getElementById('loginOverlay'); },
  get loginError() { return document.getElementById('loginError'); },
};

// ---------- 认证工具 ----------

function getNanobuddyToken() {
  return localStorage.getItem('nanobuddy_token') || '';
}

function setNanobuddyToken(token) {
  if (token) localStorage.setItem('nanobuddy_token', token);
  else localStorage.removeItem('nanobuddy_token');
}

function getNanobuddyApiKey() {
  return localStorage.getItem('nanobuddy_api_key') || '';
}

function setNanobuddyApiKey(key) {
  if (key) localStorage.setItem('nanobuddy_api_key', key);
  else localStorage.removeItem('nanobuddy_api_key');
}

function nanobuddyAuthHeaders(extra) {
  const headers = {};
  if (extra) {
    if (extra instanceof Headers) {
      extra.forEach((v, k) => { headers[k] = v; });
    } else if (typeof extra === 'object') {
      Object.assign(headers, extra);
    }
  }

  const token = getNanobuddyToken();
  if (token) {
    headers['Authorization'] = 'Bearer ' + token;
    return headers;
  }

  const key = getNanobuddyApiKey();
  if (key && !key.includes('${') && key.length >= CONFIG.MIN_API_KEY_LENGTH) {
    headers['Authorization'] = 'Bearer ' + key;
    headers['X-API-Key'] = key;
  }
  return headers;
}

async function nanobuddyFetch(url, options = {}) {
  const headers = nanobuddyAuthHeaders(options.headers);
  const response = await fetch(url, { ...options, headers });

  // 处理 401 未授权
  if (response.status === 401) {
    const hadSession = !!window.nanobuddyAuthReady && !window.nanobuddyJustLoggedIn;
    const isCoreAuth =
      url.includes('/api/auth/me') ||
      url.includes('/api/admin/');

    if (hadSession && isCoreAuth) {
      setNanobuddyToken('');
      window.nanobuddyAuthReady = false;
      window.nanobuddyCurrentUser = null;
      if (typeof showLoginOverlay === 'function') {
        showLoginOverlay('登录已过期，请重新登录');
      }
    } else if (typeof showLoginOverlay === 'function') {
      const overlay = DOM.loginOverlay;
      if (overlay?.classList.contains('open')) {
        const errEl = DOM.loginError;
        if (errEl?.textContent?.includes('过期')) {
          errEl.textContent = '';
        }
      }
    }
  }
  return response;
}

// ---------- 图标系统 ----------

// Emoji → FA 映射
const EMOJI_FA_MAP = {
  '💬': 'fa-comments', '📚': 'fa-book-open', '📁': 'fa-folder', '⚙️': 'fa-gear',
  '🔧': 'fa-wrench', '📋': 'fa-clock', '➕': 'fa-plus', '📥': 'fa-cloud-arrow-down',
  '⏹': 'fa-stop', '🔍': 'fa-magnifying-glass', '🔄': 'fa-rotate', '💾': 'fa-floppy-disk',
  '🗑️': 'fa-trash-can', '🗑': 'fa-trash-can', '✕': 'fa-xmark', '👤': 'fa-user',
  '🤖': 'fa-robot', '🤔': 'fa-brain', '✅': 'fa-circle-check', '❌': 'fa-circle-xmark',
  '📖': 'fa-book-open', '🗣': 'fa-comment', '🏁': 'fa-flag', '💭': 'fa-comment-dots',
  '⏳': 'fa-hourglass-half', '👋': 'fa-hand-wave', '📊': 'fa-chart-simple',
  '⚡': 'fa-bolt', '📂': 'fa-folder-open', '🌐': 'fa-globe', '📝': 'fa-pen',
  '🔗': 'fa-link', '♻️': 'fa-recycle', '✏️': 'fa-pencil', '📦': 'fa-box-archive',
  '📤': 'fa-up-from-bracket', '👁️': 'fa-eye', '📑': 'fa-copy', '✉️': 'fa-envelope',
  '📎': 'fa-paperclip', '📨': 'fa-inbox', '▶️': 'fa-play', '🕐': 'fa-clock',
  '🔢': 'fa-hashtag', '📄': 'fa-file-lines', '🖼️': 'fa-image', '📜': 'fa-scroll',
  '☕': 'fa-mug-saucer', '🔵': 'fa-circle', '🐍': 'fa-code', '🎨': 'fa-palette',
  '📰': 'fa-newspaper', '📕': 'fa-file-pdf', '📘': 'fa-file-word', '📗': 'fa-file-excel',
  '📈': 'fa-chart-line', '🧹': 'fa-broom', '↔️': 'fa-right-left', '💻': 'fa-terminal',
  '🗃️': 'fa-database', '🎯': 'fa-bullseye', '🧠': 'fa-brain', 'ℹ️': 'fa-circle-info',
  '📽️': 'fa-video', '☑': 'fa-square-check', '📭': 'fa-inbox', '💡': 'fa-lightbulb',
  '🔎': 'fa-magnifying-glass', '🛠': 'fa-screwdriver-wrench',
};

// 工具名称 → Emoji 图标
const TOOL_ICON_MAP = {
  get_time: '🕐', calculator: '🔢', read_file: '📄', web_search: '🌐',
  browse_files: '📂', search_files: '🔍', read_document: '📖',
  query_knowledge: '🔎', index_knowledge: '📥', knowledge_stats: '📊',
  remove_from_knowledge: '🗑️',
  create_document: '📝', create_table: '📋', create_presentation: '📽️',
  analyze_data: '📈', format_data: '🔄', clean_data: '🧹',
  etl_pipeline: '🔗', convert_data: '↔️',
  delete_file: '🗑️', create_folder: '📁', rename_files: '✏️',
  organize_files: '📦', deduplicate_files: '♻️',
  exec: '💻', write_file: '📝', edit_file: '✏️', list_dir: '📂',
  glob: '🔍', grep: '🔎', web_fetch: '🌐', run_code: '▶️',
  browse_archive: '📦', extract_archive: '📤', create_archive: '📥',
  ocr_image: '👁️', ocr_pdf: '📄', ocr_batch: '📑',
  parse_email: '✉️', extract_email_attachments: '📎', batch_parse_emails: '📨',
  db_connect: '🔌', db_list_tables: '📋', db_describe_table: '📐',
  db_execute_query: '⚡', db_test_connection: '🔗', db_disconnect: '🔌',
};

// 工具名称 → FA 图标
const TOOL_FA_MAP = {
  get_time: 'fa-clock', calculator: 'fa-calculator', read_file: 'fa-file-lines',
  web_search: 'fa-globe', browse_files: 'fa-folder-open', search_files: 'fa-search',
  read_document: 'fa-book-open', query_knowledge: 'fa-magnifying-glass',
  index_knowledge: 'fa-cloud-arrow-down', knowledge_stats: 'fa-chart-simple',
  remove_from_knowledge: 'fa-trash-can',
  create_document: 'fa-file-word', create_table: 'fa-table', create_presentation: 'fa-file-powerpoint',
  analyze_data: 'fa-chart-line', format_data: 'fa-arrows-rotate', clean_data: 'fa-broom',
  etl_pipeline: 'fa-diagram-project', convert_data: 'fa-right-left',
  delete_file: 'fa-trash-can', create_folder: 'fa-folder-plus', rename_files: 'fa-pencil',
  organize_files: 'fa-boxes-stacked', deduplicate_files: 'fa-copy',
  exec: 'fa-terminal', write_file: 'fa-file-pen', edit_file: 'fa-pen', list_dir: 'fa-list',
  glob: 'fa-magnifying-glass', grep: 'fa-filter', web_fetch: 'fa-cloud',
  browse_archive: 'fa-box-archive', extract_archive: 'fa-file-zipper', create_archive: 'fa-box-archive',
  ocr_image: 'fa-eye', ocr_pdf: 'fa-file-pdf', ocr_batch: 'fa-layer-group',
  parse_email: 'fa-envelope', extract_email_attachments: 'fa-paperclip', batch_parse_emails: 'fa-envelope-open-text',
  run_code: 'fa-play',
  db_connect: 'fa-plug', db_list_tables: 'fa-table-list', db_describe_table: 'fa-table-columns',
  db_execute_query: 'fa-bolt', db_test_connection: 'fa-link', db_disconnect: 'fa-plug-circle-xmark',
};

// 工具分类配置
const TOOL_CATEGORIES = {
  utility: { label: '常用工具', fa: 'fa-bolt', bg: '#fff3e0', color: '#e65100', border: '#ffe0b2' },
  io: { label: '文件读写', fa: 'fa-folder-open', bg: '#e3f2fd', color: '#1565c0', border: '#bbdefb' },
  web: { label: '网络搜索', fa: 'fa-globe', bg: '#e8f5e9', color: '#2e7d32', border: '#c8e6c9' },
  filesystem: { label: '文件管理', fa: 'fa-folder', bg: '#f3e5f5', color: '#6a1b9a', border: '#e1bee7' },
  knowledge: { label: '知识库', fa: 'fa-book-open', bg: '#fce4ec', color: '#c62828', border: '#f8bbd0' },
  office: { label: '办公文档', fa: 'fa-file-pen', bg: '#e0f7fa', color: '#00695c', border: '#b2ebf2' },
  data: { label: '数据处理', fa: 'fa-chart-simple', bg: '#eceff1', color: '#37474f', border: '#cfd8dc' },
  general: { label: '其他', fa: 'fa-wrench', bg: '#f5f5f5', color: '#616161', border: '#e0e0e0' },
};

const CATEGORY_ORDER = ['utility', 'knowledge', 'office', 'filesystem', 'data', 'io', 'web', 'general'];

// 图标工具函数
function _dualIcon(emoji, faClass) {
  const cls = faClass || EMOJI_FA_MAP[emoji] || 'fa-circle';
  return `<i class="icon-fa fa-solid ${cls}"></i>`;
}

function _replaceEmoji(text) {
  if (!text) return text;
  let result = text;
  for (const [emoji, faClass] of Object.entries(EMOJI_FA_MAP)) {
    const pattern = new RegExp(emoji.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    result = result.replace(pattern, `<i class="fa-solid ${faClass}"></i>`);
  }
  return result;
}

// ---------- 文件扩展名 → FA 图标 ----------

function getFileIcon(ext) {
  const map = {
    '.pdf': 'fa-file-pdf', '.docx': 'fa-file-word', '.doc': 'fa-file-word',
    '.xlsx': 'fa-file-excel', '.xls': 'fa-file-excel',
    '.csv': 'fa-file-csv', '.json': 'fa-file-code', '.yaml': 'fa-file-code', '.yml': 'fa-file-code',
    '.py': 'fa-code', '.js': 'fa-code', '.ts': 'fa-code', '.java': 'fa-code', '.cpp': 'fa-gear',
    '.c': 'fa-gear', '.h': 'fa-gear', '.go': 'fa-code',
    '.html': 'fa-code', '.htm': 'fa-code', '.css': 'fa-palette', '.xml': 'fa-file-code',
    '.md': 'fa-file-lines', '.txt': 'fa-file-lines', '.log': 'fa-file-lines',
    '.sql': 'fa-database', '.sh': 'fa-terminal', '.bat': 'fa-terminal', '.ps1': 'fa-terminal',
    '.jpg': 'fa-image', '.jpeg': 'fa-image', '.png': 'fa-image', '.gif': 'fa-image',
    '.zip': 'fa-file-zipper', '.rar': 'fa-file-zipper', '.7z': 'fa-file-zipper',
    '.exe': 'fa-gear', '.msi': 'fa-gear',
    '.toml': 'fa-gear', '.ini': 'fa-gear', '.cfg': 'fa-gear', '.conf': 'fa-gear',
  };
  const fa = map[ext] || 'fa-file';
  return `<i class="icon-fa fa-solid ${fa}"></i>`;
}

// ---------- 文本工具 ----------

function escHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderMarkdown(text) {
  if (!text) return '';
  let result = text
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
  return result;
}

function autoScroll(el, threshold = CONFIG.SCROLL_THRESHOLD) {
  if (!el) return;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - threshold) {
    el.scrollTop = el.scrollHeight;
  }
}

// ---------- Toast 通知 ----------

function toast(msg, type = 'info') {
  const container = DOM.toastContainer;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), CONFIG.TOAST_DURATION);
}

// ---------- 模态弹窗 ----------

function createModal(title, message, buttons, options = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const card = document.createElement('div');
  card.className = 'modal-card';
  card.innerHTML = `<h3>${escHtml(title)}</h3><p>${escHtml(message)}</p>`;

  const btnWrapper = document.createElement('div');
  btnWrapper.className = 'modal-btns';

  buttons.forEach((btn) => {
    const el = document.createElement('button');
    el.textContent = btn.label;
    if (btn.className) el.className = btn.className;
    el.onclick = () => {
      overlay.remove();
      if (btn.action) btn.action();
    };
    btnWrapper.appendChild(el);
  });

  card.appendChild(btnWrapper);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // 点击背景关闭（如果有取消按钮）
  const hasCancel = buttons.some(b => b.isCancel);
  if (hasCancel) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }

  // ESC 关闭
  const onKey = (e) => {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);
}

function showConfirm(title, message, onConfirm, onCancel) {
  createModal(title, message, [
    { label: '取消', isCancel: true, action: onCancel },
    { label: '确定', className: 'btn-primary', action: onConfirm },
  ]);
}

function showDangerConfirm(title, message, onConfirm, onCancel) {
  createModal(title, message, [
    { label: '取消', isCancel: true, action: onCancel },
    { label: '确定删除', className: 'btn-danger', action: onConfirm },
  ]);
}

function showAlert(title, message, onOk) {
  createModal(title, message, [
    { label: '知道了', className: 'btn-primary', action: onOk },
  ]);
}

// ---------- 工具面板 ----------

async function loadTools() {
  const container = DOM.toolPanelInner;
  if (!container) return;

  try {
    const [toolsRes, displayRes] = await Promise.all([
      nanobuddyFetch('/tools').then(r => r.json()),
      nanobuddyFetch('/api/tools/display').then(r => r.json()),
    ]);

    const tools = toolsRes.tools || [];
    const nameMap = displayRes.tools || {};

    if (!tools.length) {
      container.innerHTML = '<div style="padding:10px 0;font-size:13px;color:#999">无可用工具</div>';
      return;
    }

    // 按分类分组
    const groups = {};
    tools.forEach(t => {
      const cat = t.category || 'general';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(t);
    });

    let html = '';
    CATEGORY_ORDER.forEach(cat => {
      const items = groups[cat];
      if (!items?.length) return;
      const cfg = TOOL_CATEGORIES[cat] || TOOL_CATEGORIES.general;
      html += `<div class="tp-category"><i class="fa-solid ${cfg.fa}"></i> ${cfg.label}</div>`;
      html += '<div class="tp-tags">';
      items.forEach(t => {
        const label = nameMap[t.name] || t.name;
        const fa = TOOL_FA_MAP[t.name] || 'fa-wrench';
        html += `<span class="tp-tag" style="background:${cfg.bg};color:${cfg.color};border-color:${cfg.border}" title="${t.name}">
          <i class="fa-solid ${fa}"></i> ${label}
        </span>`;
      });
      html += '</div>';
    });

    container.innerHTML = html;
  } catch {
    if (container) {
      container.innerHTML = '<div style="padding:10px 0;font-size:13px;color:#999">加载失败</div>';
    }
  }
}

function toggleToolPanel() {
  const panel = DOM.toolPanel;
  const btn = DOM.toolMenuBtn;
  if (!panel) return;

  if (panel.classList.contains('open')) {
    panel.classList.remove('open');
    btn?.classList.remove('active');
  } else {
    if (!AppState._toolsLoaded) {
      loadTools();
      AppState._toolsLoaded = true;
    }
    panel.classList.add('open');
    btn?.classList.add('active');
  }
}

// ---------- 状态检查 ----------

async function checkStatus() {
  try {
    const res = await nanobuddyFetch('/api/status');
    const data = await res.json();
    const dot = DOM.statusDot;
    const text = DOM.statusText;
    if (!dot || !text) return;

    if (data.model) {
      dot.className = 'status-dot online';
      const label = data.model.type === 'openai' ? 'API' : 'Ollama';
      text.textContent = `${label} · ${data.model.name} · ${data.knowledge.documents} 文档`;
    } else if (data.ollama?.available) {
      dot.className = 'status-dot online';
      text.textContent = `Ollama 已连接 · ${data.knowledge.documents} 文档`;
    } else {
      dot.className = 'status-dot offline';
      text.textContent = '未连接';
    }
  } catch {
    const dot = DOM.statusDot;
    const text = DOM.statusText;
    if (dot) dot.className = 'status-dot offline';
    if (text) text.textContent = '服务器异常';
  }
}

// ---------- 全局变量兼容（保持向后兼容） ----------

// 暴露状态到 window（供其他模块使用）
Object.defineProperties(window, {
  currentPage: {
    get: () => AppState.currentPage,
    set: (v) => { AppState.currentPage = v; },
  },
  sessionId: {
    get: () => AppState.sessionId,
    set: (v) => { AppState.sessionId = v; },
  },
  conversationId: {
    get: () => AppState.conversationId,
    set: (v) => { AppState.conversationId = v; },
  },
  currentConvId: {
    get: () => AppState.currentConvId,
    set: (v) => { AppState.currentConvId = v; },
  },
  splitConvId: {
    get: () => AppState.splitConvId,
    set: (v) => { AppState.splitConvId = v; },
  },
  isStreaming: {
    get: () => AppState.isStreaming,
    set: (v) => { AppState.isStreaming = v; },
  },
  isSplitStreaming: {
    get: () => AppState.isSplitStreaming,
    set: (v) => { AppState.isSplitStreaming = v; },
  },
  fbHistory: {
    get: () => AppState.fbHistory,
    set: (v) => { AppState.fbHistory = v; },
  },
  currentReader: {
    get: () => AppState.currentReader,
    set: (v) => { AppState.currentReader = v; },
  },
  debugEvents: {
    get: () => AppState.debugEvents,
    set: (v) => { AppState.debugEvents = v; },
  },
  debugActiveTab: {
    get: () => AppState.debugActiveTab,
    set: (v) => { AppState.debugActiveTab = v; },
  },
  currentPlan: {
    get: () => AppState.currentPlan,
    set: (v) => { AppState.currentPlan = v; },
  },
  agentMode: {
    get: () => AppState.agentMode,
    set: (v) => {
      AppState.agentMode = v;
      localStorage.setItem('nanobuddy_agent_mode', v);
    },
  },
});

// 暴露函数到 window
window.getNanobuddyToken = getNanobuddyToken;
window.setNanobuddyToken = setNanobuddyToken;
window.getNanobuddyApiKey = getNanobuddyApiKey;
window.setNanobuddyApiKey = setNanobuddyApiKey;
window.nanobuddyAuthHeaders = nanobuddyAuthHeaders;
window.nanobuddyFetch = nanobuddyFetch;
window.escHtml = escHtml;
window.getFileIcon = getFileIcon;
window.renderMarkdown = renderMarkdown;
window._dualIcon = _dualIcon;
window._replaceEmoji = _replaceEmoji;
window.toast = toast;
window.showConfirm = showConfirm;
window.showDangerConfirm = showDangerConfirm;
window.showAlert = showAlert;
window.loadTools = loadTools;
window.toggleToolPanel = toggleToolPanel;
window.checkStatus = checkStatus;
window._autoScroll = autoScroll;

// ---------- 初始化 ----------

document.addEventListener('DOMContentLoaded', () => {
  // 初始状态检查
  checkStatus();

  // 每 60 秒轮询一次状态
  setInterval(checkStatus, 60000);
});