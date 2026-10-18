// ================================================================
//  history.js — 历史面板、分屏对话、批量操作（优化版）
// ================================================================

// ---------- 常量与配置 ----------

const HISTORY_CONFIG = {
  SPLIT_THINKING_LIMIT: 150,
  TOOL_RESULT_PREVIEW: 150,
};

// ---------- 状态管理 ----------

const HistoryState = {
  isMultiSelect: false,
  allConvs: [],
  splitReader: null,
  splitThinking: null,
  splitThinkingBody: null,
  splitThinkingHtml: '',
  isSplitStreaming: false,
};

// ---------- DOM 引用 ----------

const HistoryDOM = {
  get overlay() { return document.getElementById('historyOverlay'); },
  get list() { return document.getElementById('historyList'); },
  get toolbar() { return document.getElementById('htToolbar'); },
  get multiBtn() { return document.getElementById('htMultiBtn'); },
  get rightCol() { return document.getElementById('rightCol'); },
  get splitMessages() { return document.getElementById('splitMessages'); },
  get splitInput() { return document.getElementById('splitInput'); },
  get splitStopBtn() { return document.getElementById('splitStopBtn'); },
  get ctxMenu() { return document.getElementById('ctxMenu'); },
  get stopBtn() { return document.getElementById('stopBtn'); },
  get chatMessages() { return document.getElementById('chatMessages'); },
};

// ---------- 历史面板 ----------

function openHistory() {
  const overlay = HistoryDOM.overlay;
  if (!overlay) return;
  overlay.classList.add('open');
  loadHistory();
}

function closeHistory() {
  const overlay = HistoryDOM.overlay;
  if (overlay) overlay.classList.remove('open');
}

async function loadHistory() {
  const list = HistoryDOM.list;
  if (!list) return;

  list.innerHTML = '<div style="text-align:center;padding:20px;color:#999">加载中...</div>';

  try {
    const res = await nanobuddyFetch('/api/conversations');
    const data = await res.json();
    HistoryState.allConvs = data.conversations || [];

    renderHistory(HistoryState.allConvs);
  } catch {
    list.innerHTML = '<div style="padding:20px;color:#999">加载失败</div>';
  }
}

function renderHistory(arr) {
  const list = HistoryDOM.list;
  if (!list) return;

  if (!arr.length) {
    const kw = (document.getElementById('htSearchInput')?.value || '').trim();
    list.innerHTML = `<div style="text-align:center;padding:30px;color:#999">${kw ? '无匹配对话' : '暂无对话'}</div>`;
    return;
  }

  list.innerHTML = arr.map(c => {
    const cb = HistoryState.isMultiSelect
      ? `<input type="checkbox" class="ht-checkbox" value="${c.id}">`
      : '';
    const clickAttr = HistoryState.isMultiSelect
      ? ' onclick="event.stopPropagation();const cb=this.querySelector(\'.ht-checkbox\');if(cb)cb.checked=!cb.checked;"'
      : ` onclick="loadConv('${c.id}')"`;
    const pinned = c.pinned ? ' 📌' : '';
    const pinBtn = c.pinned
      ? `<span class="ht-act" title="取消置顶" onclick="event.stopPropagation();togglePin('${c.id}',0)">📌</span>`
      : `<span class="ht-act" title="置顶" onclick="event.stopPropagation();togglePin('${c.id}',1)">📍</span>`;
    return `<div class="ht-item"${clickAttr} oncontextmenu="showCtx(event,'${c.id}')">
      ${cb}
      <div class="ht-info">
        <div class="ht-name">${escHtml(c.title || '新对话')}${pinned}</div>
        <div class="ht-time">${c.message_count || 0}条 · ${c.updated_at || ''}</div>
      </div>
      <div class="ht-actions">
        ${pinBtn}
        <span class="ht-act" title="重命名" onclick="event.stopPropagation();renameConv('${c.id}')">✏️</span>
      </div>
    </div>`;
  }).join('');
}

function filterHistory() {
  const kw = (document.getElementById('htSearchInput')?.value || '').trim().toLowerCase();
  if (!kw) {
    renderHistory(HistoryState.allConvs);
    return;
  }
  const filtered = HistoryState.allConvs.filter(c =>
    (c.title || '新对话').toLowerCase().includes(kw)
  );
  renderHistory(filtered);
}

async function renameConv(convId) {
  const conv = HistoryState.allConvs.find(c => c.id === convId);
  const oldTitle = conv?.title || '新对话';
  const title = prompt('重命名对话', oldTitle);
  if (title === null) return;
  const newTitle = title.trim();
  if (!newTitle) {
    toast('标题不能为空', 'error');
    return;
  }
  try {
    await nanobuddyFetch(`/api/conversations/${convId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle }),
    });
    loadHistory();
  } catch {
    toast('重命名失败', 'error');
  }
}

async function togglePin(convId, pinned) {
  try {
    await nanobuddyFetch(`/api/conversations/${convId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned }),
    });
    loadHistory();
  } catch {
    toast('操作失败', 'error');
  }
}

async function loadConv(convId) {
  closeHistory();

  try {
    const res = await nanobuddyFetch(`/api/conversations/${convId}`);
    const data = await res.json();
    const el = HistoryDOM.chatMessages;
    if (!el) return;

    // 更新会话 ID
    currentConvId = convId;
    conversationId = convId;
    sessionId = convId;

    el.innerHTML = '';
    const msgs = el;

    if (data.messages?.length) {
      data.messages.forEach(m => {
        const content = m.role === 'assistant'
          ? renderMarkdown(escHtml(m.content))
          : escHtml(m.content);
        const bubble = addMessage(m.role, content);

        // 显示思考内容
        if (m.role === 'assistant' && m.thinking && isShowThinking?.()) {
          const panel = createThinkingPanel(msgs, m.thinking);
          const msgDiv = bubble?.parentNode;
          if (msgDiv) msgs.insertBefore(panel, msgDiv);
        }
      });
    }

    el.scrollTop = el.scrollHeight;
  } catch {
    toast('加载对话失败', 'error');
  }
}

function createThinkingPanel(container, content) {
  const panel = document.createElement('div');
  panel.className = 'thinking-panel';
  const escaped = escHtml(content).replace(/\n/g, '<br>');
  const displayContent = window._replaceEmoji ? window._replaceEmoji(escaped) : escaped;

  panel.innerHTML = `
    <div class="tp-header" onclick="this.nextElementSibling.classList.toggle('collapsed');const t=this.querySelector('.tp-toggle');t.textContent=t.textContent==='▼'?'▶':'▼'">
      <span>${_dualIcon('🧠', 'fa-brain')} 思考过程</span>
      <span class="tp-toggle">▼</span>
    </div>
    <div class="tp-body">${displayContent}</div>
  `;
  return panel;
}

// ---------- 右键菜单 ----------

function showCtx(e, convId) {
  e.preventDefault();
  const menu = HistoryDOM.ctxMenu;
  if (!menu) return;

  menu.innerHTML = `
    <div class="ctx-item" onclick="closeCtx();loadConv('${convId}')">
      ${_dualIcon('📂', 'fa-folder-open')} 在主屏打开
    </div>
    <div class="ctx-item" onclick="closeCtx();addSplit2('${convId}')">
      ${_dualIcon('➕', 'fa-plus')} 添加到分屏
    </div>
    <div class="ctx-divider"></div>
    <div class="ctx-item danger" onclick="closeCtx();delConv('${convId}')">
      ${_dualIcon('🗑️', 'fa-trash-can')} 删除此对话
    </div>
  `;

  menu.style.left = Math.min(e.clientX, window.innerWidth - 180) + 'px';
  menu.style.top = e.clientY + 'px';
  menu.classList.add('open');

  setTimeout(() => {
    document.addEventListener('click', closeCtx, { once: true });
  }, 10);
}

function closeCtx() {
  const menu = HistoryDOM.ctxMenu;
  if (menu) menu.classList.remove('open');
}

function delConv(id) {
  showDangerConfirm('删除对话', '确定要删除此对话吗？', async () => {
    await nanobuddyFetch(`/api/conversations/${id}`, { method: 'DELETE' });
    closeHistory();
    loadHistory();
  });
}

async function addSplit2(convId) {
  const panel = HistoryDOM.rightCol;
  const msgs = HistoryDOM.splitMessages;
  if (!panel || !msgs) return;

  msgs.innerHTML = '';
  splitConvId = convId;

  try {
    const res = await nanobuddyFetch(`/api/conversations/${convId}`);
    const data = await res.json();

    if (data.messages?.length) {
      data.messages.forEach(m => {
        const div = document.createElement('div');
        div.className = `message ${m.role}`;
        const avatarHtml = m.role === 'user'
          ? _dualIcon('👤', 'fa-user')
          : _dualIcon('🤖', 'fa-robot');
        div.innerHTML = `
          <div class="avatar">${avatarHtml}</div>
          <div class="bubble">${escHtml(m.content)}</div>
          <button class="copy-btn" onclick="copyMessage(this)" title="复制内容">${_dualIcon('📋', 'fa-copy')}</button>
        `;
        msgs.appendChild(div);
      });
    }

    panel.classList.add('open');
    const input = HistoryDOM.splitInput;
    if (input) input.focus();
  } catch {
    toast('加载分屏对话失败', 'error');
  }
}

// ---------- 分屏控制 ----------

function closeSplit() {
  const panel = HistoryDOM.rightCol;
  if (panel) panel.classList.remove('open');
  splitConvId = '';
  HistoryState.isSplitStreaming = false;
  HistoryState.splitThinking = null;
  HistoryState.splitThinkingBody = null;
  HistoryState.splitThinkingHtml = '';
  if (HistoryState.splitReader) {
    try { HistoryState.splitReader.cancel(); } catch {}
    HistoryState.splitReader = null;
  }
}

function stopStreaming() {
  if (currentReader) {
    try { currentReader.cancel(); } catch {}
    currentReader = null;
  }
  nanobuddyFetch('/chat/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  }).catch(() => {});
  const btn = HistoryDOM.stopBtn;
  if (btn) btn.style.display = 'none';
}

function stopSplitStreaming() {
  if (HistoryState.splitReader) {
    try { HistoryState.splitReader.cancel(); } catch {}
    HistoryState.splitReader = null;
  }
  nanobuddyFetch('/chat/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  }).catch(() => {});
  const btn = HistoryDOM.splitStopBtn;
  if (btn) btn.style.display = 'none';
  HistoryState.isSplitStreaming = false;
}

// ---------- 分屏聊天 ----------

function onSplitKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendSplitChat();
  }
}

function sendSplitChat() {
  // 重置分屏思考面板
  HistoryState.splitThinking = null;
  HistoryState.splitThinkingBody = null;
  HistoryState.splitThinkingHtml = '';

  const input = HistoryDOM.splitInput;
  const btn = document.querySelector('#rightCol .send-btn');
  const msg = input?.value.trim() || '';
  if (!msg || HistoryState.isSplitStreaming) return;

  HistoryState.isSplitStreaming = true;
  if (btn) btn.disabled = true;

  const msgs = HistoryDOM.splitMessages;
  if (!msgs) return;

  // 清空空状态
  const empty = msgs.querySelector('.empty-state');
  if (empty) empty.remove();

  // 显示用户消息
  const userDiv = document.createElement('div');
  userDiv.className = 'message user';
  userDiv.innerHTML = `
    <div class="avatar">${_dualIcon('👤', 'fa-user')}</div>
    <div class="bubble">${escHtml(msg)}</div>
    <button class="copy-btn" onclick="copyMessage(this)" title="复制内容">${_dualIcon('📋', 'fa-copy')}</button>
  `;
  msgs.appendChild(userDiv);
  msgs.scrollTop = msgs.scrollHeight;

  if (input) {
    input.value = '';
    input.style.height = 'auto';
  }

  // 发送请求
  const convId = splitConvId || '';
  nanobuddyFetch('/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: msg,
      session_id: sessionId,
      conversation_id: convId,
    }),
  })
    .then(res => {
      sessionId = res.headers.get('X-Session-Id') || sessionId;
      const newConvId = res.headers.get('X-Conversation-Id') || '';
      if (newConvId) splitConvId = newConvId;

      HistoryState.splitReader = res.body.getReader();
      processSplitStream(HistoryState.splitReader, msgs);
    })
    .catch(() => {
      finishSplitStream(btn);
    });
}

function processSplitStream(reader, msgs) {
  const dec = new TextDecoder();
  let buf = '';
  let aiBubble = null;
  let fullReply = '';

  function readChunk() {
    reader.read()
      .then(result => {
        if (result.done) {
          finishSplitStream(document.querySelector('#rightCol .send-btn'));
          return;
        }

        buf += dec.decode(result.value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            debugEvents.push({ _time: Date.now(), ...evt });
            handleSplitEvent(evt, { msgs, aiBubble, fullReply });
          } catch {}
        }

        msgs.scrollTop = msgs.scrollHeight;
        readChunk();
      })
      .catch(() => {
        finishSplitStream(document.querySelector('#rightCol .send-btn'));
      });
  }

  readChunk();
}

function handleSplitEvent(evt, ctx) {
  const { msgs } = ctx;
  let { aiBubble, fullReply } = ctx;

  // 移除所有阶段徽章
  const removePhases = () => {
    msgs.querySelectorAll('.phase-badge').forEach(el => el.remove());
  };

  switch (evt.phase) {
    case 'knowledge':
      break;

    case 'think_token':
      if (isShowThinking?.()) {
        if (!HistoryState.splitThinking) {
          const tp = document.createElement('div');
          tp.className = 'thinking-panel';
          tp.innerHTML = `
            <div class="tp-header" onclick="this.nextElementSibling.classList.toggle('collapsed');const t=this.querySelector('.tp-toggle');t.textContent=t.textContent==='▼'?'▶':'▼'">
              <span>${_dualIcon('🧠', 'fa-brain')} 思考过程</span>
              <span class="tp-toggle">▼</span>
            </div>
            <div class="tp-body"></div>
          `;
          msgs.appendChild(tp);
          HistoryState.splitThinking = tp;
          HistoryState.splitThinkingBody = tp.querySelector('.tp-body');
          HistoryState.splitThinkingHtml = '';
          msgs.scrollTop = msgs.scrollHeight;
        }
        HistoryState.splitThinkingHtml += evt.token || '';
        HistoryState.splitThinkingBody.innerHTML = _replaceEmoji(HistoryState.splitThinkingHtml);
        msgs.scrollTop = msgs.scrollHeight;
      }
      break;

    case 'self_check':
      removePhases();
      addSplitPhase(msgs, _dualIcon('🔄', 'fa-rotate') + ' 二次确认中...', 'thinking');
      showSplitStopBtn();
      break;

    case 'thinking':
      removePhases();
      addSplitPhase(msgs, _dualIcon('🤔', 'fa-brain') + ` 思考中... (${evt.round || ''})`, 'thinking');
      showSplitStopBtn();
      break;

    case 'tool_call':
      removePhases();
      const tools = (evt.tools || []).join(', ');
      addSplitPhase(msgs, _dualIcon('🔧', 'fa-wrench') + ` 调用工具: ${tools}`, 'tool');
      showSplitStopBtn();
      if (HistoryState.splitThinkingBody && isShowThinking?.()) {
        HistoryState.splitThinkingHtml += `\n──────────────\n🔧 调用工具: ${tools}\n`;
        HistoryState.splitThinkingBody.innerHTML = _replaceEmoji(HistoryState.splitThinkingHtml);
        msgs.scrollTop = msgs.scrollHeight;
      }
      break;

    case 'tool_result':
      removePhases();
      addSplitPhase(msgs, _dualIcon('✅', 'fa-circle-check') + ` ${evt.tool || ''} 完成`, 'result');
      if (HistoryState.splitThinkingBody && isShowThinking?.()) {
        const snippet = (evt.result || '').substring(0, HISTORY_CONFIG.TOOL_RESULT_PREVIEW);
        HistoryState.splitThinkingHtml += `✅ ${evt.tool || ''} → ${snippet}\n`;
        HistoryState.splitThinkingBody.innerHTML = _replaceEmoji(HistoryState.splitThinkingHtml);
        msgs.scrollTop = msgs.scrollHeight;
      }
      break;

    case 'answering':
      removePhases();
      const aiDiv = document.createElement('div');
      aiDiv.className = 'message assistant';
      aiDiv.innerHTML = `
        <div class="avatar">${_dualIcon('🤖', 'fa-robot')}</div>
        <div class="bubble"></div>
        <button class="copy-btn" onclick="copyMessage(this)" title="复制内容">${_dualIcon('📋', 'fa-copy')}</button>
      `;
      msgs.appendChild(aiDiv);
      aiBubble = aiDiv.querySelector('.bubble');
      hideSplitStopBtn();
      break;

    case 'answer':
      if (!aiBubble) {
        removePhases();
        const fallbackDiv = document.createElement('div');
        fallbackDiv.className = 'message assistant';
        fallbackDiv.innerHTML = `
          <div class="avatar">${_dualIcon('🤖', 'fa-robot')}</div>
          <div class="bubble"></div>
          <button class="copy-btn" onclick="copyMessage(this)" title="复制内容">${_dualIcon('📋', 'fa-copy')}</button>
        `;
        msgs.appendChild(fallbackDiv);
        aiBubble = fallbackDiv.querySelector('.bubble');
      }
      fullReply += evt.token || '';
      aiBubble.innerHTML = renderMarkdown(escHtml(fullReply));
      break;

    case 'error':
      console.error('Split error:', evt.message);
      break;

    case 'done':
      removePhases();
      hideSplitStopBtn();
      break;
  }

  // 更新上下文
  ctx.aiBubble = aiBubble;
  ctx.fullReply = fullReply;
}

function addSplitPhase(msgs, label, cls) {
  const el = document.createElement('div');
  el.className = `phase-badge phase-${cls}`;
  el.innerHTML = label;
  msgs.appendChild(el);
  return el;
}

function showSplitStopBtn() {
  const btn = HistoryDOM.splitStopBtn;
  if (btn) btn.style.display = '';
}

function hideSplitStopBtn() {
  const btn = HistoryDOM.splitStopBtn;
  if (btn) btn.style.display = 'none';
}

function finishSplitStream(btn) {
  HistoryState.isSplitStreaming = false;
  if (btn) btn.disabled = false;
  HistoryDOM.splitMessages?.querySelectorAll('.phase-badge').forEach(el => el.remove());
  hideSplitStopBtn();
  const input = HistoryDOM.splitInput;
  if (input) input.focus();
}

// ---------- 多选与批量删除 ----------

function toggleMultiSelect() {
  HistoryState.isMultiSelect = !HistoryState.isMultiSelect;
  const toolbar = HistoryDOM.toolbar;
  const btn = HistoryDOM.multiBtn;

  if (toolbar) toolbar.style.display = HistoryState.isMultiSelect ? 'flex' : 'none';
  if (btn) {
    btn.innerHTML = HistoryState.isMultiSelect
      ? `${_dualIcon('☑', 'fa-square-check')} 取消`
      : `${_dualIcon('☑', 'fa-square-check')} 多选`;
  }
  loadHistory();
}

function selectAllHistory() {
  const cbs = document.querySelectorAll('.ht-checkbox');
  const allChecked = Array.from(cbs).every(cb => cb.checked);
  cbs.forEach(cb => { cb.checked = !allChecked; });
}

function getSelectedIds() {
  const cbs = document.querySelectorAll('.ht-checkbox:checked');
  return Array.from(cbs).map(cb => cb.value);
}

function deleteSelected() {
  const ids = getSelectedIds();
  if (ids.length === 0) {
    showAlert('提示', '请先勾选要删除的对话');
    return;
  }

  showDangerConfirm('批量删除对话', `确定删除选中的 ${ids.length} 个对话吗？`, async () => {
    try {
      await Promise.all(ids.map(id => nanobuddyFetch(`/api/conversations/${id}`, { method: 'DELETE' })));
      loadHistory();
      if (currentConvId && ids.includes(currentConvId)) newChat();
    } catch {
      showAlert('错误', '删除失败');
    }
  });
}

function deleteAllHistory() {
  showDangerConfirm('删除全部对话', '确定删除全部对话吗？此操作不可恢复！', async () => {
    try {
      const res = await nanobuddyFetch('/api/conversations');
      const data = await res.json();
      const arr = data.conversations || [];

      if (!arr.length) {
        showAlert('提示', '没有可删除的对话');
        return;
      }

      showDangerConfirm('再次确认', `共 ${arr.length} 个对话，确定全部删除？`, async () => {
        try {
          await Promise.all(arr.map(c => nanobuddyFetch(`/api/conversations/${c.id}`, { method: 'DELETE' })));
          loadHistory();
          newChat();
        } catch {
          showAlert('错误', '删除失败');
        }
      });
    } catch {
      showAlert('错误', '获取对话列表失败');
    }
  });
}

// ---------- 导出全局接口 ----------

window.openHistory = openHistory;
window.closeHistory = closeHistory;
window.loadHistory = loadHistory;
window.loadConv = loadConv;
window.showCtx = showCtx;
window.closeCtx = closeCtx;
window.delConv = delConv;
window.addSplit2 = addSplit2;
window.closeSplit = closeSplit;
window.stopStreaming = stopStreaming;
window.stopSplitStreaming = stopSplitStreaming;
window.onSplitKeydown = onSplitKeydown;
window.sendSplitChat = sendSplitChat;
window.toggleMultiSelect = toggleMultiSelect;
window.selectAllHistory = selectAllHistory;
window.getSelectedIds = getSelectedIds;
window.deleteSelected = deleteSelected;
window.deleteAllHistory = deleteAllHistory;
window.filterHistory = filterHistory;
window.renameConv = renameConv;
window.togglePin = togglePin;
window.HistoryState = HistoryState;