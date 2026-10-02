/* JV With Luca — public deal submission (no login required) */
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

/* Contract uploads go to Luca's Google Drive via an Apps Script web app
   (deployed as him, anonymous access). The script URL is baked in at deploy. */
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzpi7ftGhEUAGjkVa615wyeCEhj5xCiofc-ZPQiNUEEK8YUb2YMncJr9WmARgUYWod4/exec';

const SMS_TEXT_VERSION = 'v1-2026-10-02';
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const STATE_NAMES = { GA: 'GEORGIA', TX: 'TEXAS' };

const $ = id => document.getElementById(id);
const msg = $('form-msg');

function showMsg(text, kind) {
  msg.className = kind;
  msg.textContent = text;
  msg.style.display = 'block';
}
function clearMsg() {
  msg.className = '';
  msg.textContent = '';
  msg.style.display = 'none';
}

/* ---------- state picker ---------- */
function pickState(abbr) {
  $('f-state').value = abbr;
  $('f-state-label').value = STATE_NAMES[abbr] + ' (' + abbr + ')';
  $('deal-state-name').textContent = STATE_NAMES[abbr];
  $('form-section').classList.add('open');
  clearMsg();
  setTimeout(() => {
    $('form-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 60);
}
$('pick-ga').addEventListener('click', () => pickState('GA'));
$('pick-tx').addEventListener('click', () => pickState('TX'));
$('change-state').addEventListener('click', () => {
  $('form-section').classList.remove('open');
  document.querySelector('.maps').scrollIntoView({ behavior: 'smooth', block: 'center' });
});

/* ---------- validation ---------- */
const val = id => ($(id).value || '').trim();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate() {
  const errors = [];
  const state = $('f-state').value;
  if (!STATE_NAMES[state]) errors.push('Choose Georgia or Texas above first.');

  const firstName = val('f-firstName'), lastName = val('f-lastName');
  const phone = val('f-phone'), email = val('f-email');
  const street = val('f-street'), city = val('f-city'), zip = val('f-zip');
  const pictures = val('f-pictures');
  const repairs = val('f-repairs'), zestimate = val('f-zestimate'), amount = val('f-amount');
  const closeDate = val('f-closeDate');
  const file = $('f-contract').files[0];
  const consent = $('f-consent').checked;

  if (!firstName) errors.push('First name is required.');
  if (!lastName) errors.push('Last name is required.');
  if (phone.replace(/\D/g, '').length < 7) errors.push('Enter a valid phone number (at least 7 digits).');
  if (!EMAIL_RE.test(email)) errors.push('Enter a valid email address.');
  if (!street) errors.push('Property street address is required.');
  if (!city) errors.push('City is required.');
  if (!zip) errors.push('Postal code is required.');
  if (!/^https?:\/\/.+\..+/.test(pictures)) errors.push('Property pictures must be a valid http(s) link (Google Drive or Dropbox folder).');
  [['repairs', repairs], ['zestimate', zestimate], ['contract amount', amount]].forEach(([label, v]) => {
    if (v === '' || isNaN(Number(v)) || Number(v) < 0) errors.push(label + ' must be a number of 0 or more.');
  });
  if (!closeDate) errors.push('Contract close date is required.');
  if (!file) {
    errors.push('Proof of contract file is required.');
  } else {
    if (!ALLOWED_TYPES.includes(file.type)) errors.push('Contract must be a PDF, JPG, or PNG file.');
    if (file.size > MAX_FILE_BYTES) errors.push('Contract file must be 10 MB or smaller.');
  }
  if (!consent) errors.push('You must agree to the calls/texts consent to submit.');

  return { errors, data: { firstName, lastName, phone, email, street, city, zip, pictures, repairs, zestimate, amount, closeDate, file, state } };
}

/* ---------- submit ---------- */
$('deal-form').addEventListener('submit', async e => {
  e.preventDefault();
  clearMsg();
  const { errors, data } = validate();
  if (errors.length) {
    showMsg('Please fix the following:\n• ' + errors.join('\n• '), 'error');
    msg.style.whiteSpace = 'pre-line';
    return;
  }

  const btn = $('submit-btn');
  btn.disabled = true;
  btn.textContent = 'SUBMITTING…';

  const normalizedAddress = (data.street + ' ' + data.city + ' ' + data.state + ' ' + data.zip)
    .toLowerCase().replace(/\s+/g, ' ').trim();

  const docRef = db.collection('jv_deals').doc();
  const payload = {
    firstName: data.firstName,
    lastName: data.lastName,
    phone: data.phone,
    email: data.email,
    street: data.street,
    city: data.city,
    state: data.state,
    zip: data.zip,
    normalizedAddress,
    picturesLink: data.pictures,
    repairsEstimate: Number(data.repairs),
    zestimate: Number(data.zestimate),
    closeDate: data.closeDate,
    contractAmount: Number(data.amount),
    smsConsent: {
      value: true,
      at: firebase.firestore.FieldValue.serverTimestamp(),
      textVersion: SMS_TEXT_VERSION
    },
    status: 'new',
    submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
    source: 'jvwithluca-web'
  };

  try {
    await docRef.set(payload);
  } catch (err) {
    console.error(err);
    showMsg('Could not save your submission. Please check your connection and try again.', 'error');
    btn.disabled = false;
    btn.textContent = 'SUBMIT DEAL';
    return;
  }

  try {
    const base64 = await fileToBase64(data.file);
    const up = await uploadViaAppsScript({
      dealId: docRef.id,
      fileName: data.file.name,
      mimeType: data.file.type,
      base64
    });
    await docRef.update({
      contractFile: { driveFileId: up.fileId, driveLink: up.url, name: data.file.name, size: data.file.size }
    });
  } catch (err) {
    console.error(err);
    // Don't leave an orphaned doc behind.
    try { await docRef.delete(); } catch (e) { console.error(e); }
    showMsg('Your contract file could not be uploaded, so the submission was not saved. Please try again (PDF/JPG/PNG, max 10 MB).', 'error');
    btn.disabled = false;
    btn.textContent = 'SUBMIT DEAL';
    return;
  }

  showMsg('Deal submitted successfully. Luca will review it and be in touch.', 'success');
  $('deal-form').reset();
  btn.disabled = false;
  btn.textContent = 'SUBMIT DEAL';
});

/* ---------- Drive upload via hidden iframe + postMessage ----------
   Apps Script web apps 302-redirect POSTs, which breaks fetch; the reliable
   pattern is a form POST into a hidden iframe, with the script posting the
   JSON result back to this page. */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || '');
      const i = s.indexOf('base64,');
      resolve(i >= 0 ? s.slice(i + 7) : s);
    };
    r.onerror = () => reject(new Error('could not read file'));
    r.readAsDataURL(file);
  });
}

function uploadViaAppsScript(payload) {
  return new Promise((resolve, reject) => {
    const tag = 'up' + Date.now();
    const iframe = document.createElement('iframe');
    iframe.name = tag;
    iframe.style.display = 'none';
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = APPS_SCRIPT_URL;
    form.target = tag;
    form.enctype = 'application/x-www-form-urlencoded';
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'json';
    input.value = JSON.stringify(payload);
    form.appendChild(input);

    let done = false;
    const timer = setTimeout(() => finish(new Error('upload timed out')), 120000);

    function finish(err, data) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMsg);
      iframe.remove();
      form.remove();
      if (err) reject(err);
      else if (data && data.ok) resolve(data);
      else reject(new Error((data && data.error) || 'upload failed'));
    }
    function onMsg(ev) {
      if (!/\.googleusercontent\.com$/.test(ev.origin) && ev.origin !== 'https://script.google.com') return;
      let data = null;
      try { data = JSON.parse(ev.data); } catch (e) { return; }
      if (!data || typeof data.ok === 'undefined') return;
      finish(null, data);
    }

    window.addEventListener('message', onMsg);
    document.body.appendChild(iframe);
    document.body.appendChild(form);
    try {
      form.submit();
    } catch (e) {
      finish(e);
    }
  });
}
