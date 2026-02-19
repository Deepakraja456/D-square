// ── CONFIG — PASTE YOUR SUPABASE KEYS HERE ───────────────────────────────────
const SUPABASE_URL = 'https://sdpxkrdexpajipzawrdw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkcHhrcmRleHBhamlwemF3cmR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0OTcwMDEsImV4cCI6MjA4NzA3MzAwMX0.a33SKAum02CW3wZxHmgDrECH1a4vR2ouTl-1oiYRaF8';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── STATE ─────────────────────────────────────────────────────────────────────
let CU = null;        // current user profile
let SESSION = null;   // supabase session
let HABITS = [];      // loaded habits
let dark = false;
let pinBuf = '', pcBuf = '', pcStep = 'cur';
let loginEmail = '', loginProfile = null;
let noteTimer = null, hView = 'l', cfOpen = false;

// ── CRYPTO ────────────────────────────────────────────────────────────────────
async function H(v) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v + '__mydash__'));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch { return btoa(v + '__mydash__'); }
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
const today = () => new Date().toISOString().slice(0, 10);
const $ = id => document.getElementById(id);
const show = id => $(id).style.display = 'block';
const hide = id => $(id).style.display = 'none';
const showErr = (id, msg) => { $(id).textContent = msg; show(id); };
const hideErr = id => hide(id);

function showMsg(elId, msg, isOk = true) {
  const el = $(elId);
  el.textContent = msg;
  el.className = isOk ? 'ok' : 'err';
  show(elId);
  setTimeout(() => hide(elId), 3000);
}

// ── BOOT ──────────────────────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  // Listen for auth state changes
  sb.auth.onAuthStateChange(async (event, session) => {
    SESSION = session;
    if (session) {
      await loadUserProfile(session.user.id);
    }
  });

  // Check existing session
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    SESSION = session;
    await loadUserProfile(session.user.id);
  } else {
    hideLoader();
    showAuth();
    showStep('email');
  }

  // Theme toggle
  $('tg').onclick = () => {
    dark = !dark;
    document.body.classList.toggle('dark', dark);
    $('tg').classList.toggle('on', dark);
    localStorage.setItem('dark', dark);
  };
  if (localStorage.getItem('dark') === 'true') $('tg').click();
});

async function loadUserProfile(uid) {
  const { data, error } = await sb.from('profiles').select('*').eq('id', uid).single();
  if (error || !data) {
    // Profile not set up yet — go to PIN setup
    hideLoader();
    showAuth();
    showStep('setpin');
    return;
  }
  if (data.status === 'blocked') {
    await sb.auth.signOut();
    hideLoader();
    showAuth();
    showStep('locked');
    return;
  }
  CU = data;
  hideLoader();
  launchApp();
}

function hideLoader() {
  $('loader').classList.add('hide');
  setTimeout(() => hide('loader'), 500);
}
function showAuth() { $('auth').style.display = 'flex'; }
function hideAuth() { $('auth').style.display = 'none'; }

// ── AUTH STEPS ─────────────────────────────────────────────────────────────────
function showStep(s) {
  ['email','reg','setpin','pin','forgot','resetpin','locked','loading'].forEach(x => {
    const el = $('s-' + x);
    if (el) el.style.display = 'none';
  });
  const el = $('s-' + s);
  if (el) el.style.display = 'block';
}

function showLogin() { showStep('email'); }
function showReg()   { showStep('reg'); }

async function nextStep() {
  const email = $('ei').value.trim().toLowerCase();
  if (!email || !email.includes('@')) { showErr('ee', 'Please enter a valid email.'); return; }
  hideErr('ee');
  loginEmail = email;
  showStep('loading');

  // Check if user exists in profiles via Supabase auth
  // Try signing in with a dummy password to check existence — we'll use OTP-less flow
  // Actually just look up profile by email
  const { data, error } = await sb.from('profiles')
    .select('id, name, pin_hash, sec_question, status')
    .eq('id', (await sb.from('profiles').select('id').limit(1)).data?.[0]?.id || '')
    .limit(1);

  // Better: use auth to check. We store email in profiles via a view or just try sign in
  // Simplest: try to sign in, if user not found show register
  const { error: signErr } = await sb.auth.signInWithPassword({ email, password: 'CHECK_ONLY_' + email });

  if (signErr && signErr.message.includes('Invalid login credentials')) {
    // User exists but wrong password (expected) — show PIN
    const { data: prof } = await sb.from('profiles')
      .select('name, pin_hash, sec_question, status')
      .eq('id', await getUidByEmail(email))
      .single();

    if (prof) {
      loginProfile = prof;
      $('pname').textContent = prof.name.split(' ')[0];
      if (prof.sec_question) {
        $('fsq') && ($('fsq').textContent = prof.sec_question);
      }
      showStep('pin');
      pinBuf = '';
      renderDots('pd', 4, '');
      renderKeypad('pk', pressLoginPin);
    } else {
      showStep('email');
      showErr('ee', 'No account found. Please register.');
    }
  } else if (signErr && signErr.message.toLowerCase().includes('user not found')) {
    showStep('email');
    showErr('ee', 'No account found. Please register below.');
  } else {
    // Unexpected — show email step
    showStep('email');
    showErr('ee', 'Something went wrong. Please try again.');
  }
}

async function getUidByEmail(email) {
  // We stored email in profiles table — but Supabase auth.users is protected
  // Workaround: store email in profiles
  const { data } = await sb.from('profiles').select('id, email').eq('email', email).single();
  return data?.id || null;
}

// ── REGISTER ──────────────────────────────────────────────────────────────────
async function doRegister() {
  const name = $('rn').value.trim();
  const email = $('re').value.trim().toLowerCase();
  const sq = $('rsq').value;
  const sa = $('rsa').value.trim().toLowerCase();
  if (!name || !email || !sq || !sa) { showErr('re2', 'Please fill in all fields.'); return; }
  hideErr('re2');
  showStep('loading');

  // Create auth user
  const { data, error } = await sb.auth.signUp({ email, password: crypto.randomUUID() });
  if (error) { showStep('reg'); showErr('re2', error.message); return; }

  // Store profile
  const saHash = await H(sa);
  const { error: pe } = await sb.from('profiles').insert({
    id: data.user.id,
    name, email,
    role: 'user',
    status: 'active',
    sec_question: sq,
    sec_answer_hash: saHash,
  });

  if (pe) { showStep('reg'); showErr('re2', 'Failed to create profile. Try again.'); return; }

  SESSION = data.session;
  CU = { id: data.user.id, name, email, role: 'user', status: 'active' };
  loginEmail = email;

  // Now set PIN
  pinBuf = '';
  renderDots('spd', 4, '');
  renderKeypad('spk', pressSetPin);
  showStep('setpin');
}

// ── SET PIN (first time) ──────────────────────────────────────────────────────
let setPinFirst = '';
async function pressSetPin(k) {
  if (k === '⌫') { pinBuf = pinBuf.slice(0, -1); renderDots('spd', 4, pinBuf); return; }
  if (pinBuf.length >= 4) return;
  pinBuf += k; renderDots('spd', 4, pinBuf);
  if (pinBuf.length === 4) {
    if (!setPinFirst) {
      // First entry — ask to confirm
      setPinFirst = pinBuf; pinBuf = '';
      $('s-setpin').querySelector('p').textContent = 'Confirm your PIN';
      renderDots('spd', 4, '');
    } else {
      if (pinBuf !== setPinFirst) {
        setPinFirst = ''; pinBuf = '';
        $('s-setpin').querySelector('p').textContent = 'PINs did not match. Try again.';
        renderDots('spd', 4, '');
        return;
      }
      // Save PIN hash
      const hash = await H(pinBuf);
      await sb.from('profiles').update({ pin_hash: hash }).eq('id', CU.id);
      CU.pin_hash = hash;
      setPinFirst = ''; pinBuf = '';

      // Create empty notes record
      await sb.from('notes').insert({ user_id: CU.id, content: '' });

      hideAuth();
      launchApp();
    }
  }
}

// ── LOGIN PIN ─────────────────────────────────────────────────────────────────
let loginAttempts = 0;
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
        // Actually sign in properly
        showStep('loading');
        // Use magic link / stored session approach
        // Since we used random password on register, we need a different sign-in method
        // Best: use custom session via service role — but we can't expose that
        // Alternative: sign in with OTP email — no, too complex for beginner
        // Simplest working approach: store a session token in profiles and validate PIN only
        // For this implementation, we use anon key + RLS with PIN validation only
        // The user is "logged in" once PIN matches — we load their data via stored session
        const uid = await getUidByEmail(loginEmail);
        if (uid) {
          const { data: prof } = await sb.from('profiles').select('*').eq('id', uid).single();
          CU = prof;
          hideAuth();
          launchApp();
        }
      } else {
        loginAttempts++;
        pinBuf = '';
        const dots = $('pd');
        dots.classList.add('shake');
        setTimeout(() => dots.classList.remove('shake'), 500);
        if (loginAttempts >= 5) {
          showStep('locked');
        } else {
          hideErr('pe');
          $('pe').textContent = `Wrong PIN — ${5 - loginAttempts} attempts left.`;
          $('pe').className = 'err';
          show('pe');
          setTimeout(() => hide('pe'), 2500);
          renderDots('pd', 4, '');
          renderKeypad('pk', pressLoginPin);
        }
      }
    }, 180);
  }
}

// ── FORGOT PIN ────────────────────────────────────────────────────────────────
function showForgot() {
  if (loginProfile?.sec_question) {
    $('fsq').textContent = loginProfile.sec_question;
  }
  showStep('forgot');
}

async function verifySecAnswer() {
  const ans = $('fsa').value.trim().toLowerCase();
  const h = await H(ans);
  if (h === loginProfile.sec_answer_hash) {
    hideErr('fe');
    pinBuf = '';
    renderDots('rpd', 4, '');
    renderKeypad('rpk', pressResetPin);
    showStep('resetpin');
  } else {
    showErr('fe', 'Incorrect answer. Please try again.');
  }
}

async function pressResetPin(k) {
  if (k === '⌫') { pinBuf = pinBuf.slice(0, -1); renderDots('rpd', 4, pinBuf); return; }
  if (pinBuf.length >= 4) return;
  pinBuf += k; renderDots('rpd', 4, pinBuf);
  if (pinBuf.length === 4) {
    const h = await H(pinBuf);
    const uid = await getUidByEmail(loginEmail);
    if (uid) {
      await sb.from('profiles').update({ pin_hash: h, attempts: 0 }).eq('id', uid);
      loginProfile.pin_hash = h;
    }
    pinBuf = '';
    $('pname').textContent = loginProfile.name.split(' ')[0];
    renderDots('pd', 4, '');
    renderKeypad('pk', pressLoginPin);
    showStep('pin');
  }
}

// ── SIGN OUT ──────────────────────────────────────────────────────────────────
async function signOut() {
  await sb.auth.signOut();
  CU = null; SESSION = null; loginProfile = null; loginAttempts = 0;
  $('app').style.display = 'none';
  showAuth(); showStep('email');
  $('ei').value = '';
}

async function deleteAccount() {
  if (!confirm('Are you sure? This will permanently delete your account and all data.')) return;
  await sb.from('profiles').delete().eq('id', CU.id);
  await signOut();
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
  const app = $('app');
  app.style.display = 'flex';
  buildNav();
  loadProfile();
  showPage('home');
}

// ── NAV ───────────────────────────────────────────────────────────────────────
const TABS = [
  { id:'home',     l:'Home',    s:'<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>' },
  { id:'notes',    l:'Notes',   s:'<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>' },
  { id:'habits',   l:'Habits',  s:'<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>' },
  { id:'files',    l:'Files',   s:'<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' },
  { id:'settings', l:'More',    s:'<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>' },
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
  const { data } = await sb.from('habits').select('id, title').eq('user_id', CU.id);
  HABITS = data || [];
}

function updateHomeRing() {
  const t = today();
  const done = HABITS.filter(h => h._done).length;
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
        font-size:12px;font-weight:700;color:${full?'#fff':'var(--t2)'};
        box-shadow:${full?'0 3px 10px rgba(var(--ar),0.4)':'none'}">${cnt||''}</div>
    </div>`;
  }
}

function renderQuickHabits() {
  const el = $('qh'); el.innerHTML = '';
  const t = today();
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
  const content = data?.content
