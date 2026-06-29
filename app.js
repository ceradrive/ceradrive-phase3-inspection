/* CFC CashBook v0.9.3 - secure ledger create RPC */
const APP_VERSION = 'v0.9.3';
const APP_VERSION_LABEL = 'v0.9.3 Secure Ledger Create';
const CONFIG_KEY = 'cfc_cashbook_supabase_config_v07';
const ACTIVE_BUSINESS_KEY = 'cfc_cashbook_active_business_v07';
const OFFLINE_QUEUE_KEY = 'cfc_cashbook_offline_queue_v07';
const REMEMBER_LOGIN_KEY = 'cfc_cashbook_remember_login_v090';
const REMEMBER_EMAIL_KEY = 'cfc_cashbook_remember_email_v090';

const todayISO = () => new Date().toISOString().slice(0, 10);
const nowISO = () => new Date().toISOString();
const uid = (prefix = 'id') => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
const uuid = () => crypto?.randomUUID ? crypto.randomUUID() : uid('uuid');
const parseAmount = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const escapeHtml = (value = '') => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
const normalize = (value = '') => String(value).trim().toLowerCase().replace(/\s+/g, ' ');

let sb = null;
let session = null;
let user = null;
let config = loadConfig();
let state = {
  loading: true,
  screen: 'books',
  businesses: [],
  businessId: localStorage.getItem(ACTIVE_BUSINESS_KEY) || '',
  books: [],
  balances: {},
  businessMembers: [],
  bookMembers: [],
  profiles: {},
  entries: [],
  selectedBookId: '',
  dateFrom: '',
  dateTo: '',
  type: 'ALL',
  search: '',
  reportBookId: 'ALL',
  error: '',
  message: '',
  offlineQueue: loadQueue()
};

function builtInConfig() {
  const cfg = window.CFC_CASHBOOK_DEFAULT_CONFIG || {};
  return {
    supabaseUrl: String(cfg.supabaseUrl || '').trim().replace(/\/$/, ''),
    anonKey: String(cfg.anonKey || '').trim()
  };
}
function isUsableKey(key = '') {
  const value = String(key || '').trim();
  return Boolean(value && !value.includes('PASTE_') && !value.includes('YOUR_') && !value.includes('...'));
}
function loadConfig() {
  const fallback = builtInConfig();
  try {
    const stored = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
    return {
      supabaseUrl: String(stored.supabaseUrl || fallback.supabaseUrl || '').trim().replace(/\/$/, ''),
      anonKey: String(stored.anonKey || fallback.anonKey || '').trim()
    };
  } catch {
    return fallback;
  }
}

function saveConfig(next) {
  config = next;
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  initSupabase();
}
function loadQueue() {
  try { return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]'); } catch { return []; }
}
function saveQueue() { localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(state.offlineQueue)); }
function setMessage(message = '', error = '') { state.message = message; state.error = error; render(); }
function isConfigured() { return Boolean(config.supabaseUrl && isUsableKey(config.anonKey)); }
function shouldRememberLogin() {
  return localStorage.getItem(REMEMBER_LOGIN_KEY) !== 'false';
}
function savedLoginEmail() {
  return localStorage.getItem(REMEMBER_EMAIL_KEY) || '';
}
function clearStoredAuthSession() {
  try {
    Object.keys(localStorage).forEach(key => {
      if ((key.startsWith('sb-') && key.includes('-auth-token')) || key.includes('supabase.auth.token')) {
        localStorage.removeItem(key);
      }
    });
  } catch {}
}
function initSupabase() {
  if (!isConfigured() || !window.supabase) { sb = null; return; }
  const remember = shouldRememberLogin();
  sb = window.supabase.createClient(config.supabaseUrl, config.anonKey, {
    auth: { persistSession: remember, autoRefreshToken: remember, detectSessionInUrl: true }
  });
}

function bookMember(book) {
  return book?.cashbook_book_members?.[0] || null;
}
function canAddToBook(book) {
  if (!book) return false;
  const member = bookMember(book);
  if (!member) return isOwnerAdmin(); // Owner/Admin may not receive a joined row in some RLS shapes.
  return Boolean(member.can_add_entry || member.book_role === 'owner' || member.book_role === 'manager');
}
function canEditBook(book) {
  if (!book) return false;
  const member = bookMember(book);
  if (!member) return isOwnerAdmin();
  return Boolean(member.can_edit_entry || member.book_role === 'owner' || member.book_role === 'manager');
}
function canExportBook(book) {
  if (!book) return false;
  const member = bookMember(book);
  if (!member) return isOwnerAdmin();
  return Boolean(member.can_export || member.book_role === 'owner' || member.book_role === 'manager' || member.book_role === 'viewer');
}
function activeBusinessRole() {
  return state.businesses.find(b => b.id === state.businessId)?.role || '';
}
function isOwnerAdmin() {
  const role = activeBusinessRole();
  return role === 'owner' || role === 'admin';
}
function bookName(bookId) { return state.books.find(b => b.id === bookId)?.name || 'Hidden ledger'; }
function userName() { return user?.user_metadata?.display_name || user?.email || 'User'; }
function pendingCount() { return state.offlineQueue.length; }
function hasCloud() { return sb && session; }

async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js?v=0.9.3').catch(() => null);
  }
  initSupabase();
  if (!sb) { state.loading = false; render(); return; }
  const { data } = await sb.auth.getSession();
  session = data.session;
  user = session?.user || null;
  sb.auth.onAuthStateChange((_event, newSession) => {
    session = newSession;
    user = newSession?.user || null;
    if (user) loadCloudData(); else { state.loading = false; render(); }
  });
  if (user) await loadCloudData();
  else { state.loading = false; render(); }
}

async function loadCloudData() {
  if (!sb || !user) return;
  state.loading = true; state.error = '';
  render();
  try {
    const { data: memberships, error: bmError } = await sb
      .from('cashbook_business_members')
      .select('business_id,business_role,cashbook_businesses(id,name)')
      .eq('is_active', true);
    if (bmError) throw bmError;
    state.businesses = (memberships || []).map(row => ({
      id: row.business_id,
      role: row.business_role,
      name: row.cashbook_businesses?.name || 'Business'
    }));

    if (!state.businesses.length) {
      state.loading = false;
      state.screen = 'bootstrap';
      render();
      return;
    }

    if (!state.businessId || !state.businesses.some(b => b.id === state.businessId)) {
      state.businessId = state.businesses[0].id;
      localStorage.setItem(ACTIVE_BUSINESS_KEY, state.businessId);
    }

    const { data: books, error: booksError } = await sb
      .from('cashbook_books')
      .select('*, cashbook_book_members(book_role, can_add_entry, can_edit_entry, can_export, can_view_balance)')
      .eq('business_id', state.businessId)
      .eq('is_active', true)
      .order('created_at', { ascending: true });
    if (booksError) throw booksError;
    state.books = books || [];

    if (state.books.length) {
      const ids = state.books.map(b => b.id);
      const { data: balances, error: balError } = await sb
        .from('v_cashbook_book_balances')
        .select('*')
        .in('book_id', ids);
      if (balError) throw balError;
      state.balances = Object.fromEntries((balances || []).map(b => [b.book_id, b]));

      const { data: entries, error: entryError } = await sb
        .from('cashbook_entries')
        .select('*')
        .in('book_id', ids)
        .eq('is_void', false)
        .order('entry_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(500);
      if (entryError) throw entryError;
      state.entries = entries || [];
    } else {
      state.balances = {};
      state.entries = [];
    }
    await loadRoleUserData();
    if (!state.selectedBookId && state.books[0]) state.selectedBookId = state.books[0].id;
    state.loading = false;
    render();
    if (navigator.onLine && state.offlineQueue.length) syncQueue();
  } catch (err) {
    state.loading = false;
    state.error = err.message || String(err);
    render();
  }
}


async function loadRoleUserData() {
  state.businessMembers = [];
  state.bookMembers = [];
  state.profiles = {};
  if (!sb || !user || !state.businessId || !isOwnerAdmin()) return;
  try {
    let members = [];
    const joined = await sb
      .from('cashbook_business_members')
      .select('*, cashbook_profiles(*)')
      .eq('business_id', state.businessId)
      .eq('is_active', true)
      .order('created_at', { ascending: true });
    if (joined.error) {
      const plain = await sb
        .from('cashbook_business_members')
        .select('*')
        .eq('business_id', state.businessId)
        .eq('is_active', true)
        .order('created_at', { ascending: true });
      if (plain.error) throw plain.error;
      members = plain.data || [];
    } else {
      members = joined.data || [];
    }
    state.businessMembers = members;
    members.forEach(m => {
      if (m.cashbook_profiles) state.profiles[m.user_id] = m.cashbook_profiles;
    });
    const userIds = [...new Set(members.map(m => m.user_id).filter(Boolean))];
    const missingProfileIds = userIds.filter(id => !state.profiles[id]);
    if (missingProfileIds.length) {
      const { data: profiles, error: profileError } = await sb
        .from('cashbook_profiles')
        .select('*')
        .in('user_id', missingProfileIds);
      if (!profileError) (profiles || []).forEach(profile => { state.profiles[profile.user_id] = profile; });
    }
    if (state.books.length) {
      const { data: bookMembers, error: bookMemberError } = await sb
        .from('cashbook_book_members')
        .select('*')
        .in('book_id', state.books.map(b => b.id))
        .eq('is_active', true);
      if (!bookMemberError) state.bookMembers = bookMembers || [];
    }
  } catch (err) {
    console.warn('Role management data skipped:', err?.message || err);
  }
}

function render() {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = `${renderTopbar()}<main class="container">${renderMain()}</main>${renderBottomNav()}`;
  hydrateDatalists();
  bindEvents();
}
function renderTopbar() {
  const online = navigator.onLine;
  const cloud = hasCloud();
  return `<div class="topbar">
    <div class="brand"><div class="logo">CB</div><div><div class="brand-title">CFC CashBook <span class="version-pill light">${APP_VERSION}</span></div><div class="brand-subtitle">${escapeHtml(cloud ? userName() : 'Not signed in')} • ${cloud ? 'Cloud connected' : 'Setup / Sign In'} • Ledger entries + Contra</div></div></div>
    <div class="status-group"><div class="status-pill"><span class="dot ${online ? '' : 'offline'}"></span>${online ? 'Online' : 'Offline'} • ${pendingCount()} pending</div><div class="status-pill hide-mobile">${cloud ? 'Cloud connected' : 'Local setup'}</div></div>
  </div>`;
}
function renderBottomNav() {
  if (!hasCloud()) return '';
  if (state.screen === 'ledger') return ''; // ledger page uses Cash In / Cash Out bar at bottom
  return `<nav class="bottom-nav">
    <button class="nav-btn ${state.screen === 'books' ? 'active' : ''}" data-nav="books">Ledgers</button>
    <button class="nav-btn ${state.screen === 'reports' ? 'active' : ''}" data-nav="reports">Reports</button>
    <button class="nav-btn ${state.screen === 'settings' ? 'active' : ''}" data-nav="settings">Settings</button>
  </nav>`;
}
function renderMain() {
  if (state.loading) return `<div class="empty">Loading ${APP_VERSION_LABEL}...</div>`;
  if (!isConfigured()) return renderConfig();
  if (!session) return renderLogin();
  if (state.screen === 'bootstrap') return renderBootstrap();
  if (state.screen === 'ledger') return renderLedger();
  if (state.screen === 'reports') return renderReports();
  if (state.screen === 'settings') return renderSettings();
  return renderBooks();
}
function renderAlerts() {
  return `${state.error ? `<div class="error-box">${escapeHtml(state.error)}</div>` : ''}${state.message ? `<div class="success-box">${escapeHtml(state.message)}</div>` : ''}`;
}
function renderConfig() {
  return `<section class="hero-card login-card"><h1>Cloud Connection Settings <span class="version-pill">${APP_VERSION}</span></h1><p>Cloud connection can be provided through config.js or saved on this authorized device. Use only the cloud publishable key. Never enter service role keys, database passwords, JWT secrets, or secret keys.</p><div class="version-banner">${APP_VERSION_LABEL}</div></section>
  <section class="card login-card" style="margin-top:14px">${renderAlerts()}
    <form id="configForm" class="simple-entry-form">
      <label>Cloud Project URL<input name="supabaseUrl" required placeholder="https://xxxx.supabase.co" value="${escapeHtml(config.supabaseUrl || '')}" /></label>
      <label>Publishable key<input name="anonKey" required placeholder="sb_publishable_..." value="${escapeHtml(config.anonKey || '')}" /></label>
      <button class="btn primary full" type="submit">Save Cloud Connection</button>
    </form>
    <p class="muted">Permanent setup: add the Project URL and sb_publishable key in config.js. Device-only setup can be saved here.</p>
  </section>`;
}
function renderLogin() {
  const remember = shouldRememberLogin();
  const rememberedEmail = remember ? savedLoginEmail() : '';
  return `<section class="hero-card login-card"><h1>Login to CFC CashBook</h1><p>Cloud database is active. Entries will be available on authorized devices after sign-in.</p><div class="version-banner">Current app version: <strong>${APP_VERSION_LABEL}</strong></div></section>
  <section class="card login-card" style="margin-top:14px">${renderAlerts()}
    <form id="loginForm" class="simple-entry-form">
      <label>Email<input name="email" type="email" required placeholder="owner@example.com" value="${escapeHtml(rememberedEmail)}" /></label>
      <label>Password<input name="password" type="password" required placeholder="Minimum 6 characters" /></label>
      <label class="checkbox-line remember-line"><input name="remember_me" type="checkbox" ${remember ? 'checked' : ''} /> <span>Remember me on this device</span></label>
      <button class="btn primary full" type="submit" data-login-action="signin">Sign In</button>
      <button class="btn secondary full" type="button" data-signup>Sign Up / Create User</button>
    </form>
    <div class="notice" style="margin-top:12px">When Remember me is unchecked, the sign-in session is not saved for future app opens on this device.</div>
    <div class="notice" style="margin-top:12px">After the first Owner login, Initial Organization Setup creates CFC business ledgers such as Owner Cash, Factory Cash, Factory Expense, and Axis Bank.</div>
    <button class="mini-link" data-reset-config style="margin-top:12px">Change Cloud Connection Settings</button>
  </section>`;
}
function renderBootstrap() {
  return `<section class="hero-card login-card"><h1>Initial Organization Setup</h1><p>No CashBook organization is available for this account yet. Run the owner setup once to create the business and starter ledgers.</p><div class="version-banner">${APP_VERSION_LABEL}</div></section>
  <section class="card login-card" style="margin-top:14px">${renderAlerts()}
    <form id="bootstrapForm" class="simple-entry-form">
      <label>Business name<input name="businessName" required value="CFC" /></label>
      <label>Owner display name<input name="displayName" required value="Owner" /></label>
      <button class="btn primary full" type="submit">Create CFC CashBook Organization</button>
    </form>
    <div class="notice" style="margin-top:12px">This setup is intended for the first Owner account. Run it only once to avoid duplicate starter ledgers.</div>
  </section>`;
}
function renderBooks() {
  const books = state.books;
  const adminButtons = isOwnerAdmin() ? '<button class="btn secondary" data-open-ledger-admin>＋ Add Ledger</button>' : '';
  const adminSmallButtons = isOwnerAdmin() ? '<button class="btn primary small" data-open-ledger-admin>＋ Add Ledger</button>' : '';
  return `<section class="hero-card compact-hero"><h1>Daily cash control, mobile-first.</h1><p>Manage Cash In, Cash Out, Contra Entry, and ledger-wise permissions. Offline entries are saved locally and synced when online.</p><div class="version-banner">Current app version: <strong>${APP_VERSION_LABEL}</strong></div><div class="actions" style="margin-top:14px"><button class="btn primary" data-open-contra>Contra Entry</button>${adminButtons}<button class="btn secondary" data-refresh>Refresh</button></div></section>${renderAlerts()}
  <div class="section-title ledger-list-title"><div><h2>My Ledgers</h2><p>Business: ${escapeHtml(activeBusinessName())}</p></div><div class="actions title-actions">${adminSmallButtons}<button class="btn secondary small" data-refresh>Refresh</button></div></div>
  <div class="ledger-book-list">${books.length ? books.map(renderBookCard).join('') : '<div class="empty">No ledgers found. Check permissions or Initial Organization Setup.</div>'}</div>`;
}
function activeBusinessName() { return state.businesses.find(b => b.id === state.businessId)?.name || 'CFC'; }
function renderBookCard(book) {
  const bal = state.balances[book.id];
  const balance = Number(bal?.current_balance ?? book.opening_balance);
  const signClass = balance < 0 ? 'negative' : 'positive';
  return `<article class="ledger-book-row" data-open-book="${book.id}">
    <div class="ledger-icon book-icon">₹</div>
    <div class="ledger-book-main"><div class="ledger-book-title">${escapeHtml(book.name)}</div><div class="ledger-book-date">${escapeHtml(book.book_type)} • ${book.is_private ? 'Private' : 'Shared'} • ${bal?.entry_count ?? 0} entries</div></div>
    <div class="ledger-book-right"><div class="ledger-book-amount ${signClass}">${money(balance)}</div><div class="ledger-book-sub">${book.is_private ? 'Private' : 'Cloud'}</div></div>
  </article>`;
}
function renderLedger() {
  const book = state.books.find(b => b.id === state.selectedBookId);
  if (!book) return `<div class="empty">Ledger not found or no permission.</div>`;
  const entries = filteredEntries(book.id);
  const totalIn = entries.filter(e => e.entry_type === 'IN').reduce((s,e)=>s+Number(e.amount),0);
  const totalOut = entries.filter(e => e.entry_type === 'OUT').reduce((s,e)=>s+Number(e.amount),0);
  const bal = state.balances[book.id]?.current_balance ?? book.opening_balance;
  const runningMap = getRunningBalanceMap(book.id);
  const deleteButton = isOwnerAdmin() ? `<button class="icon-btn danger-small" data-delete-ledger="${book.id}">Deactivate</button>` : '';
  return `<div class="mobile-ledger-head compact-ledger-head"><button class="back-icon" data-back>‹</button><div class="ledger-title-block"><h2>${escapeHtml(book.name)} <span class="version-pill">${APP_VERSION}</span></h2><p>${entries.length} entries • Balance ${money(bal)}</p></div><button class="icon-btn" data-export-book="${book.id}">CSV</button>${deleteButton}</div>
  <section class="ledger-total-footer top-summary"><div><span>Total IN</span><strong>${money(totalIn)}</strong></div><div><span>Total OUT</span><strong>${money(totalOut)}</strong></div><div><span>Balance</span><strong class="${Number(bal)<0?'amount out':'amount in'}">${money(bal)}</strong></div></section>
  <details class="filter-details compact-filter-line"><summary>Filter: ${escapeHtml(dateRangeLabel(state.dateFrom, state.dateTo))} • ${escapeHtml(state.type)}</summary><div class="form-grid compact-filters"><label>From<input type="date" data-filter-from value="${escapeHtml(state.dateFrom)}" /></label><label>To<input type="date" data-filter-to value="${escapeHtml(state.dateTo)}" /></label><label>Type<select data-filter-type><option value="ALL" ${state.type==='ALL'?'selected':''}>All</option><option value="IN" ${state.type==='IN'?'selected':''}>Cash In</option><option value="OUT" ${state.type==='OUT'?'selected':''}>Cash Out</option><option value="CONTRA" ${state.type==='CONTRA'?'selected':''}>Contra</option></select></label><label>Search<input data-search-ledger placeholder="Search party, purpose, note..." value="${escapeHtml(state.search)}" /></label><div class="button-row span-2"><button class="btn secondary" data-clear-filters>Clear</button><button class="btn secondary" data-export-book="${book.id}">Export CSV</button></div></div></details>
  <div class="period-note">Use the checkbox only for reconciliation. Open details or edit through the right arrow. ${APP_VERSION} • ${navigator.onLine ? 'Online' : 'Offline'} • ${pendingCount()} pending sync</div>
  <div class="simple-ledger-list compact-ledger-list">${entries.length ? groupEntriesByDate(entries, runningMap) : '<div class="empty">No entries in this date/filter range.</div>'}</div>
  <section class="ledger-total-footer"><div><span>Total Cleared:</span><strong>${money(reconciledTotal(entries))}</strong></div><div><span>Total Outstanding:</span><strong>${money(totalIn - totalOut - reconciledNet(entries))}</strong></div><div><span>Balance:</span><strong class="${Number(bal)<0?'amount out':'amount in'}">${money(bal)}</strong></div></section>
  ${canAddToBook(book) ? `<div class="quick-entry-bar"><button class="cash-btn in" data-open-entry="${book.id}" data-entry-type="IN"><span>＋</span> Cash In</button><button class="cash-btn out" data-open-entry="${book.id}" data-entry-type="OUT"><span>−</span> Cash Out</button></div>` : ''}`;
}
function renderReports() {
  const books = state.reportBookId === 'ALL' ? state.books : state.books.filter(b => b.id === state.reportBookId);
  const options = ['<option value="ALL">All visible ledgers</option>'].concat(state.books.map(b => `<option value="${b.id}" ${state.reportBookId===b.id?'selected':''}>${escapeHtml(b.name)}</option>`)).join('');
  const rows = books.map(book => {
    const entries = filteredEntries(book.id);
    const totalIn = entries.filter(e=>e.entry_type==='IN').reduce((s,e)=>s+Number(e.amount),0);
    const totalOut = entries.filter(e=>e.entry_type==='OUT').reduce((s,e)=>s+Number(e.amount),0);
    const bal = state.balances[book.id] || {};
    return `<tr><td>${escapeHtml(book.name)}</td><td>${money(book.opening_balance)}</td><td>${money(totalIn)}</td><td>${money(totalOut)}</td><td><strong>${money(bal.current_balance ?? book.opening_balance)}</strong></td><td>${entries.length}</td></tr>`;
  }).join('');
  return `<div class="section-title"><div><h2>Reports</h2><p>Specific ledger + date range report.</p></div><button class="btn secondary" data-export-all>Export CSV</button></div><div class="card filter-card"><div class="form-grid"><label>Ledger<select data-report-book>${options}</select></label><label>Type<select data-filter-type><option value="ALL" ${state.type==='ALL'?'selected':''}>All</option><option value="IN" ${state.type==='IN'?'selected':''}>IN only</option><option value="OUT" ${state.type==='OUT'?'selected':''}>OUT only</option><option value="CONTRA" ${state.type==='CONTRA'?'selected':''}>Contra only</option></select></label><label>From date<input type="date" data-filter-from value="${escapeHtml(state.dateFrom)}" /></label><label>To date<input type="date" data-filter-to value="${escapeHtml(state.dateTo)}" /></label><div class="button-row span-2"><button class="btn secondary" data-clear-filters>Clear Filters</button></div></div></div><div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Ledger</th><th>Opening</th><th>Period IN</th><th>Period OUT</th><th>Current Closing</th><th>Entries</th></tr></thead><tbody>${rows || '<tr><td colspan="6">No ledgers.</td></tr>'}</tbody></table></div>`;
}
function renderOfflineStatusCard() {
  const online = navigator.onLine;
  const pending = pendingCount();
  return `<section class="card" style="margin-top:14px"><h3>Offline Save Status</h3><div class="kpi-row"><div class="kpi"><span>Device</span><strong>${online ? 'Online' : 'Offline'}</strong></div><div class="kpi"><span>Pending Sync</span><strong>${pending}</strong></div><div class="kpi"><span>Offline Entries</span><strong>${pending ? 'Saved Locally' : 'Ready'}</strong></div></div><div class="notice" style="margin-top:12px">Cash In, Cash Out, and Contra entries can be saved offline after the app has been opened once with internet and added to the iPhone Home Screen. Attachment upload requires internet and is not queued offline in this version.</div></section>`;
}
function renderSettings() {
  return `<div class="section-title"><div><h2>Settings</h2><p>${APP_VERSION_LABEL}</p></div></div><section class="card">${renderAlerts()}<div class="kpi-row"><div class="kpi"><span>Version</span><strong>${APP_VERSION}</strong></div><div class="kpi"><span>Cloud</span><strong>${hasCloud() ? 'Connected' : 'No'}</strong></div><div class="kpi"><span>Your Role</span><strong>${escapeHtml(roleLabel(activeBusinessRole()) || 'User')}</strong></div></div><div class="actions"><button class="btn primary" data-refresh>Refresh Cloud</button><button class="btn secondary" data-sync-queue>Sync Pending</button><button class="btn secondary" data-reload-latest>Reload Latest App</button><button class="btn secondary" data-signout>Sign Out</button><button class="btn danger" data-reset-config>Reset Cloud Connection</button></div><div class="notice" style="margin-top:12px">Only the publishable key is allowed in the frontend. Never enter a service role key, database password, JWT secret, or secret key.</div></section>${renderOfflineStatusCard()}${renderUserManagement()}`;
}
function renderUserManagement() {
  if (!isOwnerAdmin()) {
    return `<section class="card" style="margin-top:14px"><h3>User & Role Management</h3><p class="muted">Only Owner/Admin can manage organization users, roles, and ledger access.</p></section>`;
  }
  const rows = state.businessMembers.length
    ? state.businessMembers.map(renderUserRow).join('')
    : '<div class="empty">No organization users found. Refresh cloud data and check member permissions.</div>';
  return `<section class="card" style="margin-top:14px"><div class="section-title inline-title"><div><h2>User & Role Management</h2><p>Add existing signed-in users, set organization role, and assign ledger access.</p></div><button class="btn primary" data-open-user-admin>Add User / Update Role</button></div><div class="notice" style="margin-bottom:12px">A user must sign up once before Owner/Admin can assign a role. This app never uses service-role or secret keys in the browser.</div><div class="user-role-list">${rows}</div></section>`;
}
function renderUserRow(member) {
  const profile = memberProfile(member);
  const email = profileEmail(profile, member.user_id);
  const name = profileName(profile, email);
  const role = member.business_role || 'viewer';
  const access = ledgerAccessSummary(member.user_id, role);
  const accessButton = role === 'owner' || role === 'admin'
    ? '<span class="badge synced">All Ledgers</span>'
    : `<button class="btn secondary small" data-user-access="${escapeHtml(member.user_id)}">Ledger Access</button>`;
  return `<article class="user-role-row"><div><strong>${escapeHtml(name)}</strong><div class="muted small-text">${escapeHtml(email)}</div></div><div><span class="badge">${escapeHtml(roleLabel(role))}</span><div class="muted small-text">${escapeHtml(access)}</div></div><div>${accessButton}</div></article>`;
}
function memberProfile(member) {
  return member?.cashbook_profiles || state.profiles[member?.user_id] || {};
}
function profileEmail(profile = {}, fallback = '') {
  return profile.email || profile.user_email || profile.primary_email || fallback || 'Unknown user';
}
function profileName(profile = {}, fallback = '') {
  return profile.display_name || profile.full_name || profile.name || fallback || 'User';
}
function roleLabel(role = '') {
  const map = { owner: 'Owner', admin: 'Admin', accounts: 'Accounts', manager: 'Manager', staff: 'Staff', viewer: 'Viewer' };
  return map[String(role).toLowerCase()] || role;
}
function ledgerAccessSummary(userId, businessRole = '') {
  if (businessRole === 'owner' || businessRole === 'admin') return 'Full organization access';
  const rows = state.bookMembers.filter(row => row.user_id === userId && row.is_active !== false);
  if (!rows.length) return 'No ledgers assigned';
  const names = rows.map(row => bookName(row.book_id)).filter(Boolean);
  return names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3} more` : names.join(', ');
}
function defaultLedgerPermissions(role = 'viewer') {
  const value = String(role || 'viewer').toLowerCase();
  if (value === 'manager' || value === 'accounts') return { book_role: 'manager', can_add_entry: true, can_edit_entry: true, can_export: true, can_view_balance: true };
  if (value === 'staff') return { book_role: 'staff', can_add_entry: true, can_edit_entry: false, can_export: false, can_view_balance: true };
  return { book_role: 'viewer', can_add_entry: false, can_edit_entry: false, can_export: true, can_view_balance: true };
}

function filteredEntries(bookId) {
  const term = normalize(state.search);
  return state.entries.filter(e => e.book_id === bookId && !e.is_void)
    .filter(e => !state.dateFrom || e.entry_date >= state.dateFrom)
    .filter(e => !state.dateTo || e.entry_date <= state.dateTo)
    .filter(e => state.type === 'ALL' || (state.type === 'CONTRA' ? Boolean(e.contra_id) : e.entry_type === state.type))
    .filter(e => !term || [displayTitle(e), e.title, e.note, e.mode].join(' ').toLowerCase().includes(term))
    .sort((a,b) => b.entry_date.localeCompare(a.entry_date) || b.created_at.localeCompare(a.created_at));
}
function groupEntriesByDate(entries, runningMap = {}) {
  let last = '';
  return entries.map(entry => {
    const header = entry.entry_date !== last ? `<div class="date-separator">${formatLedgerDate(entry.entry_date)}</div>` : '';
    last = entry.entry_date;
    return header + renderEntryRow(entry, runningMap[entry.id]);
  }).join('');
}
function renderEntryRow(entry, runningBalance) {
  const direction = entry.entry_type === 'IN' ? 'in' : 'out';
  const amountLabel = entry.entry_type === 'OUT' ? '-' + money(entry.amount) : money(entry.amount);
  return `<article class="simple-entry-row compact-entry-row ${entry.is_reconciled ? 'reconciled' : ''}">
    <div class="reconcile-cell"><input type="checkbox" data-reconcile-entry="${entry.id}" ${entry.is_reconciled ? 'checked' : ''} title="Reconciled / checked" aria-label="Reconcile entry" /></div>
    <div class="entry-left"><div class="entry-title compact-title">${escapeHtml(displayTitle(entry))}</div><div class="entry-date-line">${escapeHtml(formatShortDate(entry.entry_date))}${entry.note ? ' • ' + escapeHtml(entry.note) : ''}</div>${entry.contra_id ? '<span class="badge tiny">Contra</span>' : ''}${entry.is_edited ? '<span class="badge tiny edited">Edited</span>' : ''}</div>
    <div class="entry-right compact-right"><div class="amount ${direction}">${amountLabel}</div><div class="entry-balance">${runningBalance == null ? '' : money(runningBalance)}</div></div>
    <button class="row-chevron" data-entry-details="${entry.id}" aria-label="Open entry details">›</button>
  </article>`;
}
function getRunningBalanceMap(bookId) {
  const book = state.books.find(b => b.id === bookId);
  let balance = Number(book?.opening_balance || 0);
  const rows = state.entries.filter(e => e.book_id === bookId && !e.is_void).slice().sort((a,b) => a.entry_date.localeCompare(b.entry_date) || a.created_at.localeCompare(b.created_at));
  const map = {};
  rows.forEach(e => { balance += e.entry_type === 'IN' ? Number(e.amount) : -Number(e.amount); map[e.id] = balance; });
  return map;
}
function reconciledNet(entries) { return entries.filter(e => e.is_reconciled).reduce((s,e)=>s+(e.entry_type === 'IN' ? Number(e.amount) : -Number(e.amount)),0); }
function reconciledTotal(entries) { return entries.filter(e => e.is_reconciled).reduce((s,e)=>s+Number(e.amount),0); }
function displayTitle(entry) {
  if (!entry.contra_id) return entry.title || '';
  if (entry.entry_type === 'IN') return `Contra received${entry.linked_book_id ? ' from ' + bookName(entry.linked_book_id) : ''}`;
  return `Contra paid${entry.linked_book_id ? ' to ' + bookName(entry.linked_book_id) : ''}`;
}
function formatLedgerDate(dateStr) { try { return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return dateStr; } }
function formatShortDate(dateStr) { try { return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: '2-digit' }); } catch { return dateStr; } }
function formatEntryTime(iso) { try { return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }); } catch { return ''; } }
function dateRangeLabel(from = '', to = '') { if (from && to) return `${from} to ${to}`; if (from) return `from ${from}`; if (to) return `till ${to}`; return 'all dates'; }
function resetFilters() { state.search=''; state.dateFrom=''; state.dateTo=''; state.type='ALL'; state.reportBookId='ALL'; }

function hydrateDatalists() {
  const titles = [...new Set(state.entries.map(e => e.title).filter(Boolean))].slice(0, 50);
  const notes = [...new Set(state.entries.map(e => e.note).filter(Boolean))].slice(0, 50);
  const titleList = document.getElementById('titleSuggestions');
  const noteList = document.getElementById('noteSuggestions');
  if (titleList) titleList.innerHTML = titles.map(v => `<option value="${escapeHtml(v)}"></option>`).join('');
  if (noteList) noteList.innerHTML = notes.map(v => `<option value="${escapeHtml(v)}"></option>`).join('');
}

function bindEvents() {
  document.querySelectorAll('[data-nav]').forEach(btn => btn.onclick = () => { state.screen = btn.dataset.nav; render(); });
  document.querySelector('[data-back]')?.addEventListener('click', () => { state.screen = 'books'; render(); });
  document.querySelectorAll('[data-refresh]').forEach(btn => btn.addEventListener('click', loadCloudData));
  document.querySelector('[data-reload-latest]')?.addEventListener('click', reloadLatestApp);
  document.querySelector('[data-sync-queue]')?.addEventListener('click', syncQueue);
  document.querySelector('[data-signout]')?.addEventListener('click', signOut);
  document.querySelector('[data-open-user-admin]')?.addEventListener('click', openUserAdminModal);
  document.querySelectorAll('[data-user-access]').forEach(btn => btn.onclick = (e) => { e.stopPropagation(); openLedgerAccessModal(btn.dataset.userAccess); });
  document.querySelectorAll('[data-reset-config]').forEach(btn => btn.onclick = resetConfig);
  document.querySelector('[data-open-contra]')?.addEventListener('click', openContraModal);
  document.querySelectorAll('[data-open-ledger-admin]').forEach(btn => btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openLedgerAdminModal(); }));
  document.querySelectorAll('[data-open-book]').forEach(card => card.onclick = () => { state.selectedBookId = card.dataset.openBook; state.screen='ledger'; resetFilters(); render(); });
  document.querySelectorAll('[data-open-entry]').forEach(btn => btn.onclick = (e) => { e.stopPropagation(); openEntryModal(btn.dataset.openEntry, btn.dataset.entryType); });
  document.querySelectorAll('[data-entry-details]').forEach(btn => btn.onclick = (e) => { e.stopPropagation(); openEntryDetails(btn.dataset.entryDetails); });
  document.querySelectorAll('[data-edit-entry]').forEach(btn => btn.onclick = (e) => { e.stopPropagation(); openEditModal(btn.dataset.editEntry); });
  document.querySelectorAll('[data-reconcile-entry]').forEach(box => { box.onclick = (e) => e.stopPropagation(); box.onchange = (e) => { e.stopPropagation(); toggleReconciled(box.dataset.reconcileEntry, box.checked); }; });
  document.querySelectorAll('[data-delete-ledger]').forEach(btn => btn.onclick = (e) => { e.stopPropagation(); deleteLedger(btn.dataset.deleteLedger); });
  document.querySelectorAll('[data-export-book]').forEach(btn => btn.onclick = (e) => { e.stopPropagation(); exportBookCsv(btn.dataset.exportBook); });
  document.querySelector('[data-export-all]')?.addEventListener('click', exportAllCsv);
  document.querySelector('[data-clear-filters]')?.addEventListener('click', () => { resetFilters(); render(); });
  document.querySelectorAll('[data-filter-from]').forEach(input => input.oninput = () => { state.dateFrom = input.value; render(); });
  document.querySelectorAll('[data-filter-to]').forEach(input => input.oninput = () => { state.dateTo = input.value; render(); });
  document.querySelectorAll('[data-filter-type]').forEach(select => select.onchange = () => { state.type = select.value; render(); });
  document.querySelector('[data-search-ledger]')?.addEventListener('input', e => { state.search = e.target.value; render(); });
  document.querySelector('[data-report-book]')?.addEventListener('change', e => { state.reportBookId = e.target.value; render(); });
  document.querySelector('#configForm')?.addEventListener('submit', saveConfigForm);
  document.querySelector('#loginForm')?.addEventListener('submit', signIn);
  document.querySelector('[data-signup]')?.addEventListener('click', signUp);
  document.querySelector('#bootstrapForm')?.addEventListener('submit', bootstrapOwner);
}
async function saveConfigForm(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  saveConfig({ supabaseUrl: String(fd.get('supabaseUrl')).trim().replace(/\/$/, ''), anonKey: String(fd.get('anonKey')).trim() });
  state.message = 'Cloud connection saved.'; state.error = ''; render();
}
async function signIn(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const email = String(fd.get('email') || '').trim();
  const password = String(fd.get('password') || '');
  const remember = fd.get('remember_me') === 'on';
  localStorage.setItem(REMEMBER_LOGIN_KEY, remember ? 'true' : 'false');
  if (remember) localStorage.setItem(REMEMBER_EMAIL_KEY, email);
  else { localStorage.removeItem(REMEMBER_EMAIL_KEY); clearStoredAuthSession(); }
  initSupabase();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return setMessage('', error.message);
  session = data.session; user = data.user; await loadCloudData();
}
async function signUp() {
  const form = document.getElementById('loginForm');
  const fd = new FormData(form);
  const email = String(fd.get('email') || '').trim();
  const password = String(fd.get('password') || '');
  const remember = fd.get('remember_me') === 'on';
  if (!email || !password) return setMessage('', 'Email and password are required.');
  localStorage.setItem(REMEMBER_LOGIN_KEY, remember ? 'true' : 'false');
  if (remember) localStorage.setItem(REMEMBER_EMAIL_KEY, email);
  else { localStorage.removeItem(REMEMBER_EMAIL_KEY); clearStoredAuthSession(); }
  initSupabase();
  const { data, error } = await sb.auth.signUp({ email, password, options: { data: { display_name: email } } });
  if (error) return setMessage('', error.message);
  state.message = data.session ? 'User created and logged in.' : 'User created. Sign in after email verification if confirmation is enabled.';
  state.error = '';
  render();
}
async function bootstrapOwner(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const { error } = await sb.rpc('cashbook_bootstrap_owner', { p_business_name: fd.get('businessName'), p_display_name: fd.get('displayName') });
  if (error) return setMessage('', error.message);
  state.screen = 'books';
  await loadCloudData();
}
async function signOut() { await sb.auth.signOut(); session=null; user=null; render(); }
function resetConfig() {
  if (!confirm('Reset cloud connection settings? The current user will also be signed out.')) return;
  try { sb?.auth?.signOut(); } catch {}
  localStorage.removeItem(CONFIG_KEY); localStorage.removeItem(ACTIVE_BUSINESS_KEY);
  config={}; sb=null; session=null; user=null; state.screen='books'; render();
}
async function reloadLatestApp() {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.() || [];
    await Promise.all(regs.map(r => r.update()));
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k.includes('cfc-cashbook') && !k.includes('v0.9.1')).map(k => caches.delete(k)));
    }
  } catch {}
  location.href = location.origin + location.pathname + '?v=0.9.1&t=' + Date.now();
}

function showModal(title, html) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal"><header><h3>${escapeHtml(title)}</h3><button class="close-x" data-close-modal>×</button></header>${html}</div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener('click', e => { if (e.target === wrap || e.target.matches('[data-close-modal]')) wrap.remove(); });
  return wrap;
}
function openEntryModal(bookId, entryType = 'OUT') {
  const book = state.books.find(b => b.id === bookId);
  if (!canAddToBook(book)) { alert('You do not have permission to add entries in this ledger.'); return; }
  const tmp = document.createElement('div'); tmp.appendChild(document.getElementById('entryFormTemplate').content.cloneNode(true));
  const modal = showModal(entryType === 'IN' ? 'Cash In' : 'Cash Out', tmp.innerHTML);
  const form = modal.querySelector('#entryForm');
  const attachmentInput = form.querySelector('input[name="attachment"]');
  if (!navigator.onLine && attachmentInput) {
    attachmentInput.disabled = true;
    attachmentInput.closest('label')?.insertAdjacentHTML('beforeend', '<div class="muted-label">Offline mode: save the entry now and upload attachment later when online.</div>');
  }
  form.entry_type.value = entryType;
  form.entry_date.value = todayISO();
  form.querySelector('button[type="submit"]').textContent = entryType === 'IN' ? 'Save Cash In' : 'Save Cash Out';
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = {
      business_id: state.businessId,
      book_id: bookId,
      local_id: uid('local'),
      idempotency_key: uid('entrykey'),
      entry_date: fd.get('entry_date') || todayISO(),
      entry_type: fd.get('entry_type'),
      amount: parseAmount(fd.get('amount')),
      title: String(fd.get('title') || '').trim(),
      note: String(fd.get('note') || '').trim(),
      mode: 'Cash',
      source: 'manual',
      sync_status: 'synced',
      created_by: user.id
    };
    if (!payload.amount || !payload.title) return alert('Amount and Party / Purpose are required.');
    const file = fd.get('attachment');
    if (!navigator.onLine) {
      if (file && file.name) return alert('Offline save supports entry data only. Please remove the attachment and upload it when the device is online.');
      state.offlineQueue.push({ action: 'insert_entry', payload, queued_at: nowISO() });
      saveQueue(); modal.remove(); state.message = 'Offline entry saved on this device. It will sync when the device is online.'; render(); return;
    }
    try { await insertEntry(payload, file); modal.remove(); await loadCloudData(); }
    catch (err) { alert(err.message || String(err)); }
  };
}
async function insertEntry(payload, file) {
  const { data, error } = await sb.from('cashbook_entries').insert(payload).select('*').single();
  if (error) throw error;
  await upsertSuggestion(payload.book_id, 'title', payload.title);
  if (payload.note) await upsertSuggestion(payload.book_id, 'note', payload.note);
  if (file && file.name) await uploadAttachment(data, file);
  return data;
}
async function uploadAttachment(entry, file) {
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${entry.business_id}/${entry.book_id}/${entry.id}/${Date.now()}_${safe}`;
  const { error: upError } = await sb.storage.from('cashbook-attachments').upload(path, file, { upsert: false });
  if (upError) throw upError;
  const { error: attError } = await sb.from('cashbook_entry_attachments').insert({ business_id: entry.business_id, entry_id: entry.id, file_name: file.name, file_type: file.type, file_size_bytes: file.size, storage_bucket: 'cashbook-attachments', storage_path: path, uploaded_by: user.id });
  if (attError) throw attError;
  await sb.from('cashbook_entries').update({ attachment_count: 1 }).eq('id', entry.id);
}
async function upsertSuggestion(bookId, type, value) {
  value = String(value || '').trim(); if (!value) return;
  const row = { business_id: state.businessId, book_id: bookId, suggestion_type: type, value, normalized_value: normalize(value), last_used_at: nowISO(), created_by: user.id };
  try {
    const { error } = await sb.from('cashbook_suggestion_master').upsert(row, {
      onConflict: 'business_id,book_id,suggestion_type,normalized_value',
      ignoreDuplicates: false
    });
    if (error) console.warn('Suggestion save skipped:', error.message);
  } catch (err) {
    console.warn('Suggestion save skipped:', err?.message || err);
  }
}

async function toggleReconciled(entryId, checked) {
  const entry = state.entries.find(e => e.id === entryId);
  if (!entry) return;
  try {
    const updates = { is_reconciled: checked, reconciled_by: checked ? user.id : null, reconciled_at: checked ? nowISO() : null, updated_by: user.id };
    const { error } = await sb.from('cashbook_entries').update(updates).eq('id', entryId);
    if (error) throw error;
    try {
      const { error: auditError } = await sb.from('cashbook_entry_audit_log').insert({ business_id: entry.business_id, book_id: entry.book_id, entry_id: entry.id, action: checked ? 'reconciled' : 'unreconciled', details: { checked }, performed_by: user.id });
      if (auditError) console.warn('Reconcile audit log skipped:', auditError.message);
    } catch (auditErr) {
      console.warn('Reconcile audit log skipped:', auditErr?.message || auditErr);
    }
    await loadCloudData();
  } catch (err) {
    alert(err.message || String(err));
    await loadCloudData();
  }
}


async function findProfileByEmail(email) {
  const clean = normalize(email);
  if (!clean) throw new Error('Email is required.');
  if (!state.businessId) throw new Error('Organization is not loaded yet. Refresh and try again.');

  const { data: rpcData, error: rpcError } = await sb.rpc('cashbook_find_profile_by_email', {
    p_business_id: state.businessId,
    p_email: clean
  });

  if (rpcError) {
    const msg = (rpcError.message || '').toLowerCase();
    if (msg.includes('function') && msg.includes('cashbook_find_profile_by_email')) {
      throw new Error('User lookup function is not ready. Run database migration 004_secure_profile_email_lookup.sql once in Supabase SQL Editor, then reload the app.');
    }
    throw rpcError;
  }

  const profile = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  if (!profile?.user_id) {
    throw new Error('User profile not found. Confirm the user has signed up, then run the profile email sync SQL if needed.');
  }
  return profile;
}
function openUserAdminModal() {
  if (!isOwnerAdmin()) { alert('Only Owner/Admin can manage users.'); return; }
  const modal = showModal('Add User / Update Role', `<form class="simple-entry-form" id="userRoleForm"><label>User email<input name="email" type="email" required placeholder="user@example.com" /></label><label>Organization role<select name="business_role" required><option value="admin">Admin</option><option value="accounts">Accounts</option><option value="manager">Manager</option><option value="staff">Staff</option><option value="viewer">Viewer</option></select></label><div class="notice">For security, the user must already have signed up once. Owner/Admin can then assign the organization role and ledger access.</div><div class="button-row"><button type="button" class="btn secondary" data-close-modal>Cancel</button><button type="submit" class="btn primary">Save User Role</button></div></form>`);
  const form = modal.querySelector('#userRoleForm');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    try {
      const profile = await findProfileByEmail(fd.get('email'));
      const role = String(fd.get('business_role') || 'viewer').toLowerCase();
      const existing = state.businessMembers.find(m => m.user_id === profile.user_id);
      if (existing) {
        const { error } = await sb
          .from('cashbook_business_members')
          .update({ business_role: role, is_active: true })
          .eq('business_id', state.businessId)
          .eq('user_id', profile.user_id);
        if (error) throw error;
      } else {
        const { error } = await sb.from('cashbook_business_members').insert({ business_id: state.businessId, user_id: profile.user_id, business_role: role, is_active: true, created_by: user.id });
        if (error) throw error;
      }
      modal.remove();
      await loadCloudData();
      if (role !== 'owner' && role !== 'admin') openLedgerAccessModal(profile.user_id);
    } catch (err) {
      const msg = err.message || String(err);
      if (msg.includes('cashbook_business_members_business_role_check')) {
        alert('Manager role is not enabled in the database yet. Run database migration 005_add_manager_business_role.sql once, then reload the app.');
      } else {
        alert(msg);
      }
    }
  };
}
function openLedgerAccessModal(targetUserId) {
  if (!isOwnerAdmin()) { alert('Only Owner/Admin can manage ledger access.'); return; }
  const member = state.businessMembers.find(m => m.user_id === targetUserId);
  if (!member) { alert('Organization user not found.'); return; }
  if (member.business_role === 'owner' || member.business_role === 'admin') { alert('Owner/Admin has full organization access. Ledger-specific assignment is not required.'); return; }
  const profile = memberProfile(member);
  const rows = state.books.map(book => {
    const bm = state.bookMembers.find(row => row.user_id === targetUserId && row.book_id === book.id && row.is_active !== false);
    const selected = Boolean(bm);
    const role = bm?.book_role || (member.business_role === 'manager' || member.business_role === 'accounts' ? 'manager' : member.business_role === 'staff' ? 'staff' : 'viewer');
    return `<div class="ledger-access-row"><label class="checkbox-line"><input type="checkbox" data-access-ledger="${book.id}" ${selected ? 'checked' : ''} />${escapeHtml(book.name)}</label><select data-access-role="${book.id}"><option value="manager" ${role==='manager'?'selected':''}>Manager</option><option value="staff" ${role==='staff'?'selected':''}>Staff</option><option value="viewer" ${role==='viewer'?'selected':''}>Viewer</option></select></div>`;
  }).join('');
  const modal = showModal('Ledger Access', `<div class="notice">User: <strong>${escapeHtml(profileEmail(profile, targetUserId))}</strong>. Select the ledgers this user can access.</div><form class="simple-entry-form" id="ledgerAccessForm"><div class="ledger-access-list">${rows || '<div class="empty">No ledgers available.</div>'}</div><div class="button-row"><button type="button" class="btn secondary" data-close-modal>Cancel</button><button type="submit" class="btn primary">Save Ledger Access</button></div></form>`);
  const form = modal.querySelector('#ledgerAccessForm');
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await saveLedgerAccess(targetUserId, modal);
      modal.remove();
      await loadCloudData();
    } catch (err) { alert(err.message || String(err)); }
  };
}
async function saveLedgerAccess(targetUserId, modal) {
  for (const book of state.books) {
    const checked = modal.querySelector(`[data-access-ledger="${book.id}"]`)?.checked;
    const role = modal.querySelector(`[data-access-role="${book.id}"]`)?.value || 'viewer';
    const existing = state.bookMembers.find(row => row.user_id === targetUserId && row.book_id === book.id);
    if (checked) {
      const perms = defaultLedgerPermissions(role);
      const payload = { ...perms, is_active: true };
      if (existing) {
        const { error } = await sb.from('cashbook_book_members').update(payload).eq('book_id', book.id).eq('user_id', targetUserId);
        if (error) throw error;
      } else {
        const { error } = await sb.from('cashbook_book_members').insert({ book_id: book.id, user_id: targetUserId, ...perms, is_active: true, created_by: user.id });
        if (error) throw error;
      }
    } else if (existing) {
      const { error } = await sb.from('cashbook_book_members').update({ is_active: false }).eq('book_id', book.id).eq('user_id', targetUserId);
      if (error) throw error;
    }
  }
}

function openLedgerAdminModal() {
  if (!isOwnerAdmin()) { alert('Only Owner/Admin can add ledgers.'); return; }
  const tmp = document.createElement('div'); tmp.appendChild(document.getElementById('ledgerFormTemplate').content.cloneNode(true));
  const modal = showModal('Add Ledger', tmp.innerHTML);
  const form = modal.querySelector('#ledgerForm');
  form.onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = {
      business_id: state.businessId,
      name: String(fd.get('name') || '').trim(),
      book_type: fd.get('book_type') || 'cash',
      opening_balance: parseAmount(fd.get('opening_balance')),
      is_private: fd.get('is_private') === 'on',
      created_by: user.id
    };
    if (!payload.name) return alert('Ledger name is required.');
    try {
      const { data: book, error } = await sb.rpc('cashbook_create_ledger', {
        p_business_id: payload.business_id,
        p_name: payload.name,
        p_book_type: payload.book_type,
        p_opening_balance: payload.opening_balance,
        p_is_private: payload.is_private
      });
      if (error) throw error;
      modal.remove(); await loadCloudData();
    } catch (err) { alert(err.message || String(err)); }
  };
}

async function deleteLedger(bookId) {
  if (!isOwnerAdmin()) { alert('Only Owner/Admin can deactivate ledgers.'); return; }
  const book = state.books.find(b => b.id === bookId);
  if (!book) return;
  const count = state.entries.filter(e => e.book_id === bookId && !e.is_void).length;
  const ok = confirm(`Deactivate ledger "${book.name}"?\n\nEntries: ${count}\n\nThis will not hard delete data. The ledger will be marked inactive and hidden from the app.`);
  if (!ok) return;
  try {
    const { error } = await sb.from('cashbook_books').update({ is_active: false, updated_at: nowISO() }).eq('id', bookId);
    if (error) throw error;
    state.screen = 'books'; state.selectedBookId = '';
    await loadCloudData();
  } catch (err) { alert(err.message || String(err)); }
}

function openContraModal() {
  const books = state.books.filter(canAddToBook);
  if (books.length < 2) { alert('Contra Entry requires at least two ledgers.'); return; }
  const tmp = document.createElement('div'); tmp.appendChild(document.getElementById('contraFormTemplate').content.cloneNode(true));
  const modal = showModal('Contra Entry', tmp.innerHTML);
  const form = modal.querySelector('#contraForm');
  const opts = books.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
  form.from_book_id.innerHTML = opts; form.to_book_id.innerHTML = opts; form.entry_date.value = todayISO();
  form.onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(form);
    const fromId = fd.get('from_book_id'); const toId = fd.get('to_book_id');
    if (fromId === toId) return alert('From and To ledgers cannot be the same.');
    const contraId = uuid();
    const date = fd.get('entry_date') || todayISO();
    const amount = parseAmount(fd.get('amount'));
    const note = String(fd.get('note') || '').trim();
    const fromName = bookName(fromId); const toName = bookName(toId);
    const outPayload = { business_id: state.businessId, book_id: fromId, local_id: uid('local'), idempotency_key: uid('contra'), entry_date: date, entry_type: 'OUT', amount, title: `Contra paid to ${toName}`, note, mode: 'Cash', category: 'Contra Entry', source: 'manual', sync_status: 'synced', contra_id: contraId, linked_book_id: toId, created_by: user.id };
    const inPayload = { business_id: state.businessId, book_id: toId, local_id: uid('local'), idempotency_key: uid('contra'), entry_date: date, entry_type: 'IN', amount, title: `Contra received from ${fromName}`, note, mode: 'Cash', category: 'Contra Entry', source: 'manual', sync_status: 'synced', contra_id: contraId, linked_book_id: fromId, created_by: user.id };
    if (!navigator.onLine) {
      state.offlineQueue.push({ action: 'contra', outPayload, inPayload, queued_at: nowISO() }); saveQueue(); modal.remove(); state.message='Offline contra saved. It will sync when the device is online.'; render(); return;
    }
    try { await insertContra(outPayload, inPayload); modal.remove(); await loadCloudData(); }
    catch (err) { alert(err.message || String(err)); }
  };
}
async function insertContra(outPayload, inPayload) {
  const { data: out, error: outError } = await sb.from('cashbook_entries').insert(outPayload).select('*').single();
  if (outError) throw outError;
  const { data: inn, error: inError } = await sb.from('cashbook_entries').insert(inPayload).select('*').single();
  if (inError) throw inError;
  await sb.from('cashbook_entries').update({ linked_entry_id: inn.id }).eq('id', out.id);
  await sb.from('cashbook_entries').update({ linked_entry_id: out.id }).eq('id', inn.id);
}
function openEditModal(entryId) {
  const entry = state.entries.find(e => e.id === entryId);
  if (!entry) return;
  const book = state.books.find(b => b.id === entry.book_id);
  if (!canEditBook(book)) { alert('You do not have permission to edit this entry.'); return; }
  const tmp = document.createElement('div'); tmp.appendChild(document.getElementById('editFormTemplate').content.cloneNode(true));
  const modal = showModal('Edit Entry', tmp.innerHTML);
  const form = modal.querySelector('#editForm');
  form.entry_type.value = entry.entry_type; form.amount.value = entry.amount; form.title.value = entry.title; form.note.value = entry.note || ''; form.entry_date.value = entry.entry_date;
  form.onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(form);
    const reason = String(fd.get('reason') || '').trim();
    const updates = { entry_type: fd.get('entry_type'), amount: parseAmount(fd.get('amount')), title: String(fd.get('title') || '').trim(), note: String(fd.get('note') || '').trim(), entry_date: fd.get('entry_date') || todayISO(), is_edited: true, updated_by: user.id };
    try {
      const fields = ['entry_type','amount','title','note','entry_date'];
      const historyRows = fields.filter(f => String(entry[f] ?? '') !== String(updates[f] ?? '')).map(f => ({ entry_id: entry.id, business_id: entry.business_id, book_id: entry.book_id, field_name: f, old_value: String(entry[f] ?? ''), new_value: String(updates[f] ?? ''), edit_reason: reason, edited_by: user.id }));
      if (historyRows.length) {
        const { error: histError } = await sb.from('cashbook_entry_edit_history').insert(historyRows);
        if (histError) throw histError;
      }
      const { error } = await sb.from('cashbook_entries').update(updates).eq('id', entry.id);
      if (error) throw error;
      modal.remove(); await loadCloudData();
    } catch (err) { alert(err.message || String(err)); }
  };
}
function openEntryDetails(entryId) {
  const entry = state.entries.find(e => e.id === entryId);
  if (!entry) return;
  const book = state.books.find(b => b.id === entry.book_id);
  const editButton = canEditBook(book) ? `<button class="btn primary full" style="margin-top:16px" data-edit-entry="${entry.id}">Edit Entry</button>` : '';
  showModal('Entry Details', `<div class="card"><div class="details-top"><span>${entry.contra_id ? 'Contra ' + entry.entry_type : (entry.entry_type === 'IN' ? 'Cash In' : 'Cash Out')} • ${APP_VERSION}</span><strong>${escapeHtml(formatLedgerDate(entry.entry_date))}, ${escapeHtml(formatEntryTime(entry.created_at))}</strong></div><div class="details-amount amount ${entry.entry_type==='IN'?'in':'out'}" style="font-size:32px;margin:12px 0">${money(entry.amount)}</div><h3>${escapeHtml(displayTitle(entry))}</h3>${entry.note ? `<p>${escapeHtml(entry.note)}</p>` : ''}<span class="cash-chip">${escapeHtml(entry.mode || 'Cash')}</span>${editButton}</div><div class="entry-meta" style="margin-top:12px">Cloud ID: ${escapeHtml(entry.id)}<br>Created: ${escapeHtml(entry.created_at)}<br>${entry.is_edited ? 'Edited: Yes' : 'Edited: No'}</div>`);
  document.querySelector('.modal [data-edit-entry]')?.addEventListener('click', () => { document.querySelector('.modal-backdrop')?.remove(); openEditModal(entry.id); });
}

async function syncQueue() {
  if (!sb || !session) return setMessage('', 'Login required for sync.');
  if (!navigator.onLine) return setMessage('', 'Internet connection unavailable. Sync will work when the device is online.');
  const remaining = [];
  for (const item of state.offlineQueue) {
    try {
      if (item.action === 'insert_entry') await insertEntry({ ...item.payload, sync_status: 'synced' });
      if (item.action === 'contra') await insertContra({ ...item.outPayload, sync_status: 'synced' }, { ...item.inPayload, sync_status: 'synced' });
    } catch (err) {
      item.last_error = err.message || String(err);
      remaining.push(item);
    }
  }
  state.offlineQueue = remaining; saveQueue();
  await loadCloudData();
  state.message = remaining.length ? `${remaining.length} pending item(s) could not sync. Try again when the connection is stable.` : 'All pending entries synced to cloud.';
  render();
}

function rowsToCsv(rows) { return rows.map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n'); }
function downloadFile(filename, content, type = 'text/csv') { const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); }
function exportBookCsv(bookId) {
  const book = state.books.find(b => b.id === bookId);
  const rows = [['Date','Type','Title','Note','IN Amount','OUT Amount','Mode','Contra','Reconciled','Edited','Created At','Cloud ID']];
  filteredEntries(bookId).forEach(e => rows.push([e.entry_date, e.contra_id ? `CONTRA-${e.entry_type}` : e.entry_type, displayTitle(e), e.note || '', e.entry_type==='IN'?e.amount:'', e.entry_type==='OUT'?e.amount:'', e.mode || 'Cash', e.contra_id ? 'Yes':'No', e.is_reconciled ? 'Yes':'No', e.is_edited ? 'Yes':'No', e.created_at, e.id]));
  downloadFile(`${(book?.name || 'ledger').replace(/\s+/g,'_')}_${state.dateFrom || 'start'}_${state.dateTo || 'today'}_${APP_VERSION}.csv`, rowsToCsv(rows));
}
function exportAllCsv() {
  const rows = [['Ledger','Date','Type','Title','Note','IN Amount','OUT Amount','Mode','Contra','Reconciled','Edited','Created At','Cloud ID']];
  const books = state.reportBookId === 'ALL' ? state.books : state.books.filter(b => b.id === state.reportBookId);
  books.forEach(book => filteredEntries(book.id).forEach(e => rows.push([book.name, e.entry_date, e.contra_id ? `CONTRA-${e.entry_type}` : e.entry_type, displayTitle(e), e.note || '', e.entry_type==='IN'?e.amount:'', e.entry_type==='OUT'?e.amount:'', e.mode || 'Cash', e.contra_id ? 'Yes':'No', e.is_reconciled ? 'Yes':'No', e.is_edited ? 'Yes':'No', e.created_at, e.id])));
  downloadFile(`CFC_CashBook_Report_${state.dateFrom || 'start'}_${state.dateTo || 'today'}_${APP_VERSION}.csv`, rowsToCsv(rows));
}

window.addEventListener('online', () => { render(); if (state.offlineQueue.length) syncQueue(); });
window.addEventListener('offline', render);
init();
