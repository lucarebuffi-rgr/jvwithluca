/* JV Deals — Admin CRM (Luca-only) */
'use strict';

const firebaseConfig = {
  apiKey: "AIzaSyDNpa-2O0RduvXa5qmmIfFoioKG4gyoCOs",
  authDomain: "rgr-crm-941ab.firebaseapp.com",
  projectId: "rgr-crm-941ab",
  storageBucket: "rgr-crm-941ab.firebasestorage.app",
  messagingSenderId: "970218702810",
  appId: "1:970218702810:web:03409e8b0e971bb0b6e2e3"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
const storage = firebase.storage();

/* ---------------- Auth: Google sign-in, Luca-only data ----------------
   Firestore rules allow READS and WRITES on jv_deals only from Luca's
   Google account. This mirrors the GA Stacked/Zombies CRM pattern verbatim:
   login_hint steers sign-in to his RGR account, the wrong-account banner
   blocks silent re-auth as the Athena mailbox, and requireAuth() guards
   every write. */
const LUCA_EMAIL = 'luca.rebuffi@royalgroupsrealty.com';
let currentUser = null;
// The Firestore rules allow reads AND writes ONLY as LUCA_EMAIL. A Google
// sign-in as any other account (e.g. the Athena mailbox, which a silent
// re-auth can pick as the browser's default session) gets every read and
// write denied — so the app must treat "signed in as someone else" as
// effectively signed out, and say so loudly.
function isLucaSignedIn() {
  return !!(currentUser && currentUser.email === LUCA_EMAIL);
}
auth.onAuthStateChanged(u => {
  currentUser = u;
  const btn = document.getElementById('auth-btn');
  const chip = document.getElementById('user-chip');
  const banner = document.getElementById('acct-banner');
  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  const exp = document.getElementById('export-btn');
  const wrongAccount = !!(u && u.email !== LUCA_EMAIL);
  if (wrongAccount) {
    btn.style.display = 'none';
    chip.style.display = 'inline';
    chip.textContent = '👤 ' + (u.email || 'signed in');
    banner.style.display = 'block';
    banner.querySelector('.acct-banner-msg').textContent =
      '⚠️ Signed in as ' + u.email + ' — this CRM only works as ' + LUCA_EMAIL + '. Nothing will load until you switch accounts.';
    gate.style.display = 'block';
    app.style.display = 'none';
    exp.style.display = 'none';
    stopListening();
  } else if (u) {
    btn.style.display = 'none';
    chip.style.display = 'inline';
    chip.textContent = '👤 ' + (u.email || 'signed in');
    banner.style.display = 'none';
    gate.style.display = 'none';
    app.style.display = 'block';
    exp.style.display = 'inline-block';
    startListening();
  } else {
    btn.style.display = 'inline-block';
    chip.style.display = 'none';
    banner.style.display = 'none';
    gate.style.display = 'block';
    app.style.display = 'none';
    exp.style.display = 'none';
    stopListening();
  }
});
function requireAuth() {
  if (isLucaSignedIn()) return true;
  if (currentUser) {
    // Signed in, but as the wrong Google account — the Firestore rules would
    // deny the write, so block here with guidance instead of failing silently.
    showToast('Wrong Google account — use "Switch Google account" above to sign in as ' + LUCA_EMAIL, 'error');
  } else {
    showToast('Sign in with Google to save changes', 'error');
    const btn = document.getElementById('auth-btn');
    if (btn) btn.click();
  }
  return false;
}
// keep the console clean when a write is blocked for sign-in
window.addEventListener('unhandledrejection', e => {
  if (e && e.reason && e.reason.message === 'not-signed-in') e.preventDefault();
});
function signInWithGoogle(selectAccount) {
  const provider = new firebase.auth.GoogleAuthProvider();
  // Steer Google toward Luca's account: without login_hint, a sign-in (or a
  // silent re-auth after the session lapses) can land on the browser's default
  // Google session — e.g. the Athena mailbox — and the Firestore rules then
  // deny every read and write. The switch flow forces the account chooser.
  const params = { login_hint: LUCA_EMAIL };
  if (selectAccount) params.prompt = 'select_account';
  provider.setCustomParameters(params);
  return auth.signInWithPopup(provider).catch(e => {
    console.error(e);
    showToast('Google sign-in failed', 'error');
  });
}
document.getElementById('auth-btn').addEventListener('click', () => signInWithGoogle(false));
document.getElementById('gate-signin').addEventListener('click', () => signInWithGoogle(false));
document.getElementById('acct-switch-btn').addEventListener('click', async () => {
  try { await auth.signOut(); } catch (e) { console.error(e); }
  signInWithGoogle(true);
});

/* ---------------- helpers ---------------- */
const $ = id => document.getElementById(id);
function escapeHtml(s) {
  return (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function fmtDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function fmtMoney(n) {
  if (n == null || isNaN(Number(n))) return '—';
  return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}
function showToast(text, kind) {
  const t = $('toast');
  t.className = kind;
  t.textContent = text;
  clearTimeout(showToast._h);
  showToast._h = setTimeout(() => { t.className = ''; t.textContent = ''; }, 4200);
}

const STATUSES = [
  { id: 'new', label: 'New' },
  { id: 'reviewing', label: 'Reviewing' },
  { id: 'vetted', label: 'Vetted' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'closed', label: 'Closed' }
];
const STATUS_LABEL = Object.fromEntries(STATUSES.map(s => [s.id, s.label]));

/* ---------------- list + filters ---------------- */
let allDeals = [];
let activeFilter = 'all';
let selectedId = null;
let unsub = null;

function renderFilters() {
  const f = $('filters');
  f.innerHTML = '';
  const mk = (id, label, count) => {
    const b = document.createElement('button');
    b.className = 'fchip' + (activeFilter === id ? ' active' : '');
    b.textContent = label + (count != null ? ' (' + count + ')' : '');
    b.addEventListener('click', () => { activeFilter = id; renderFilters(); renderList(); });
    f.appendChild(b);
  };
  mk('all', 'All', allDeals.length);
  STATUSES.forEach(s => {
    const n = allDeals.filter(d => d.status === s.id).length;
    mk(s.id, STATUS_LABEL[s.id], n);
  });
}

function visibleDeals() {
  const list = activeFilter === 'all' ? allDeals : allDeals.filter(d => d.status === activeFilter);
  return list.slice().sort((a, b) => {
    const ta = a.submittedAt && a.submittedAt.toMillis ? a.submittedAt.toMillis() : 0;
    const tb = b.submittedAt && b.submittedAt.toMillis ? b.submittedAt.toMillis() : 0;
    return tb - ta;
  });
}

function renderList() {
  const list = $('deal-list');
  list.innerHTML = '';
  const deals = visibleDeals();
  if (!deals.length) {
    list.innerHTML = '<div style="color:var(--muted);text-align:center;padding:30px 10px;">No deals in this view yet.</div>';
    return;
  }
  deals.forEach(d => {
    const b = document.createElement('button');
    b.className = 'deal-card' + (d.id === selectedId ? ' selected' : '');
    b.innerHTML =
      '<div class="nm">' + escapeHtml(d.firstName + ' ' + d.lastName) + '</div>' +
      '<div class="ad">' + escapeHtml(d.street) + '<br>' + escapeHtml(d.city + ', ' + d.state + ' ' + d.zip) + '</div>' +
      '<div class="meta"><span class="badge st-' + escapeHtml(d.status || 'new') + '">' +
      escapeHtml((STATUS_LABEL[d.status] || d.status || 'new').toUpperCase()) + '</span>' +
      '<span class="when">' + escapeHtml(fmtDate(d.submittedAt)) + '</span></div>';
    b.addEventListener('click', () => { selectedId = d.id; renderList(); renderDetail(); });
    list.appendChild(b);
  });
}

function startListening() {
  stopListening();
  unsub = db.collection('jv_deals').onSnapshot(snap => {
    allDeals = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    renderFilters();
    renderList();
    if (selectedId) renderDetail();
  }, err => {
    console.error(err);
    showToast('Could not load deals: ' + err.message, 'error');
  });
}
function stopListening() {
  if (unsub) { unsub(); unsub = null; }
  allDeals = [];
  selectedId = null;
}

/* ---------------- detail ---------------- */
function field(k, v, raw) {
  return '<div class="d-field"><div class="k">' + escapeHtml(k) + '</div><div class="v">' + (raw ? v : escapeHtml(v)) + '</div></div>';
}

function renderDetail() {
  const det = $('detail');
  const d = allDeals.find(x => x.id === selectedId);
  if (!d) { det.innerHTML = '<div class="empty">Select a deal to view details.</div>'; return; }

  const pics = d.picturesLink
    ? '<a href="' + escapeHtml(d.picturesLink) + '" target="_blank" rel="noopener">Open pictures folder</a>'
    : '—';
  const contract = d.contractFile
    ? '<button class="btn sm" id="dl-contract">Download contract (' + escapeHtml(d.contractFile.name || 'file') + ')</button>'
    : '—';

  det.innerHTML =
    '<h2 style="color:var(--gold-bright);letter-spacing:.06em;">' + escapeHtml(d.firstName + ' ' + d.lastName) + '</h2>' +
    '<div style="color:var(--muted);font-size:13px;margin-top:6px;">Submitted ' + escapeHtml(fmtDate(d.submittedAt)) + ' · via ' + escapeHtml(d.source || 'web') + '</div>' +
    '<h3 class="sec">Contact</h3><div class="d-grid">' +
    field('Phone', d.phone) + field('Email', d.email) + '</div>' +
    '<h3 class="sec">Property</h3><div class="d-grid">' +
    field('Street', d.street) + field('City', d.city) +
    field('State', d.state) + field('Postal code', d.zip) +
    field('Pictures', pics, true) + field('Contract file', contract, true) + '</div>' +
    '<h3 class="sec">Numbers</h3><div class="d-grid">' +
    field('Repairs', fmtMoney(d.repairsEstimate)) + field('Zestimate', fmtMoney(d.zestimate)) +
    field('Contract close date', d.closeDate) + field('Locked up for', fmtMoney(d.contractAmount)) + '</div>' +
    '<h3 class="sec">Pipeline</h3><div class="pipeline" id="pipeline"></div>' +
    '<h3 class="sec">Notes</h3><div id="notes"></div>' +
    '<textarea id="note-input" placeholder="Add a note…"></textarea>' +
    '<div class="rowbtns"><button class="btn sm" id="add-note">Add note</button></div>' +
    '<h3 class="sec">Activity</h3><div id="activity"></div>';

  // pipeline buttons
  const pl = $('pipeline');
  STATUSES.forEach(s => {
    const b = document.createElement('button');
    b.className = 'pbtn' + (d.status === s.id ? ' cur' : '');
    b.textContent = s.label;
    b.addEventListener('click', () => setStatus(d, s.id));
    pl.appendChild(b);
  });

  // notes
  const notes = $('notes');
  const noteList = d.notes || [];
  notes.innerHTML = noteList.length
    ? noteList.slice().reverse().map(n =>
        '<div class="note">' + escapeHtml(n.text) + '<div class="t">' + escapeHtml(fmtDate(n.at)) + '</div></div>').join('')
    : '<div style="color:var(--muted);font-size:13px;">No notes yet.</div>';
  $('add-note').addEventListener('click', () => addNote(d));

  // activity
  const act = $('activity');
  const acts = d.activity || [];
  act.innerHTML = acts.length
    ? acts.slice().reverse().map(a =>
        '<div class="act">' + escapeHtml(a.text) + ' <span class="t">· ' + escapeHtml(fmtDate(a.at)) + '</span></div>').join('')
    : '<div style="color:var(--muted);font-size:13px;">No activity yet.</div>';

  const dl = $('dl-contract');
  if (dl) dl.addEventListener('click', async () => {
    if (!requireAuth()) return;
    dl.disabled = true;
    try {
      const url = await storage.ref(d.contractFile.storagePath).getDownloadURL();
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      console.error(e);
      showToast('Could not get the contract download link.', 'error');
    }
    dl.disabled = false;
  });
}

async function setStatus(d, statusId) {
  if (!requireAuth()) return;
  if (d.status === statusId) return;
  const now = new Date().toISOString();
  try {
    await db.collection('jv_deals').doc(d.id).update({
      status: statusId,
      activity: firebase.firestore.FieldValue.arrayUnion({
        type: 'status',
        text: 'Status changed to ' + STATUS_LABEL[statusId],
        at: now
      })
    });
    showToast('Status updated.', 'ok');
  } catch (e) {
    console.error(e);
    showToast('Could not update status: ' + e.message, 'error');
  }
}

async function addNote(d) {
  if (!requireAuth()) return;
  const ta = $('note-input');
  const text = (ta.value || '').trim();
  if (!text) { showToast('Write a note first.', 'error'); return; }
  const now = new Date().toISOString();
  try {
    await db.collection('jv_deals').doc(d.id).update({
      notes: firebase.firestore.FieldValue.arrayUnion({ text, at: now }),
      activity: firebase.firestore.FieldValue.arrayUnion({ type: 'note', text: 'Note added', at: now })
    });
    showToast('Note added.', 'ok');
  } catch (e) {
    console.error(e);
    showToast('Could not add note: ' + e.message, 'error');
  }
}

/* ---------------- CSV export ---------------- */
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return '"' + s.replace(/"/g, '""') + '"';
}
$('export-btn').addEventListener('click', () => {
  if (!requireAuth()) return;
  const rows = [
    ['submittedAt', 'firstName', 'lastName', 'phone', 'email', 'street', 'city', 'state', 'zip',
     'picturesLink', 'repairsEstimate', 'zestimate', 'closeDate', 'contractAmount', 'status',
     'contractFileName', 'contractStoragePath']
  ];
  visibleDeals().forEach(d => {
    rows.push([
      fmtDate(d.submittedAt), d.firstName, d.lastName, d.phone, d.email, d.street, d.city, d.state, d.zip,
      d.picturesLink, d.repairsEstimate, d.zestimate, d.closeDate, d.contractAmount, d.status,
      d.contractFile ? d.contractFile.name : '', d.contractFile ? d.contractFile.storagePath : ''
    ]);
  });
  const csv = rows.map(r => r.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'jv-deals-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
});
