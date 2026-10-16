// ================================================================
//  debug.js — 调试面板模块（优化版）
//  提供：事件时间线、工具调用详情、日志查看、Raw JSON 展示
// ================================================================

// ---------- 常量与配置 ----------

const DEBUG_CONFIG = {
  AUTO_REFRESH_INTERVAL: 3000,
  EVENT_DISPLAY_LIMIT: 150,
  LOG_DISPLAY_LIMIT: 80,
  LOG_FETCH_LIMIT: 100,
  TOOL_RESULT_PREVIEW: 800,
  SCROLL_NEAR_BOTTOM_THRESHOLD: 60,
};

const DEBUG_TABS = {
  events: { label: '事件流', icon: 'fa-list-ul' },
  tools: { label: '工具调用', icon: 'fa-wrench' },
  logs: { label: '日志', icon: 'fa-file-lines' },
  raw: { label: 'Raw JSON', icon: 'fa-code' },
};

const PHASE_LABELS = {
  knowledge: { label: '知识库', cls: 'dd-knowledge', icon: 'fa-book-open' },
  thinking: { label: '思考中', cls: 'dd-thinking', icon: 'fa-brain' },
  self_check: { label: '二次确认', cls: 'dd-thinking', icon: 'fa-rotate' },
  think_token: { label: 'token', cls: 'dd-thinking', icon: 'fa-comment-dots' },
  think_done: { label: '思考完成', cls: 'dd-thinking', icon: 'fa-circle-check' },
  tool_call: { label: '调用工具', cls: 'dd-toolcall', icon: 'fa-wrench' },
  tool_continue: { label: '自动续传', cls: 'dd-toolcall', icon: 'fa-hourglass-half' },
  tool_result: { label: '工具返回', cls: 'dd-toolresult', icon: 'fa-cloud-arrow-down' },
  plan_exec_start: { label: '计划执行', cls: 'dd-thinking', icon: 'fa-bolt' },
  plan_fallback: { label: '兜底执行', cls: 'dd-thinking', icon: 'fa-rotate' },
  plan_step: { label: '计划步骤', cls: 'dd-toolcall', icon: 'fa-clock' },
  plan_correction: { label: '步骤修正', cls: 'dd-toolcall', icon: 'fa-wrench' },
  plan_eval: { label: '步骤验证', cls: 'dd-thinking', icon: 'fa-magnifying-glass' },
  plan_eval_done: { label: '验证完成', cls: 'dd-thinking', icon: 'fa-circle-check' },
  plan_answering: { label: '综合分析', cls: 'dd-answer', icon: 'fa-brain' },
  answering: { label: '开始回答', cls: 'dd-answer', icon: 'fa-comment' },
  answer: { label: '回答', cls: 'dd-answer', icon: 'fa-comments' },
  error: { label: '错误', cls: 'dd-error', icon: 'fa-circle-xmark' },
  done: { label: '完成', cls: 'dd-answer', icon: 'fa-flag' },
};

// ---------- 状态管理 ----------

const DebugState = {
  activeTab: 'events',
  logTimer: null,
  autoTimer: null,
  isPanelOpen: false,
};

// ---------- DOM 引用 ----------

const DebugDOM = {
  get drawer() { return document.getElementById('debugDrawer'); },
  get body() { return document.getElementById('ddBody'); },
  get bar() { return document.getElementById('ddBar'); },
  get btn() { return document.getElementById('debugBtn'); },
  get tabs() { return document.querySelectorAll('.dd-tab'); },
};

// ---------- 工具函数 ----------

function getPhaseInfo(phase) {
  const info = PHASE_LABELS[phase];
  if (!info) return { label: phase, cls: '', icon: 'fa-link' };
  return info;
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString() + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function formatCount(count) {
  return count > 1 ? ` <span style="color:#e8b84b;font-weight:600">×${count}</span>` : '';
}

function getToolCallCount() {
  return debugEvents.filter(e => e.phase === 'tool_call').length;
}

function getLastEventTime() {
  const last = debugEvents[debugEvents.length - 1];
  return last ? formatTime(last._time) : '--';
}

function shouldAutoScroll(el) {
  if (!el) return false;
  return el.scrollTop + el.clientHeight >= el.scrollHeight - DEBUG_CONFIG.SCROLL_NEAR_BOTTOM_THRESHOLD;
}

// ---------- 渲染函数 ----------

function renderEventTimeline() {
  const body = DebugDOM.body;
  if (!debugEvents.length) {
    body.innerHTML = '<div class="dd-empty">等待对话事件...</div>';
    updateDebugBar();
    return;
  }

  // 将连续同类型事件合并（排除 tool_result 和 error）
  const groups = [];
  const start = Math.max(0, debugEvents.length - DEBUG_CONFIG.EVENT_DISPLAY_LIMIT);

  for (let i = start; i < debugEvents.length; i++) {
    const e = debugEvents[i];
    const last = groups[groups.length - 1];
    const shouldMerge = last && last.phase === e.phase && e.phase !== 'tool_result' && e.phase !== 'error';

    if (shouldMerge) {
      last.count++;
      last._time = e._time;
    } else {
      groups.push({
        phase: e.phase,
        _time: e._time,
        tools: e.tools,
        tool: e.tool,
        result: e.result,
        message: e.message,
        count: 1,
      });
    }
  }

  let html = '';
  for (const e of groups) {
    const info = getPhaseInfo(e.phase);
    const time = formatTime(e._time);
    const countLabel = formatCount(e.count);
    const iconHtml = `<i class="icon-fa fa-solid ${info.icon}"></i>`;

    html += `<div class="dd-entry ${info.cls}">`;
    html += `<span class="dd-time">${time}</span> `;
    html += `<span class="dd-phase">${iconHtml} ${info.label}</span>${countLabel}`;

    if (e.phase === 'tool_call' && e.tools) {
      html += ` <span style="color:#6bcf7f">${escHtml(e.tools.join(', '))}</span>`;
    }
    if (e.phase === 'tool_result') {
      html += ` <span style="color:#6bcf7f">${escHtml(e.tool || '')}</span>`;
      const snippet = (e.result || '').substring(0, DEBUG_CONFIG.TOOL_RESULT_PREVIEW);
      const hasMore = e.result && e.result.length > DEBUG_CONFIG.TOOL_RESULT_PREVIEW;
      html += `<div class="dd-detail dd-result">${escHtml(snippet)}${hasMore ? ' ...' : ''}</div>`;
    }
    if (e.phase === 'error') {
      html += `<div class="dd-detail" style="color:#e74c3c">${escHtml(e.message || '')}</div>`;
    }
    html += '</div>';
  }

  body.innerHTML = html || '<div class="dd-empty">无事件</div>';

  if (shouldAutoScroll(body)) {
    body.scrollTop = body.scrollHeight;
  }
  updateDebugBar();
}

function renderToolDetails() {
  const body = DebugDOM.body;
  const pairs = [];
  let pending = null;

  for (const e of debugEvents) {
    if (e.phase === 'tool_call') {
      pending = { time: e._time, tools: e.tools || [], result: null };
    }
    if (e.phase === 'tool_result' && pending) {
      pending.result = e;
      pairs.push(pending);
      pending = null;
    }
  }

  if (!pairs.length) {
    body.innerHTML = '<div class="dd-empty">暂无工具调用记录</div>';
    return;
  }

  let html = '';
  for (const p of pairs) {
    const time = formatTime(p.time);
    html += `<div class="dd-entry dd-toolcall">`;
    html += `<span class="dd-time">${time}</span> `;
    html += `<span class="dd-phase"><i class="icon-fa fa-solid fa-wrench"></i> ${escHtml(p.tools.join(', '))}</span>`;

    if (p.result) {
      const resultText = (p.result.result || '').substring(0, DEBUG_CONFIG.TOOL_RESULT_PREVIEW);
      html += `<div class="dd-detail dd-result" style="max-height:none">${escHtml(resultText)}</div>`;
    } else {
      html += `<div class="dd-detail" style="color:#e8b84b">等待结果...</div>`;
    }
    html += '</div>';
  }

  body.innerHTML = html;
  body.scrollTop = body.scrollHeight;
  updateDebugBar();
}

function renderRawJSON() {
  const body = DebugDOM.body;
  if (!debugEvents.length) {
    body.innerHTML = '<div class="dd-empty">无数据</div>';
    return;
  }

  const recent = debugEvents.slice(-30);
  let html = '<pre style="font-size:10px;line-height:1.4;white-space:pre-wrap;word-break:break-all">';

  for (const e of recent) {
    const obj = {};
    for (const key in e) {
      if (key !== '_time') obj[key] = e[key];
    }
    try {
      html += escHtml(JSON.stringify(obj, null, 2)) + '\n';
    } catch {
      html += escHtml(String(obj)) + '\n';
    }
  }

  html += '</pre>';
  body.innerHTML = html;
  body.scrollTop = body.scrollHeight;
}

async function refreshDebugLogs() {
  const body = DebugDOM.body;
  body.innerHTML = '<div style="text-align:center;padding:20px;color:#5a6080"><div class="spinner"></div>加载日志...</div>';

  try {
    const res = await nanobuddyFetch(`/api/debug/logs?limit=${DEBUG_CONFIG.LOG_FETCH_LIMIT}`);
    const data = await res.json();
    const logs = data.logs || [];

    if (!logs.length) {
      body.innerHTML = '<div class="dd-empty">暂无日志</div>';
      return;
    }

    const start = Math.max(0, logs.length - DEBUG_CONFIG.LOG_DISPLAY_LIMIT);
    let html = '';
    for (let i = start; i < logs.length; i++) {
      const l = logs[i];
      const levelClass = `dd-log-${l.level}`;
      html += `<div class="dd-log-entry">`;
      html += `<span class="dd-log-lvl ${levelClass}">[${l.level}]</span>`;
      html += `<span style="color:#6a7090">${escHtml(l.logger)}</span> `;
      html += `<span>${escHtml(l.message)}</span>`;
      html += '</div>';
    }
    body.innerHTML = html || '<div class="dd-empty">无日志</div>';
    body.scrollTop = body.scrollHeight;
  } catch (e) {
    body.innerHTML = `<div class="dd-empty">日志加载失败: ${e.message}</div>`;
  }
}

// ---------- 面板控制 ----------

function toggleDebug() {
  const drawer = DebugDOM.drawer;
  const btn = DebugDOM.btn;
  if (!drawer) return;

  const isOpen = drawer.classList.contains('open');

  if (isOpen) {
    drawer.classList.remove('open');
    if (btn) { btn.style.background = ''; btn.style.color = ''; }
    if (DebugState.logTimer) {
      clearInterval(DebugState.logTimer);
      DebugState.logTimer = null;
    }
    if (DebugState.autoTimer) {
      clearInterval(DebugState.autoTimer);
      DebugState.autoTimer = null;
    }
    DebugState.isPanelOpen = false;
  } else {
    drawer.classList.add('open');
    if (btn) { btn.style.background = 'var(--primary)'; btn.style.color = '#fff'; }
    DebugState.isPanelOpen = true;
    refreshDebugPanel();

    // 日志定时刷新
    DebugState.logTimer = setInterval(() => {
      if (DebugState.activeTab === 'logs') refreshDebugLogs();
      updateDebugBar();
    }, DEBUG_CONFIG.AUTO_REFRESH_INTERVAL);

    // 事件自动刷新
    DebugState.autoTimer = setInterval(() => {
      if (!DebugState.isPanelOpen) return;
      if (DebugState.activeTab === 'events') renderEventTimeline();
      else if (DebugState.activeTab === 'tools') renderToolDetails();
      updateDebugBar();
    }, DEBUG_CONFIG.AUTO_REFRESH_INTERVAL);
  }
}

function clearDebugEvents() {
  debugEvents = [];
  const body = DebugDOM.body;
  if (body) body.innerHTML = '<div class="dd-empty">已清空，等待新事件...</div>';
  updateDebugBar();
}

function switchDebugTab(tab) {
  DebugState.activeTab = tab;
  document.querySelectorAll('.dd-tab').forEach(t => t.classList.remove('active'));
  const el = document.querySelector(`.dd-tab[data-dtab="${tab}"]`);
  if (el) el.classList.add('active');
  refreshDebugPanel();
}

function refreshDebugPanel() {
  const tab = DebugState.activeTab;
  const handlers = {
    events: renderEventTimeline,
    tools: renderToolDetails,
    logs: refreshDebugLogs,
    raw: renderRawJSON,
  };
  const handler = handlers[tab];
  if (handler) handler();
}

function updateDebugBar() {
  const toolCount = getToolCallCount();
  const lastTime = getLastEventTime();
  const bar = DebugDOM.bar;
  if (bar) {
    bar.textContent = `事件: ${debugEvents.length} | 工具调用: ${toolCount} | 最后: ${lastTime}`;
  }
}

function refreshDebugLogsManual() {
  refreshDebugLogs();
}

// ---------- 导出全局接口 ----------

window.toggleDebug = toggleDebug;
window.clearDebugEvents = clearDebugEvents;
window.switchDebugTab = switchDebugTab;
window.refreshDebugPanel = refreshDebugPanel;
window.updateDebugBar = updateDebugBar;
window.refreshDebugLogs = refreshDebugLogsManual;
window.DebugState = DebugState;

// ---------- 初始化 ----------

// 清理定时器（页面卸载时）
window.addEventListener('beforeunload', () => {
  if (DebugState.logTimer) clearInterval(DebugState.logTimer);
  if (DebugState.autoTimer) clearInterval(DebugState.autoTimer);
});

// 主动检查面板状态（用于恢复）
document.addEventListener('DOMContentLoaded', () => {
  const drawer = DebugDOM.drawer;
  if (drawer && drawer.classList.contains('open')) {
    DebugState.isPanelOpen = true;
    refreshDebugPanel();
  }
});