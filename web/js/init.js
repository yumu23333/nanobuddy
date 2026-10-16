// ================================================================
//  init.js — 应用初始化模块（优化版）
//  负责：认证初始化、配置加载、事件绑定、模式切换
// ================================================================

// ---------- 常量与配置 ----------

const INIT_CONFIG = {
  STATUS_CHECK_INTERVAL: 15000,
  CHAT_INPUT_MAX_HEIGHT: 150,
  SPLIT_INPUT_MAX_HEIGHT: 100,
};

// ---------- DOM 引用 ----------

const InitDOM = {
  get chatInput() { return document.getElementById('chatInput'); },
  get splitInput() { return document.getElementById('splitInput'); },
  get modeBtnReact() { return document.getElementById('modeBtnReact'); },
  get modeBtnPlan() { return document.getElementById('modeBtnPlan'); },
};

// ---------- 初始化入口 ----------

/**
 * 应用初始化
 * 在 DOM 加载完成后执行
 */
async function initApp() {
  // 1. 初始化认证
  await initAuth();

  // 2. 如果认证未就绪，停止后续初始化
  if (!window.nanobuddyAuthReady) return;

  // 3. 加载各项配置
  loadAllConfigs();

  // 4. 设置模式按钮图标
  updateModeButtonIcons();

  // 5. 绑定输入框事件
  bindInputEvents();

  // 6. 启动状态轮询
  startStatusPolling();
}

/**
 * 加载所有配置
 */
function loadAllConfigs() {
  // 状态检查
  checkStatus();

  // 显示设置
  loadThinkingSetting();
  loadIconTheme();

  // 模型设置
  loadModelSettings();

  // 模式设置
  loadAgentMode();
  updateModeUI(agentMode);

  // 企业微信配置
  loadWorkConfig();
}

/**
 * 更新模式按钮图标（跟随主题）
 */
function updateModeButtonIcons() {
  const reactBtn = InitDOM.modeBtnReact;
  const planBtn = InitDOM.modeBtnPlan;

  if (reactBtn) {
    reactBtn.innerHTML = `${_dualIcon('⚡', 'fa-bolt')} 急速`;
  }
  if (planBtn) {
    planBtn.innerHTML = `${_dualIcon('📋', 'fa-clock')} 计划`;
  }
}

/**
 * 绑定输入框自动调整高度
 */
function bindInputEvents() {
  const chatInput = InitDOM.chatInput;
  const splitInput = InitDOM.splitInput;

  if (chatInput) {
    chatInput.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, INIT_CONFIG.CHAT_INPUT_MAX_HEIGHT) + 'px';
    });
  }

  if (splitInput) {
    splitInput.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, INIT_CONFIG.SPLIT_INPUT_MAX_HEIGHT) + 'px';
    });
  }
}

/**
 * 启动状态轮询
 */
function startStatusPolling() {
  // 立即检查一次（已在 loadAllConfigs 中调用，这里作为兜底）
  checkStatus();

  // 定时轮询
  setInterval(checkStatus, INIT_CONFIG.STATUS_CHECK_INTERVAL);
}

// ---------- Plan-and-Execute 模式 ----------

/**
 * 加载 Agent 模式
 */
async function loadAgentMode() {
  try {
    const res = await nanobuddyFetch(`/chat/mode?session_id=${sessionId}`);
    const data = await res.json();

    if (data.session_id) {
      sessionId = data.session_id;
    }

    agentMode = data.mode || 'react';
    updateModeUI(agentMode);
  } catch {
    // 静默失败，使用默认模式
  }
}

/**
 * 设置 Agent 模式
 */
async function setAgentMode(mode) {
  // 更新按钮状态
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  // 更新全局状态
  agentMode = mode;
  localStorage.setItem('nanobuddy_agent_mode', mode);

  // 通知后端
  try {
    await nanobuddyFetch('/chat/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, mode }),
    });
  } catch {
    // 静默失败
  }
}

/**
 * 更新模式 UI
 */
function updateModeUI(mode) {
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
}

// ---------- 导出全局接口 ----------

// 暴露初始化函数
window.initApp = initApp;

// 暴露模式相关函数（供其他模块调用）
window.loadAgentMode = loadAgentMode;
window.setAgentMode = setAgentMode;
window.updateModeUI = updateModeUI;

// 暴露配置常量（供调试）
window.INIT_CONFIG = INIT_CONFIG;

// ---------- 自动初始化 ----------

// DOM 加载完成后自动初始化
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});