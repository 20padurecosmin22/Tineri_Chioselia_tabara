function getToken() { return sessionStorage.getItem('tabara_token'); }
function setToken(token) { sessionStorage.setItem('tabara_token', token); }
function clearToken() {
  sessionStorage.removeItem('tabara_token');
  sessionStorage.removeItem('tabara_user');
  localStorage.removeItem('tabara_token');
  localStorage.removeItem('tabara_user');
}
function getUser() {
  try {
    const raw = sessionStorage.getItem('tabara_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function setUser(user) { sessionStorage.setItem('tabara_user', JSON.stringify(user)); }
function parseJwt(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(atob(base64).split('').map((c) => '%' + (`00${c.charCodeAt(0).toString(16)}`).slice(-2)).join('')));
  } catch {
    return null;
  }
}
function isLoggedIn() {
  const token = getToken();
  if (!token) return false;
  const payload = parseJwt(token);
  if (!payload) return false;
  if (payload.exp && Date.now() / 1000 > payload.exp) {
    clearToken();
    return false;
  }
  return true;
}
function getCurrentUser() {
  if (!isLoggedIn()) return null;
  return getUser() || parseJwt(getToken());
}

async function apiFetch(path, method, body) {
  method = method || 'GET';
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const opts = { method, headers };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);

  try {
    const response = await fetch(path, opts);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || i18n.t('err_server'));
    return data;
  } catch (error) {
    if (error.message === 'Failed to fetch') throw new Error(i18n.t('err_no_connection'));
    throw error;
  }
}

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(message, type, duration) {
  type = type || 'success';
  duration = duration || 3500;
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const icons = { success: 'OK', error: '!', info: 'i', warning: '!' };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${icons[type] || ''}</span><span>${escapeHtml(message)}</span>`;
  toast.addEventListener('click', () => toast.remove());
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'slideInRight .3s ease reverse';
    setTimeout(() => toast.remove(), 280);
  }, duration);
}

function getCategoryInfo(category) {
  const map = {
    spiritual: { key: 'cat_spiritual_short', emoji: '🙏', badge: 'badge-spiritual' },
    jocuri:    { key: 'cat_jocuri_short',    emoji: '🎮', badge: 'badge-jocuri' },
    ateliere:  { key: 'cat_ateliere_short',  emoji: '🎨', badge: 'badge-ateliere' },
    sport:     { key: 'cat_sport_short',     emoji: '⚽', badge: 'badge-sport' },
    muzica:    { key: 'cat_muzica_short',    emoji: '🎵', badge: 'badge-muzica' },
    altele:    { key: 'cat_altele_short',    emoji: '✨', badge: 'badge-altele' },
  };
  const info = map[category];
  if (!info) return { label: category, emoji: '•', badge: 'badge-altele' };
  return { label: i18n.t(info.key), emoji: info.emoji, badge: info.badge };
}

function formatDate(value) {
  const date = new Date(value);
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);
  if (diff < 60) return i18n.t('date_just_now');
  if (diff < 3600) return i18n.t('date_min').replace('{n}', Math.floor(diff / 60));
  if (diff < 86400) return i18n.t('date_hours').replace('{n}', Math.floor(diff / 3600));
  if (diff < 172800) return i18n.t('date_yesterday');
  const locales = { ro: 'ro-RO', ru: 'ru-RU', en: 'en-GB' };
  return date.toLocaleDateString(locales[i18n.getLang()] || 'ro-RO', { day: 'numeric', month: 'short' });
}

function renderIdeas(ideas, containerId, votedIds) {
  const container = document.getElementById(containerId || 'ideas-grid');
  votedIds = votedIds || new Set();
  if (!container) return;
  if (!ideas || ideas.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <span class="empty-icon">⛺</span>
        <h3>${escapeHtml(i18n.t('empty_title'))}</h3>
        <p>${escapeHtml(i18n.t('empty_text'))}</p>
      </div>`;
    return;
  }

  container.innerHTML = ideas.map((idea, index) => {
    const category = getCategoryInfo(idea.category);
    const isVoted = votedIds.has(idea.id);
    const statusBadge = idea.status === 'selected'
      ? `<span class="badge badge-selected">${escapeHtml(i18n.t('badge_selected'))}</span>`
      : idea.status === 'rejected'
        ? `<span class="badge badge-rejected">${escapeHtml(i18n.t('badge_rejected'))}</span>`
        : '';

    return `
      <div class="idea-card" style="animation-delay:${index * 0.05}s" data-id="${idea.id}">
        <div class="card-header">
          <h3 class="card-title">${escapeHtml(idea.title)}</h3>
          <span class="badge ${category.badge}">${category.emoji} ${escapeHtml(category.label)}</span>
        </div>
        <div class="card-meta">
          <span>${escapeHtml(idea.user_name)}</span>
          <span>${formatDate(idea.created_at)}</span>
        </div>
        <p class="card-description">${escapeHtml(idea.description)}</p>
        ${idea.materials ? `<div class="card-materials"><strong>${escapeHtml(i18n.t('card_materials_label'))}</strong> ${escapeHtml(idea.materials)}</div>` : ''}
        ${(idea.duration || idea.max_participants) ? `
          <div class="card-info">
            ${idea.duration ? `<span class="card-info-item">${escapeHtml(idea.duration)}</span>` : ''}
            ${idea.max_participants ? `<span class="card-info-item">${escapeHtml(i18n.t('card_max'))} ${idea.max_participants} ${escapeHtml(i18n.t('card_persons'))}</span>` : ''}
          </div>` : ''}
        <div class="card-footer">
          <div class="card-status-badges">${statusBadge}</div>
          <button class="vote-btn${isVoted ? ' voted' : ''}" onclick="handleVote('${idea.id}', this)" data-voted="${isVoted}" data-id="${idea.id}">
            <span class="vote-icon">${isVoted ? '♥' : '♡'}</span>
            <span class="vote-count">${idea.vote_count}</span>
          </button>
        </div>
      </div>`;
  }).join('');
}

async function handleVote(ideaId, button) {
  if (!isLoggedIn()) {
    showLoginModal(i18n.t('err_auth_vote'));
    return;
  }
  const wasVoted = button.dataset.voted === 'true';
  const countEl = button.querySelector('.vote-count');
  const iconEl = button.querySelector('.vote-icon');
  const currentCount = parseInt(countEl.textContent, 10) || 0;
  button.dataset.voted = String(!wasVoted);
  button.classList.toggle('voted', !wasVoted);
  iconEl.textContent = wasVoted ? '♡' : '♥';
  countEl.textContent = wasVoted ? currentCount - 1 : currentCount + 1;
  button.disabled = true;

  try {
    const result = await apiFetch(`/api/ideas/${ideaId}/vote`, 'POST');
    const votedIds = getVotedIds();
    countEl.textContent = result.vote_count;
    button.dataset.voted = String(result.voted);
    button.classList.toggle('voted', result.voted);
    iconEl.textContent = result.voted ? '♥' : '♡';
    if (result.voted) votedIds.add(ideaId);
    else votedIds.delete(ideaId);
    saveVotedIds(votedIds);
    showToast(result.voted ? i18n.t('toast_vote_add') : i18n.t('toast_vote_remove'), result.voted ? 'success' : 'info');
  } catch (error) {
    button.dataset.voted = String(wasVoted);
    button.classList.toggle('voted', wasVoted);
    iconEl.textContent = wasVoted ? '♥' : '♡';
    countEl.textContent = currentCount;
    showToast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

async function handleLogin(name, pin, formEl, errorEl) {
  if (!name || !pin) {
    showFormError(errorEl, i18n.t('err_name_pin'));
    return false;
  }
  const submit = formEl ? formEl.querySelector('button[type="submit"]') : null;
  try {
    clearFormError(errorEl);
    if (submit) {
      submit.disabled = true;
      submit.textContent = i18n.t('authenticating');
    }
    const data = await apiFetch('/api/auth/login', 'POST', { name, pin });
    setToken(data.token);
    setUser(data.user);
    showToast(i18n.t('toast_welcome').replace('{name}', data.user.name), 'success');
    return data.user;
  } catch (error) {
    showFormError(errorEl, error.message);
    return false;
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = i18n.t('btn_enter');
    }
  }
}

async function handleRegister(name, pin, campCode, formEl, errorEl) {
  if (!name || !pin || !campCode) {
    showFormError(errorEl, i18n.t('err_name_pin_code'));
    return false;
  }
  if (!/^\d{4,}$/.test(pin)) {
    showFormError(errorEl, i18n.t('err_pin_digits'));
    return false;
  }
  const submit = formEl ? formEl.querySelector('button[type="submit"]') : null;
  try {
    clearFormError(errorEl);
    if (submit) {
      submit.disabled = true;
      submit.textContent = i18n.t('registering');
    }
    const data = await apiFetch('/api/auth/register', 'POST', { name, pin, camp_code: campCode });
    setToken(data.token);
    setUser(data.user);
    showToast(i18n.t('toast_welcome_camp').replace('{name}', data.user.camp_name || i18n.t('your_camp')), 'success');
    return data.user;
  } catch (error) {
    showFormError(errorEl, error.message);
    return false;
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = i18n.t('btn_create_profile');
    }
  }
}

async function handleSubmitIdea(formData, errorEl) {
  try {
    clearFormError(errorEl);
    return await apiFetch('/api/ideas', 'POST', formData);
  } catch (error) {
    showFormError(errorEl, error.message);
    return null;
  }
}

function showFormError(element, message) {
  if (!element) return;
  element.innerHTML = `! ${escapeHtml(message)}`;
  element.style.display = 'flex';
}
function clearFormError(element) {
  if (!element) return;
  element.innerHTML = '';
  element.style.display = 'none';
}

let loginSuccessHandler = null;
function showLoginModal(message, onSuccess) {
  loginSuccessHandler = onSuccess || null;
  let overlay = document.getElementById('global-login-modal');
  if (overlay) {
    overlay.style.display = 'flex';
    const msg = overlay.querySelector('.modal-message');
    if (msg) msg.textContent = message || i18n.t('modal_sub');
    return;
  }

  overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'global-login-modal';
  overlay.innerHTML = `
    <div class="modal">
      <button class="modal-close" onclick="App.closeLoginModal()">×</button>
      <div style="text-align:center;margin-bottom:.5rem"><img src="/media/logo_camp.png" alt="Camp Community" style="height:48px;object-fit:contain"></div>
      <h2 class="modal-title" style="text-align:center">${escapeHtml(i18n.t('modal_title'))}</h2>
      <p class="modal-message modal-subtitle" style="text-align:center">${escapeHtml(message || i18n.t('modal_sub'))}</p>
      <div class="modal-tabs">
        <button class="modal-tab active" onclick="App.switchAuthTab('login', this)">${escapeHtml(i18n.t('tab_enter'))}</button>
        <button class="modal-tab" onclick="App.switchAuthTab('register', this)">${escapeHtml(i18n.t('tab_profile'))}</button>
      </div>
      <div id="auth-error" class="alert alert-error" style="display:none"></div>
      <div id="login-form-wrap">
        <form id="login-form" onsubmit="App.submitLoginForm(event)">
          <div class="form-group">
            <label class="form-label" for="login-name">${escapeHtml(i18n.t('login_name_label'))}</label>
            <input type="text" class="form-input" id="login-name" placeholder="${escapeHtml(i18n.t('login_name_ph'))}" required>
          </div>
          <div class="form-group">
            <label class="form-label" for="login-pin">${escapeHtml(i18n.t('login_pin_label'))}</label>
            <input type="password" class="form-input" id="login-pin" placeholder="${escapeHtml(i18n.t('login_pin_ph'))}" required>
          </div>
          <div style="text-align:center;margin-top:.75rem">
            <button type="submit" class="btn btn-success btn-lg">${escapeHtml(i18n.t('btn_enter'))}</button>
          </div>
        </form>
      </div>
      <div id="register-form-wrap" style="display:none">
        <form id="register-form" onsubmit="App.submitRegisterForm(event)">
          <div class="form-group">
            <label class="form-label" for="reg-name">${escapeHtml(i18n.t('reg_name_label'))} <span class="required">*</span></label>
            <input type="text" class="form-input" id="reg-name" placeholder="${escapeHtml(i18n.t('reg_name_ph'))}" required>
          </div>
          <div class="form-group">
            <label class="form-label" for="reg-camp-code">${escapeHtml(i18n.t('reg_code_label'))} <span class="required">*</span></label>
            <input type="text" class="form-input" id="reg-camp-code" placeholder="${escapeHtml(i18n.t('reg_code_ph'))}" required>
          </div>
          <div class="form-group">
            <label class="form-label" for="reg-pin">${escapeHtml(i18n.t('reg_pin_label'))} <span class="required">*</span></label>
            <input type="password" inputmode="numeric" class="form-input" id="reg-pin" placeholder="${escapeHtml(i18n.t('reg_pin_ph'))}" minlength="4" required>
            <p class="form-hint">${escapeHtml(i18n.t('reg_pin_hint'))}</p>
          </div>
          <div style="text-align:center;margin-top:.75rem">
            <button type="submit" class="btn btn-success btn-lg">${escapeHtml(i18n.t('btn_create_profile'))}</button>
          </div>
        </form>
      </div>
    </div>`;
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeLoginModal();
  });
  document.body.appendChild(overlay);
}
function closeLoginModal() {
  const overlay = document.getElementById('global-login-modal');
  if (overlay) overlay.style.display = 'none';
}
function switchAuthTab(tab, button) {
  document.querySelectorAll('.modal-tab').forEach((item) => item.classList.remove('active'));
  if (button) button.classList.add('active');
  document.getElementById('login-form-wrap').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('register-form-wrap').style.display = tab === 'register' ? 'block' : 'none';
  clearFormError(document.getElementById('auth-error'));
}
async function submitLoginForm(event) {
  event.preventDefault();
  const name = document.getElementById('login-name').value.trim();
  const pin = document.getElementById('login-pin').value;
  const user = await handleLogin(name, pin, event.target, document.getElementById('auth-error'));
  if (user) {
    closeLoginModal();
    updateHeaderAuth();
    if (loginSuccessHandler) loginSuccessHandler(user);
  }
}
async function submitRegisterForm(event) {
  event.preventDefault();
  const name = document.getElementById('reg-name').value.trim();
  const campCode = document.getElementById('reg-camp-code').value.trim();
  const pin = document.getElementById('reg-pin').value;
  const user = await handleRegister(name, pin, campCode, event.target, document.getElementById('auth-error'));
  if (user) {
    closeLoginModal();
    updateHeaderAuth();
    if (loginSuccessHandler) loginSuccessHandler(user);
  }
}

function updateHeaderAuth() {
  const loginButton = document.getElementById('header-login-btn');
  const logoutButton = document.getElementById('header-logout-btn');
  const chip = document.getElementById('header-user-chip');
  const user = getCurrentUser();
  if (user) {
    if (loginButton) loginButton.style.display = 'none';
    if (logoutButton) logoutButton.style.display = 'inline-flex';
    if (chip) {
      chip.style.display = 'flex';
      const initial = user.name ? user.name[0].toUpperCase() : '?';
      chip.innerHTML = `<div class="user-avatar">${escapeHtml(initial)}</div><span>${escapeHtml(user.name)} · ${escapeHtml(user.camp_code || '')}</span>`;
    }
  } else {
    if (loginButton) loginButton.style.display = 'inline-flex';
    if (logoutButton) logoutButton.style.display = 'none';
    if (chip) chip.style.display = 'none';
  }
}
function handleLogout() {
  clearToken();
  updateHeaderAuth();
  showToast(i18n.t('toast_logged_out'), 'info');
  setTimeout(() => location.reload(), 500);
}

function votedStorageKey() {
  const user = getCurrentUser();
  return `tabara_voted_ids_${user && user.camp_code ? user.camp_code : 'global'}`;
}
function getVotedIds() {
  try {
    const raw = localStorage.getItem(votedStorageKey());
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}
function saveVotedIds(ids) {
  localStorage.setItem(votedStorageKey(), JSON.stringify([...ids]));
}

window.App = {
  getToken,
  setToken,
  clearToken,
  getUser,
  setUser,
  getCurrentUser,
  isLoggedIn,
  parseJwt,
  apiFetch,
  showToast,
  showLoginModal,
  closeLoginModal,
  switchAuthTab,
  submitLoginForm,
  submitRegisterForm,
  handleVote,
  handleLogin,
  handleRegister,
  handleSubmitIdea,
  renderIdeas,
  escapeHtml,
  formatDate,
  getCategoryInfo,
  updateHeaderAuth,
  handleLogout,
  getVotedIds,
  saveVotedIds,
  showFormError,
  clearFormError,
};
