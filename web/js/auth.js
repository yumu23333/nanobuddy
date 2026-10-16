// ============================================================
//  auth.js — 认证与管理员模块（优化版）
// ============================================================

// ---------- 工具函数 ----------

/** 格式化 API 错误详情 */
function formatApiDetail(data) {
  if (!data) return '请求失败';
  const detail = data.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map(item => {
      if (typeof item === 'string') return item;
      const loc = item.loc?.length ? item.loc.join('.') + ': ' : '';
      return loc + (item.msg || JSON.stringify(item));
    }).join('\n');
  }
  return String(detail || data.message || '请求失败');
}

/** 转义 HTML */
function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]);
}

/** 带认证的 fetch 封装（如果 nanobuddyFetch 已全局定义则直接使用） */
async function apiFetch(url, options = {}) {
  const token = getNanobuddyToken?.() || '';
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: 'Bearer ' + token }),
    ...options.headers,
  };
  const resp = await fetch(url, { ...options, headers });
  // 若返回 401，清除 token 并提示登录
  if (resp.status === 401) {
    setNanobuddyToken?.('');
    window.nanobuddyCurrentUser = null;
    showLoginOverlay?.('登录已过期，请重新登录');
  }
  return resp;
}

// ---------- 状态管理 ----------

const AuthStore = {
  user: null,
  ready: false,
  justLoggedIn: false,
};

/** 更新用户界面（侧栏、管理菜单等） */
function updateUserChrome() {
  const u = AuthStore.user;
  const bar = document.getElementById('userBar');
  const adminNav = document.getElementById('navAdmin');
  const settingsNav = document.querySelector('.nav-item[data-page="settings"]');
  const loginBtn = document.querySelector('.btn-login-sidebar');
  const logoutBtn = document.querySelector('.btn-logout');

  if (bar) {
    bar.style.display = u ? 'flex' : 'none';
    const nameEl = document.getElementById('userDisplayName');
    if (nameEl) nameEl.textContent = u ? (u.display_name || u.username) : '';
    const roleEl = document.getElementById('userRoleBadge');
    if (roleEl) {
      const roleLabel = { admin: '管理员', readonly: '只读' }[u?.role] || '成员';
      roleEl.textContent = roleLabel;
      roleEl.className = 'user-role-badge role-' + (u ? u.role : 'member');
    }
  }
  if (loginBtn) loginBtn.style.display = u?.role === 'readonly' && u?.id === 'guest' ? '' : 'none';
  if (logoutBtn) logoutBtn.style.display = u?.role === 'readonly' && u?.id === 'guest' ? 'none' : '';
  if (adminNav) adminNav.style.display = u?.role === 'admin' ? '' : 'none';
  if (settingsNav) settingsNav.style.display = ['admin', 'member'].includes(u?.role) ? '' : 'none';
}

// ---------- 登录 / 登出 ----------

/** 显示登录遮罩 */
function showLoginOverlay(msg) {
  const el = document.getElementById('loginOverlay');
  if (!el) return;
  el.classList.add('open');
  document.body.classList.add('login-lock');
  const err = document.getElementById('loginError');
  if (err) err.textContent = msg || '';
}

/** 隐藏登录遮罩 */
function hideLoginOverlay() {
  const el = document.getElementById('loginOverlay');
  if (el) el.classList.remove('open');
  document.body.classList.remove('login-lock');
  const err = document.getElementById('loginError');
  if (err) err.textContent = '';
}

/** 登出 */
function logoutNanobuddy() {
  setNanobuddyToken?.('');
  AuthStore.user = { id: 'guest', username: 'guest', role: 'readonly', display_name: '访客' };
  AuthStore.ready = true;
  window.nanobuddyAuthReady = true;
  window.nanobuddyCurrentUser = AuthStore.user;
  updateUserChrome();
}

/** 清除本地认证缓存 */
function clearNanobuddyLocalAuth() {
  setNanobuddyToken?.('');
  setNanobuddyApiKey?.('');
  AuthStore.user = null;
  AuthStore.ready = false;
  const err = document.getElementById('loginError');
  if (err) err.textContent = '';
  const msg = '已清除本地登录信息，请重新登录';
  if (typeof toast === 'function') toast(msg, 'success');
  else alert(msg);
}

/** 初始化认证（页面加载时调用） */
async function initAuth() {
  try {
    const res = await fetch('/api/security/status');
    const data = await res.json();
    if (!data.auth_enabled) {
      AuthStore.ready = true;
      window.nanobuddyAuthReady = true;
      window.nanobuddyCurrentUser = null;
      hideLoginOverlay();
      return;
    }
    const token = getNanobuddyToken?.();
    if (token) {
      const meRes = await fetch('/api/auth/me', {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (meRes.ok) {
        const me = await meRes.json();
        AuthStore.user = me.user;
        AuthStore.ready = true;
        window.nanobuddyAuthReady = true;
        window.nanobuddyCurrentUser = me.user;
        hideLoginOverlay();
        updateUserChrome();
        if (typeof loadModelSettings === 'function') loadModelSettings();
        return;
      }
      setNanobuddyToken?.('');
    }
    AuthStore.user = { id: 'guest', username: 'guest', role: 'readonly', display_name: '访客' };
    AuthStore.ready = true;
    window.nanobuddyAuthReady = true;
    window.nanobuddyCurrentUser = AuthStore.user;
    updateUserChrome();
  } catch {
    showLoginOverlay('无法连接服务，请确认 Nanobuddy 已启动');
  }
}

/** 绑定登录表单 */
function bindLoginForm() {
  const form = document.getElementById('loginForm');
  if (!form || form._bound) return;
  form._bound = true;

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errEl = document.getElementById('loginError');

    if (!username || !password) {
      if (errEl) errEl.textContent = '请输入用户名和密码';
      return;
    }
    if (errEl) errEl.textContent = '';

    setNanobuddyToken?.('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (errEl) errEl.textContent = formatApiDetail(data) || `登录失败 (HTTP ${res.status})`;
        return;
      }
      if (!data.token) {
        if (errEl) errEl.textContent = '登录响应异常（无 token），请重启服务后重试';
        return;
      }
      setNanobuddyToken(data.token);
      AuthStore.user = data.user;
      AuthStore.ready = true;
      AuthStore.justLoggedIn = true;
      window.nanobuddyAuthReady = true;
      window.nanobuddyCurrentUser = data.user;
      setTimeout(() => { AuthStore.justLoggedIn = false; }, 3000);
      hideLoginOverlay();
      updateUserChrome();
      if (typeof loadModelSettings === 'function') loadModelSettings();
      if (typeof checkStatus === 'function') checkStatus();
    } catch {
      if (errEl) errEl.textContent = '网络错误';
    }
  });
}

/** 绑定注册表单 */
function bindRegisterForm() {
  const form = document.getElementById('registerForm');
  if (!form || form._bound) return;
  form._bound = true;

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const username = document.getElementById('registerUsername').value.trim();
    const password = document.getElementById('registerPassword').value;
    const confirm = document.getElementById('registerConfirmPassword').value;
    const errEl = document.getElementById('registerError');

    if (!username || !password || !confirm) {
      if (errEl) errEl.textContent = '请填写所有字段';
      return;
    }
    if (password !== confirm) {
      if (errEl) errEl.textContent = '两次输入的密码不一致';
      return;
    }
    if (username.length < 2) {
      if (errEl) errEl.textContent = '用户名至少 2 个字符';
      return;
    }
    if (password.length < 6) {
      if (errEl) errEl.textContent = '密码至少 6 位';
      return;
    }
    if (errEl) errEl.textContent = '';

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (errEl) errEl.textContent = formatApiDetail(data) || `注册失败 (HTTP ${res.status})`;
        return;
      }
      const msg = '注册成功，请登录';
      if (typeof toast === 'function') toast(msg, 'success');
      else alert(msg);
      hideRegisterForm();
      document.getElementById('registerUsername').value = '';
      document.getElementById('registerPassword').value = '';
      document.getElementById('registerConfirmPassword').value = '';
      document.getElementById('loginUsername').value = username;
    } catch {
      if (errEl) errEl.textContent = '网络错误';
    }
  });
}

function showRegisterForm() {
  const el = document.getElementById('registerOverlay');
  if (el) el.classList.add('open');
}

function hideRegisterForm() {
  const el = document.getElementById('registerOverlay');
  if (el) el.classList.remove('open');
  const err = document.getElementById('registerError');
  if (err) err.textContent = '';
}

// ---------- 管理员模块 ----------

const AdminStore = {
  usersCache: [],
  convCount: 0,
};

function adminRoleLabel(role) {
  return { admin: '管理员', member: '成员', readonly: '只读' }[role] || role;
}

function adminRoleIcon(role) {
  const icons = {
    admin: '<i class="icon-fa fa-solid fa-user-shield"></i>',
    readonly: '<i class="icon-fa fa-solid fa-eye"></i>',
  };
  return icons[role] || '<i class="icon-fa fa-solid fa-user"></i>';
}

/** 更新统计卡片 */
function updateAdminStats() {
  const users = AdminStore.usersCache || [];
  const elU = document.getElementById('adminStatUsers');
  const elA = document.getElementById('adminStatActive');
  const elC = document.getElementById('adminStatConvs');
  if (elU) elU.textContent = String(users.length);
  if (elA) elA.textContent = String(users.filter(u => u.is_active).length);
  if (elC) elC.textContent = String(AdminStore.convCount);
}

/** 渲染单个用户卡片 */
function renderAdminUserCard(u) {
  const active = u.is_active;
  const canDelete = u.id !== AuthStore.user?.id;
  return `
    <div class="admin-user-card">
      <div class="admin-user-card-main">
        <div class="admin-user-avatar">${adminRoleIcon(u.role)}</div>
        <div class="admin-user-info">
          <div class="admin-user-name">${escHtml(u.display_name || u.username)}</div>
          <div class="admin-user-sub">
            <span class="text-muted">@${escHtml(u.username)}</span>
            <span class="admin-role-badge role-${escHtml(u.role)}">${adminRoleLabel(u.role)}</span>
            <span><span class="admin-status-dot ${active ? 'on' : 'off'}"></span>${active ? '已启用' : '已禁用'}</span>
          </div>
        </div>
      </div>
      <div class="admin-user-actions">
        <select data-uid="${u.id}" class="admin-role-select" onchange="adminChangeRole(this)">
          ${['admin','member','readonly'].map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${adminRoleLabel(r)}</option>`).join('')}
        </select>
        <button class="btn btn-sm btn-outline" onclick="adminToggleActive('${u.id}', ${!active})">
          ${active ? '禁用' : '启用'}
        </button>
        <button class="btn btn-sm btn-outline" onclick="adminResetPassword('${u.id}')">重置密码</button>
        ${canDelete ? `<button class="btn btn-sm btn-danger" onclick="adminDeleteUser('${u.id}')">删除</button>` : ''}
      </div>
    </div>
  `;
}

/** 处理 API 错误信息 */
function adminApiError(res, data) {
  if (res.status === 401) return '未登录或登录已失效，请重新登录后再打开管理页';
  if (res.status === 403) return '需要管理员权限';
  return formatApiDetail(data) || `加载失败 (HTTP ${res.status})`;
}

/** 加载用户列表 */
async function loadAdminUsers() {
  const box = document.getElementById('adminUserList');
  if (!box) return;
  if (!getNanobuddyToken?.()) {
    box.innerHTML = '<div class="admin-empty">请先登录管理员账号</div>';
    return;
  }
  box.innerHTML = '<div class="loading"><div class="spinner"></div>加载中...</div>';

  try {
    const res = await apiFetch('/api/admin/users');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(adminApiError(res, data));

    const users = data.users || [];
    AdminStore.usersCache = users;
    updateAdminStats();

    const countEl = document.getElementById('adminUserCount');
    if (countEl) countEl.textContent = users.length ? `共 ${users.length} 人` : '';

    if (!users.length) {
      box.innerHTML = '<div class="admin-empty">暂无用户，请在上方创建</div>';
      return;
    }
    box.innerHTML = users.map(renderAdminUserCard).join('');
  } catch (err) {
    box.innerHTML = `<div class="admin-empty">${escHtml(err.message || '加载失败')}</div>`;
  }
}

/** 变更用户角色 */
async function adminChangeRole(sel) {
  const uid = sel.getAttribute('data-uid');
  await apiFetch(`/api/admin/users/${uid}`, {
    method: 'PATCH',
    body: JSON.stringify({ role: sel.value }),
  });
  loadAdminUsers();
}

/** 启用/禁用用户 */
async function adminToggleActive(uid, active) {
  await apiFetch(`/api/admin/users/${uid}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_active: active }),
  });
  loadAdminUsers();
}

/** 删除用户 */
async function adminDeleteUser(uid) {
  const u = AdminStore.usersCache.find(x => x.id === uid);
  const name = u ? (u.display_name || u.username) : uid;
  if (!confirm(`确定删除用户「${name}」？其对话记录也会一并删除。`)) return;

  const res = await apiFetch(`/api/admin/users/${uid}`, { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    alert(formatApiDetail(data) || '删除失败');
    return;
  }
  if (typeof toast === 'function') toast(data.message || '已删除', 'success');
  loadAdminUsers();
  loadAdminConversations();
}

/** 重置用户密码 */
async function adminResetPassword(uid) {
  const pw = prompt('输入新密码（至少 6 位）');
  if (!pw || pw.length < 6) return;
  await apiFetch(`/api/admin/users/${uid}`, {
    method: 'PATCH',
    body: JSON.stringify({ password: pw }),
  });
  alert('密码已更新');
}

/** 创建用户（管理员） */
async function adminCreateUser() {
  const username = document.getElementById('adminNewUsername').value.trim();
  const password = document.getElementById('adminNewPassword').value;
  const role = document.getElementById('adminNewRole').value;
  const displayName = document.getElementById('adminNewDisplay').value.trim();

  if (!username || !password) {
    alert('请填写用户名和密码');
    return;
  }
  if (username.length < 2) {
    alert('用户名至少 2 个字符');
    return;
  }
  if (password.length < 6) {
    alert('密码至少 6 位（后端校验要求）');
    return;
  }

  try {
    const res = await apiFetch('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({ username, password, role, display_name: displayName || username }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 403) {
        alert('需要管理员账号登录后才能创建用户（侧栏应有「管理」菜单）');
        return;
      }
      alert(formatApiDetail(data) || `创建失败 (HTTP ${res.status})`);
      return;
    }
    // 清空表单
    ['adminNewUsername', 'adminNewPassword', 'adminNewDisplay'].forEach(id => {
      document.getElementById(id).value = '';
    });
    const msg = `用户「${username}」已创建`;
    if (typeof toast === 'function') toast(msg, 'success');
    else alert(msg);
    loadAdminUsers();
  } catch (err) {
    alert(`创建失败：${err.message || '网络错误'}`);
  }
}

/** 加载对话列表（管理页） */
async function loadAdminConversations() {
  const box = document.getElementById('adminConvList');
  if (!box) return;
  if (!getNanobuddyToken?.()) {
    box.innerHTML = '<div class="admin-empty">请先登录</div>';
    return;
  }
  box.innerHTML = '<div class="loading"><div class="spinner"></div>加载中...</div>';

  const filter = document.getElementById('adminConvUserFilter');
  const q = filter?.value ? `?user_id=${encodeURIComponent(filter.value)}` : '';

  try {
    const res = await apiFetch(`/api/admin/conversations${q}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(adminApiError(res, data));

    const convs = data.conversations || [];
    if (!filter?.value) {
      AdminStore.convCount = convs.length;
      updateAdminStats();
    }

    if (!convs.length) {
      box.innerHTML = '<div class="admin-empty">暂无对话记录</div>';
      return;
    }

    box.innerHTML = convs.map(c => {
      const owner = escHtml(c.owner_display_name || c.owner_username || '未知用户');
      const time = escHtml(c.updated_at || c.created_at || '');
      return `
        <div class="admin-conv-row" data-cid="${escHtml(c.id)}" onclick="adminOpenConv('${c.id}')">
          <div class="admin-conv-title">${escHtml(c.title || '新对话')}</div>
          <div class="admin-conv-meta">${owner} · ${c.message_count || 0} 条消息${time ? `<br>${time}` : ''}</div>
        </div>
      `;
    }).join('');
  } catch (err) {
    box.innerHTML = `<div class="admin-empty">${escHtml(err.message || '加载失败')}</div>`;
  }
}

/** 预览对话内容 */
async function adminOpenConv(convId) {
  const panel = document.getElementById('adminConvPreview');
  if (!panel) return;

  // 高亮选中行
  document.querySelectorAll('.admin-conv-row').forEach(el => {
    el.classList.toggle('active', el.getAttribute('data-cid') === convId);
  });

  panel.innerHTML = '<div class="admin-preview-scroll"><div class="loading"><div class="spinner"></div>加载中...</div></div>';

  try {
    const res = await apiFetch(`/api/admin/conversations/${convId}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || '加载失败');

    const msgs = (data.messages || []).slice(-30);
    if (!msgs.length) {
      panel.innerHTML = `
        <div class="admin-preview-head">${escHtml(data.title || convId)}</div>
        <div class="admin-preview-scroll"><div class="admin-empty">该对话暂无消息</div></div>
      `;
      return;
    }

    const msgHtml = msgs.map(m => {
      const role = m.role || 'assistant';
      const roleLabel = role === 'user' ? '用户' : role === 'assistant' ? '助手' : role;
      return `
        <div class="admin-preview-msg role-${escHtml(role)}">
          <div class="msg-role">${roleLabel}</div>
          <div class="msg-body">${escHtml(String(m.content || '').slice(0, 2000))}</div>
        </div>
      `;
    }).join('');

    panel.innerHTML = `
      <div class="admin-preview-head">${escHtml(data.title || convId)} <span class="text-muted">（最近 ${msgs.length} 条，可向下滚动）</span></div>
      <div class="admin-preview-scroll" id="adminPreviewScroll">${msgHtml}</div>
    `;

    const scrollEl = document.getElementById('adminPreviewScroll');
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  } catch (err) {
    panel.innerHTML = `<div class="admin-preview-scroll"><div class="admin-empty">${escHtml(err.message || '加载失败')}</div></div>`;
  }
}

/** 加载管理页面所有数据 */
function loadAdminPage() {
  loadAdminUsers();
  loadAdminConversations();

  // 填充用户筛选下拉
  apiFetch('/api/admin/users')
    .then(r => r.json().catch(() => ({})))
    .then(data => {
      const sel = document.getElementById('adminConvUserFilter');
      if (!sel) return;
      const users = data.users || [];
      const cur = sel.value;
      sel.innerHTML = `<option value="">全部用户</option>${users.map(u =>
        `<option value="${u.id}">${escHtml(u.display_name || u.username)}</option>`
      ).join('')}`;
      if (cur) sel.value = cur;
    })
    .catch(() => {});

  // 重置预览区
  const preview = document.getElementById('adminConvPreview');
  if (preview && !preview.querySelector('.admin-preview-msg') && !preview.querySelector('.admin-preview-head')) {
    preview.innerHTML = `
      <div class="admin-preview-scroll">
        <div class="admin-preview-empty">
          <div class="big-icon"><i class="icon-fa fa-solid fa-message"></i></div>
          <p>从左侧选择一条对话查看最近消息</p>
        </div>
      </div>
    `;
  }
}

// ---------- 暴露全局接口 ----------
// 保持与原有调用一致，挂载到 window 上
window.AuthStore = AuthStore;
window.logoutNanobuddy = logoutNanobuddy;
window.clearNanobuddyLocalAuth = clearNanobuddyLocalAuth;
window.initAuth = initAuth;
window.showLoginOverlay = showLoginOverlay;
window.hideLoginOverlay = hideLoginOverlay;
window.updateUserChrome = updateUserChrome;
window.showRegisterForm = showRegisterForm;
window.hideRegisterForm = hideRegisterForm;
window.adminCreateUser = adminCreateUser;
window.adminChangeRole = adminChangeRole;
window.adminToggleActive = adminToggleActive;
window.adminDeleteUser = adminDeleteUser;
window.adminResetPassword = adminResetPassword;
window.loadAdminUsers = loadAdminUsers;
window.loadAdminConversations = loadAdminConversations;
window.adminOpenConv = adminOpenConv;
window.loadAdminPage = loadAdminPage;

// 自动绑定表单
document.addEventListener('DOMContentLoaded', () => {
  bindLoginForm();
  bindRegisterForm();
});