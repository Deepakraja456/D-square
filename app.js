// ── PASTE YOUR KEYS HERE ─────────────────────────────────────────────────────
const SUPABASE_URL = 'https://sdpxkrdexpajipzawrdw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkcHhrcmRleHBhamlwemF3cmR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0OTcwMDEsImV4cCI6MjA4NzA3MzAwMX0.a33SKAum02CW3wZxHmgDrECH1a4vR2ouTl-1oiYRaF8';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── STATE ─────────────────────────────────────────────────────────────────────
let CU = null, HABITS = [], dark = false;
let pinBuf = '', pcBuf = '', pcStep = 'cur';
let loginEmail = '', loginProfile = null, loginAttempts = 0;
let noteTimer = null, hView = 'l', cfOpen = false, setPinFirst = '';

// ── HELPERS ───────────────────────────────────────────────────────────────────
const today = () => new Date().toISOString().slice(0, 10);
const $ = id => document.getElementById(id);
const show = el => (typeof el === 'string' ? $(el) : el).style.display = 'block';
const hide = el => (typeof el === 'string' ? $(el) : el).style.display = 'none';

async function H(v) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v + '__mydash__'));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch { return btoa(v + '__mydash__'); }
}

function showToast(msg, ok = true) {
  let t = $('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.style = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);padding:10px 20px;border-radius:12px;font-size:13px;font-weight:600;z-index:9999;transition:opacity .3s;max-width:300px;text-align:center';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.background = ok ? 'var(--accent)' : 'var(--danger)';
  t.style.color = '#fff';
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.style.opacity = '0', 3000);
}

// ── BOOT ──────────────────────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  // Check if user was previously logged in
  const saved = localStorage.getItem('cu');
  if (saved) {
    try {
      CU = JSON.parse(saved);
      // Verify still exists in DB
      const { data } = await sb.from('profiles').select('*').eq('id', CU.id).single();
      if (data && data.status !== 'blocked') {
        CU = data;
        hideLoader();
        launchApp();
        return;
      }
    } catch (e) {}
    localStorage.removeItem('cu');
  }
  hideLoader();
  showAuth();
  showStep('email');

  // Theme toggle
  $('tg').onclick = () => {
    dark = !dark;
    document.body.classList.toggle('dark', dark);
    $('tg').classList.toggle('on', dark);
    localStorage.setItem('dark', dark);
  };
  if (localStorage.getItem('dark') === 'true') $('tg').onclick();
});

function hideLoader() {
  $('loader').classList.add('hide');
  setTimeout(() => hide('loader'), 500);
}
function showAuth() { $('auth').style.display = 'flex'; }
function hideAuth() { $('auth').style.display = 'none'; }

// ── AUTH STEPS ────────────────────────────────────────────────────────────────
function showStep(s) {
  ['email','reg','setpin','pin','forgot','resetpin','locked','loading'].forEach(x => {
    const el = $('s-' + x);
    if (el) el.style.display = 'none';
  });
  const el = $('s-' + s);
  if (el) el.style.display = 'block';
}

function showLogin() { showStep('email'); }
function showReg()   { showStep('reg'); pinBuf = ''; setPinFirst = ''; }

// ── EMAIL STEP ────────────────────────────────────────────────────────────────
async function nextStep() {
  const email = $('ei').value.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    $('ee').textContent = 'Enter a valid email.';
    show('ee'); return;
  }
  hide('ee');
  loginEmail = email;
  showStep('loading');

  // Look up user by email in profiles
  const { data, error } = await sb.from('profiles').select('*').eq('email', email).single();

  if (!data || error) {
    showStep('email');
    $('ee').textContent = 'No account found. Please register.';
    show('ee');
    return;
  }

  if (data.status === 'blocked') {
    showStep('locked');
    return;
  }

  loginProfile = data;
  $('pname').textContent = data.name.split(' ')[0];
  if (data.sec_question) $('fsq').textContent = data.sec_question;

  pinBuf = '';
  renderDots('pd', 4, '');
  renderKeypad('pk', pressLoginPin);
  showStep('pin');
}

// ── REGISTER ──────────────────────────────────────────────────────────────────
async function doRegister() {
  const name  = $('rn').value.trim();
  const email = $('re').value.trim().toLowerCase();
  const sq    = $('rsq').value;
  const sa    = $('rsa').value.trim().toLowerCase();

  if (!name || !email || !sq || !sa) {
    $('re2').textContent = 'Please fill in all fields.';
    show('re2'); return;
  }
  hide('re2');

  // Check email not already used
  const { data: existing } = await sb.from('profiles').select('id').eq('email', email).single();
  if (existing) {
    $('re2').textContent = 'Email already registered. Please login.';
    show('re2'); return;
  }

  showStep('loading');

  const saHash = await H(sa);
  const uid = crypto.randomUUID();

  const { error } = await sb.from('profiles').insert({
    id: uid, name, email,
    role: 'user', status: 'active',
    sec_question: sq,
    sec_answer_hash: saHash,
    pin_hash: null,
  });

  if (error) {
    showStep('reg');
    $('re2').textContent = 'Registration failed: ' + error.message;
    show('re2'); return;
  }

  // Create empty notes record
  await sb.from('notes').insert({ user_id: uid, content: '' });

  CU = { id: uid, name, email, role: 'user', status: 'active' };
  loginEmail = email;

  // Now set PIN
  pinBuf = ''; setPinFirst = '';
  const p = $('s-setpin').querySelector('p');
  if (p) p.textContent = 'Choose a 4-digit PIN';
  renderDots('spd', 4, '');
  renderKeypad('spk', pressSetPin);
  showStep('setpin');
}

// ── SET PIN ───────────────────────────────────────────────────────────────────
async function pressSetPin(k) {
  if (k === '⌫') { pinBuf = pinBuf.slice(0, -1); renderDots('spd', 4, pinBuf); return; }
  if (pinBuf.length >= 4) return;
  pinBuf += k; renderDots('spd', 4, pinBuf);

  if (pinBuf.length === 4) {
    if (!setPinFirst) {
      setPinFirst = pinBuf; pinBuf = '';
      const p = $('s-setpin').querySelector('p');
      if (p) p.textContent = 'Confirm your PIN';
      renderDots('spd', 4, '');
    } else {
      if (pinBuf !== setPinFirst) {
        setPinFirst = ''; pinBuf = '';
        const p = $('s-setpin').querySelector('p');
        if (p) p.textContent = "PINs didn't match. Try again.";
        renderDots('spd', 4, '');
        return;
      }
      const hash = await H(pinBuf);
      await sb.from('profiles').update({ pin_hash: hash }).eq('id', CU.id);
      CU.pin_hash = hash;
      setPinFirst = ''; pinBuf = '';
      localStorage.setItem('cu', JSON.stringify(CU));
      hideAuth();
      launchApp();
    }
  }
}

// ── LOGIN PIN ─────────────────────────────────────────────────────────────────
async function pressLoginPin(k) {
  if (k === '⌫') { pinBuf = pinBuf.slice(0, -1); renderDots('pd', 4, pinBuf); return; }
  if (pinBuf.length >= 4) return;
  pinBuf += k; renderDots('pd', 4, pinBuf);

  if (pinBuf.length === 4) {
    const p = pinBuf; pinBuf = '';
    setTimeout(async () => {
      const h = await H(p);
      if (h === loginProfile.pin_hash) {
        loginAttempts = 0;
        CU = loginProfile;
        localStorage.setItem('cu', JSON.stringify(CU));
        hideAuth();
        launchApp();
      } else {
        loginAttempts++;
        renderDots('pd', 4, '');
        const dots = $('pd');
        dots.classList.add('shake');
        setTimeout(() => dots.classList.remove('shake'), 500);
        if (loginAttempts >= 5) {
          await sb.from('profiles').update({ status: 'blocked' }).eq('id', loginProfile.id);
          showStep('locked');
          return;
        }
        $('pe').textContent = `Wrong PIN — ${5 - loginAttempts} attempts left.`;
        $('pe').className = 'err';
        show('pe');
        setTimeout(() => hide('pe'), 2500);
        renderKeypad('pk', pressLoginPin);
      }
    }, 180);
  }
}

// ── FORGOT PIN ────────────────────────────────────────────────────────────────
function showForgot() {
  if (loginProfile?.sec_question) $('fsq').textContent = loginProfile.sec_question;
  showStep('forgot');
}

async function verifySecAnswer() {
  const ans = $('fsa').value.trim().toLowerCase();
  const h = await H(ans);
  if (h === loginProfile.sec_answer_hash) {
    hide('fe');
    pinBuf = '';
    renderDots('rpd', 4, '');
    renderKeypad('rpk', pressResetPin);
    showStep('resetpin');
  } else {
    $('fe').textContent = 'Incorrect answer.';
    show('fe');
  }
}

async function pressResetPin(k) {
  if (k === '⌫') { pinBuf = pinBuf.slice(0, -1); renderDots('rpd', 4, pinBuf); return; }
  if (pinBuf.length >= 4) return;
  pinBuf += k; renderDots('rpd', 4, pinBuf);
  if (pinBuf.length === 4) {
    const h = await H(pinBuf);
    await sb.from('profiles').update({ pin_hash: h }).eq('id', loginProfile.id);
    loginProfile.pin_hash = h;
    pinBuf = '';
    renderDots('pd', 4, '');
    renderKeypad('pk', pressLoginPin);
    showStep('pin');
    showToast('✓ PIN reset! Please log in.');
  }
}

// ── SIGN OUT ──────────────────────────────────────────────────────────────────
function signOut() {
  CU = null; loginProfile = null; loginAttempts = 0; pinBuf = '';
  localStorage.removeItem('cu');
  $('app').style.display = 'none';
  showAuth(); showStep('email');
  $('ei').value = '';
}

async function deleteAccount() {
  if (!confirm('Permanently delete your account and all data?')) return;
  await sb.from('notes').delete().eq('user_id', CU.id);
  await sb.from('habit_logs').delete().in('habit_id', HABITS.map(h => h.id));
  await sb.from('habits').delete().eq('user_id', CU.id);
  await sb.from('files').delete().eq('user_id', CU.id);
  await sb.from('profiles').delete().eq('id', CU.id);
  signOut();
}

// ── KEYPAD ────────────────────────────────────────────────────────────────────
function renderDots(id, max, buf) {
  const el = $(id); if (!el) return;
  el.innerHTML = '';
  for (let i = 0; i < max; i++) {
    const d = document.createElement('div');
    d.className = 'dot' + (i < buf.length ? ' on' : '');
    if (i === buf.length - 1) d.style.animation = 'pop .25s ease';
    el.appendChild(d);
  }
}

function renderKeypad(id, cb) {
  const el = $(id); if (!el) return;
  el.innerHTML = '';
  ['1','2','3','4','5','6','7','8','9','','0','⌫'].forEach(k => {
    const b = document.createElement('button');
    b.className = 'key' + (k === '' ? ' empty' : '') + (k === '⌫' ? ' del' : '');
    b.textContent = k;
    if (k) b.onclick = () => cb(k);
    el.appendChild(b);
  });
}

// ── APP LAUNCH ────────────────────────────────────────────────────────────────
function launchApp() {
  $('app').style.display = 'flex';
  buildNav();
  loadProfile();
  showPage('home');
}

// ── NAV ───────────────────────────────────────────────────────────────────────
const TABS = [
  { id:'home',     l:'Home',   s:'<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>' },
  { id:'notes',    l:'Notes',  s:'<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>' },
  { id:'habits',   l:'Habits', s:'<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>' },
  { id:'files',    l:'Files',  s:'<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' },
  { id:'settings', l:'More',   s:'<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>' },
];
const ADMIN_TAB = { id:'admin', l:'Admin', s:'<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>' };

function buildNav() {
  const nav = $('nav'); nav.innerHTML = '';
  const tabs = CU?.role === 'admin' ? [...TABS.slice(0,4), ADMIN_TAB, TABS[4]] : [...TABS];
  tabs.forEach(t => {
    const b = document.createElement('button');
    b.className = 'nb'; b.id = 'nb-' + t.id;
    b.innerHTML = t.s + `<span>${t.l}</span>`;
    b.onclick = () => showPage(t.id);
    nav.appendChild(b);
  });
}

function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nb').forEach(b => b.classList.remove('on'));
  const pg = $('pg-' + id); if (pg) pg.classList.add('active');
  const nb = $('nb-' + id); if (nb) nb.classList.add('on');
  if (id === 'home')     renderHome();
  if (id === 'notes')    loadNotes();
  if (id === 'habits')   loadHabits();
  if (id === 'files')    loadFiles();
  if (id === 'admin')    loadAdmin();
}

// ── HOME ──────────────────────────────────────────────────────────────────────
async function renderHome() {
  if (!CU) return;
  const h = new Date().getHours();
  $('gsub').textContent = (h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening') + ',';
  $('gname').textContent = CU.name.split(' ')[0] + ' 👋';
  $('hav').textContent = CU.name[0];
  $('hdate').textContent = new Date().toLocaleDateString('en', { weekday:'long', month:'long', day:'numeric' });
  await loadHabitsData();
  updateHomeRing();
  renderWeekStrip();
  renderQuickHabits();
}

async function loadHabitsData() {
  const { data: habits } = await sb.from('habits').select('id, title').eq('user_id', CU.id).order('created_at');
  const { data: logs } = await sb.from('habit_logs').select('habit_id, log_date, completed')
    .in('habit_id', (habits || []).map(h => h.id));
  HABITS = (habits || []).map(h => ({
    ...h,
    _logs: (logs || []).filter(l => l.habit_id === h.id)
      .reduce((a, l) => ({ ...a, [l.log_date]: l.completed }), {}),
  }));
}

function updateHomeRing() {
  const t = today();
  const done = HABITS.filter(h => h._logs?.[t]).length;
  const pct = HABITS.length ? Math.round((done / HABITS.length) * 100) : 0;
  $('hc').textContent = `${done} of ${HABITS.length} habits`;
  $('rp').textContent = pct + '%';
  $('rm').style.strokeDashoffset = 207 - (pct / 100) * 207;
}

function renderWeekStrip() {
  const ws = $('ws'); ws.innerHTML = '';
  const t = today();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5);
    const k = d.toISOString().slice(0, 10);
    const cnt = HABITS.filter(h => h._logs?.[k]).length;
    const iT = k === t, full = HABITS.length && cnt === HABITS.length;
    ws.innerHTML += `<div style="display:flex;flex-direction:column;align-items:center;gap:5px">
      <div style="font-size:10px;color:${iT?'var(--accent)':'var(--t3)'};font-weight:${iT?700:500}">${d.toLocaleDateString('en',{weekday:'short'}).slice(0,1)}</div>
      <div style="width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;
        background:${full?'linear-gradient(135deg,var(--accent),var(--accent2))':cnt>0?'rgba(var(--ar),0.2)':'transparent'};
        border:${iT?'2px solid var(--accent)':'2px solid var(--gb2)'};
        font-size:12px;font-weight:700;color:${full?'#fff':'var(--t2)'};">${cnt||''}</div>
    </div>`;
  }
}

function renderQuickHabits() {
  const el = $('qh'); el.innerHTML = '';
  const t = today();
  if (HABITS.length === 0) { el.innerHTML = '<p style="color:var(--t3);font-size:14px;text-align:center;padding:10px 0">No habits yet — add some in Habits tab!</p>'; return; }
  HABITS.forEach((h, i) => {
    const done = !!h._logs?.[t];
    el.innerHTML += `<div style="display:flex;align-items:center;gap:13px;padding:10px 0;${i < HABITS.length-1?'border-bottom:1px solid var(--gb2);':''}">
      <div onclick="quickToggle('${h.id}')" style="width:28px;height:28px;border-radius:50%;flex-shrink:0;
        border:2px solid ${done?'var(--accent)':'var(--gb)'};
        background:${done?'linear-gradient(135deg,var(--accent),var(--accent2))':'var(--glass2)'};
        cursor:pointer;display:flex;align-items:center;justify-content:center;
        box-shadow:${done?'0 3px 10px rgba(var(--ar),0.45)':'none'};transition:all .2s">
        ${done?'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>':''}
      </div>
      <span style="color:${done?'var(--t3)':'var(--text)'};font-size:15px;text-decoration:${done?'line-through':'none'};font-weight:${done?400:500}">${h.title}</span>
    </div>`;
  });
}

async function quickToggle(hid) {
  const t = today();
  const h = HABITS.find(x => x.id === hid);
  if (!h) return;
  if (!h._logs) h._logs = {};
  const wasDone = !!h._logs[t];
  h._logs[t] = !wasDone;
  if (!wasDone) {
    await sb.from('habit_logs').upsert({ habit_id: hid, log_date: t, completed: true });
  } else {
    await sb.from('habit_logs').delete().eq('habit_id', hid).eq('log_date', t);
  }
  updateHomeRing();
  renderWeekStrip();
  renderQuickHabits();
}

// ── NOTES ─────────────────────────────────────────────────────────────────────
async function loadNotes() {
  const { data } = await sb.from('notes').select('content').eq('user_id', CU.id).single();
  const content = data?.content || '';
  $('na').value = content;
  $('nmc').textContent = content.length + ' chars';
  $('nst').textContent = '● Saved';
  $('nst').style.color = 'var(--accent)';
}

async function noteChange(v) {
  $('nst').textContent = '● Saving…'; $('nst').style.color = 'var(--t3)';
  $('nmc').textContent = v.length + ' chars';
  clearTimeout(noteTimer);
  noteTimer = setTimeout(async () => {
    const { data } = await sb.from('notes').select('id').eq('user_id', CU.id).single();
    if (data) {
      await sb.from('notes').update({ content: v, updated_at: new Date().toISOString() }).eq('user_id', CU.id);
    } else {
      await sb.from('notes').insert({ user_id: CU.id, content: v });
    }
    $('nst').textContent = '● Saved';
    $('nst').style.color = 'var(--accent)';
  }, 900);
}

// ── HABITS ────────────────────────────────────────────────────────────────────
async function loadHabits() {
  const { data: habits } = await sb.from('habits').select('id, title').eq('user_id', CU.id).order('created_at');
  const { data: logs } = await sb.from('habit_logs').select('habit_id, log_date, completed')
    .in('habit_id', (habits || []).map(h => h.id));
  HABITS = (habits || []).map(h => ({
    ...h,
    _logs: (logs || []).filter(l => l.habit_id === h.id)
      .reduce((a, l) => ({ ...a, [l.log_date]: l.completed }), {}),
  }));
  rende
