// ================================================================
//  chat.js — 聊天核心模块（优化版）
//  采用 ES6+ 语法，模块化组织，提取常量和工具函数
// ================================================================

// ---------- 常量与配置 ----------

const CHAT_CONFIG = {
  SCROLL_THRESHOLD: 120,
  MAX_INPUT_HEIGHT: 160,
  THINKING_UPDATE_INTERVAL: 1000,
  TOOL_TIMER_INTERVAL: 1000,
  PREVIEW_MESSAGE_LIMIT: 30,
  TOOL_RESULT_PREVIEW_LENGTH: 300,
  MAX_THINKING_DISPLAY: 2000,
  COMPACT_THRESHOLD: 60000,
};

const QUICK_COMMANDS = [
  { cmd: '/new', desc: '新建对话' },
  { cmd: '/clear', desc: '删除当前对话' },
  { cmd: '/compact', desc: '压缩对话历史' },
  { cmd: '/skills', desc: '技能列表' },
  { cmd: '/use', desc: '激活技能' },
  { cmd: '/unload', desc: '卸载技能' },
  { cmd: '/status', desc: '系统状态' },
  { cmd: '/selfcheck', desc: '运行自检' },
  { cmd: '/tools', desc: '工具列表' },
  { cmd: '/knowledge', desc: '知识库统计' },
  { cmd: '/cost', desc: '会话统计' },
  { cmd: '/history', desc: '历史对话' },
];

const SKILL_PRESETS = [
  { name: '🗄️ 数据处理', skills: ['iceberg', 'paimon', 'flink', 'fluss', 'lance', 'iggy', 'docker-compose'] },
  { name: '📄 办公文档', skills: ['docx', 'xlsx', 'pdf', 'pptx'] },
  { name: '🎨 内容创作', skills: ['doc-coauthoring', 'internal-comms', 'deck'] },
  { name: '💻 前端开发', skills: ['frontend-design', 'web-artifacts-builder', 'webapp-testing'] },
  { name: '🎭 设计', skills: ['canvas-design', 'brand-guidelines', 'theme-factory', 'algorithmic-art', 'slack-gif-creator'] },
];

// ---------- 状态管理 ----------

const ChatState = {
  sessionId: '',
  currentConvId: '',
  conversationId: '',
  isStreaming: false,
  currentReader: null,
  currentPlan: null,
  uploadedFiles: [],
  uploadIdCounter: 0,
  toolTimers: {},
  debugEvents: [],
  thinkingTimer: null,
};

// ---------- DOM 引用缓存 ----------

const CHAT_DOM = {
  get chatMessages() { return document.getElementById('chatMessages'); },
  get chatInput() { return document.getElementById('chatInput'); },
  get sendBtn() { return document.getElementById('sendBtn'); },
  get stopBtn() { return document.getElementById('stopBtn'); },
  get convTitle() { return document.getElementById('convTitle'); },
  get filePreview() { return document.getElementById('filePreview'); },
  get quickCmdBar() { return document.getElementById('quickCmdBar'); },
  get skillPanel() { return document.getElementById('skillPanel'); },
  get skillPanelBody() { return document.getElementById('skillPanelBody'); },
  get historyOverlay() { return document.getElementById('historyOverlay'); },
  get historyList() { return document.getElementById('historyList'); },
  get splitMessages() { return document.getElementById('splitMessages'); },
  get splitInput() { return document.getElementById('splitInput'); },
  get convPanel() { return document.getElementById('convPanel'); },
};

// ---------- 工具函数 ----------

/** 智能滚动：用户不在底部时不强制下拉 */
function autoScroll(el, threshold = CHAT_CONFIG.SCROLL_THRESHOLD) {
  if (!el) return;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - threshold) {
    el.scrollTop = el.scrollHeight;
  }
}

/** 安全获取会话 ID */
function getSessionId() {
  return ChatState.sessionId || ChatState.currentConvId || ChatState.conversationId;
}

/** 更新会话 ID */
function setSessionId(id) {
  ChatState.sessionId = id;
  ChatState.currentConvId = id;
  ChatState.conversationId = id;
}

/** 检查是否显示思考过程 */
function isShowThinking() {
  const checkbox = document.getElementById('setShowThinking');
  return checkbox ? checkbox.checked : true;
}

/** 自动调整输入框高度 */
function autoResizeInput(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, CHAT_CONFIG.MAX_INPUT_HEIGHT) + 'px';
}

/** 获取文件图标 */
function getFileIcon(ext) {
  const icons = {
    '.pdf': '📄', '.docx': '📝', '.xlsx': '📊', '.pptx': '📽️',
    '.jpg': '🖼️', '.png': '🖼️', '.gif': '🖼️', '.svg': '🖼️',
    '.zip': '📦', '.rar': '📦', '.tar': '📦', '.gz': '📦',
    '.py': '🐍', '.js': '📜', '.html': '🌐', '.css': '🎨',
    '.json': '📋', '.xml': '📋', '.yaml': '📋', '.toml': '📋',
    '.md': '📝', '.txt': '📃', '.log': '📃',
  };
  return icons[ext] || '📎';
}

// ---------- SSE 事件处理器 ----------

const EventHandlers = {
  /** 处理计划执行流式响应 */
  async handlePlanExecute(reader, msgs) {
    const dec = new TextDecoder();
    let buf = '';
    let thinkingPanel = null;
    let thinkingBody = null;
    let thinkingHtml = '';
    let thinkingTimer = null;
    let planTimerEl = null;
    let planTimerStart = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (thinkingTimer) clearInterval(thinkingTimer);
        break;
      }
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const evt = JSON.parse(line.slice(6));
          ChatState.debugEvents.push({ _time: Date.now(), ...evt });

          switch (evt.phase) {
            case 'think_token':
              if (!thinkingPanel) {
                const result = this.createThinkingPanel(msgs);
                thinkingPanel = result.panel;
                thinkingBody = result.body;
                planTimerEl = result.timerEl;
                planTimerStart = Date.now();
                thinkingTimer = setInterval(() => {
                  if (!planTimerEl) return;
                  const sec = Math.floor((Date.now() - planTimerStart) / 1000);
                  planTimerEl.textContent = String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
                }, CHAT_CONFIG.THINKING_UPDATE_INTERVAL);
              }
              thinkingHtml += evt.token || '';
              thinkingBody.innerHTML = _replaceEmoji(thinkingHtml);
              autoScroll(msgs);
              break;

            case 'plan':
              if (thinkingPanel) {
                const hdr = thinkingPanel.querySelector('.tp-header span');
                if (hdr) hdr.innerHTML = _dualIcon('', 'fa-circle-check') + ' 计划已就绪';
                if (thinkingBody) thinkingBody.style.opacity = '0.5';
              }
              if (thinkingTimer) clearInterval(thinkingTimer);
              ChatState.currentPlan = { ...evt.plan, _queryText: evt.query };
              this.showPlanCard(evt.plan);
              break;
          }
        } catch (e) { /* ignore */ }
      }
    }
  },

  createThinkingPanel(msgs) {
    const panel = document.createElement('div');
    panel.className = 'thinking-panel';
    const hdr = document.createElement('div');
    hdr.className = 'tp-header';
    hdr.innerHTML = `<span>${_dualIcon('🧠', 'fa-brain')} 思考计划 <span class="tp-timer">00:00</span></span><span class="tp-toggle">▼</span>`;
    hdr.onclick = function() {
      const body = this.nextElementSibling;
      body.classList.toggle('collapsed');
      const tog = this.querySelector('.tp-toggle');
      tog.textContent = tog.textContent === '▼' ? '▶' : '▼';
    };
    panel.appendChild(hdr);
    const body = document.createElement('div');
    body.className = 'tp-body';
    panel.appendChild(body);
    msgs.appendChild(panel);
    autoScroll(msgs);
    return { panel, body, timerEl: hdr.querySelector('.tp-timer') };
  },

  showPlanCard(plan) {
    const steps = plan.steps || [];
    let html = '<div class="plan-steps">';
    if (steps.length) {
      steps.forEach((s, i) => {
        html += `<div class="plan-step">
          <span class="step-num">${i + 1}</span>
          <span class="step-desc">${escHtml(s.description || '')}</span>
          <span class="step-tool">${escHtml(s.tool || '')}</span>
        </div>`;
      });
    } else {
      html += '<div class="plan-step" style="color:#999;background:transparent">无需预设计划，将自动调用工具执行</div>';
    }
    html += '</div>';

    const card = document.createElement('div');
    card.className = 'plan-card';
    card.id = 'planCard';
    card.innerHTML = `
      <div class="plan-title">${_dualIcon('', 'fa-clock')} ${escHtml(plan.title || '执行计划')}</div>
      ${html}
      <div class="plan-actions">
        <button class="btn-primary" onclick="approvePlan()"><i class="icon-fa fa-solid fa-check"></i> 批准执行</button>
        <button class="btn-outline" onclick="revisePlan()"><i class="icon-fa fa-solid fa-pen-to-square"></i> 修改需求</button>
      </div>
    `;
    document.getElementById('chatMessages').appendChild(card);
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },

  /** 处理执行流式响应 */
  async handleExecute(reader, msgs) {
    const dec = new TextDecoder();
    let buf = '';
    let aiDiv = null;
    let phaseDiv = null;
    let fullReply = '';
    let execTimer = null;
    let execTimerStart = null;
    let execTimerDiv = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (execTimer) clearInterval(execTimer);
        if (execTimerDiv) execTimerDiv.remove();
        break;
      }
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const evt = JSON.parse(line.slice(6));
          ChatState.debugEvents.push({ _time: Date.now(), ...evt });

          // 使用事件分发器处理
          this.dispatchEvent(evt, { msgs, phaseDiv, aiDiv, fullReply, execTimer, execTimerDiv, execTimerStart });
        } catch (e) { /* ignore */ }
      }
    }
  },

  dispatchEvent(evt, context) {
    // 简化版事件分发，实际可进一步拆分
    const handlers = {
      'system_notice': () => addMessage('assistant', renderMarkdown(escHtml(evt.message || ''))),
      'plan_exec_start': () => {
        // 处理执行开始
      },
      'thinking': () => {
        // 处理思考状态
      },
      'tool_call': () => {
        // 处理工具调用
      },
      'tool_result': () => {
        // 处理工具结果
      },
      'answering': () => {
        // 处理开始回答
      },
      'answer': () => {
        // 处理回答流
      },
      'done': () => {
        // 处理完成
      },
    };
    const handler = handlers[evt.phase];
    if (handler) handler();
  },
};

// ---------- 命令系统 ----------

const CommandSystem = {
  /** 前端命令（不发送到后端） */
  frontendCommands: {
    '/new': () => { showConfirm('新建对话', '确定新建对话？当前对话将保留在历史中。', () => newChat()); return true; },
    '/clear': () => { showDangerConfirm('删除对话', '确定删除当前对话？此操作不可恢复！', () => {
      const sid = getSessionId();
      if (sid) {
        nanobuddyFetch(`/api/conversations/${sid}`, { method: 'DELETE' }).catch(() => {});
      }
      setSessionId('');
      document.getElementById('chatMessages').innerHTML = `
        <div class="empty-state">
          <div class="big-icon">${_dualIcon('', 'fa-hand-wave')}</div>
          <h3>你好！我是 Nanobuddy</h3>
          <p>对话已删除，可以开始新话题。</p>
        </div>
      `;
      document.getElementById('convTitle').textContent = '新对话';
    }); return true; },
    '/history': () => { openHistory(); return true; },
    '/stop': () => { stopStreaming(); return true; },
  },

  /** 技能命令 */
  async handleSkillCommand(cmd, args, msg) {
    const msgs = document.getElementById('chatMessages');
    const empty = msgs.querySelector('.empty-state');
    if (empty) empty.remove();

    switch (cmd) {
      case '/skills':
        return await this.showSkillList(msg);
      case '/use':
        return await this.activateSkill(args, msg);
      case '/unload':
        return await this.unloadSkill(msg);
      default:
        return null;
    }
  },

  async showSkillList(msg) {
    try {
      const res = await nanobuddyFetch('/api/skills');
      if (!res.ok) {
        await showCommandResult(msg, '获取技能列表失败');
        return true;
      }
      const data = await res.json();
      const skills = data.skills || [];
      if (!skills.length) {
        await showCommandResult(msg, '暂无可用技能。在 skills/ 目录下放置 SKILL.md 即可添加。');
      } else {
        const lines = ['**可用技能：**'];
        skills.forEach(s => lines.push(`  \`/use ${s.name}\`  — ${s.description}`));
        lines.push('', '使用 `/use 技能名` 激活技能，`/unload` 卸载');
        await showCommandResult(msg, lines.join('\n'));
      }
      return true;
    } catch (e) {
      await showCommandResult(msg, `获取技能列表失败: ${e.message}`);
      return true;
    }
  },

  async activateSkill(args, msg) {
    const skillName = args.join(' ');
    if (!skillName) {
      await showCommandResult(msg, '请指定技能名，如：`/use excel-analyzer`');
      return true;
    }
    const sid = getSessionId();
    if (!sid) {
      await showCommandResult(msg, '请先开始一段对话');
      return true;
    }
    try {
      const res = await nanobuddyFetch('/api/skills/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid, skill_name: skillName }),
      });
      const data = await res.json();
      await showCommandResult(msg, data.message || '操作完成');
      return true;
    } catch (e) {
      await showCommandResult(msg, `激活失败: ${e.message}`);
      return true;
    }
  },

  async unloadSkill(msg) {
    const sid = getSessionId();
    if (!sid) {
      await showCommandResult(msg, '没有激活的技能');
      return true;
    }
    try {
      const res = await nanobuddyFetch('/api/skills/deactivate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid }),
      });
      const data = await res.json();
      await showCommandResult(msg, data.message || '已卸载所有技能');
      return true;
    } catch (e) {
      await showCommandResult(msg, `卸载失败: ${e.message}`);
      return true;
    }
  },

  /** 压缩命令 */
  async handleCompact(msg) {
    const sid = getSessionId();
    if (!sid) {
      await showCommandResult(msg, '没有可压缩的对话。请先开始一段对话。');
      return true;
    }
    const msgs = document.getElementById('chatMessages');
    addMessage('user', escHtml(msg));
    const statusEl = addPhase('📦 压缩对话中...（AI 生成摘要）', 'thinking');

    try {
      const res = await nanobuddyFetch('/api/compact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid }),
      });
      if (res.ok) {
        const data = await res.json();
        if (statusEl) statusEl.remove();
        addMessage('assistant', renderMarkdown(escHtml(data.text || '')));
        if (data.new_session_id) setSessionId(data.new_session_id);
      } else {
        if (statusEl) statusEl.remove();
        addMessage('assistant', `压缩失败：服务器返回 ${res.status}`);
      }
    } catch (e) {
      if (statusEl) statusEl.remove();
      addMessage('assistant', `压缩失败：${e.message}`);
    }
    return true;
  },

  /** 执行命令入口 */
  async execute(msg) {
    const parts = msg.split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    // 前端命令
    if (this.frontendCommands[cmd]) {
      return this.frontendCommands[cmd]();
    }

    // 压缩命令
    if (cmd === '/compact') {
      return await this.handleCompact(msg);
    }

    // 技能命令
    const skillResult = await this.handleSkillCommand(cmd, args, msg);
    if (skillResult !== null) return skillResult;

    // 后端命令
    const result = await this.fetchCommand(cmd);
    if (result) {
      await showCommandResult(msg, result);
      return true;
    }

    return false;
  },

  async fetchCommand(cmd) {
    const name = cmd.replace('/', '');
    try {
      const res = await nanobuddyFetch(`/api/command/${name}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.text || '(无输出)';
    } catch {
      return null;
    }
  },
};

// ---------- UI 渲染函数 ----------

/** 显示命令结果 */
async function showCommandResult(cmdText, resultText) {
  const msgs = document.getElementById('chatMessages');
  const empty = msgs.querySelector('.empty-state');
  if (empty) empty.remove();
  addMessage('user', escHtml(cmdText));
  addMessage('assistant', renderMarkdown(escHtml(resultText || '')));
  autoScroll(msgs);
}

/** 渲染快捷命令栏 */
function renderQuickCommands() {
  const bar = document.getElementById('quickCmdBar');
  if (!bar) return;
  bar.innerHTML = '';
  QUICK_COMMANDS.forEach(qc => {
    const btn = document.createElement('button');
    btn.className = 'qc-btn';
    btn.innerHTML = `<span class="qc-cmd">${qc.cmd}</span><span class="qc-desc">${qc.desc}</span>`;
    btn.onclick = () => onQuickCmdClick(qc.cmd);
    bar.appendChild(btn);
  });
}

/** 切换快捷命令面板 */
function toggleQuickCmds() {
  const panel = document.getElementById('quickCmdBar');
  const btn = document.getElementById('qcToggleBtn');
  if (!panel || !btn) return;
  const isOpen = panel.style.display !== 'none' && panel.classList.contains('open');
  if (isOpen) {
    panel.style.display = 'none';
    panel.classList.remove('open');
    btn.classList.remove('open');
  } else {
    panel.style.display = 'flex';
    panel.classList.add('open');
    btn.classList.add('open');
  }
}

/** 快捷命令点击处理 */
async function onQuickCmdClick(cmd) {
  const msgs = document.getElementById('chatMessages');
  const empty = msgs.querySelector('.empty-state');
  if (empty) empty.remove();

  if (['/new', '/clear', '/history', '/stop'].includes(cmd)) {
    CommandSystem.frontendCommands[cmd]();
    return;
  }

  addMessage('user', escHtml(cmd));
  const result = await CommandSystem.execute(cmd);
  if (!result) {
    addMessage('assistant', `未知命令: ${cmd}`);
  }
  autoScroll(msgs);
}

// ---------- 技能面板 ----------

/** 切换技能面板 */
function toggleSkillPanel() {
  const panel = document.getElementById('skillPanel');
  const isOpen = panel.classList.contains('open');
  panel.classList.toggle('open');
  if (!isOpen) loadSkillPanel();
}

/** 加载技能面板 */
async function loadSkillPanel() {
  const body = document.getElementById('skillPanelBody');
  body.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary)"><div class="spinner"></div>加载中...</div>';

  const sid = getSessionId() || `tmp_${Date.now().toString(36)}`;
  if (!getSessionId()) ChatState.sessionId = sid;

  try {
    const [skillsRes, activeRes] = await Promise.all([
      nanobuddyFetch('/api/skills').then(r => r.json()),
      nanobuddyFetch('/api/skills/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid }),
      }).then(r => r.json()).catch(() => ({ active_skills: [] })),
    ]);

    const skills = skillsRes.skills || [];
    const activeSkills = activeRes.active_skills || [];

    if (!skills.length) {
      body.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-secondary)">暂无可用技能</div>';
      return;
    }

    // 按分类分组
    const groups = {};
    skills.forEach(s => {
      const cat = s.category || '其他';
      if (!groups[cat]) groups[cat] = { active: [], inactive: [] };
      if (activeSkills.includes(s.name)) groups[cat].active.push(s);
      else groups[cat].inactive.push(s);
    });

    // 构建 HTML
    let html = buildPresetButtons(activeSkills);
    const catOrder = ['数据处理', '文档处理', '内容创作', '设计', '开发工具', '系统管理', '其他'];
    catOrder.forEach(cat => {
      const g = groups[cat];
      if (!g || (!g.active.length && !g.inactive.length)) return;
      html += `<div class="skill-section-title">${escHtml(cat)}</div>`;
      g.active.forEach(s => html += renderSkillCard(s, true));
      g.inactive.forEach(s => html += renderSkillCard(s, false));
    });
    body.innerHTML = html;
  } catch {
    body.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-secondary)">加载失败</div>';
  }
}

/** 构建预设按钮 */
function buildPresetButtons(activeSkills) {
  const activeSet = new Set(activeSkills);
  let html = '<div class="skill-presets">';
  SKILL_PRESETS.forEach(p => {
    const allIn = p.skills.filter(s => activeSet.has(s)).length;
    let cls = 'skill-preset-btn';
    if (allIn === p.skills.length) cls += ' active';
    else if (allIn > 0) cls += ' partial';
    html += `<button class="${cls}" onclick="toggleSkillPreset('${p.name.replace(/'/g, "\\'")}')">${p.name}</button>`;
  });
  html += '</div>';
  return html;
}

/** 渲染单个技能卡片 */
function renderSkillCard(skill, isActive) {
  const name = skill.name;
  const desc = skill.description || '';
  const activeClass = isActive ? 'active' : '';
  const activeStyle = isActive ? ' style="background:#e8f5e9;border-color:#27ae60"' : '';
  const btnHtml = isActive
    ? `<button class="btn btn-sm btn-outline" style="color:var(--danger);border-color:var(--danger)" onclick="deactivateSkill('${name}')"><i class="icon-fa fa-solid fa-xmark"></i> 卸载</button>`
    : `<button class="btn btn-sm btn-primary" onclick="activateSkill('${name}')"><i class="icon-fa fa-solid fa-check"></i> 激活</button>`;
  return `<div class="skill-card ${activeClass}"${activeStyle} data-skill-name="${escHtml(name)}">
    <div class="skill-card-name">${escHtml(name)}<span class="active-badge">已激活</span></div>
    <div class="skill-card-toggle" onmouseenter="hoverSkillDesc(event, this, '${escHtml(desc)}')" onmouseleave="hideSkillDesc(event, this)">
      <span class="toggle-arrow">▸</span> 详细信息
    </div>
    <div class="skill-card-actions">${btnHtml}</div>
  </div>`;
}

// ---------- 消息发送 ----------

/** 发送聊天消息 */
async function sendChat() {
  const input = document.getElementById('chatInput');
  const btn = document.getElementById('sendBtn');
  const msg = input.value.trim();

  if (ChatState.isStreaming) return;
  if (!msg && !ChatState.uploadedFiles.length) return;

  ChatState.isStreaming = true;
  btn.disabled = true;
  document.getElementById('stopBtn').style.display = '';

  // 清除空状态
  const msgs = document.getElementById('chatMessages');
  const empty = msgs.querySelector('.empty-state');
  if (empty) empty.remove();

  // 收集上传文件
  const files = ChatState.uploadedFiles.map(f => f.path);
  ChatState.uploadedFiles = [];
  document.getElementById('filePreview').innerHTML = '';

  // 构建查询文本
  let queryText = msg;
  if (!queryText && files.length) {
    queryText = '请帮我处理这些文件：' + files.map(f => f.split('/').pop().split('\\').pop()).join(', ');
  }
  if (!queryText) {
    ChatState.isStreaming = false;
    btn.disabled = false;
    document.getElementById('stopBtn').style.display = 'none';
    return;
  }

  // 斜杠命令处理
  if (queryText.startsWith('/')) {
    const handled = await CommandSystem.execute(queryText);
    if (handled) {
      ChatState.isStreaming = false;
      btn.disabled = false;
      document.getElementById('stopBtn').style.display = 'none';
      input.focus();
      return;
    }
  }

  // 正常对话流程
  addMessage('user', escHtml(queryText));
  input.value = '';
  input.style.height = 'auto';

  try {
    const res = await nanobuddyFetch('/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: queryText,
        session_id: ChatState.sessionId,
        conversation_id: ChatState.currentConvId,
        files,
      }),
    });

    const newSessionId = res.headers.get('X-Session-Id');
    if (newSessionId) ChatState.sessionId = newSessionId;
    const newConvId = res.headers.get('X-Conversation-Id');
    if (newConvId) {
      ChatState.currentConvId = newConvId;
      ChatState.conversationId = newConvId;
    }

    await processStreamResponse(res);
  } catch (e) {
    toast(`网络错误: ${e.message}`, 'error');
  }

  ChatState.isStreaming = false;
  btn.disabled = false;
  document.getElementById('stopBtn').style.display = 'none';
  input.focus();
}

/** 处理流式响应 */
async function processStreamResponse(res) {
  const reader = res.body.getReader();
  ChatState.currentReader = reader;
  const dec = new TextDecoder();
  let buf = '';
  let aiDiv = null;
  let phaseDiv = null;
  let fullReply = '';
  let thinkingPanel = null;
  let thinkingBody = null;
  let thinkingHtml = '';
  let thinkingTimer = null;
  let statusBar = document.createElement('div');
  statusBar.className = 'phase-badge phase-thinking status-bar';
  statusBar.textContent = '处理中';
  const msgs = document.getElementById('chatMessages');
  msgs.appendChild(statusBar);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const evt = JSON.parse(line.slice(6));
        ChatState.debugEvents.push({ _time: Date.now(), ...evt });

        const result = processStreamEvent(evt, {
          msgs,
          aiDiv,
          phaseDiv,
          fullReply,
          thinkingPanel,
          thinkingBody,
          thinkingHtml,
          thinkingTimer,
          statusBar,
        });

        // 更新引用
        aiDiv = result.aiDiv || aiDiv;
        phaseDiv = result.phaseDiv || phaseDiv;
        fullReply = result.fullReply || fullReply;
        thinkingPanel = result.thinkingPanel || thinkingPanel;
        thinkingBody = result.thinkingBody || thinkingBody;
        thinkingHtml = result.thinkingHtml || thinkingHtml;
        thinkingTimer = result.thinkingTimer || thinkingTimer;
        statusBar = result.statusBar || statusBar;
      } catch (e) { /* ignore */ }
    }
  }
}

/** 处理单个流式事件 */
function processStreamEvent(evt, ctx) {
  const msgs = ctx.msgs;
  let { aiDiv, phaseDiv, fullReply, thinkingPanel, thinkingBody, thinkingHtml, thinkingTimer, statusBar } = ctx;

  switch (evt.phase) {
    case 'knowledge':
      phaseDiv = addPhase('📖 已检索知识库', 'knowledge');
      break;

    case 'think_token':
      if (isShowThinking()) {
        if (!thinkingPanel) {
          const tp = createThinkingPanel(msgs);
          thinkingPanel = tp.panel;
          thinkingBody = tp.body;
          thinkingTimer = tp.timer;
        }
        thinkingHtml += evt.token || '';
        thinkingBody.innerHTML = _replaceEmoji(thinkingHtml);
        autoScroll(msgs);
      }
      if (statusBar) {
        const tok = evt.token || '';
        if (tok.includes('🔧') || tok.includes('调用工具')) {
          statusBar.textContent = '运行工具...';
        } else if (tok.includes('验证') || tok.includes('检查')) {
          statusBar.textContent = '验证中...';
        } else if (statusBar.textContent !== '运行工具...') {
          statusBar.textContent = '思考...';
        }
      }
      break;

    case 'thinking':
      if (phaseDiv) phaseDiv.remove();
      phaseDiv = addPhase(`思考中... (${evt.round || ''})`, 'thinking');
      document.getElementById('stopBtn').style.display = '';
      break;

    case 'self_check':
      if (phaseDiv) phaseDiv.remove();
      phaseDiv = addPhase('二次确认中...', 'thinking');
      document.getElementById('stopBtn').style.display = '';
      break;

    case 'tool_call':
      if (phaseDiv) phaseDiv.remove();
      document.getElementById('stopBtn').style.display = '';
      (evt.tools_info || evt.tools || []).forEach((toolInfo, index) => {
        const tname = typeof toolInfo === 'string' ? toolInfo : toolInfo.name;
        const intent = typeof toolInfo === 'object' ? toolInfo.intent : '';
        const command = typeof toolInfo === 'object' ? toolInfo.command : '';
        const card = document.createElement('div');
        const id = `tc_${tname}_${Date.now()}_${index}`;
        card.className = 'tool-card tc-running';
        card.id = id;
        
        let bodyContent = '';
        if (intent) {
          bodyContent = `<div class="tc-intent" style="font-weight:bold;color:#2563eb;margin-bottom:8px">🎯 ${escHtml(intent)}</div>`;
        }
        if (command) {
          bodyContent += `<div class="tc-command" style="font-family:monospace;font-size:13px;background:#f3f4f6;padding:8px;border-radius:4px;color:#374151;white-space:pre-wrap;word-break:break-all;">${escHtml(command)}</div>`;
        }
        if (!bodyContent) {
          bodyContent = '<span style="color:#999">等待结果...</span>';
        }
        
        card.innerHTML = `
          <div class="tc-header" onclick="this.nextElementSibling.classList.toggle('collapsed');const t=this.querySelector('.tc-toggle');t.textContent=t.textContent==='▼'?'▶':'▼'">
            <span class="tc-icon">⚡</span>
            <span class="tc-name">${escHtml(tname)}</span>
            <span class="tc-status">运行中...</span>
            <span class="tc-toggle">▼</span>
          </div>
          <div class="tc-body">${bodyContent}</div>
        `;
        msgs.appendChild(card);
        autoScroll(msgs);

        // 耗时计时器
        const startTime = Date.now();
        ChatState.toolTimers[id] = setInterval(() => {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          const s = document.querySelector(`#${id} .tc-status`);
          if (s) s.textContent = `运行中... ${elapsed}s`;
        }, CHAT_CONFIG.TOOL_TIMER_INTERVAL);
      });
      if (thinkingBody && isShowThinking()) {
        thinkingHtml += `\n──────────────\n🔧 调用工具: ${(evt.tools || []).join(', ')}\n`;
        thinkingBody.innerHTML = _replaceEmoji(thinkingHtml);
        autoScroll(msgs);
      }
      break;

    case 'tool_result':
      if (phaseDiv) phaseDiv.remove();
      const cards = msgs.querySelectorAll('.tool-card');
      const lastCard = cards[cards.length - 1];
      if (lastCard && !lastCard.classList.contains('tc-done')) {
        if (ChatState.toolTimers[lastCard.id]) {
          clearInterval(ChatState.toolTimers[lastCard.id]);
          delete ChatState.toolTimers[lastCard.id];
        }
        lastCard.classList.remove('tc-running');
        lastCard.classList.add('tc-done');
        const snippet = (evt.result || '').substring(0, CHAT_CONFIG.TOOL_RESULT_PREVIEW_LENGTH);
        const isErr = evt.result && (evt.result.includes('错误') || evt.result.includes('出错'));
        if (isErr) lastCard.classList.add('tc-error');
        lastCard.querySelector('.tc-status').textContent = isErr ? '出错' : '完成';
        const body = lastCard.querySelector('.tc-body');
        body.textContent = snippet;
      } else {
        const isErr = evt.result && evt.result.includes('错误');
        phaseDiv = addPhase(
          `${isErr ? '[错误]' : '[完成]'} ${evt.tool} 完成`,
          isErr ? 'error' : 'result'
        );
      }
      if (thinkingBody && isShowThinking()) {
        const snippet = (evt.result || '').substring(0, 150);
        thinkingHtml += `[完成] ${evt.tool} → ${snippet}\n`;
        thinkingBody.innerHTML = _replaceEmoji(thinkingHtml);
        autoScroll(msgs);
      }
      break;

    case 'answering':
      if (phaseDiv) phaseDiv.remove();
      if (statusBar) statusBar.textContent = '回答中';
      aiDiv = addMessage('assistant', '');
      document.getElementById('stopBtn').style.display = 'none';
      break;

    case 'answer':
      if (!aiDiv) {
        if (phaseDiv) phaseDiv.remove();
        aiDiv = addMessage('assistant', '');
      }
      fullReply += evt.token || '';
      aiDiv.innerHTML = renderMarkdown(escHtml(fullReply));
      autoScroll(msgs);
      break;

    case 'error':
      toast(`错误: ${escHtml(evt.message || '')}`, 'error');
      break;

    case 'done':
      document.querySelectorAll('.phase-badge').forEach(e => e.remove());
      document.getElementById('stopBtn').style.display = 'none';
      if (thinkingTimer) clearInterval(thinkingTimer);
      if (statusBar) {
        statusBar.textContent = '完成';
        setTimeout(() => { if (statusBar) statusBar.remove(); }, 2000);
      }
      break;
  }

  return { aiDiv, phaseDiv, fullReply, thinkingPanel, thinkingBody, thinkingHtml, thinkingTimer, statusBar };
}

// ---------- 工具函数：创建思考面板 ----------

function createThinkingPanel(msgs) {
  const panel = document.createElement('div');
  panel.className = 'thinking-panel';
  const hdr = document.createElement('div');
  hdr.className = 'tp-header';
  hdr.innerHTML = `
    <span>${_dualIcon('🧠', 'fa-brain')} 思考过程 <span class="tp-timer">00:00</span></span>
    <span class="tp-toggle">▼</span>
  `;
  hdr.onclick = function() {
    const body = this.nextElementSibling;
    body.classList.toggle('collapsed');
    const tog = this.querySelector('.tp-toggle');
    tog.textContent = tog.textContent === '▼' ? '▶' : '▼';
  };
  panel.appendChild(hdr);

  const body = document.createElement('div');
  body.className = 'tp-body';
  panel.appendChild(body);

  msgs.appendChild(panel);
  autoScroll(msgs);

  const timerEl = hdr.querySelector('.tp-timer');
  const startTime = Date.now();
  const timer = setInterval(() => {
    if (!timerEl) return;
    const sec = Math.floor((Date.now() - startTime) / 1000);
    timerEl.textContent = String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
  }, CHAT_CONFIG.THINKING_UPDATE_INTERVAL);

  return { panel, body, timer };
}

// ---------- 页面切换 ----------

function switchPage(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('active');
    p.style.display = 'none';
  });
  const target = document.getElementById(`page-${page}`);
  if (target) {
    target.classList.add('active');
    target.style.display = 'flex';
  }
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navItem) navItem.classList.add('active');

  // 按需加载
  const loaders = {
    knowledge: loadKnowledgeBase,
    files: loadDrives,
    database: () => { loadDbConfigs(); loadDbConfigSelect(); },
    stats: () => setTimeout(loadStats, 50),
    tools: () => setTimeout(loadToolPage, 50),
    settings: () => setTimeout(() => {
      if (typeof loadModelSettings === 'function') loadModelSettings();
    }, 50),
    admin: () => setTimeout(() => { if (typeof loadAdminPage === 'function') loadAdminPage(); }, 50),
  };
  const loader = loaders[page];
  if (loader) loader();
}

// ---------- 对话历史 ----------

function toggleConvPanel() {
  const panel = document.getElementById('convPanel');
  panel.classList.toggle('open');
  if (panel.classList.contains('open')) loadConvList();
}

async function loadConvList() {
  try {
    const res = await nanobuddyFetch('/api/conversations');
    const data = await res.json();
    const list = document.getElementById('convList');
    if (!data.conversations || data.conversations.length === 0) {
      list.innerHTML = '<div class="empty-list">暂无对话历史</div>';
      return;
    }
    list.innerHTML = data.conversations.map(c => `
      <div class="conv-item" onclick="loadConversation('${c.id}')">
        <div class="conv-title">${escHtml(c.title)}</div>
        <div class="conv-time">${c.updated_at || ''} · ${c.message_count || 0} 条</div>
      </div>
    `).join('');
  } catch {
    // ignore
  }
}

async function loadConversation(id) {
  try {
    const res = await nanobuddyFetch(`/api/conversations/${id}`);
    const data = await res.json();
    setSessionId(id);
    document.getElementById('convTitle').textContent = data.conversation.title;
    document.getElementById('convPanel').classList.remove('open');

    const msgs = document.getElementById('chatMessages');
    msgs.innerHTML = '';
    if (data.messages && data.messages.length) {
      data.messages.forEach(m => {
        const content = m.role === 'assistant' ? renderMarkdown(escHtml(m.content)) : escHtml(m.content);
        addMessage(m.role, content);
        // 显示思考内容（如果存在）
        if (m.role === 'assistant' && m.thinking && isShowThinking()) {
          const panel = document.createElement('div');
          panel.className = 'thinking-panel';
          panel.innerHTML = `
            <div class="tp-header" onclick="this.nextElementSibling.classList.toggle('collapsed');const t=this.querySelector('.tp-toggle');t.textContent=t.textContent==='▼'?'▶':'▼'">
              <span>${_dualIcon('🧠', 'fa-brain')} 思考过程</span>
              <span class="tp-toggle">▼</span>
            </div>
            <div class="tp-body">${_replaceEmoji(escHtml(m.thinking).replace(/\n/g, '<br>'))}</div>
          `;
          const lastMsg = msgs.querySelector('.message:last-child');
          if (lastMsg) msgs.insertBefore(panel, lastMsg);
        }
      });
    }
  } catch {
    toast('加载对话失败', 'error');
  }
}

// ---------- 文件上传 ----------

/** 处理文件选择 */
function handleFileSelect(event) {
  const files = event.target.files;
  if (!files.length) return;
  for (let i = 0; i < files.length; i++) {
    uploadFileItem(files[i]);
  }
  event.target.value = '';
}

/** 上传单个文件 */
function uploadFileItem(file) {
  const preview = document.getElementById('filePreview');
  const itemId = `fu_${++ChatState.uploadIdCounter}`;

  // 显示上传中
  preview.insertAdjacentHTML('beforeend', `
    <div class="file-preview" id="${itemId}">
      <span class="file-icon">${getFileIcon('.' + (file.name.split('.').pop() || 'bin'))}</span>
      <span class="file-name">${escHtml(file.name)}</span>
      <span class="upload-progress">⏳ 上传中...</span>
    </div>
  `);

  const formData = new FormData();
  formData.append('file', file);

  nanobuddyFetch('/api/upload', { method: 'POST', body: formData })
    .then(r => {
      if (!r.ok) throw new Error(`服务器返回: ${r.status}`);
      return r.json();
    })
    .then(data => {
      if (data.status !== 'ok') throw new Error(data.message || '上传失败');
      ChatState.uploadedFiles.push({ name: data.file_name, path: data.file_path, size: data.size });
      const el = document.getElementById(itemId);
      if (el) {
        el.setAttribute('data-path', data.file_path);
        el.innerHTML = `
          <span class="file-icon">${getFileIcon(data.ext)}</span>
          <span class="file-name">${escHtml(data.file_name)}</span>
          <span class="file-size">${data.size_str || ''}</span>
          <span class="file-remove" title="移除">×</span>
        `;
      }
    })
    .catch(err => {
      const el = document.getElementById(itemId);
      if (el) {
        el.innerHTML = `<span class="file-icon">❌</span><span class="file-name">${escHtml(file.name)} 上传失败</span>`;
        el.title = err.message || '上传出错';
      }
    });
}

/** 设置拖拽上传 */
function setupDragDrop() {
  const col = document.querySelector('.chat-col');
  if (!col) return;
  col.addEventListener('dragenter', e => { e.preventDefault(); col.classList.add('drag-over'); });
  col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('drag-over'); });
  col.addEventListener('dragleave', e => {
    if (!e.currentTarget.contains(e.relatedTarget)) col.classList.remove('drag-over');
  });
  col.addEventListener('drop', e => {
    e.preventDefault();
    col.classList.remove('drag-over');
    if (e.dataTransfer.files.length) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        uploadFileItem(e.dataTransfer.files[i]);
      }
    }
  });
}

// ---------- 键盘事件 ----------

function onChatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
}

// ---------- 计划操作 ----------

function revisePlan() {
  const card = document.getElementById('planCard');
  if (card) card.remove();
  ChatState.currentPlan = null;
  ChatState.isStreaming = false;
  document.getElementById('sendBtn').disabled = false;
  document.getElementById('chatInput').focus();
}

async function approvePlan() {
  if (!ChatState.currentPlan) return;
  const card = document.getElementById('planCard');
  if (card) card.remove();

  ChatState.isStreaming = true;
  document.getElementById('stopBtn').style.display = '';

  try {
    const q = ChatState.currentPlan._queryText || document.getElementById('chatInput').value.trim() || '执行';
    const res = await nanobuddyFetch('/chat/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan: ChatState.currentPlan,
        query: q,
        session_id: ChatState.sessionId,
        conversation_id: ChatState.currentConvId,
      }),
    });

    const newSessionId = res.headers.get('X-Session-Id');
    if (newSessionId) ChatState.sessionId = newSessionId;
    const newConvId = res.headers.get('X-Conversation-Id');
    if (newConvId) {
      ChatState.currentConvId = newConvId;
      ChatState.conversationId = newConvId;
    }

    ChatState.currentReader = res.body.getReader();
    await EventHandlers.handleExecute(ChatState.currentReader, document.getElementById('chatMessages'));
  } catch (e) {
    toast(`执行失败: ${e.message}`, 'error');
  }

  document.querySelectorAll('.phase-badge').forEach(e => e.remove());
  document.getElementById('stopBtn').style.display = 'none';
  ChatState.isStreaming = false;
  document.getElementById('sendBtn').disabled = false;
}

// ---------- 停止流式 ----------

function stopStreaming() {
  if (ChatState.currentReader) {
    try {
      ChatState.currentReader.cancel();
    } catch (e) { /* ignore */ }
    ChatState.currentReader = null;
  }
  ChatState.isStreaming = false;
  document.getElementById('stopBtn').style.display = 'none';
  document.getElementById('sendBtn').disabled = false;
  document.querySelectorAll('.phase-badge').forEach(e => e.remove());
  toast('已停止生成', 'info');
}

// ---------- 压缩对话历史 ----------

async function compactChatHistory() {
  const sid = getSessionId();
  if (!sid) {
    toast('请先开始一段对话', 'error');
    return;
  }
  return CommandSystem.handleCompact('/compact');
}

// ---------- 新建对话 ----------

function newChat() {
  setSessionId('');
  document.getElementById('convTitle').textContent = '新对话';
  document.getElementById('chatMessages').innerHTML = `
    <div class="empty-state">
      <div class="big-icon">${_dualIcon('👋', 'fa-hand-wave')}</div>
      <h3>你好！我是 Nanobuddy</h3>
      <p>你的企业级 AI 助手。我可以帮你整理文件、搜索知识库、分析文档、回答问题。在下方输入框开始对话。</p>
    </div>
  `;
}

// ---------- 消息相关 ----------

function addMessage(role, html) {
  const msgs = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = `message ${role}`;
  const avatarHtml = role === 'user' ? _dualIcon('', 'fa-user') : _dualIcon('', 'fa-robot');
  div.innerHTML = `
    <div class="avatar">${avatarHtml}</div>
    <div class="bubble">${html}</div>
    <button class="copy-btn" onclick="copyMessage(this)" title="复制内容">${_dualIcon('', 'fa-copy')}</button>
  `;
  msgs.appendChild(div);
  autoScroll(msgs);
  return div.querySelector('.bubble');
}

function addPhase(label, cls) {
  const msgs = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = `phase-badge phase-${cls}`;
  if (label.indexOf('<i class=') === 0) {
    div.innerHTML = label;
  } else {
    const first = label[0];
    if (first && window._emojiFA && window._emojiFA[first]) {
      div.innerHTML = _dualIcon(first, window._emojiFA[first]) + ' ' + label.slice(1).trim();
    } else {
      div.textContent = label;
    }
  }
  msgs.appendChild(div);
  autoScroll(msgs);
  return div;
}

function copyMessage(btn) {
  const bubble = btn.parentNode.querySelector('.bubble');
  if (!bubble) return;
  const text = bubble.textContent || '';
  const doneIcon = _dualIcon('', 'fa-circle-check');
  const copyIcon = _dualIcon('', 'fa-copy');

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      btn.innerHTML = doneIcon;
      setTimeout(() => { btn.innerHTML = copyIcon; }, 1500);
    });
  } else {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    btn.innerHTML = doneIcon;
    setTimeout(() => { btn.innerHTML = copyIcon; }, 1500);
  }
}

// ---------- 技能操作 ----------

async function activateSkill(name) {
  const sid = getSessionId();
  if (!sid) {
    toast('请先开始一段对话', 'error');
    return;
  }
  try {
    const res = await nanobuddyFetch('/api/skills/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sid, skill_name: name }),
    });
    const data = await res.json();
    if (data.status === 'ok') {
      toast(data.message, 'success');
      loadSkillPanel();
    } else {
      toast(data.message || '激活失败', 'error');
    }
  } catch (e) {
    toast(`激活失败: ${e.message}`, 'error');
  }
}

async function deactivateSkill(name) {
  const sid = getSessionId();
  if (!sid) return;
  try {
    const res = await nanobuddyFetch('/api/skills/deactivate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sid, skill_name: name }),
    });
    const data = await res.json();
    if (data.status === 'ok') {
      toast(data.message, 'success');
      loadSkillPanel();
    } else {
      toast(data.message || '卸载失败', 'error');
    }
  } catch (e) {
    toast(`卸载失败: ${e.message}`, 'error');
  }
}

function toggleSkillPreset(presetName) {
  const preset = SKILL_PRESETS.find(p => p.name === presetName);
  if (!preset) return;
  const sid = getSessionId();
  if (!sid) {
    toast('请先开始一段对话', 'info');
    return;
  }

  nanobuddyFetch('/api/skills/active', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sid }),
  })
    .then(r => r.json())
    .then(data => {
      const current = data.active_skills || [];
      const currentSet = new Set(current);
      const allActive = preset.skills.every(s => currentSet.has(s));
      const newSkills = allActive
        ? current.filter(s => !preset.skills.includes(s))
        : [...current, ...preset.skills.filter(s => !currentSet.has(s))];

      return nanobuddyFetch('/api/skills/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid, skills: newSkills }),
      });
    })
    .then(r => r.json())
    .then(data => {
      if (data.status === 'ok') loadSkillPanel();
      else toast(data.message || '操作失败', 'error');
    })
    .catch(e => toast(`请求失败: ${e.message}`, 'error'));
}

// ---------- 技能描述悬停 ----------

let skillPopupTimer = null;
let skillPopupEl = null;

function hoverSkillDesc(event, el, desc) {
  if (skillPopupTimer) clearTimeout(skillPopupTimer);
  skillPopupTimer = setTimeout(() => {
    const old = document.getElementById('skillPopup');
    if (old) old.remove();

    const popup = document.createElement('div');
    popup.id = 'skillPopup';
    popup.className = 'skill-popup';
    popup.textContent = desc;

    const rect = el.getBoundingClientRect();
    popup.style.left = '-9999px';
    popup.style.top = '-9999px';
    document.body.appendChild(popup);
    const actualH = popup.offsetHeight;
    const spaceBelow = window.innerHeight - rect.bottom - 6;
    if (spaceBelow < actualH && rect.top > actualH + 6) {
      popup.style.top = `${rect.top - actualH - 4}px`;
    } else {
      popup.style.top = `${rect.bottom + 4}px`;
    }
    popup.style.left = `${Math.min(Math.max(rect.left, 4), window.innerWidth - 360)}px`;

    document.body.appendChild(popup);
    skillPopupEl = popup;

    popup.onmouseenter = () => { if (skillPopupTimer) clearTimeout(skillPopupTimer); };
    popup.onmouseleave = () => { popup.remove(); skillPopupEl = null; };
  }, 500);
}

function hideSkillDesc(event, el) {
  if (skillPopupTimer) {
    clearTimeout(skillPopupTimer);
    skillPopupTimer = null;
  }
  setTimeout(() => {
    if (skillPopupEl && !skillPopupEl.matches(':hover')) {
      skillPopupEl.remove();
      skillPopupEl = null;
    }
  }, 100);
}

// ---------- 菜单占位 ----------

function quickTagFill(text) {
  const input = document.getElementById('chatInput');
  if (!input) return;
  input.value = (input.value ? input.value + ' ' : '') + text;
  input.focus();
  input.dispatchEvent(new Event('input'));
}

function toggleCraftMenu(e) {
  if (e) e.stopPropagation();
  showModeMenu(e, 'craft');
}

function toggleAutoMenu(e) {
  if (e) e.stopPropagation();
  showModeMenu(e, 'auto');
}

function toggleSkillMenu(e) {
  if (e) e.stopPropagation();
  toggleSkillPanel();
}

function toggleAppMenu(e) {
  if (e) e.stopPropagation();
  showAppMenu(e);
}

function togglePermissionMenu(e) {
  if (e) e.stopPropagation();
  showPermissionMenu(e);
}

function toggleWorkspaceMenu(e) {
  if (e) e.stopPropagation();
  toast('工作空间选择待接入', 'info');
}

// ---------- 菜单实现 ----------

function showModeMenu(e, modeType) {
  const target = e.currentTarget;
  closeAllDropdowns();
  const menu = document.createElement('div');
  menu.className = 'toolbar-dropdown';
  menu.style.position = 'absolute';
  
  const rect = target.getBoundingClientRect();
  menu.style.left = `${rect.left}px`;
  menu.style.top = `${rect.bottom + 8}px`;
  menu.style.minWidth = `${Math.max(rect.width, 260)}px`;
  
  const modes = {
    craft: [
      { name: '急速 (React)', desc: '直接执行，快速响应', icon: '⚡', color: '#f59e0b' },
      { name: '计划 (Plan)', desc: '先规划再执行', icon: '📋', color: '#3b82f6' },
    ],
    auto: [
      { name: '自动模式', desc: 'AI 自主决定执行方式', icon: '🤖', color: '#10b981' },
      { name: '手动模式', desc: '每步需确认', icon: '👆', color: '#8b5cf6' },
      { name: '半自动模式', desc: '简单操作自动执行', icon: '⚙️', color: '#6366f1' },
    ],
  };
  
  const items = modes[modeType] || [];
  let html = '<div class="dropdown-header">' + (modeType === 'craft' ? 'Craft 模式' : '自动模式') + '</div>';
  html += '<div class="dropdown-content">';
  items.forEach((item, index) => {
    const isActive = ChatState.currentMode === item.name;
    html += `<div class="dropdown-item ${isActive ? 'active' : ''}" onclick="selectMode('${modeType}', '${item.name.replace(/'/g, "\\'")}')">
      <div class="dropdown-icon-wrap" style="background:${item.color}20;">
        <span class="dropdown-icon">${item.icon}</span>
      </div>
      <div class="dropdown-text-wrap">
        <div class="dropdown-text">${item.name}</div>
        <div class="dropdown-desc">${item.desc}</div>
      </div>
      ${isActive ? '<span class="dropdown-check">✓</span>' : ''}
    </div>`;
    if (index < items.length - 1) {
      html += '<div class="dropdown-divider"></div>';
    }
  });
  html += '</div>';
  html += '<div class="dropdown-footer">点击切换模式</div>';
  
  menu.innerHTML = html;
  document.body.appendChild(menu);
  
  setTimeout(() => menu.classList.add('show'), 10);
  
  document.addEventListener('click', closeDropdownHandler, { once: true });
}

function selectMode(modeType, modeName) {
  closeAllDropdowns();
  ChatState.currentMode = modeName;
  toast(`已切换到 ${modeName}`, 'success');
}

function showAppMenu(e) {
  const target = e.currentTarget;
  closeAllDropdowns();
  
  const menu = document.createElement('div');
  menu.className = 'toolbar-dropdown';
  menu.style.position = 'absolute';
  
  const rect = target.getBoundingClientRect();
  menu.style.left = `${rect.left}px`;
  menu.style.top = `${rect.bottom + 8}px`;
  menu.style.minWidth = `${Math.max(rect.width, 260)}px`;
  
  let html = '<div class="dropdown-header">应用连接</div>';
  html += '<div class="dropdown-content">';
  
  fetch('/api/tools/display')
    .then(r => r.json())
    .then(data => {
      const tools = data || {};
      const toolNames = Object.keys(tools).slice(0, 8);
      if (toolNames.length === 0) {
        html += '<div class="dropdown-empty"><div class="empty-icon">🔌</div>暂无可用应用</div>';
      } else {
        const appIcons = ['📱', '💻', '🌐', '☁️', '🔧', '⚙️', '🛠️', '🔗'];
        toolNames.forEach((name, index) => {
          html += `<div class="dropdown-item" onclick="toast('已连接: ${tools[name]}', 'success')">
            <div class="dropdown-icon-wrap" style="background:#6366f120;">
              <span class="dropdown-icon">${appIcons[index % appIcons.length]}</span>
            </div>
            <div class="dropdown-text-wrap">
              <div class="dropdown-text">${tools[name] || name}</div>
              <div class="dropdown-desc">点击连接</div>
            </div>
          </div>`;
          if (index < toolNames.length - 1) {
            html += '<div class="dropdown-divider"></div>';
          }
        });
      }
      html += '</div>';
      menu.innerHTML = html;
    })
    .catch(() => {
      html += '<div class="dropdown-empty"><div class="empty-icon">⚠️</div>加载失败</div></div>';
      menu.innerHTML = html;
    });
  
  menu.innerHTML = html + '<div class="dropdown-loading"><div class="spinner"></div>加载中...</div></div>';
  document.body.appendChild(menu);
  setTimeout(() => menu.classList.add('show'), 10);
  document.addEventListener('click', closeDropdownHandler, { once: true });
}

function showPermissionMenu(e) {
  const target = e.currentTarget;
  closeAllDropdowns();
  
  const menu = document.createElement('div');
  menu.className = 'toolbar-dropdown';
  menu.style.position = 'absolute';
  
  const rect = target.getBoundingClientRect();
  menu.style.left = `${rect.left}px`;
  menu.style.top = `${rect.bottom + 8}px`;
  menu.style.minWidth = `${Math.max(rect.width, 260)}px`;
  
  const permissions = [
    { name: '允许文件读取', enabled: true, icon: '📁', color: '#3b82f6' },
    { name: '允许文件写入', enabled: true, icon: '✏️', color: '#10b981' },
    { name: '允许命令执行', enabled: false, icon: '💻', color: '#f59e0b' },
    { name: '允许网络访问', enabled: true, icon: '🌐', color: '#8b5cf6' },
    { name: '允许 API 调用', enabled: true, icon: '🔌', color: '#6366f1' },
  ];
  
  let html = '<div class="dropdown-header">默认权限</div>';
  html += '<div class="dropdown-content">';
  permissions.forEach((p, index) => {
    const cls = p.enabled ? 'enabled' : 'disabled';
    html += `<div class="dropdown-item ${cls}" onclick="togglePermission('${p.name}')">
      <div class="dropdown-icon-wrap" style="background:${p.color}20;">
        <span class="dropdown-icon">${p.icon}</span>
      </div>
      <div class="dropdown-text-wrap">
        <div class="dropdown-text">${p.name}</div>
        <div class="dropdown-desc">${p.enabled ? '已启用' : '已禁用'}</div>
      </div>
      <div class="dropdown-check-box"></div>
    </div>`;
    if (index < permissions.length - 1) {
      html += '<div class="dropdown-divider"></div>';
    }
  });
  html += '</div>';
  html += '<div class="dropdown-footer">点击切换权限</div>';
  
  menu.innerHTML = html;
  document.body.appendChild(menu);
  setTimeout(() => menu.classList.add('show'), 10);
  document.addEventListener('click', closeDropdownHandler, { once: true });
}

function togglePermission(name) {
  closeAllDropdowns();
  toast(`权限 "${name}" 已切换`, 'info');
}

function closeAllDropdowns() {
  document.querySelectorAll('.toolbar-dropdown').forEach(d => d.remove());
}

function closeDropdownHandler(e) {
  closeAllDropdowns();
}

// ---------- 初始化 ----------

document.addEventListener('DOMContentLoaded', () => {
  renderQuickCommands();
  setupDragDrop();

  // 文件移除委托
  document.addEventListener('click', e => {
    const target = e.target;
    if (!target.classList.contains('file-remove')) return;
    const preview = target.closest('.file-preview');
    if (!preview) return;
    const path = preview.getAttribute('data-path') || '';
    preview.remove();
    if (path) {
      ChatState.uploadedFiles = ChatState.uploadedFiles.filter(f => f.path !== path);
    }
  });
});

// ---------- 暴露全局接口 ----------

window.sendChat = sendChat;
window.newChat = newChat;
window.switchPage = switchPage;
window.toggleSkillPanel = toggleSkillPanel;
window.toggleQuickCmds = toggleQuickCmds;
window.onQuickCmdClick = onQuickCmdClick;
window.compactChatHistory = compactChatHistory;
window.toggleConvPanel = toggleConvPanel;
window.loadConversation = loadConversation;
window.onChatKeydown = onChatKeydown;
window.quickTagFill = quickTagFill;
window.toggleCraftMenu = toggleCraftMenu;
window.toggleAutoMenu = toggleAutoMenu;
window.toggleSkillMenu = toggleSkillMenu;
window.toggleAppMenu = toggleAppMenu;
window.togglePermissionMenu = togglePermissionMenu;
window.toggleWorkspaceMenu = toggleWorkspaceMenu;
window.showModeMenu = showModeMenu;
window.selectMode = selectMode;
window.showAppMenu = showAppMenu;
window.showPermissionMenu = showPermissionMenu;
window.togglePermission = togglePermission;
window.closeAllDropdowns = closeAllDropdowns;
window.closeDropdownHandler = closeDropdownHandler;
window.autoResizeInput = autoResizeInput;
window.handleFileSelect = handleFileSelect;
window.copyMessage = copyMessage;
window.addMessage = addMessage;
window.addPhase = addPhase;
window.activateSkill = activateSkill;
window.deactivateSkill = deactivateSkill;
window.toggleSkillPreset = toggleSkillPreset;
window.hoverSkillDesc = hoverSkillDesc;
window.hideSkillDesc = hideSkillDesc;
window.revisePlan = revisePlan;
window.approvePlan = approvePlan;
window.stopStreaming = stopStreaming;
window.showCommandResult = showCommandResult;

// 暴露状态供其他模块使用
window.ChatState = ChatState;
window.getSessionId = getSessionId;