let adminToken = null;
let currentIdeaStatus = 'toate';
let _timeRefreshInterval = null;

document.addEventListener('DOMContentLoaded', function () {
  const token = App.getToken();
  const user = App.getUser();
  if (token && user && user.role === 'camp_admin' && App.isLoggedIn()) {
    adminToken = token;
    showDashboard();
  }
});

function switchAdminTab(tab) {
  document.getElementById('admin-login-form').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('camp-create-form').style.display = tab === 'create' ? 'block' : 'none';
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-create').classList.toggle('active', tab === 'create');
  clearAdminError();
}

function showAdminError(message) {
  const error = document.getElementById('admin-error');
  error.innerHTML = `! ${App.escapeHtml(message)}`;
  error.style.display = 'flex';
}
function clearAdminError() {
  const error = document.getElementById('admin-error');
  error.innerHTML = '';
  error.style.display = 'none';
}

async function handleAdminLogin(event) {
  event.preventDefault();
  clearAdminError();
  const button = document.getElementById('admin-login-btn');
  const name = document.getElementById('admin-name-input').value.trim();
  const pin = document.getElementById('admin-pin-input').value;
  button.disabled = true;
  button.textContent = i18n.t('verifying');

  try {
    const data = await App.apiFetch('/api/auth/login', 'POST', { name, pin });
    if (data.user.role !== 'camp_admin') {
      App.clearToken();
      throw new Error(i18n.t('err_not_admin'));
    }
    App.setToken(data.token);
    App.setUser(data.user);
    adminToken = data.token;
    showDashboard();
  } catch (error) {
    showAdminError(error.message);
  } finally {
    button.disabled = false;
    button.textContent = i18n.t('btn_enter_dash');
  }
}

async function handleCampCreate(event) {
  event.preventDefault();
  clearAdminError();
  const button = document.getElementById('camp-create-btn');
  button.disabled = true;
  button.textContent = i18n.t('creating');

  const payload = {
    camp_name: document.getElementById('camp-name').value.trim(),
    camp_code: document.getElementById('camp-code').value.trim(),
    name: document.getElementById('admin-username').value.trim(),
    full_name: document.getElementById('admin-full-name').value.trim(),
    phone: document.getElementById('admin-phone').value.trim(),
    email: document.getElementById('admin-email').value.trim(),
    pin: document.getElementById('admin-create-pin').value,
  };

  try {
    const data = await App.apiFetch('/api/admin/register-camp', 'POST', payload);
    App.setToken(data.token);
    App.setUser(data.user);
    adminToken = data.token;
    App.showToast(i18n.t('toast_camp_created'), 'success');
    showDashboard();
  } catch (error) {
    showAdminError(error.message);
  } finally {
    button.disabled = false;
    button.textContent = i18n.t('btn_create_camp');
  }
}

function adminLogout() {
  clearInterval(_timeRefreshInterval);
  App.clearToken();
  adminToken = null;
  document.getElementById('admin-dashboard').style.display = 'none';
  document.getElementById('admin-login-screen').style.display = 'flex';
  i18n.apply();
}

async function showDashboard() {
  document.getElementById('admin-login-screen').style.display = 'none';
  document.getElementById('admin-dashboard').style.display = 'block';
  i18n.apply();
  const user = App.getUser();
  document.getElementById('admin-camp-subtitle').textContent = `${user.camp_name || 'Tabara'} · ${user.camp_code || ''}`;
  document.getElementById('admin-user-chip').innerHTML = `<div class="user-avatar">${App.escapeHtml((user.name || '?')[0].toUpperCase())}</div><span>${App.escapeHtml(user.name || '')}</span>`;
  await loadDashboard();
  clearInterval(_timeRefreshInterval);
  _timeRefreshInterval = setInterval(refreshTimestamps, 30000);
}

async function loadDashboard() {
  await Promise.all([loadStats(), loadUsers(), loadIdeas()]);
}

async function authedFetch(path, options) {
  options = options || {};
  options.headers = Object.assign({}, options.headers || {}, {
    Authorization: `Bearer ${adminToken}`,
    'Content-Type': 'application/json',
  });
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || i18n.t('err_server'));
  return data;
}

async function loadStats() {
  try {
    const stats = await authedFetch('/api/admin/stats');
    document.getElementById('stat-users').textContent = stats.total_users;
    document.getElementById('stat-leaders').textContent = stats.leaders;
    document.getElementById('stat-admins').textContent = stats.admins;
    document.getElementById('stat-ideas').textContent = stats.total_ideas;
    document.getElementById('stat-votes').textContent = stats.total_votes;
  } catch (error) {
    App.showToast(error.message, 'error');
  }
}

async function loadUsers() {
  try {
    const users = await authedFetch('/api/admin/users');
    renderUsers(users);
  } catch (error) {
    App.showToast(error.message, 'error');
  }
}

function renderUsers(users) {
  const tbody = document.getElementById('users-table-body');
  const currentUser = App.getUser();
  if (!users.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--text-muted)">${App.escapeHtml(i18n.t('no_accounts'))}</td></tr>`;
    return;
  }
  tbody.innerHTML = users.map((user) => {
    const contact = [user.full_name, user.email, user.phone].filter(Boolean).map(App.escapeHtml).join('<br>');
    const role = user.role === 'camp_admin' ? i18n.t('role_admin') : i18n.t('role_leader');
    const canDelete = user.id !== currentUser.id;
    return `
      <tr>
        <td><strong>${App.escapeHtml(user.name)}</strong><br><span style="color:var(--text-muted);font-size:.8rem">${App.escapeHtml(user.camp_code || '')}</span></td>
        <td>${App.escapeHtml(role)}</td>
        <td>${contact || '-'}</td>
        <td><span data-created-at="${App.escapeHtml(user.created_at)}">${App.formatDate(user.created_at)}</span></td>
        <td>
          ${canDelete
            ? `<button class="btn btn-danger btn-sm" onclick="deleteUser('${user.id}')">${App.escapeHtml(i18n.t('btn_delete'))}</button>`
            : `<span style="color:var(--text-muted);font-size:.82rem">${App.escapeHtml(i18n.t('current_account'))}</span>`}
        </td>
      </tr>`;
  }).join('');
}

function refreshTimestamps() {
  document.querySelectorAll('[data-created-at]').forEach(function (el) {
    el.textContent = App.formatDate(el.dataset.createdAt);
  });
}

async function deleteUser(userId) {
  if (!confirm(i18n.t('confirm_delete'))) return;
  try {
    await authedFetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
    App.showToast(i18n.t('toast_account_deleted'), 'success');
    await loadDashboard();
  } catch (error) {
    App.showToast(error.message, 'error');
  }
}

async function loadIdeas() {
  try {
    const params = new URLSearchParams();
    if (currentIdeaStatus !== 'toate') params.set('status', currentIdeaStatus);
    const ideas = await authedFetch('/api/admin/ideas?' + params.toString());
    renderIdeasTable(ideas);
  } catch (error) {
    App.showToast(error.message, 'error');
  }
}

function renderIdeasTable(ideas) {
  const tbody = document.getElementById('ideas-table-body');
  if (!ideas.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-muted)">${App.escapeHtml(i18n.t('no_ideas'))}</td></tr>`;
    return;
  }
  tbody.innerHTML = ideas.map((idea) => {
    const category = App.getCategoryInfo(idea.category);
    const status = idea.status === 'selected'
      ? i18n.t('badge_selected')
      : idea.status === 'rejected'
        ? i18n.t('badge_rejected')
        : i18n.t('badge_pending');
    const actions = [];
    if (idea.status !== 'selected') actions.push(`<button class="btn btn-success btn-sm" onclick="updateStatus('${idea.id}', 'selected')">${App.escapeHtml(i18n.t('btn_select'))}</button>`);
    if (idea.status !== 'rejected') actions.push(`<button class="btn btn-danger btn-sm" onclick="updateStatus('${idea.id}', 'rejected')">${App.escapeHtml(i18n.t('btn_reject'))}</button>`);
    if (idea.status !== 'pending') actions.push(`<button class="btn btn-ghost btn-sm" onclick="updateStatus('${idea.id}', 'pending')">${App.escapeHtml(i18n.t('btn_reset'))}</button>`);
    const description = idea.description.length > 70 ? idea.description.slice(0, 70) + '...' : idea.description;
    return `
      <tr>
        <td><strong>${App.escapeHtml(idea.title)}</strong><div class="idea-desc-preview">${App.escapeHtml(description)}</div></td>
        <td>${App.escapeHtml(idea.user_name)}</td>
        <td>${App.escapeHtml(category.label)}</td>
        <td><span class="vote-badge">${idea.vote_count}</span></td>
        <td>${App.escapeHtml(status)}</td>
        <td><div class="action-btns">${actions.join('')}</div></td>
      </tr>`;
  }).join('');
}

async function updateStatus(ideaId, status) {
  try {
    await authedFetch(`/api/admin/ideas/${ideaId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    App.showToast(i18n.t('toast_status_updated'), 'success');
    await loadDashboard();
  } catch (error) {
    App.showToast(error.message, 'error');
  }
}

function filterIdeas(status, button) {
  currentIdeaStatus = status;
  document.querySelectorAll('.filter-btn').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  loadIdeas();
}
