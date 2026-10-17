// ================================================================
//  pages.js — 页面功能模块（优化版）
//  包含：知识库、文件浏览、设置、数据库、统计、工具等
// ================================================================

// ---------- 配置常量 ----------
const PAGES_CONFIG = {
  KB_SEARCH_LIMIT: 10,
  AUDIT_LIMIT_DEFAULT: 100,
  TOOL_STATS_DAYS: 30,
  TOAST_DURATION: 3000,
  FILE_INDEX_CHUNK_SIZE: 500,
  DONUT_ANIMATION_DURATION: 180,
  TOOL_RESULT_PREVIEW: 150,
};

// ---------- 全局状态（兼容原有变量） ----------
window.fbMode = 'workspace';
window.fbCurrentPath = '';
window.fbCurrentAbsPath = '';
window.fbCanWrite = false;
window.fbRoots = [];
window.kbMultiSelect = false;

// ---------- DOM 引用缓存 ----------
const PAGES_DOM = {
  // 知识库
  kbStats: () => document.querySelector('#kbStats .stat-card:nth-child(1) .number'),
  kbChunks: () => document.querySelector('#kbStats .stat-card:nth-child(2) .number'),
  kbVectors: () => document.querySelector('#kbStats .stat-card:nth-child(3) .number'),
  kbDocList: () => document.getElementById('kbDocList'),
  kbDocCount: () => document.getElementById('kbDocCount'),
  kbPath: () => document.getElementById('kbPath'),
  kbSearch: () => document.getElementById('kbSearch'),
  kbToolbar: () => document.getElementById('kbToolbar'),
  kbMultiBtn: () => document.getElementById('kbMultiBtn'),
  kbCancelBtn: () => document.getElementById('kbCancelBtn'),

  // 文件浏览
  fbRoots: () => document.getElementById('fbRoots'),
  fbPath: () => document.getElementById('fbPath'),
  fbItems: () => document.getElementById('fbItems'),
  fbUploadBtn: () => document.getElementById('fbUploadBtn'),
  fbMkdirBtn: () => document.getElementById('fbMkdirBtn'),
  fbUploadInput: () => document.getElementById('fbUploadInput'),

  // 设置
  setNanobuddyApiKey: () => document.getElementById('setNanobuddyApiKey'),
  securityStatusHint: () => document.getElementById('securityStatusHint'),
  setModelType: () => document.getElementById('setModelType'),
  ollamaSettings: () => document.getElementById('ollamaSettings'),
  openaiSettings: () => document.getElementById('openaiSettings'),
  setOllamaUrl: () => document.getElementById('setOllamaUrl'),
  setChatModel: () => document.getElementById('setChatModel'),
  setOpenaiUrl: () => document.getElementById('setOpenaiUrl'),
  setOpenaiKey: () => document.getElementById('setOpenaiKey'),
  setOpenaiModel: () => document.getElementById('setOpenaiModel'),
  setEmbedModel: () => document.getElementById('setEmbedModel'),
  setChunkSize: () => document.getElementById('setChunkSize'),
  setOverlap: () => document.getElementById('setOverlap'),
  setTopK: () => document.getElementById('setTopK'),
  setAutoCompact: () => document.getElementById('setAutoCompact'),
  setPruneTools: () => document.getElementById('setPruneTools'),
  setCompactThreshold: () => document.getElementById('setCompactThreshold'),
  setMcpDirs: () => document.getElementById('setMcpDirs'),
  setMcpIncludeKnowledge: () => document.getElementById('setMcpIncludeKnowledge'),
  setMcpIncludeData: () => document.getElementById('setMcpIncludeData'),
  setMcpResolvedHint: () => document.getElementById('setMcpResolvedHint'),
  setShowThinking: () => document.getElementById('setShowThinking'),
  setIconTheme: () => document.getElementById('setIconTheme'),
  thinkingToggleTrack: () => document.getElementById('thinkingToggleTrack'),
  thinkingToggleThumb: () => document.getElementById('thinkingToggleThumb'),
  workCorpId: () => document.getElementById('workCorpId'),
  workAgentId: () => document.getElementById('workAgentId'),
  workSecret: () => document.getElementById('workSecret'),
  workCallbackUrl: () => document.getElementById('workCallbackUrl'),
  workTestResult: () => document.getElementById('workTestResult'),
  auditLogBody: () => document.getElementById('auditLogBody'),
  auditLoadHint: () => document.getElementById('auditLoadHint'),
  auditEventType: () => document.getElementById('auditEventType'),
  auditLimit: () => document.getElementById('auditLimit'),
  testModelBtn: () => document.getElementById('testModelBtn'),
  testModelResult: () => document.getElementById('testModelResult'),

  // 数据库
  dbConfigList: () => document.getElementById('dbConfigList'),
  sqConfigSelect: () => document.getElementById('sqConfigSelect'),
  sqMessages: () => document.getElementById('sqMessages'),
  sqInput: () => document.getElementById('sqInput'),
  sqProgress: () => document.getElementById('sqProgress'),

  // 统计
  donutChart: () => document.getElementById('donutChart'),
  donutTotal: () => document.getElementById('donutTotal'),
  statsTableBody: () => document.getElementById('statsTableBody'),
  statsEmpty: () => document.getElementById('statsEmpty'),
  toolsTableBody: () => document.getElementById('toolsTableBody'),
  toolsEmpty: () => document.getElementById('toolsEmpty'),
  toolsStatsPeriod: () => document.getElementById('toolsStatsPeriod'),
};

// ================================================================
//  1. 知识库模块
// ================================================================

async function loadKnowledgeBase() {
  await Promise.all([loadKbStats(), loadKbDocs()]);
}

async function loadKbStats() {
  try {
    const d = await nanobuddyFetch('/api/knowledge/stats').then(r => r.json());
    const stats = PAGES_DOM.kbStats();
    const chunks = PAGES_DOM.kbChunks();
    const vectors = PAGES_DOM.kbVectors();
    if (stats) stats.textContent = d.total_documents || 0;
    if (chunks) chunks.textContent = d.total_chunks || 0;
    if (vectors) vectors.textContent = d.vector_count || 0;
  } catch {}
}

async function loadKbDocs() {
  const list = PAGES_DOM.kbDocList();
  const countEl = PAGES_DOM.kbDocCount();
  if (!list) return;

  try {
    const d = await nanobuddyFetch('/api/knowledge/documents').then(r => r.json());
    const docs = d.documents || [];

    if (countEl) countEl.textContent = docs.length + ' 个文档';

    if (!docs.length) {
      list.innerHTML = `<div class="empty-list">${_dualIcon('📭', 'fa-inbox')} 知识库为空，请输入文件路径进行索引</div>`;
      return;
    }

    list.innerHTML = docs.map(doc => `
      <div class="doc-item">
        ${window.kbMultiSelect ? `<input type="checkbox" class="kb-checkbox" value="${doc.id}" style="margin-right:10px;width:16px;height:16px;cursor:pointer;flex-shrink:0">` : ''}
        <span class="doc-icon">${getFileIcon(doc.file_type)}</span>
        <div class="doc-info">
          <div class="doc-name">${escHtml(doc.file_name)}</div>
          <div class="doc-meta">${escHtml(doc.file_path)} · ${doc.chunk_count || 0} 块 · ${doc.indexed_at || ''}</div>
        </div>
        <span class="doc-type">${doc.file_type || '未知'}</span>
        ${window.kbMultiSelect ? '' : `<button class="btn btn-sm btn-danger" onclick="deleteDoc('${doc.id}')">删除</button>`}
      </div>
    `).join('');
  } catch {
    list.innerHTML = '<div class="empty-list">加载失败</div>';
  }
}

async function indexFromInput() {
  const pathInput = PAGES_DOM.kbPath();
  if (!pathInput) return;
  const path = pathInput.value.trim();
  if (!path) {
    toast('请输入文件或文件夹路径', 'error');
    return;
  }

  const btn = document.querySelector('#page-knowledge .btn-primary');
  const cancelBtn = PAGES_DOM.kbCancelBtn();
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 索引中...'; }
  if (cancelBtn) cancelBtn.style.display = 'inline-flex';

  try {
    const d = await nanobuddyFetch('/api/knowledge/index', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, recursive: true }),
    }).then(r => r.json());

    if (d.status === 'ok') {
      const count = d.result ? (d.result.chunk_count || d.result.success || 0) : 0;
      toast(`✅ 索引完成！处理了 ${count} 个文件块`, 'success');
      await Promise.all([loadKbStats(), loadKbDocs()]);
    } else {
      toast('索引失败: ' + JSON.stringify(d), 'error');
    }
  } catch (e) {
    toast('请求失败: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📥 索引到知识库'; }
    if (cancelBtn) cancelBtn.style.display = 'none';
  }
}

async function cancelIndexing() {
  try {
    await nanobuddyFetch('/api/knowledge/cancel', { method: 'POST' }).then(r => r.json());
    toast('⏹ 已终止索引', 'info');
  } catch {
    toast('取消失败', 'error');
  }
}

async function deleteDoc(docId) {
  showDangerConfirm('删除知识库文档', '确定要从知识库中删除此文档吗？', async () => {
    try {
      await nanobuddyFetch(`/api/knowledge/document/${docId}`, { method: 'DELETE' }).then(r => r.json());
      toast('文档已删除', 'success');
      await Promise.all([loadKbDocs(), loadKbStats()]);
    } catch {
      toast('删除失败', 'error');
    }
  });
}

// ---- 知识库多选删除 ----
function toggleKbMultiSelect() {
  window.kbMultiSelect = !window.kbMultiSelect;
  const toolbar = PAGES_DOM.kbToolbar();
  const btn = PAGES_DOM.kbMultiBtn();
  if (toolbar) toolbar.style.display = window.kbMultiSelect ? 'flex' : 'none';
  if (btn) {
    btn.innerHTML = window.kbMultiSelect
      ? `${_dualIcon('☑', 'fa-square-check')} 取消`
      : `${_dualIcon('☑', 'fa-square-check')} 多选`;
  }
  loadKbDocs();
}

function selectAllKbDocs() {
  const cbs = document.querySelectorAll('.kb-checkbox');
  const allChecked = cbs.length > 0 && Array.from(cbs).every(cb => cb.checked);
  cbs.forEach(cb => { cb.checked = !allChecked; });
}

function getSelectedKbIds() {
  return Array.from(document.querySelectorAll('.kb-checkbox:checked')).map(cb => cb.value);
}

function deleteSelectedKbDocs() {
  const ids = getSelectedKbIds();
  if (ids.length === 0) {
    showAlert('提示', '请先勾选要删除的文档');
    return;
  }
  showDangerConfirm('批量删除文档', `确定删除选中的 ${ids.length} 个文档吗？`, async () => {
    try {
      await Promise.all(ids.map(id => nanobuddyFetch(`/api/knowledge/document/${id}`, { method: 'DELETE' })));
      toast(`已删除 ${ids.length} 个文档`, 'success');
      await Promise.all([loadKbDocs(), loadKbStats()]);
    } catch {
      showAlert('错误', '删除失败');
    }
  });
}

function clearAllKnowledge() {
  showDangerConfirm('清空知识库', '确定要清空整个知识库吗？\n所有已索引的文档和向量数据将被删除。', () => {
    showDangerConfirm('⚠️ 再次确认', '此操作不可恢复！\n确定清空所有知识库数据吗？', async () => {
      try {
        const d = await nanobuddyFetch('/api/knowledge/clear', { method: 'POST' }).then(r => r.json());
        toast(`知识库已清空（${d.count || 0} 个文档）`, 'success');
        await Promise.all([loadKbDocs(), loadKbStats()]);
      } catch (e) {
        toast('清空失败: ' + e.message, 'error');
      }
    });
  });
}

async function searchKnowledge() {
  const input = PAGES_DOM.kbSearch();
  const pathInput = PAGES_DOM.kbPath();
  if (!input) return;

  const q = input.value.trim();
  if (!q) {
    input.style.display = 'none';
    return;
  }

  try {
    const d = await nanobuddyFetch(`/api/knowledge/search?query=${encodeURIComponent(q)}&n=${PAGES_CONFIG.KB_SEARCH_LIMIT}`).then(r => r.json());
    const list = PAGES_DOM.kbDocList();
    if (!list) return;

    if (!d.results || d.results.length === 0) {
      list.innerHTML = '<div class="empty-list">未找到相关内容</div>';
      return;
    }

    list.innerHTML = `<div style="margin-bottom:12px;font-size:14px;color:var(--text-secondary)">🔍 搜索: "${escHtml(q)}" · 找到 ${d.total} 条结果</div>`;
    list.innerHTML += d.results.map(r => `
      <div class="doc-item" style="flex-direction:column;align-items:stretch">
        <div style="display:flex;align-items:center;gap:8px;width:100%">
          <span>${getFileIcon('.' + (r.source.split('.').pop() || 'txt'))}</span>
          <span style="font-weight:600;font-size:13px">${escHtml(r.source)}</span>
          <span style="font-size:11px;color:var(--text-secondary)">相关度: ${(1 - r.score).toFixed(2)}</span>
        </div>
        <div style="font-size:13px;color:var(--text-secondary);margin-top:4px;line-height:1.5">${escHtml(r.content)}</div>
      </div>
    `).join('');

    input.style.display = 'none';
    input.value = '';
  } catch {
    toast('搜索失败', 'error');
  }
}

// ================================================================
//  2. 文件浏览模块
// ================================================================

function fbRootIcon(id) {
  const map = { shared: '🌐', mine: '👤', users: '👥' };
  return _dualIcon(map[id] || '💾', map[id] ? (id === 'shared' ? 'fa-users' : id === 'mine' ? 'fa-user' : 'fa-users-gear') : 'fa-hard-drive');
}

function fbRootDesc(id) {
  const map = { shared: '全员可访问', mine: '仅您与管理员', users: '管理员查看各账号' };
  return map[id] || '';
}

function renderFbRoots(roots) {
  const div = PAGES_DOM.fbRoots();
  if (!div) return;
  if (!roots?.length) { div.innerHTML = ''; return; }

  div.innerHTML = roots.map(r => `
    <button type="button" class="fb-root-btn" data-path="${escHtml(r.path)}" data-id="${escHtml(r.id || '')}">
      ${fbRootIcon(r.id)}
      <span><span>${escHtml(r.name)}</span><span class="root-desc">${escHtml(fbRootDesc(r.id))}</span></span>
    </button>
  `).join('');

  div.onclick = function(e) {
    const btn = e.target.closest('.fb-root-btn');
    if (!btn) return;
    document.querySelectorAll('.fb-root-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    listFiles(btn.getAttribute('data-path'));
  };
}

function updateFbActions(canUpload) {
  const up = PAGES_DOM.fbUploadBtn();
  const mk = PAGES_DOM.fbMkdirBtn();
  const show = window.fbMode === 'workspace' && window.fbCanWrite && window.fbCurrentAbsPath;
  if (up) up.style.display = show && canUpload ? '' : 'none';
  if (mk) mk.style.display = show ? '' : 'none';
}

async function loadDrives() {
  if (!getNanobuddyToken() && window.nanobuddyAuthReady !== true) {
    const items = PAGES_DOM.fbItems();
    if (items) items.innerHTML = '<div class="empty-list">请先登录后再使用团队文件</div>';
    return;
  }

  try {
    const d = await nanobuddyFetch('/api/files/roots').then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });

    window.fbMode = d.mode || 'workspace';
    window.fbRoots = d.roots || [];
    renderFbRoots(window.fbRoots);

    if (window.fbRoots.length) {
      const first = document.querySelector('.fb-root-btn');
      if (first) first.classList.add('active');
      listFiles(window.fbRoots[0].path);
    } else {
      const legacy = await nanobuddyFetch('/api/files/drives').then(r => r.json());
      window.fbMode = legacy.mode || 'legacy';
      window.fbRoots = (legacy.drives || []).map(drv => ({ id: 'legacy', name: drv.name, path: drv.path }));
      renderFbRoots(window.fbRoots);
      if (window.fbRoots.length) listFiles(window.fbRoots[0].path);
    }
  } catch (e) {
    const msg = e.message?.includes('401') ? '登录已失效，请重新登录' : (e.message || '加载失败');
    const pathEl = PAGES_DOM.fbPath();
    const itemsEl = PAGES_DOM.fbItems();
    if (pathEl) pathEl.textContent = '—';
    if (itemsEl) itemsEl.innerHTML = `<div class="empty-list">${escHtml(msg)}</div>`;
  }
}

async function listFiles(path) {
  window.fbCurrentAbsPath = path;
  const pathEl = PAGES_DOM.fbPath();
  const itemsEl = PAGES_DOM.fbItems();
  if (pathEl) pathEl.textContent = '加载中…';
  if (itemsEl) itemsEl.innerHTML = '<div class="loading"><div class="spinner"></div>加载中...</div>';

  try {
    const resp = await nanobuddyFetch(`/api/files/list?path=${encodeURIComponent(path)}`);
    if (!resp.ok) {
      let msg = '加载失败';
      if (resp.status === 500) msg = '服务器内部错误，请稍后重试';
      else if (resp.status === 403) msg = '无访问权限，请登录后重试';
      else if (resp.status === 404) msg = '路径不存在';
      else msg = `HTTP ${resp.status}`;
      throw new Error(msg);
    }
    const d = await resp.json();

    window.fbMode = d.mode || window.fbMode;
    window.fbCanWrite = !!d.can_write;
    window.fbCurrentPath = d.display_path || d.path;
    if (pathEl) pathEl.textContent = window.fbCurrentPath;
    updateFbActions(!!d.can_upload);

    if (itemsEl) {
      itemsEl.innerHTML = '';
      if (d.parent) {
        const up = document.createElement('div');
        up.className = 'fb-item is-dir';
        up.innerHTML = `<span class="item-icon">${_dualIcon('📂', 'fa-folder-open')}</span><span class="item-name" style="font-weight:600">.. 返回上级</span>`;
        up.onclick = () => listFiles(d.parent);
        itemsEl.appendChild(up);
      }

      (d.items || []).forEach(item => {
        const div = document.createElement('div');
        div.className = item.is_dir ? 'fb-item is-dir' : 'fb-item';
        div.setAttribute('data-path', item.path);
        div.setAttribute('data-dir', item.is_dir ? '1' : '0');
        if (item.is_supported) div.setAttribute('data-indexable', '1');

        const icon = item.is_dir ? _dualIcon('📁', 'fa-folder') : getFileIcon(item.ext);
        const size = item.is_dir ? '' : item.size_str;

        let html = `<span class="item-icon">${icon}</span>`;
        if (item.is_dir) {
          html += `<span class="item-name">${escHtml(item.name)}</span>`;
          html += `<span class="item-meta">${item.modified || ''}</span>`;
        } else {
          html += `<span class="item-name">${escHtml(item.name)}</span>`;
          html += `<span class="item-meta">${size} · ${item.modified || ''}</span>`;
          if (item.is_supported) {
            html += '<button class="index-btn">+ 索引</button>';
          }
        }
        div.innerHTML = html;

        div.onclick = function(e) {
          const btn = e.target.closest('.index-btn');
          if (btn) {
            e.stopPropagation();
            quickIndex(this.getAttribute('data-path'));
            return;
          }
          if (this.getAttribute('data-dir') === '1') {
            listFiles(this.getAttribute('data-path'));
          }
        };
        div.ondblclick = function(e) {
          if (e.target.closest('.index-btn')) return;
          if (this.getAttribute('data-dir') === '0') {
            const fp = this.getAttribute('data-path');
            const fname = fp.split(/[/\\]/).pop();
            showConfirm('打开文件', `将在服务器上用默认程序打开：\n\n${fname}`, () => openLocalFile(fp));
          }
        };
        itemsEl.appendChild(div);
      });

      if (!(d.items || []).length && !d.parent) {
        itemsEl.innerHTML = '<div class="empty-list">📁 此文件夹为空，可上传文件</div>';
      }
    }
  } catch (e) {
    const msg = e.message || '加载失败';
    const is500 = msg.includes('500') || msg.includes('服务器内部错误');
    if (itemsEl) itemsEl.innerHTML = `
      <div class="empty-list">
        ${is500 ? '⚠️' : '❌'} ${escHtml(msg)}
        ${is500 ? '<br><button class="btn btn-sm btn-outline" style="margin-top:10px" onclick="listFiles(window.fbCurrentAbsPath)">重试</button>' : ''}
      </div>
    `;
    updateFbActions(false);
  }
}

function goUpDir() {
  if (!window.fbCurrentAbsPath) {
    loadDrives();
    return;
  }
  nanobuddyFetch(`/api/files/list?path=${encodeURIComponent(window.fbCurrentAbsPath)}`)
    .then(r => r.json())
    .then(d => {
      if (d.parent) listFiles(d.parent);
      else {
        document.querySelectorAll('.fb-root-btn').forEach(b => b.classList.remove('active'));
        loadDrives();
      }
    })
    .catch(() => loadDrives());
}

function refreshFiles() {
  if (window.fbCurrentAbsPath) listFiles(window.fbCurrentAbsPath);
  else loadDrives();
}

function triggerFbUpload() {
  const inp = PAGES_DOM.fbUploadInput();
  if (inp) inp.click();
}

function onFbUploadPick(input) {
  if (!input.files?.length || !window.fbCurrentAbsPath) return;
  const files = Array.from(input.files);
  input.value = '';
  let idx = 0;

  function next() {
    if (idx >= files.length) { refreshFiles(); return; }
    const f = files[idx++];
    const fd = new FormData();
    fd.append('file', f);

    nanobuddyFetch(`/api/files/upload?path=${encodeURIComponent(window.fbCurrentAbsPath)}`, {
      method: 'POST',
      body: fd,
    })
      .then(r => r.json())
      .then(d => {
        toast(d.status === 'ok' ? `已上传: ${d.file_name || f.name}` : '上传失败', d.status === 'ok' ? 'success' : 'error');
        next();
      })
      .catch(() => { toast('上传失败', 'error'); next(); });
  }
  toast(`正在上传 ${files.length} 个文件…`, 'info');
  next();
}

async function fbCreateFolder() {
  if (!window.fbCurrentAbsPath) return;
  const name = prompt('新建文件夹名称');
  if (!name?.trim()) return;

  try {
    await nanobuddyFetch('/api/files/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: window.fbCurrentAbsPath, name: name.trim() }),
    }).then(r => {
      if (!r.ok) throw new Error('创建失败');
      return r.json();
    });
    toast('文件夹已创建', 'success');
    refreshFiles();
  } catch (e) {
    toast(e.message || '创建失败', 'error');
  }
}

async function openLocalFile(filePath) {
  try {
    const d = await nanobuddyFetch('/api/files/open?path=' + encodeURIComponent(filePath), { method: 'POST' }).then(r => r.json());
    if (d.status === 'ok') toast(`已打开: ${filePath.split('\\').pop()}`, 'success');
  } catch (e) {
    toast('打开失败: ' + e.message, 'error');
  }
}

async function quickIndex(filePath) {
  try {
    const d = await nanobuddyFetch('/api/knowledge/index', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, recursive: false }),
    }).then(r => r.json());
    toast(d.status === 'ok' ? '✅ 已索引到知识库' : `索引失败: ${d.message || d.detail || ''}`, d.status === 'ok' ? 'success' : 'error');
  } catch (e) {
    toast('索引失败: ' + e.message, 'error');
  }
}

// ================================================================
//  3. 设置与显示选项
// ================================================================

function loadThinkingSetting() {
  const enabled = localStorage.getItem('nanobuddy_show_thinking');
  const el = PAGES_DOM.setShowThinking();
  if (!el) return;
  el.checked = enabled !== null ? enabled === 'true' : true;
  updateThinkingToggleUI();
}

function saveThinkingSetting() {
  const el = PAGES_DOM.setShowThinking();
  if (!el) return;
  localStorage.setItem('nanobuddy_show_thinking', el.checked ? 'true' : 'false');
  updateThinkingToggleUI();
}

function updateThinkingToggleUI() {
  const el = PAGES_DOM.setShowThinking();
  const track = PAGES_DOM.thinkingToggleTrack();
  const thumb = PAGES_DOM.thinkingToggleThumb();
  if (!el || !track || !thumb) return;
  const on = el.checked;
  track.style.background = on ? 'var(--primary)' : '#ccc';
  thumb.style.transform = on ? 'translateX(20px)' : 'none';
}

function isShowThinking() {
  return localStorage.getItem('nanobuddy_show_thinking') !== 'false';
}

function applyIconTheme(theme) {
  if (theme === 'fa') {
    document.body.classList.add('theme-fa');
  } else {
    document.body.classList.remove('theme-fa');
  }
  localStorage.setItem('nanobuddy_icon_theme', theme);
  if (window.nanobuddyCurrentUser && window.nanobuddyAuthReady && typeof nanobuddyFetch === 'function') {
    nanobuddyFetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { icon_theme: theme } }),
    }).catch(() => {});
  }
}

function loadIconTheme() {
  const theme = localStorage.getItem('nanobuddy_icon_theme') || 'emoji';
  const el = PAGES_DOM.setIconTheme();
  if (el) el.value = theme;
  applyIconTheme(theme);
}

const API_PROVIDERS = {
  'openai': { url: 'https://api.openai.com/v1', model: 'gpt-4o-mini', filter: ['openai', 'all'] },
  'deepseek': { url: 'https://api.deepseek.com/v1', model: 'deepseek-chat', filter: ['deepseek', 'all'] },
  'anthropic': { url: 'https://api.anthropic.com/v1', model: 'claude-3-sonnet-20240229', filter: ['anthropic', 'all'] },
  'google': { url: 'https://generativelanguage.googleapis.com/v1', model: 'gemini-pro', filter: ['google', 'all'] },
  'qwen-cloud': { url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-turbo', filter: ['qwen', 'all'] },
  'ernie': { url: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/eb-instant', model: 'eb-instant', filter: ['ernie', 'all'] },
  'hunyuan': { url: 'https://hunyuan.tencent.com/engine/api', model: 'hunyuan-pro', filter: ['hunyuan', 'all'] },
  'doubao': { url: 'https://api.doubao.com/v1', model: 'doubao-pro', filter: ['doubao', 'all'] },
  'xinghuo': { url: 'https://spark-api.xf-yun.com/v3.1/chat', model: 'general', filter: ['xinghuo', 'all'] },
  'huggingface': { url: 'https://api-inference.huggingface.co/models', model: 'meta-llama/Llama-3-8B-Instruct', filter: ['llama', 'qwen', 'baichuan', 'mistral', 'all'] },
  'openai-compat': { url: 'https://api.openai.com/v1', model: 'gpt-4o-mini', filter: ['openai', 'deepseek', 'qwen', 'baichuan', 'llama', 'mistral', 'anthropic', 'google', 'all'] },
};

function onModelSelectChange() {
  const select = document.getElementById('setOpenaiModel');
  const customInput = document.getElementById('setOpenaiModelCustom');
  if (select && customInput) {
    if (select.value === 'custom') {
      customInput.style.display = 'block';
      customInput.focus();
    } else {
      customInput.style.display = 'none';
    }
  }
}

function toggleModelType() {
  const t = PAGES_DOM.setModelType()?.value;
  const ollama = PAGES_DOM.ollamaSettings();
  const openai = PAGES_DOM.openaiSettings();
  if (ollama) ollama.style.display = t === 'ollama' ? '' : 'none';
  if (openai) openai.style.display = t !== 'ollama' ? '' : 'none';
  
  const config = API_PROVIDERS[t];
  if (config) {
    const urlInput = document.getElementById('setOpenaiUrl');
    const modelSelect = document.getElementById('setOpenaiModel');
    const customInput = document.getElementById('setOpenaiModelCustom');
    
    if (urlInput) urlInput.value = config.url;
    
    if (modelSelect) {
      const template = document.getElementById('modelOptionsTemplate');
      if (!template) {
        const tempDiv = document.createElement('div');
        tempDiv.id = 'modelOptionsTemplate';
        tempDiv.style.display = 'none';
        tempDiv.innerHTML = modelSelect.innerHTML;
        document.body.appendChild(tempDiv);
      }
      
      const savedValue = modelSelect.value;
      const templateDiv = document.getElementById('modelOptionsTemplate');
      if (templateDiv) {
        modelSelect.innerHTML = templateDiv.innerHTML;
      }
      
      const optionsToRemove = [];
      Array.from(modelSelect.options).forEach(opt => {
        const provider = opt.getAttribute('data-provider');
        if (!config.filter.includes(provider)) {
          optionsToRemove.push(opt);
        }
      });
      
      optionsToRemove.forEach(opt => opt.remove());
      
      const optgroups = modelSelect.querySelectorAll('optgroup');
      optgroups.forEach(group => {
        if (group.children.length === 0) {
          group.remove();
        }
      });
      
      if (savedValue !== 'custom' && modelSelect.options.namedItem(savedValue)) {
        modelSelect.value = savedValue;
      } else {
        modelSelect.value = config.model;
      }
      
      if (customInput) {
        customInput.style.display = modelSelect.value === 'custom' ? 'block' : 'none';
      }
    }
  }
}

function saveNanobuddyApiKey() {
  const el = PAGES_DOM.setNanobuddyApiKey();
  if (!el) return;
  setNanobuddyApiKey(el.value.trim());
  toast('访问密钥已保存到浏览器', 'success');
  loadSecurityStatus();
}

async function loadSecurityStatus() {
  const hint = PAGES_DOM.securityStatusHint();
  if (!hint) return;

  const headers = {};
  const token = getNanobuddyToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;

  try {
    const d = await fetch('/api/security/status', { headers }).then(r => r.json());
    if (!d.auth_enabled) {
      hint.textContent = '服务端未启用鉴权';
      hint.style.color = '';
      return;
    }
    if (d.user?.username) {
      hint.textContent = `已登录：${d.user.display_name || d.user.username}${d.user.role === 'admin' ? '（管理员）' : ''}`;
      hint.style.color = '#27ae60';
      return;
    }
    if (window.nanobuddyCurrentUser) {
      hint.textContent = `已登录：${window.nanobuddyCurrentUser.display_name || window.nanobuddyCurrentUser.username}`;
      hint.style.color = '#27ae60';
      return;
    }
    hint.textContent = '未登录（请使用账号登录；API Key 仅用于脚本调用）';
    hint.style.color = '#e67e22';
  } catch {
    hint.textContent = '';
  }
}

// ---- 审计日志 ----

const AUDIT_TOOL_LABELS = {
  'api_files_list': '列出文件',
  'api_files_read': '读取文件',
  'api_files_write': '写入文件',
  'api_files_delete': '删除文件',
  'read_file': '读取文件',
  'write_file': '写入文件',
  'list_dir': '列出目录',
  'edit_file': '编辑文件',
  'delete_file': '删除文件',
  'glob': '文件搜索',
  'grep': '内容搜索',
};
const AUDIT_TYPE_LABELS = { 
  tool_call: '工具调用', 
  file_access: '文件访问',
  login: '登录',
  logout: '登出',
  api_call: 'API调用'
};

async function loadAuditLogs() {
  const tbody = PAGES_DOM.auditLogBody();
  const hint = PAGES_DOM.auditLoadHint();
  if (!tbody) return;

  const eventType = PAGES_DOM.auditEventType()?.value || '';
  const limit = parseInt(PAGES_DOM.auditLimit()?.value || '100', 10);

  let url = `/api/security/audit/logs?limit=${limit}&offset=0`;
  if (eventType) url += `&event_type=${encodeURIComponent(eventType)}`;

  if (hint) hint.textContent = '加载中…';
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-secondary);padding:20px">加载中…</td></tr>';

  try {
    const d = await nanobuddyFetch(url).then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });

    const events = d.events || [];
    if (hint) hint.textContent = `共 ${events.length} 条（最近）`;

    if (!events.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-secondary);padding:24px">暂无审计记录</td></tr>';
      return;
    }

    tbody.innerHTML = events.map(ev => {
      const typeLabel = AUDIT_TYPE_LABELS[ev.event_type] || ev.event_type || '—';
      let toolOrAction = ev.tool_name || ev.action || '—';
      toolOrAction = AUDIT_TOOL_LABELS[toolOrAction] || toolOrAction;
      const detailParts = [];
      if (ev.path) {
        let displayPath = ev.path;
        const workspaceMatch = displayPath.match(/[\\/](data[\\/]workspace[\\/].*)$/);
        if (workspaceMatch) {
          displayPath = workspaceMatch[1];
        }
        detailParts.push(displayPath);
      } else if (ev.detail) {
        detailParts.push(String(ev.detail).slice(0, 200));
      }
      if (ev.session_id) {
        let sid = String(ev.session_id);
        if (sid.length > 12) sid = sid.slice(0, 12) + '…';
        detailParts.push('会话:' + sid);
      }
      const detailPlain = detailParts.join(' · ') || '—';
      const statusCls = ev.status === 'ok' ? 'audit-status-ok' : 'audit-status-error';
      const statusText = ev.status === 'ok' ? '成功' : (ev.status || '—');
      return `<tr>
        <td>${escHtml(ev.created_at || '—')}</td>
        <td><span class="audit-type-badge">${escHtml(typeLabel)}</span></td>
        <td title="${escHtml(ev.tool_name || ev.action || '')}">${escHtml(toolOrAction)}</td>
        <td class="audit-detail-cell" title="${escHtml(ev.path || detailPlain)}">${escHtml(detailPlain)}</td>
        <td class="${statusCls}">${escHtml(statusText)}</td>
      </tr>`;
    }).join('');
  } catch (e) {
    if (hint) hint.textContent = '';
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--danger);padding:20px">加载失败: ${escHtml(e.message || '')}</td></tr>`;
  }
}

// ---- 模型设置加载 ----
function applyRoleBasedSettingsVisibility() {
  const userRole = window.AuthStore?.user?.role || 'member';
  const isAdmin = userRole === 'admin';
  document.querySelectorAll('.settings-group.admin-only').forEach(el => {
    el.style.display = isAdmin ? '' : 'none';
  });
}

async function loadModelSettings() {
  applyRoleBasedSettingsVisibility();
  const keyEl = PAGES_DOM.setNanobuddyApiKey();
  if (keyEl) keyEl.value = getNanobuddyApiKey();
  loadSecurityStatus();
  loadAuditLogs();

  try {
    const d = await nanobuddyFetch('/api/settings').then(r => r.json());
    const s = d.db_settings || {};

    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el && val !== undefined && val !== null) {
        if (el.type === 'checkbox') el.checked = val !== false && val !== 'false';
        else el.value = val;
      }
    };

    setVal('setModelType', s.api_provider || s.model_type);
    setVal('setOllamaUrl', s.ollama_url);
    setVal('setChatModel', s.chat_model);
    setVal('setOpenaiUrl', s.openai_base_url);

    const keyInput = PAGES_DOM.setOpenaiKey();
    if (keyInput) {
      if (s.openai_api_key_configured) {
        keyInput.placeholder = '已配置（留空不修改，填写则更新）';
      } else {
        keyInput.placeholder = 'sk-...';
      }
    }

    const modelSelect = document.getElementById('setOpenaiModel');
    const customInput = document.getElementById('setOpenaiModelCustom');
    if (modelSelect && s.openai_model) {
      const hasOption = Array.from(modelSelect.options).some(opt => opt.value === s.openai_model);
      if (hasOption) {
        modelSelect.value = s.openai_model;
        if (customInput) customInput.style.display = 'none';
      } else {
        modelSelect.value = 'custom';
        if (customInput) {
          customInput.value = s.openai_model;
          customInput.style.display = 'block';
        }
      }
    }
    setVal('setEmbedModel', s.embed_model);
    setVal('setChunkSize', s.chunk_size);
    setVal('setOverlap', s.chunk_overlap);
    setVal('setTopK', s.top_k);
    setVal('setAutoCompact', s.context_auto_compact_enabled);
    setVal('setPruneTools', s.context_prune_tool_results);
    setVal('setCompactThreshold', s.context_auto_compact_threshold);

    const mcpTa = PAGES_DOM.setMcpDirs();
    if (mcpTa && s.mcp_filesystem_dirs !== undefined) mcpTa.value = s.mcp_filesystem_dirs;
    setVal('setMcpIncludeKnowledge', s.mcp_include_knowledge);
    setVal('setMcpIncludeData', s.mcp_include_data);

    if (s.icon_theme) applyIconTheme(s.icon_theme);

    const mcpHint = PAGES_DOM.setMcpResolvedHint();
    if (mcpHint && s.mcp_resolved_dirs?.length) {
      mcpHint.textContent = s.mcp_resolved_dirs.join(' · ');
    }

    toggleModelType();
  } catch {}
}

// ---- MCP 重载 ----
function applyMcpReloadResponse(d) {
  const hint = PAGES_DOM.setMcpResolvedHint();
  if (hint && d.filesystem_dirs?.length) {
    hint.textContent = d.filesystem_dirs.join(' · ');
  }
  toast(d.message || 'MCP 已重新连接', 'success');
  loadMcpStatus();
}

async function reloadMcpFilesystem() {
  const btn = document.querySelector('button[onclick="reloadMcpFilesystem()"]');
  const prevText = btn?.textContent || '';
  if (btn) { btn.disabled = true; btn.textContent = '连接文件 MCP…'; }

  try {
    const d = await nanobuddyFetch('/api/mcp/reload', { method: 'POST' })
      .catch(() => nanobuddyFetch('/api/mcp/servers', { method: 'POST' }))
      .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
    applyMcpReloadResponse(d);
  } catch (e) {
    const msg = String(e.message || e);
    if (msg.includes('404')) {
      toast('应用失败：请先完全退出并重新启动 nanobuddy，再点「应用 MCP 目录」', 'error');
    } else {
      toast('应用失败: ' + msg, 'error');
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = prevText || '应用 MCP 目录（无需重启）'; }
  }
}


// ---- MCP 服务状态 ----
async function loadMcpStatus() {
  const box = document.getElementById('mcpStatusList');
  if (!box) return;
  box.textContent = '加载中…';
  try {
    const d = await nanobuddyFetch('/api/mcp/status').then(r => r.json());
    const servers = d.servers || [];
    if (!servers.length) {
      box.textContent = d.error ? ('获取失败: ' + d.error) : '未配置 MCP 服务（config.yaml → mcp_servers）';
      return;
    }
    const esc = s => String(s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
    box.innerHTML = servers.map(s => {
      const dot = s.connected
        ? '<span style="color:#27ae60">●</span> 已连接'
        : '<span style="color:#e74c3c">●</span> 未连接';
      const tools = s.connected ? (s.tools + ' 个工具') : '—';
      return '<div style="display:flex;justify-content:space-between;padding:2px 0">'
        + '<span>' + esc(s.name) + '</span><span>' + dot + ' · ' + tools + '</span></div>';
    }).join('');
  } catch (e) {
    box.textContent = '获取失败: ' + (e.message || e);
  }
}


// ---- 测试模型连接 ----
async function testModelConn() {
  const btn = PAGES_DOM.testModelBtn();
  const result = PAGES_DOM.testModelResult();
  if (!btn || !result) return;

  btn.disabled = true;
  btn.textContent = '⏳ 测试中...';
  result.textContent = '';
  result.style.color = '#999';

  const modelType = PAGES_DOM.setModelType()?.value || 'ollama';
  const baseUrl = modelType === 'ollama' ? PAGES_DOM.setOllamaUrl()?.value : PAGES_DOM.setOpenaiUrl()?.value;
  const apiKey = modelType === 'ollama' ? '' : PAGES_DOM.setOpenaiKey()?.value;
  const model = modelType === 'ollama' ? PAGES_DOM.setChatModel()?.value : getOpenaiModelValue();
  const finalType = modelType === 'ollama' ? 'ollama' : 'openai';

  try {
    const d = await nanobuddyFetch('/api/models/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_type: finalType, base_url: baseUrl, api_key: apiKey, model }),
    }).then(r => r.json());

    result.textContent = d.message || (d.status === 'ok' ? '连接成功' : '连接失败');
    result.style.color = d.status === 'ok' ? '#27ae60' : '#e74c3c';
  } catch (e) {
    result.textContent = '❌ 请求失败: ' + e.message;
    result.style.color = '#e74c3c';
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 测试模型连接';
  }
}

// ---- 保存设置 ----
function getOpenaiModelValue() {
  const modelSelect = document.getElementById('setOpenaiModel');
  const customInput = document.getElementById('setOpenaiModelCustom');
  if (modelSelect && customInput) {
    if (modelSelect.value === 'custom') {
      return customInput.value.trim();
    }
  }
  return modelSelect ? modelSelect.value : '';
}

async function saveSettings() {
  const getVal = (id, isCheckbox) => {
    const el = document.getElementById(id);
    return el ? (isCheckbox ? el.checked : el.value) : undefined;
  };

  const settings = {
    model_type: getVal('setModelType') === 'ollama' ? 'ollama' : 'openai',
    api_provider: getVal('setModelType'),
    ollama_url: getVal('setOllamaUrl'),
    chat_model: getVal('setChatModel'),
    openai_base_url: getVal('setOpenaiUrl'),
    openai_api_key: getVal('setOpenaiKey'),
    openai_model: getOpenaiModelValue(),
    embed_model: getVal('setEmbedModel'),
    chunk_size: getVal('setChunkSize'),
    chunk_overlap: getVal('setOverlap'),
    top_k: getVal('setTopK'),
    context_auto_compact_enabled: getVal('setAutoCompact', true),
    context_auto_compact_threshold: getVal('setCompactThreshold') || '60000',
    context_prune_tool_results: getVal('setPruneTools', true),
    mcp_filesystem_dirs: getVal('setMcpDirs') || '',
    mcp_include_knowledge: getVal('setMcpIncludeKnowledge', true),
    mcp_include_data: getVal('setMcpIncludeData', true),
  };

  try {
    const d = await nanobuddyFetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings }),
    }).then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
    toast(d.message || '设置已保存，模型配置已即时生效', 'success');
  } catch (e) {
    toast('保存失败: ' + (e.message || '未知错误'), 'error');
  }
}

// ---- 企业微信配置 ----
async function loadWorkConfig() {
  try {
    const d = await nanobuddyFetch('/api/settings').then(r => r.json());
    const s = d.db_settings || {};
    const setVal = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
    setVal('workCorpId', s.work_corp_id);
    setVal('workAgentId', s.work_agent_id);
    setVal('workSecret', s.work_secret);

    const url = window.location.origin + '/api/work/callback';
    const el = PAGES_DOM.workCallbackUrl();
    if (el) el.textContent = url;
  } catch {}
}

function saveWorkConfig() {
  const c = PAGES_DOM.workCorpId()?.value.trim();
  const a = PAGES_DOM.workAgentId()?.value.trim();
  const s = PAGES_DOM.workSecret()?.value.trim();
  if (!c || !s) { toast('请填写 CorpID 和 Secret', 'error'); return; }

  nanobuddyFetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings: { work_corp_id: c, work_agent_id: a, work_secret: s } }),
  })
    .then(() => toast('企业微信配置已保存', 'success'))
    .catch(() => toast('保存失败', 'error'));
}

async function testWorkConn() {
  const c = PAGES_DOM.workCorpId()?.value.trim();
  const a = PAGES_DOM.workAgentId()?.value.trim();
  const s = PAGES_DOM.workSecret()?.value.trim();
  if (!c || !s) { toast('请先填写 CorpID 和 Secret', 'error'); return; }

  const btn = document.querySelector('#page-settings .btn-primary');
  const r = PAGES_DOM.workTestResult();
  if (btn) btn.disabled = true;
  if (r) { r.textContent = '测试中...'; r.style.color = '#999'; }

  try {
    await nanobuddyFetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { work_corp_id: c, work_agent_id: a, work_secret: s } }),
    });
    const d = await nanobuddyFetch('/api/work/status').then(r => r.json());
    if (r) {
      r.textContent = d.connected ? `✅ ${d.message || '连接成功'}` : `❌ ${d.message || '连接失败'}`;
      r.style.color = d.connected ? '#27ae60' : '#e74c3c';
    }
  } catch (e) {
    if (r) { r.textContent = '❌ ' + e.message; r.style.color = '#e74c3c'; }
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ================================================================
//  4. 数据库模块
// ================================================================

function switchDbTab(tab) {
  document.querySelectorAll('.db-tab').forEach(t => {
    t.style.borderBottom = '2px solid transparent';
    t.style.color = 'var(--text-secondary)';
    t.style.fontWeight = '400';
    t.classList.remove('active');
  });
  document.querySelectorAll('.db-panel').forEach(p => p.style.display = 'none');

  const btn = document.querySelector(`.db-tab[data-dbtab="${tab}"]`);
  if (btn) {
    btn.style.borderBottom = '2px solid var(--primary)';
    btn.style.color = 'var(--primary)';
    btn.style.fontWeight = '600';
    btn.classList.add('active');
  }

  const panel = document.getElementById(`dbpanel-${tab}`);
  if (panel) panel.style.display = 'block';
  if (tab === 'sources') loadDbConfigs();
  if (tab === 'query') loadDbConfigSelect();
}

async function loadDbConfigs() {
  const list = PAGES_DOM.dbConfigList();
  if (!list) return;
  list.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px"><div class="spinner"></div></div>';

  try {
    const data = await nanobuddyFetch('/api/database/configs').then(r => r.json());
    const configs = data.configs || [];

    if (!configs.length) {
      list.innerHTML = '<div style="grid-column:1/-1;padding:60px 0;text-align:center;color:var(--text-secondary);font-size:14px">暂无数据源，点击上方「新增」按钮添加</div>';
      return;
    }

    list.innerHTML = configs.map(c => `
      <div class="db-config-card">
        <div class="dcc-header">
          <div>
            <span class="dcc-name">${escHtml(c.name)}</span>
            <span class="dcc-type">${c.db_type === 'mysql' ? 'MySQL' : c.db_type === 'postgresql' ? 'PostgreSQL' : c.db_type === 'sqlserver' ? 'SQL Server' : 'SQLite'}</span>
          </div>
          <button class="btn btn-sm btn-outline" onclick="deleteDbConfig(${c.id})" style="color:var(--danger)">${_dualIcon('🗑️', 'fa-trash-can')}</button>
        </div>
        <div class="dcc-info">${c.db_type === 'sqlite' ? '文件: ' + escHtml(c.database_name) : escHtml(c.host) + ':' + c.port + ' / ' + escHtml(c.database_name) + ' — ' + escHtml(c.username)}</div>
        <div class="dcc-actions">
          <button class="btn btn-sm btn-outline" onclick="testDbConfig(${c.id})">${_dualIcon('🔌', 'fa-plug')} 测试连接</button>
          <button class="btn btn-sm btn-outline" onclick="scanDbConfig(${c.id})">${_dualIcon('📡', 'fa-satellite-dish')} 扫描表结构</button>
          <button class="btn btn-sm btn-outline" onclick="showTableMeta(${c.id})">${_dualIcon('📋', 'fa-clipboard-list')} 表管理</button>
        </div>
        <div id="dbMsg_${c.id}" style="font-size:12px;margin-top:6px"></div>
      </div>
    `).join('');
  } catch (e) {
    list.innerHTML = `<div style="color:var(--danger);padding:20px">加载失败: ${e.message}</div>`;
  }
}

function showDbConfigForm(editId) {
  const fields = [
    { id: 'fld_name', label: '名称', type: 'text' },
    { id: 'fld_db_type', label: '类型', type: 'select', options: ['mysql', 'postgresql', 'sqlserver', 'sqlite'] },
    { id: 'fld_host', label: '主机地址', type: 'text', default: 'localhost' },
    { id: 'fld_port', label: '端口', type: 'text', default: '3306' },
    { id: 'fld_database_name', label: '数据库名/文件路径', type: 'text' },
    { id: 'fld_username', label: '用户名', type: 'text' },
    { id: 'fld_password', label: '密码', type: 'password' },
  ];

  let body = fields.map(f => {
    const input = f.type === 'select'
      ? `<select id="${f.id}" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:6px;font-size:14px">${f.options.map(o => `<option value="${o}">${o === 'mysql' ? 'MySQL' : o === 'postgresql' ? 'PostgreSQL' : o === 'sqlserver' ? 'SQL Server' : 'SQLite'}</option>`).join('')}</select>`
      : `<input id="${f.id}" type="${f.type}" value="${f.default || ''}" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:6px;font-size:14px;box-sizing:border-box">`;
    return `<div style="margin-bottom:12px"><label style="font-size:13px;font-weight:500;display:block;margin-bottom:4px">${f.label}</label>${input}</div>`;
  }).join('');

  body += `<div style="display:flex;gap:8px;margin-top:4px">
    <button class="btn btn-primary" onclick="saveDbConfigFromForm(${editId || 'null'})"><i class="icon-fa fa-solid fa-floppy-disk"></i> 保存</button>
    <button class="btn btn-outline" onclick="closeDialog()">取消</button>
  </div>`;

  showDialog(editId ? '编辑数据源' : '新增数据源', body);

  if (editId) {
    nanobuddyFetch(`/api/database/configs/${editId}`)
      .then(r => r.json())
      .then(d => {
        const cfg = d.config || {};
        ['name', 'host', 'database_name', 'username'].forEach(k => {
          const el = document.getElementById('fld_' + k);
          if (el && cfg[k]) el.value = cfg[k];
        });
        const p = document.getElementById('fld_port');
        if (p && cfg.port) p.value = cfg.port;
        const t = document.getElementById('fld_db_type');
        if (t && cfg.db_type) t.value = cfg.db_type;
      })
      .catch(() => {});
  }
}

async function saveDbConfigFromForm(editId) {
  const fields = ['name', 'db_type', 'host', 'port', 'database_name', 'username', 'password'];
  const data = {};
  fields.forEach(k => {
    const el = document.getElementById('fld_' + k);
    if (el) data[k] = el.value;
  });

  if (!data.name || !data.database_name) {
    alert('请填写必填字段');
    return;
  }
  if (data.db_type !== 'sqlite' && (!data.host || !data.username)) {
    alert('非SQLite数据库需要填写主机地址和用户名');
    return;
  }

  const url = editId ? `/api/database/configs/${editId}` : '/api/database/configs';
  const method = editId ? 'PUT' : 'POST';

  try {
    const d = await nanobuddyFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json());
    if (d.status === 'ok') { closeDialog(); loadDbConfigs(); }
    else alert('保存失败: ' + (d.detail || '未知错误'));
  } catch (e) {
    alert('请求失败: ' + e.message);
  }
}

function deleteDbConfig(id) {
  if (!confirm('确定删除此数据源？关联的表元数据也会被删除。')) return;
  nanobuddyFetch(`/api/database/configs/${id}`, { method: 'DELETE' })
    .then(() => loadDbConfigs())
    .catch(e => alert('删除失败: ' + e.message));
}

async function testDbConfig(id) {
  const el = document.getElementById('dbMsg_' + id);
  if (el) el.innerHTML = '<span style="color:#888">⏳ 测试中...</span>';
  try {
    const d = await nanobuddyFetch(`/api/database/configs/${id}/test`, { method: 'POST' }).then(r => r.json());
    if (el) el.innerHTML = `<span style="color:${d.status === 'ok' ? 'green' : 'red'}">${escHtml(d.message)}</span>`;
  } catch (e) {
    if (el) el.innerHTML = `<span style="color:red">请求失败: ${escHtml(e.message)}</span>`;
  }
}

async function scanDbConfig(id) {
  const el = document.getElementById('dbMsg_' + id);
  if (el) el.innerHTML = '<span style="color:#888">⏳ 扫描表结构中...</span>';
  try {
    const d = await nanobuddyFetch(`/api/database/configs/${id}/scan`, { method: 'POST' }).then(r => r.json());
    if (el) el.innerHTML = `<span style="color:green">✅ ${escHtml(d.message)}</span>`;
  } catch (e) {
    if (el) el.innerHTML = `<span style="color:red">❌ 扫描失败: ${escHtml(e.message)}</span>`;
  }
}

async function showTableMeta(configId) {
  try {
    const d = await nanobuddyFetch(`/api/database/configs/${configId}/metadata`).then(r => r.json());
    const metas = d.metadata || [];
    if (!metas.length) { alert('暂无表元数据，请先扫描'); return; }

    let html = `<div style="max-height:400px;overflow-y:auto"><div style="font-size:13px;font-weight:500;margin-bottom:8px;color:var(--text-secondary)">共 ${metas.length} 个表，勾选「启用问答」即可用于智能问数</div>`;
    metas.forEach(m => {
      const cols = m.columns || [];
      const cn = cols.map(c => c.column_name).join(', ');
      html += `<div class="db-table-item">
        <div>
          <div class="dbt-name">${escHtml(m.table_name)}</div>
          <div class="dbt-info">${m.table_comment ? escHtml(m.table_comment) + ' · ' : ''}${cols.length} 字段 · ${m.row_count || '?'} 行</div>
          <div style="font-size:11px;color:#aaa;margin-top:2px">${escHtml(cn.slice(0, 80))}</div>
        </div>
        <div class="dbt-actions">
          <label style="font-size:12px;display:flex;align-items:center;gap:4px;cursor:pointer">
            <input type="checkbox" ${m.qa_enabled ? 'checked' : ''} onchange="toggleTableQa(${m.id}, this.checked)"> 问答
          </label>
        </div>
      </div>`;
    });
    html += '</div>';
    showDialog('表管理 — 配置问答', html + '<div style="margin-top:12px"><button class="btn btn-outline" onclick="closeDialog()">关闭</button></div>');
  } catch (e) {
    alert('加载失败: ' + e.message);
  }
}

function toggleTableQa(metaId, enabled) {
  nanobuddyFetch(`/api/database/metadata/${metaId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ qa_enabled: enabled ? 1 : 0 }),
  }).catch(() => {});
}

async function loadDbConfigSelect() {
  const sel = PAGES_DOM.sqConfigSelect();
  if (!sel) return;
  try {
    const d = await nanobuddyFetch('/api/database/configs').then(r => r.json());
    const configs = d.configs || [];
    sel.innerHTML = '<option value="">-- 选择数据源 --</option>';
    configs.forEach(c => {
      sel.innerHTML += `<option value="${c.id}">${escHtml(c.name)} (${c.db_type === 'mysql' ? 'MySQL' : c.db_type === 'postgresql' ? 'PostgreSQL' : c.db_type === 'sqlserver' ? 'SQL Server' : 'SQLite'}/${escHtml(c.database_name)})</option>`;
    });
  } catch {}
}

// ---- 智能问数 ----
function executeSmartQuery() {
  const configId = PAGES_DOM.sqConfigSelect()?.value;
  const input = PAGES_DOM.sqInput();
  const query = input?.value.trim();
  if (!configId) { toast('请先选择数据源', 'error'); return; }
  if (!query) { toast('请输入查询内容', 'error'); return; }

  const msgs = PAGES_DOM.sqMessages();
  if (!msgs) return;

  const empty = msgs.querySelector('.db-side-empty');
  if (empty) empty.remove();

  // 用户消息
  msgs.innerHTML += `<div class="sq-msg user">${escHtml(query)}</div>`;
  if (input) input.value = '';
  if (input) input.disabled = true;

  const bubble = document.createElement('div');
  bubble.className = 'sq-msg assistant';
  bubble.innerHTML = '<div class="sq-steps"></div>';
  msgs.appendChild(bubble);
  msgs.scrollTop = msgs.scrollHeight;

  const stepsEl = bubble.querySelector('.sq-steps');
  let resultAppended = false;

  const addStep = (msg, status) => {
    if (!stepsEl) return;
    const icons = { running: '⏳', completed: '✅', failed: '❌' };
    const icon = icons[status] || '•';
    const color = status === 'failed' ? '#c62828' : (status === 'completed' ? '#2e7d32' : '#f57f17');
    stepsEl.innerHTML += `<div style="font-size:12px;color:${color};margin:2px 0">${icon} ${escHtml(msg)}</div>`;
    msgs.scrollTop = msgs.scrollHeight;
  };

  nanobuddyFetch('/api/smart-query/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, config_id: parseInt(configId, 10) }),
  })
    .then(resp => {
      if (!resp.ok) throw new Error('请求失败 (' + resp.status + ')');
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      const read = () => {
        reader.read().then(({ done, value }) => {
          if (done) {
            if (input) input.disabled = false;
            if (input) input.focus();
            msgs.scrollTop = msgs.scrollHeight;
            return;
          }

          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim() || !line.startsWith('data: ')) continue;
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.type === 'step') addStep(ev.message, ev.status);
              else if (ev.type === 'result' && !resultAppended) {
                resultAppended = true;
                const resultHtml = buildSqResultHtml(ev.data || {});
                bubble.innerHTML += resultHtml;
                msgs.scrollTop = msgs.scrollHeight;
              } else if (ev.type === 'error') {
                addStep(ev.message || '查询失败', 'failed');
                if (input) input.disabled = false;
              }
            } catch {}
          }

          msgs.scrollTop = msgs.scrollHeight;
          read();
        }).catch(() => {
          addStep('读取流失败', 'failed');
          if (input) input.disabled = false;
        });
      };
      read();
    })
    .catch(e => {
      addStep('请求失败: ' + e.message, 'failed');
      if (input) input.disabled = false;
    });
}

function buildSqResultHtml(d) {
  const summary = d.summary || '';
  const sql = d.generated_sql || '';
  const cols = d.columns || [];
  const rows = d.data || [];
  const total = d.total || rows.length;

  let html = '';
  if (summary) html += `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border-light)">${summary}</div>`;
  if (sql) {
    html += `<div class="sq-sql-toggle" onclick="const p=this.nextElementSibling;const d=p.style.display;if(!d||d==='none'){p.style.display='block';this.querySelector('.sq-sql-arrow').textContent='▼';}else{p.style.display='none';this.querySelector('.sq-sql-arrow').textContent='▶';}">
      <span class="sq-sql-arrow">▶</span> 查看 SQL
    </div><div class="sq-msg-sql" style="display:none;margin-top:6px">${escHtml(sql)}</div>`;
  }
  if (cols.length) {
    html += `<div style="margin-top:8px;font-size:12px;color:var(--text-secondary)">共 ${total} 行</div>`;
    html += `<div style="overflow-x:auto;margin-top:4px"><table style="font-size:11px;border-collapse:collapse;width:100%"><thead><tr>`;
    cols.forEach(c => html += `<th style="padding:4px 6px;border:1px solid var(--border-light);text-align:left;white-space:nowrap">${escHtml(c)}</th>`);
    html += `</tr></thead><tbody>`;
    const maxR = Math.min(rows.length, 20);
    for (let i = 0; i < maxR; i++) {
      html += '<tr>';
      cols.forEach(c => {
        const v = rows[i][c];
        html += `<td style="padding:3px 6px;border:1px solid var(--border-light);font-size:11px">${escHtml(v !== null && v !== undefined ? String(v) : '')}</td>`;
      });
      html += '</tr>';
    }
    html += '</tbody></table></div>';
  }
  return html;
}

// ---- 弹窗工具 ----
function showDialog(title, bodyHtml) {
  closeDialog();
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center';

  const dialog = document.createElement('div');
  dialog.style.cssText = 'background:var(--bg-card);border-radius:var(--radius-lg);width:700px;max-width:90vw;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.2)';
  dialog.innerHTML = `<div style="padding:16px 20px;border-bottom:1px solid var(--border);font-size:16px;font-weight:600">${title}</div><div style="padding:20px">${bodyHtml}</div>`;

  overlay.appendChild(dialog);
  overlay.onclick = e => { if (e.target === overlay) closeDialog(); };
  document.body.appendChild(overlay);
  window._dlgOverlay = overlay;
}

function closeDialog() {
  const overlay = window._dlgOverlay;
  if (overlay) { document.body.removeChild(overlay); window._dlgOverlay = null; }
}

// ================================================================
//  5. 统计与工具页面
// ================================================================

// ---- 统计状态 ----
const StatsState = {
  data: null,
  sort: 'date',
  filter: 'all',
  legend: { prompt: true, completion: true, cached: true },
  donutHover: -1,
  donutExpand: 0,
  donutAnimId: null,
};

// ---- 统计工具函数 ----
function formatNumber(n) {
  if (n == null) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function formatNumberFull(n) {
  return (n || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function getDateRange(range) {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (range === 'today') return { start, end: now };
  if (range === 'week') {
    const day = now.getDay() || 7;
    start.setDate(now.getDate() - day + 1);
    return { start, end: now };
  }
  if (range === 'month') {
    start.setDate(1);
    return { start, end: now };
  }
  return { start: new Date(0), end: now };
}

function filterByRange(convs, range) {
  if (range === 'all' || !convs) return convs || [];
  const r = getDateRange(range);
  return convs.filter(c => {
    if (!c.date) return false;
    const d = new Date(c.date);
    return d >= r.start && d <= r.end;
  });
}

function setStatsFilter(range) {
  StatsState.filter = range;
  document.querySelectorAll('#statsFilter .filter-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.range === range);
  });
  if (StatsState.data) renderAllStats();
}

// ---- 加载统计 ----
async function loadStats() {
  try {
    StatsState.data = await nanobuddyFetch('/api/stats/tokens').then(r => r.json());
    renderAllStats();
  } catch {
    const tbody = PAGES_DOM.statsTableBody();
    const empty = PAGES_DOM.statsEmpty();
    if (tbody) tbody.innerHTML = '';
    if (empty) empty.style.display = 'block';
  }
}

async function loadToolPage() {
  try {
    const d = await nanobuddyFetch(`/api/stats/tools?days=${PAGES_CONFIG.TOOL_STATS_DAYS}`).then(r => r.json());
    renderToolPage(d);
  } catch {}
}

// ---- 渲染工具统计 ----
function renderToolPage(data) {
  if (!data?.totals) return;
  const t = data.totals;

  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setText('tsNumCalls', formatNumber(t.total_calls || 0));
  setText('tsNumSuccess', formatNumber(t.success_count || 0));
  setText('tsNumErrors', formatNumber(t.error_count || 0));

  const totalTokens = (t.total_prompt || 0) + (t.total_completion || 0);
  setText('tsNumTokens', formatNumber(totalTokens));

  const cost = t.total_cost || 0;
  const costEl = document.getElementById('tsNumTotalCost');
  if (costEl) {
    costEl.textContent = cost < 0.01 && cost > 0 ? '< ¥0.01' : '¥' + cost.toFixed(4);
  }

  const tbody = PAGES_DOM.toolsTableBody();
  const empty = PAGES_DOM.toolsEmpty();
  const tools = data.by_tool || [];

  if (!tools.length) {
    if (tbody) tbody.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  let html = '';
  tools.forEach((t2, i) => {
    const tc = t2.total_cost || 0;
    const costStr = tc < 0.01 && tc > 0 ? '<¥0.01' : '¥' + tc.toFixed(4);
    html += `<tr>
      <td>${i + 1}</td>
      <td>${t2.tool_name || '-'}</td>
      <td class="num">${formatNumber(t2.call_count || 0)}</td>
      <td class="num" style="color:var(--success)">${formatNumber(t2.success_count || 0)}</td>
      <td class="num" style="color:var(--danger)">${formatNumber(t2.error_count || 0)}</td>
      <td class="num">${formatNumber(t2.avg_duration_ms || 0)}</td>
      <td class="num">${formatNumber(t2.total_prompt || 0)}</td>
      <td class="num">${formatNumber(t2.total_completion || 0)}</td>
      <td class="num">${formatNumber(t2.total_cached || 0)}</td>
      <td class="num">${costStr}</td>
    </tr>`;
  });
  if (tbody) tbody.innerHTML = html;

  const period = PAGES_DOM.toolsStatsPeriod();
  if (period) period.textContent = '(近30天)';
}

// ---- 统计渲染 ----
function renderAllStats() {
  if (!StatsState.data) return;

  const filtered = filterByRange(StatsState.data.conversations, StatsState.filter);
  const total = { conversations: filtered.length, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cached_tokens: 0, cost: 0 };

  filtered.forEach(c => {
    total.prompt_tokens += c.prompt_tokens || 0;
    total.completion_tokens += c.completion_tokens || 0;
    total.total_tokens += c.total_tokens || 0;
    total.cached_tokens += c.cached_tokens || 0;
    total.cost += c.cost || 0;
  });

  renderStatsSummary(total);
  drawDonutChart(total);
  renderStatsTable(filtered);
}

function renderStatsSummary(total) {
  const isLocal = StatsState.data?.is_local;
  const modelName = StatsState.data?.model || '';

  const map = {
    convs: { id: 'sNumConvs', val: total.conversations },
    total: { id: 'sNumTotal', val: total.total_tokens },
    prompt: { id: 'sNumPrompt', val: total.prompt_tokens },
    completion: { id: 'sNumCompletion', val: total.completion_tokens },
    cached: { id: 'sNumCached', val: total.cached_tokens },
    cost: { id: 'sNumCost', val: total.cost },
  };

  document.querySelectorAll('#statsSummary .s-card').forEach(card => {
    const key = card.dataset.key;
    const info = map[key];
    if (!info) return;
    const el = document.getElementById(info.id);
    if (!el) return;

    if (key === 'cost') {
      if (isLocal) el.textContent = '免费';
      else if (info.val < 0.01 && info.val > 0) el.textContent = '< ¥0.01';
      else el.textContent = '¥' + info.val.toFixed(2);
    } else {
      el.textContent = formatNumber(info.val);
    }

    if (key === 'cached') {
      card.style.display = info.val > 0 ? '' : 'none';
    }
  });

  const hint = document.getElementById('sCostModelHint');
  if (hint) hint.textContent = isLocal ? '(本地免费)' : '(' + modelName + ')';
}

// ---- 渲染统计表格 ----
function renderStatsTable(convs) {
  const tbody = PAGES_DOM.statsTableBody();
  const empty = PAGES_DOM.statsEmpty();

  if (!convs?.length) {
    if (tbody) tbody.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  const isLocal = StatsState.data?.is_local;
  const sorted = convs.slice().sort((a, b) => {
    if (StatsState.sort === 'date') return (b.date || '') > (a.date || '') ? 1 : -1;
    if (StatsState.sort === 'tokens') return (b.total_tokens || 0) - (a.total_tokens || 0);
    if (StatsState.sort === 'cost') return (b.cost || 0) - (a.cost || 0);
    return 0;
  });

  let html = '';
  sorted.forEach((c, i) => {
    const title = (c.title || '新对话').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const dateStr = (c.date || '').slice(0, 16).replace('T', ' ');

    let costStr = '';
    if (isLocal) costStr = '免费';
    else if (c.cost == null || c.cost === 0) costStr = '¥0';
    else if (c.cost < 0.01) costStr = '< ¥0.01';
    else costStr = '¥' + c.cost.toFixed(2);

    let srcHint = '';
    if (c.usage_source === 'estimated') {
      srcHint = ' <span class="usage-tag est" title="tiktoken 估算，非 API 实测">估</span>';
    } else if (c.usage_source === 'api') {
      srcHint = ' <span class="usage-tag api" title="DeepSeek API 返回的 usage，含系统提示与上下文">实测</span>';
    }

    html += `<tr onclick="loadConversation('${c.id}')">
      <td>${i + 1}</td>
      <td class="conv-title" title="${title}">${title}${srcHint}</td>
      <td>${dateStr}</td>
      <td class="num">${formatNumberFull(c.prompt_tokens)}</td>
      <td class="num">${formatNumberFull(c.completion_tokens)}</td>
      <td class="num">${c.cached_tokens ? formatNumberFull(c.cached_tokens) : '-'}</td>
      <td class="num"><strong>${formatNumberFull(c.total_tokens)}</strong></td>
      <td class="num">${costStr}</td>
      <td class="num">${c.message_count}</td>
    </tr>`;
  });

  if (tbody) tbody.innerHTML = html;
}

function sortStatsTable(by) {
  StatsState.sort = by;
  document.querySelectorAll('.stats-sort-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.sort === by);
  });
  if (StatsState.data) renderAllStats();
}

// ---- 扇形图 ----
const DONUT_COLORS = { prompt: '#7c4dff', completion: '#00c853', cached: '#00bcd4' };

function drawDonutChart(total) {
  const canvas = PAGES_DOM.donutChart();
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2;

  if (!canvas._sized) {
    canvas._sized = true;
    canvas.width = 280;
    canvas.height = 280;
  }

  const outerR = 110, innerR = 70;
  const segs = [];

  if (StatsState.legend.prompt && total.prompt_tokens > 0) {
    segs.push({ key: 'prompt', val: total.prompt_tokens, color: DONUT_COLORS.prompt, label: '输入令牌' });
  }
  if (StatsState.legend.completion && total.completion_tokens > 0) {
    segs.push({ key: 'completion', val: total.completion_tokens, color: DONUT_COLORS.completion, label: '输出令牌' });
  }
  if (StatsState.legend.cached && total.cached_tokens > 0) {
    segs.push({ key: 'cached', val: total.cached_tokens, color: DONUT_COLORS.cached, label: '缓存命中' });
  }

  const totalVal = segs.reduce((s, seg) => s + seg.val, 0);
  ctx.clearRect(0, 0, W, H);

  if (totalVal === 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.fillStyle = '#eee';
    ctx.fill();
    const totalEl = PAGES_DOM.donutTotal();
    if (totalEl) totalEl.textContent = '0';
    canvas._segData = [];
    return;
  }

  // 阴影
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.10)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 5;
  ctx.beginPath();
  ctx.arc(cx, cy + 2, outerR, 0, Math.PI * 2);
  ctx.arc(cx, cy + 2, innerR, 0, Math.PI * 2, true);
  ctx.closePath();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fill();
  ctx.restore();

  // 绘制扇区
  const segData = [];
  let startAngle = -Math.PI / 2;
  const expandAmt = StatsState.donutExpand || 0;

  segs.forEach((seg, i) => {
    const angle = (seg.val / totalVal) * Math.PI * 2;
    const isHover = i === StatsState.donutHover;
    const expand = isHover ? expandAmt : 0;
    const segOuter = outerR + expand;
    const segInner = innerR - expand * 0.6;

    ctx.beginPath();
    ctx.arc(cx, cy, segOuter, startAngle, startAngle + angle);
    ctx.arc(cx, cy, segInner, startAngle + angle, startAngle, true);
    ctx.closePath();
    ctx.fillStyle = seg.color;
    ctx.fill();

    let normStart = startAngle + Math.PI / 2;
    if (normStart < 0) normStart += Math.PI * 2;
    let normEnd = startAngle + angle + Math.PI / 2;
    if (normEnd < 0) normEnd += Math.PI * 2;

    segData.push({ start: normStart, end: normEnd, key: seg.key, label: seg.label, val: seg.val, color: seg.color });
    startAngle += angle;
  });

  canvas._segData = segData;
  canvas._totalVal = totalVal;
  canvas._cx = cx;
  canvas._cy = cy;
  canvas._outerR = outerR;
  canvas._innerR = innerR;

  // 更新中心数字
  const totalEl = PAGES_DOM.donutTotal();
  if (totalEl) totalEl.textContent = formatNumber(totalVal);

  // 更新图例
  const legendPrompt = document.getElementById('legendPrompt');
  const legendCompletion = document.getElementById('legendCompletion');
  const legendCached = document.getElementById('legendCached');
  if (legendPrompt) legendPrompt.textContent = formatNumberFull(total.prompt_tokens);
  if (legendCompletion) legendCompletion.textContent = formatNumberFull(total.completion_tokens);
  if (legendCached) legendCached.textContent = formatNumberFull(total.cached_tokens);
}

// ---- 图例切换 ----
function toggleLegend(key) {
  StatsState.legend[key] = !StatsState.legend[key];
  const item = document.querySelector(`.legend-item[data-key="${key}"]`);
  if (item) item.classList.toggle('hidden', !StatsState.legend[key]);
  if (StatsState.data) renderAllStats();
}

// ---- 图例点击事件 ----
document.addEventListener('click', e => {
  const item = e.target.closest('.legend-item');
  if (item) {
    const key = item.dataset.key;
    if (key) toggleLegend(key);
  }
});

// ================================================================
//  导出全局接口（保持兼容）
// ================================================================

// 知识库
window.loadKnowledgeBase = loadKnowledgeBase;
window.loadKbStats = loadKbStats;
window.loadKbDocs = loadKbDocs;
window.indexFromInput = indexFromInput;
window.cancelIndexing = cancelIndexing;
window.deleteDoc = deleteDoc;
window.toggleKbMultiSelect = toggleKbMultiSelect;
window.selectAllKbDocs = selectAllKbDocs;
window.getSelectedKbIds = getSelectedKbIds;
window.deleteSelectedKbDocs = deleteSelectedKbDocs;
window.clearAllKnowledge = clearAllKnowledge;
window.searchKnowledge = searchKnowledge;

// 文件浏览
window.loadDrives = loadDrives;
window.listFiles = listFiles;
window.goUpDir = goUpDir;
window.refreshFiles = refreshFiles;
window.triggerFbUpload = triggerFbUpload;
window.onFbUploadPick = onFbUploadPick;
window.fbCreateFolder = fbCreateFolder;
window.openLocalFile = openLocalFile;
window.quickIndex = quickIndex;

// 设置
window.loadThinkingSetting = loadThinkingSetting;
window.saveThinkingSetting = saveThinkingSetting;
window.updateThinkingToggleUI = updateThinkingToggleUI;
window.isShowThinking = isShowThinking;
window.applyIconTheme = applyIconTheme;
window.loadIconTheme = loadIconTheme;
window.toggleModelType = toggleModelType;
window.saveNanobuddyApiKey = saveNanobuddyApiKey;
window.loadSecurityStatus = loadSecurityStatus;
window.loadAuditLogs = loadAuditLogs;
window.loadModelSettings = loadModelSettings;
window.reloadMcpFilesystem = reloadMcpFilesystem;
window.loadMcpStatus = loadMcpStatus;
window.testModelConn = testModelConn;
window.saveSettings = saveSettings;
window.loadWorkConfig = loadWorkConfig;
window.saveWorkConfig = saveWorkConfig;
window.testWorkConn = testWorkConn;

// 数据库
window.switchDbTab = switchDbTab;
window.loadDbConfigs = loadDbConfigs;
window.showDbConfigForm = showDbConfigForm;
window.saveDbConfigFromForm = saveDbConfigFromForm;
window.deleteDbConfig = deleteDbConfig;
window.testDbConfig = testDbConfig;
window.scanDbConfig = scanDbConfig;
window.showTableMeta = showTableMeta;
window.toggleTableQa = toggleTableQa;
window.loadDbConfigSelect = loadDbConfigSelect;
window.executeSmartQuery = executeSmartQuery;
window.buildSqResultHtml = buildSqResultHtml;
window.showDialog = showDialog;
window.closeDialog = closeDialog;

// 统计
window.loadStats = loadStats;
window.loadToolPage = loadToolPage;
window.setStatsFilter = setStatsFilter;
window.sortStatsTable = sortStatsTable;
window.toggleLegend = toggleLegend;
window.formatNumber = formatNumber;
window.formatNumberFull = formatNumberFull;