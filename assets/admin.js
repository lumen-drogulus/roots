/* Roots approvals: the owner's queue. Every action here needs the admin key, which the server checks. */
'use strict';
const $ = s => document.querySelector(s);
const QS = new URLSearchParams(location.search);
const IS_LOCAL = /^(localhost|127\.0\.0\.1|)$/.test(location.hostname);
const API_URL = (IS_LOCAL && QS.get('api')) || window.ROOTS_CONFIG.API_URL;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};
let KEY = store.get('roots_admin_key') || '';
const esc0 = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// Server labels end in " [pending]" for people not approved yet; show that as a small marker instead.
const esc = s => esc0(s).replace(/ \[pending\]/g, ' <span class="new">new</span>');
let toastT;
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 3200); }

// The server handles one change at a time and waits up to 25 seconds for its turn, so a slow request can hold the
// next one up. Give every call a hard limit and a plain message instead of a page that just sits there.
const API_TIMEOUT = 45000;
const KEY_REJECTED = 'Admin key not accepted.';
async function api(action, body = {}) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl && setTimeout(() => ctl.abort(), API_TIMEOUT);
  let res, json;
  try {
    res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, key: KEY, ...body }), signal: ctl ? ctl.signal : undefined });
    json = await res.json();
  } catch (e) {
    throw new Error(e && e.name === 'AbortError' ? "The tree didn't answer in time. Wait a minute, then try again." : "Couldn't reach the tree. Check your connection.");
  } finally { clearTimeout(timer); }
  if (!json.ok) throw new Error(json.error || 'Something went wrong.');
  return json;
}

// Shows a button as working ("Approving…") until the call finishes, and says so if it's taking a while.
async function working(btn, label, run) {
  const old = btn ? btn.textContent : '';
  if (btn) { btn.textContent = label; btn.disabled = true; }
  const slow = setTimeout(() => toast('Still working. The server can take a moment.'), 6000);
  // On success the caller redraws (or hides) the button; on failure it comes back so you can try again.
  try { return await run(); }
  catch (err) { if (btn && btn.isConnected) { btn.textContent = old; btn.disabled = false; } throw err; }
  finally { clearTimeout(slow); }
}
const retryBox = (msg, again) => { const p = document.createElement('p'); p.className = 'err'; p.textContent = msg + ' ';
  const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'Try again'; b.onclick = again; p.appendChild(b); return p; };

/* ---------- dates ---------- */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fuzzy(s) {
  const m = /^(exact|about|before|after):(\d{1,4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(s || '');
  if (!m) return s || '';
  const core = m[3] ? (m[4] ? `${MONTHS[+m[3] - 1]} ${+m[4]}, ${m[2]}` : `${MONTHS[+m[3] - 1]} ${m[2]}`) : m[2];
  return (m[1] === 'exact' ? '' : m[1] + ' ') + core;
}
function when(iso) {
  const d = new Date(iso); if (isNaN(d)) return '';
  const mins = Math.round((Date.now() - d) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return mins + ' minutes ago';
  if (mins < 60 * 24) return Math.round(mins / 60) + ' hours ago';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function personName(r) {
  const married = (() => { try { return JSON.parse(r.married_names || '[]'); } catch (e) { return []; } })();
  const n = [r.first_name, r.middle_name, r.birth_surname].filter(Boolean).join(' ') || (r.is_placeholder === 'true' ? 'Unknown person' : '(no name)');
  return married.length ? `${n} (${married.join(', ')})` : n;
}
const FIELD = { first_name: 'First name', middle_name: 'Middle name', birth_surname: 'Last name at birth', married_names: 'Later last names', nicknames: 'Goes by',
  sex: 'Sex', living: 'Living', birth_date: 'Born', birth_place: 'Birthplace', death_date: 'Died', death_place: 'Place of death', notes: 'Notes',
  is_placeholder: 'Unknown placeholder', subtype: 'Kind of link', start_date: 'Start', end_date: 'End',
  caption: 'Caption', date_taken: 'When', place: 'Where', kind: 'Photo or document' };
const listText = v => { try { const a = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(a) ? a.join(', ') : String(v); } catch (e) { return String(v); } };
const showVal = (field, v) => field === 'married_names' ? (listText(v) || '(none)') : v === '' || v == null ? '(blank)' : /date/.test(field) ? fuzzy(v) : field === 'is_placeholder' ? (v === true || v === 'true' ? 'yes' : 'no') : String(v);

/* ---------- date sanity: catch typos like 1987 for 1978 before they go public ---------- */
let TREE = null;   // admin_tree: every row, every status
async function loadTree() { try { TREE = await api('admin_tree'); } catch (e) { TREE = null; } return TREE; }
const yearOf = d => { const m = /^(?:exact|about|before|after):(\d{1,4})/.exec(d || ''); return m ? +m[1] : null; };
const personById = id => TREE && (TREE.People || []).find(p => p.id === id);
function personWarnings(r) {
  const b = yearOf(r.birth_date), d = yearOf(r.death_date), now = new Date().getFullYear(), w = [];
  if (b && b > now) w.push(`born in ${b}, which hasn't happened yet`);
  if (d && d > now) w.push(`died in ${d}, which hasn't happened yet`);
  if (b && d && d < b) w.push(`died (${d}) before being born (${b})`);
  if (b && d && d - b > 115) w.push(`lived ${d - b} years`);
  if (b && !d && r.living === 'living' && now - b > 110) w.push(`marked living but born ${now - b} years ago`);
  return w;
}
function linkWarnings(r) {
  if (r.type !== 'parent_child') return [];
  const par = personById(r.person_a), kid = personById(r.person_b);
  if (!par || !kid) return [];
  const pb = yearOf(par.birth_date), pd = yearOf(par.death_date), kb = yearOf(kid.birth_date), w = [];
  const pn = par.first_name || 'The parent', kn = kid.first_name || 'the child';
  if (pb && kb && kb <= pb) w.push(`${pn} (born ${pb}) would be born ${kb === pb ? 'the same year as' : 'after'} ${kn} (born ${kb})`);
  else if (pb && kb && kb - pb < 12) w.push(`${pn} would be ${kb - pb} when ${kn} was born`);
  else if (pb && kb && kb - pb > 80) w.push(`${pn} would be ${kb - pb} when ${kn} was born`);
  if (pd && kb && kb - pd >= 2 && r.subtype !== 'adopted' && r.subtype !== 'step') w.push(`${pn} died in ${pd}, ${kb - pd} years before ${kn} was born`);
  return w;
}
const warnBox = w => w.length ? `<div class="datewarn">Check the dates: ${esc0(w.join('; '))}.</div>` : '';

/* ---------- gate ---------- */
async function unlock(key) {
  KEY = key;
  const q = await api('admin_queue');
  store.set('roots_admin_key', key);
  await loadTree();
  $('#gate').hidden = true; $('#app').hidden = false; $('#actions').hidden = false;
  showQueue(q);
}
function gateError(err) {
  $('#gateErr').textContent = err.message === KEY_REJECTED ? "That key didn't work. Copy it again from the Apps Script log (run showAdminKey)." : err.message;
  $('#gateErr').hidden = false;
}
$('#gateForm').onsubmit = async e => {
  e.preventDefault();
  // An empty box retries with the key this browser already saved (kept when the server was only busy).
  const k = $('#keyInput').value.trim() || store.get('roots_admin_key') || '';
  if (!k) return;
  $('#gateErr').hidden = true;
  try { await working($('#gateForm button[type="submit"]'), 'Unlocking…', () => unlock(k)); }
  catch (err) { KEY = ''; if (err.message === KEY_REJECTED) store.del('roots_admin_key'); gateError(err); }
};
// Locking also forgets the tree this device saved in owner mode, which holds every private field.
$('#btnLock').onclick = () => { store.del('roots_admin_key'); store.del('roots_cache'); location.reload(); };

/* ---------- tabs ---------- */
// Waiting, Everyone, and since 2026-11-24 the tracker: Visits, Activity, Contacts.
const TABS = { queue: 'tabQueue', people: 'tabPeople', visits: 'tabVisits', activity: 'tabActivity', contacts: 'tabContacts' };
function tab(which) {
  Object.entries(TABS).forEach(([panel, btn]) => { $('#' + btn).setAttribute('aria-selected', which === panel); $('#' + panel).hidden = which !== panel; });
  if (which === 'people') loadPeople();
  else if (which === 'queue') loadQueue();
  else showTracker(which);
}
Object.entries(TABS).forEach(([panel, btn]) => { $('#' + btn).onclick = () => tab(panel); });

/* ---------- pause ---------- */
function setPaused(p) { const b = $('#btnPause'); b.setAttribute('aria-pressed', p); b.textContent = p ? 'Adding is paused: resume' : 'Pause adding'; }
$('#btnPause').onclick = async () => {
  const now = $('#btnPause').getAttribute('aria-pressed') !== 'true';
  try { await api('admin_pause', { paused: now }); setPaused(now); toast(now ? 'Relatives can look but not add until you resume.' : 'Adding is back on.'); }
  catch (err) { toast(err.message); }
};

/* ---------- queue ---------- */
async function loadQueue() {
  try { const [q] = await Promise.all([api('admin_queue'), loadTree()]); showQueue(q); }
  catch (err) { $('#queue').replaceChildren(retryBox(err.message, loadQueue)); }
}
/* What merging does, beside the only two actions here that are hard to reverse by hand (2026-11-22). */
const INFO_ADMIN = {
  dup: `This new entry looks like someone already in the tree.\n**Same person: merge** folds it into the existing person. The links it came with move over and still wait for your approval.\nIf they're different people, ignore this and approve or reject as usual.`,
  merge: `**Merge into** folds this person into the one you pick. The one you pick stays; links, photos and corrections move over to them.\nUse it for duplicates, like the same grandparent added by two relatives.\nYou can undo it from this list.`,
  unmerge: `**Undo merge** brings this person back as they were, with their own links, photos and corrections.`
};
function describe(it) {
  const r = it.row;
  switch (it.kind) {
    case 'person': {
      const facts = [r.living && `Living: ${r.living}`, r.birth_date && `Born ${fuzzy(r.birth_date)}${r.birth_place ? ', ' + r.birth_place : ''}`,
        r.death_date && `Died ${fuzzy(r.death_date)}${r.death_place ? ', ' + r.death_place : ''}`, r.source && `Source: ${r.source}`].filter(Boolean);
      const dups = (it.possible_duplicates || []).map(d => `<span>Might be <b>${esc(d.label)}</b>${d.birth_date ? ' (born ' + esc(fuzzy(d.birth_date)) + ')' : ''}</span><button class="btn" data-merge="${esc(d.id)}">Same person: merge</button>${infoBtn(INFO_ADMIN.dup)}`).join('');
      return { label: 'New person', what: esc(personName(r)), detail: esc(facts.join(' · ')) + (r.notes ? `<div class="story">${esc(r.notes)}</div>` : '') + warnBox(personWarnings(r)) + (dups ? `<div class="dupwarn">${dups}</div>` : ''), edit: true };
    }
    case 'relationship': {
      const sub = r.subtype && r.subtype !== 'biological' && r.subtype !== 'unknown' ? ` (${r.subtype})` : '';
      const what = r.type === 'partner' ? `${esc(it.a_label)} and ${esc(it.b_label)}: partners${sub}` : `${esc(it.a_label)} is the parent of ${esc(it.b_label)}${sub}`;
      return { label: 'New link', what, detail: (r.source ? 'Source: ' + esc(r.source) : '') + warnBox(linkWarnings(r)) };
    }
    case 'suggestion':
      if (r.field === 'remove') return { label: 'Wrong link', what: `Remove ${esc(it.target_label)}`,
        detail: `Says this link is wrong. Approving takes it off the tree; both people stay.${r.source ? '<br>Source: ' + esc(r.source) : ''}` };
      return { label: 'Correction', what: `${esc(it.target_label)}: ${esc(FIELD[r.field] || r.field)}`,
        detail: `<span class="change"><s>${esc(showVal(r.field, it.current_value))}</s> → <b>${esc(showVal(r.field, it.proposed))}</b></span>${r.source ? '<br>Source: ' + esc(r.source) : ''}${it.photo_file_id ? `<div class="phrow"><a class="btn" href="https://drive.google.com/file/d/${encodeURIComponent(it.photo_file_id)}/view" target="_blank" rel="noopener">Open the file</a></div>` : ''}` };
    case 'photo': {
      const doc = (it.photo_kind || r.kind) === 'document';
      const tagged = (it.tagged || []).map(t => t.name).join(', ') || 'nobody tagged';
      const lv = it.living_tagged || [], names = esc(lv.map(p => p.name).join(', '));
      const warn = !lv.length ? '' : doc
        ? `<div class="livingwarn">Document about ${lv.length} living ${lv.length === 1 ? 'person' : 'people'}: ${names}. It may show a birthday, birthplace or other details the tree keeps to family. Approving shows it to confirmed family only, not to everyone with the link. Check it before approving.</div>`
        : `<div class="livingwarn">Shows ${lv.length} living ${lv.length === 1 ? 'person' : 'people'}: ${names}. Approving makes this photo public.</div>`;
      const file = r.drive_file_id ? `<a class="btn" href="https://drive.google.com/file/d/${encodeURIComponent(r.drive_file_id)}/view" target="_blank" rel="noopener">Open the file</a>` : '';
      const pic = it.thumbnail ? `<img class="thumb" src="${it.thumbnail}" alt="Preview">` : `<span class="thumb wait" data-preview="${esc(r.id)}">Preview loading…</span>`;
      const meta = [r.date_taken && fuzzy(r.date_taken), r.place, r.source && 'Source: ' + r.source].filter(Boolean).join(' · ');
      return { label: doc ? 'New document' : 'New photo', what: esc(r.caption || (doc ? 'Document' : 'Photo')),
        detail: `Tagged: ${esc(tagged)}${meta ? ' · ' + esc(meta) : ''}<div class="phrow">${pic}${file}</div>${warn}` };
    }
    case 'tag': {
      const doc = it.photo_kind === 'document';
      const what = `${esc(it.person_label)} tagged in a ${doc ? 'document' : 'photo'}${it.photo_caption ? ': ' + esc(it.photo_caption) : ''}`;
      const warn = !it.living ? '' : doc ? '<div class="livingwarn">This person is living. Approving shows this document about them to confirmed family only. Check what it shows first.</div>'
        : '<div class="livingwarn">This person is living. Approving shows them in a public photo.</div>';
      const file = it.drive_file_id ? `<div class="phrow"><a class="btn" href="https://drive.google.com/file/d/${encodeURIComponent(it.drive_file_id)}/view" target="_blank" rel="noopener">Open the file</a></div>` : '';
      return { label: doc ? 'Document tag' : 'Photo tag', what, detail: file + warn };
    }
    case 'claim':
      return { label: 'Who they are', what: `${esc(r.display_name || 'A relative')} says they are ${esc(it.person_label)}`, detail: 'Approve if that sounds right. Approving also lets them see living relatives\' birthdays, birthplaces and stories, so be sure it\'s really them. Until then their additions show no name.' };
  }
  return { label: it.kind, what: '', detail: '' };
}
function showQueue(q) {
  setPaused(!!q.paused);
  const batches = q.batches || [];
  const n = batches.reduce((s, b) => s + b.items.length, 0);
  $('#qCount').textContent = n ? `(${n})` : '';
  if (!batches.length) { $('#queue').innerHTML = '<p class="empty">Nothing waiting. The tree is up to date.</p>'; return; }
  $('#queue').innerHTML = batches.map((b, bi) => {
    const c = b.contributor || {};
    const who = esc(c.display_name || (c.person_label && c.claim_status === 'approved' ? c.person_label : '') || 'A relative');
    const claim = c.person_id ? `${c.claim_status === 'approved' ? 'Confirmed as' : 'Says they are'} ${esc(c.person_label)}` : '';
    return `<article class="batch" data-b="${bi}">
      <div class="bhead"><span class="who">${who}</span>${claim ? `<span class="claim">${claim}</span>` : ''}<span class="when">${esc(when(b.submitted_at))}</span><span class="spacer"></span>
        <button class="btn good" data-all="approve">Approve all</button><button class="btn bad" data-all="reject">Reject all</button></div>
      ${b.items.map((it, ii) => { const d = describe(it); return `<div class="item" data-i="${ii}">
        <div><div class="kind">${d.label}</div><div class="what">${d.what}</div><div class="detail">${d.detail}</div></div>
        <div class="ibtns"><button class="btn good" data-act="approve">Approve</button>${d.edit ? '<button class="btn" data-act="edit">Edit, then approve</button>' : ''}<button class="btn bad" data-act="reject">Reject</button></div>
      </div>`; }).join('')}
    </article>`;
  }).join('');
  // Photos Drive hasn't made a preview of yet: ask for the file itself (or Drive's picture of a PDF), one at a time.
  (async () => {
    for (const el of [...document.querySelectorAll('[data-preview]')]) {
      try {
        const res = await api('admin_photo', { id: el.dataset.preview });
        if (res.data_url) el.outerHTML = `<img class="thumb" src="${res.data_url}" alt="Preview">`;
        else el.textContent = 'No preview yet. Open the file to look.';
      } catch (e) { el.textContent = 'No preview yet. Open the file to look.'; }
    }
  })();
  document.querySelectorAll('.batch').forEach(el => {
    const b = batches[+el.dataset.b];
    el.querySelectorAll('[data-all]').forEach(btn => btn.onclick = () => decide(el, b.items.map(it => ({ kind: it.kind, id: it.row.id })), btn.dataset.all, btn));
    el.querySelectorAll('.item').forEach(row => {
      const it = b.items[+row.dataset.i];
      row.querySelectorAll('[data-act]').forEach(btn => btn.onclick = () => {
        if (btn.dataset.act === 'edit') return editPerson(row, it);
        decide(el, [{ kind: it.kind, id: it.row.id }], btn.dataset.act, btn);
      });
      row.querySelectorAll('[data-merge]').forEach(btn => btn.onclick = () => mergeInto(btn.dataset.merge, it.row.id, it.row.first_name));
    });
  });
}
async function decide(batchEl, items, act, btn) {
  batchEl.querySelectorAll('button').forEach(b => { b.disabled = true; });
  let res;
  try { res = await working(btn, act === 'approve' ? 'Approving…' : 'Rejecting…', () => api(act === 'approve' ? 'admin_approve' : 'admin_reject', { items })); }
  catch (err) { toast(err.message); batchEl.querySelectorAll('button').forEach(b => { b.disabled = false; }); return; }
  // Says what happened before the list refreshes, so a slow refresh can't hide that the click worked.
  const errs = res.errors || [];
  if (errs.length) toast(errs.map(e => e.error[0].toUpperCase() + e.error.slice(1)).join('. ') + '.');
  else toast(act === 'approve' ? (items.length > 1 ? `Approved ${items.length}.` : 'Approved.') : (items.length > 1 ? `Rejected ${items.length}.` : 'Rejected.'));
  loadQueue();
}
function editPerson(row, it) {
  if (row.querySelector('.editgrid')) return;
  const r = it.row;
  const f = (k, label, type = 'text', wide = false) => `<label class="${wide ? 'wide' : ''}">${label}${type === 'textarea' ? `<textarea name="${k}" rows="3">${esc(r[k])}</textarea>` : `<input name="${k}" value="${esc(r[k])}">`}</label>`;
  const g = document.createElement('form');
  g.className = 'editgrid';
  g.innerHTML = f('first_name', 'First name') + f('middle_name', 'Middle name') + f('birth_surname', 'Last name at birth') + f('nicknames', 'Known as') +
    `<label>Living<select name="living">${['living', 'deceased', 'unknown'].map(v => `<option${r.living === v ? ' selected' : ''}>${v}</option>`).join('')}</select></label>` +
    `<label>Sex<select name="sex">${['', 'female', 'male', 'other'].map(v => `<option value="${v}"${r.sex === v ? ' selected' : ''}>${v || 'not given'}</option>`).join('')}</select></label>` +
    f('birth_date', 'Born (e.g. about:1932, exact:1932-05-14)') + f('birth_place', 'Birthplace') + f('death_date', 'Died') + f('death_place', 'Place of death') +
    f('notes', 'Notes', 'textarea', true) +
    '<div class="row"><button type="button" class="btn quiet" data-x="cancel">Cancel</button><button class="btn good" type="submit">Save and approve</button></div>';
  row.appendChild(g);
  g.querySelector('[data-x="cancel"]').onclick = () => g.remove();
  g.onsubmit = e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(g).entries());
    decide(row.closest('.batch'), [{ kind: 'person', id: r.id, data }], 'approve');
  };
}
async function mergeInto(keepId, dropId, name) {
  try {
    // A pending entry is merged straight into the existing person; its links come along and wait for approval.
    await api('admin_merge', { keep: keepId, drop: dropId });
    toast(`Merged ${name || 'them'} into the existing person. Their links are still waiting below.`);
  } catch (err) { toast(err.message); }
  loadQueue();
}

/* ---------- everyone ---------- */
let PEOPLE = [];
async function loadPeople() {
  try { const t = await loadTree(); if (!t) throw new Error("Couldn't load the tree."); PEOPLE = t.People || []; setPaused(!!(t.meta && t.meta.paused)); showPeople(); }
  catch (err) { $('#people').innerHTML = `<p class="err">${esc(err.message)}</p>`; }
}
function showPeople() {
  const q = ($('#pSearch') && $('#pSearch').value || '').toLowerCase();
  const approved = PEOPLE.filter(p => p.status === 'approved');
  const rows = PEOPLE.filter(p => (p.status === 'approved' || p.status === 'merged') && (!q || personName(p).toLowerCase().includes(q)))
    .sort((a, b) => personName(a).localeCompare(personName(b)));
  const opts = approved.map(p => `<option value="${esc(p.id)}">${esc(personName(p))}</option>`).join('');
  $('#people').innerHTML = `<input class="search" id="pSearch" placeholder="Search everyone in the tree" value="${esc(q)}">` +
    (rows.length ? rows.map(p => `<div class="prow${p.status === 'merged' ? ' merged' : ''}" data-id="${esc(p.id)}">
      <span class="nm">${esc(personName(p))}</span>
      <span class="meta">${esc([p.birth_date && 'b. ' + fuzzy(p.birth_date), p.death_date && 'd. ' + fuzzy(p.death_date), p.living_computed ? 'living' : 'passed', p.status === 'merged' ? 'merged' : ''].filter(Boolean).join(' · '))}</span>
      <span class="spacer"></span>
      ${p.status === 'merged'
        ? '<button class="btn" data-a="unmerge">Undo merge</button>' + infoBtn(INFO_ADMIN.unmerge)
        : `<button class="btn" data-a="links">Links</button><select data-a="mergesel" aria-label="Merge ${esc(p.first_name)} into"><option value="">Merge into…</option>${opts}</select>${infoBtn(INFO_ADMIN.merge)}<button class="btn bad" data-a="retract">Take back</button>`}
    </div>`).join('') : '<p class="empty">Nobody here yet.</p>');
  $('#pSearch').oninput = () => { const pos = $('#pSearch').selectionStart; showPeople(); $('#pSearch').focus(); $('#pSearch').setSelectionRange(pos, pos); };
  document.querySelectorAll('.prow').forEach(row => {
    const id = row.dataset.id, p = PEOPLE.find(x => x.id === id);
    const confirmRow = (text, label, run) => {
      if (row.querySelector('.confirm')) return;
      const c = document.createElement('div'); c.className = 'confirm';
      c.innerHTML = `<span>${text}</span><button class="btn quiet">Cancel</button><button class="btn primary">${label}</button>`;
      row.appendChild(c);
      c.children[1].onclick = () => c.remove();
      c.children[2].onclick = run;
    };
    const ret = row.querySelector('[data-a="retract"]');
    if (ret) ret.onclick = () => confirmRow(`Take ${esc(personName(p))} off the public tree? Their links disappear with them. You can approve them again later from the Sheet.`, 'Take back', async () => {
      try { await api('admin_retract', { items: [{ kind: 'person', id }] }); toast('Taken off the tree.'); } catch (err) { toast(err.message); }
      loadPeople();
    });
    const lk = row.querySelector('[data-a="links"]');
    if (lk) lk.onclick = () => showLinks(row, p);
    const sel = row.querySelector('[data-a="mergesel"]');
    if (sel) sel.onchange = () => {
      const keep = sel.value; if (!keep || keep === id) { sel.value = ''; return; }
      const k = PEOPLE.find(x => x.id === keep);
      confirmRow(`Merge ${esc(personName(p))} into ${esc(personName(k))}? ${esc(personName(k))} stays; links, photos and corrections move over. You can undo it.`, 'Merge', async () => {
        try { await api('admin_merge', { keep, drop: id }); toast('Merged.'); } catch (err) { toast(err.message); }
        loadPeople();
      });
    };
    const un = row.querySelector('[data-a="unmerge"]');
    if (un) un.onclick = async () => { try { await api('admin_unmerge', { id }); toast('Merge undone.'); } catch (err) { toast(err.message); } loadPeople(); };
  });
}

// A person's approved links, each with Take back. For a wrong link a relative made (or a "Yes, link them" tapped by
// mistake): the link goes, both people stay.
function showLinks(row, p) {
  const open = row.querySelector('.links'); if (open) { open.remove(); return; }
  const name = id => { const x = personById(id); return x ? personName(x) : '(missing)'; };
  const rels = ((TREE && TREE.Relationships) || []).filter(r => r.status === 'approved' && (r.person_a === p.id || r.person_b === p.id));
  const kind = r => r.subtype && !['biological', 'unknown', 'married', 'partner'].includes(r.subtype) ? ` (${r.subtype})` : '';
  const text = r => r.type === 'partner' ? `Partners with ${name(r.person_a === p.id ? r.person_b : r.person_a)}${kind(r)}`
    : r.person_a === p.id ? `Parent of ${name(r.person_b)}${kind(r)}` : `Child of ${name(r.person_a)}${kind(r)}`;
  const box = document.createElement('div'); box.className = 'links';
  box.innerHTML = rels.length ? rels.map(r => `<div class="lrow" data-r="${esc(r.id)}"><span>${esc(text(r))}</span><button class="btn bad" data-a="rback">Take back</button></div>`).join('')
    : '<p class="empty">No links.</p>';
  row.appendChild(box);
  box.querySelectorAll('.lrow').forEach(lr => lr.querySelector('[data-a="rback"]').onclick = () => {
    if (lr.querySelector('.confirm')) return;
    const r = rels.find(x => x.id === lr.dataset.r);
    const c = document.createElement('div'); c.className = 'confirm';
    c.innerHTML = `<span>Remove the link "${esc(text(r))}"? Both people stay on the tree. You can approve it again later from the Sheet.</span><button class="btn quiet">Cancel</button><button class="btn primary">Take back</button>`;
    lr.appendChild(c);
    c.children[1].onclick = () => c.remove();
    c.children[2].onclick = async () => {
      try { await api('admin_retract', { items: [{ kind: 'relationship', id: r.id }] }); toast('Link taken back.'); } catch (err) { toast(err.message); }
      await loadPeople(); const again = document.querySelector(`.prow[data-id="${CSS.escape(p.id)}"]`); if (again) showLinks(again, personById(p.id));
    };
  });
}

/* =====================================================================
 * Tracker (Jonny, 2026-11-24): Visits, Activity and Contacts, from one admin_tracker call.
 * Visits are logged by the tree page (never in owner mode). Activity is built from what every row already records
 * (who sent it, when, and what became of it). Contacts are the emails relatives chose to share.
 * ===================================================================== */
let TRK = null, trkAt = 0;
async function loadTracker(force) {
  if (TRK && !force && Date.now() - trkAt < 60000) return TRK;
  TRK = await api('admin_tracker'); trkAt = Date.now();
  indexTracker(TRK);
  return TRK;
}
const dayKey = d => { const x = new Date(d); return isNaN(x) ? '' : `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const dayLabel = k => { const [y, m, d] = k.split('-').map(Number); const x = new Date(y, m - 1, d);
  const today = dayKey(Date.now()), yest = dayKey(Date.now() - 864e5);
  return k === today ? 'Today' : k === yest ? 'Yesterday' : x.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...(y !== new Date().getFullYear() ? { year: 'numeric' } : {}) }); };
const clock = d => new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
// Contributors keyed every useful way, owner's devices marked, unknown devices given steady names (Visitor 1, 2, …).
function indexTracker(t) {
  t.byId = new Map(t.contributors.map(c => [c.id, c]));
  t.byDevice = new Map(t.contributors.filter(c => c.device).map(c => [c.device, c]));
  t.visits = t.visits.map(([at, device, from, kind, browser, first]) => ({ at, device, from, kind, browser, first: first === 'yes' }))
    .filter(v => !isNaN(new Date(v.at)))
    .sort((a, b) => new Date(a.at) - new Date(b.at));
  const own = c => c && t.owner_person_id && c.person_id === t.owner_person_id;
  t.visits = t.visits.filter(v => !own(t.byDevice.get(v.device)));
  // Each device keeps whoever first brought it, even if later visits come from a bookmark.
  t.firstFrom = new Map(); t.visitorNo = new Map(); let n = 0;
  t.visits.forEach(v => {
    if (v.from && !t.firstFrom.has(v.device)) t.firstFrom.set(v.device, v.from);
    if (!t.byDevice.has(v.device) && !t.visitorNo.has(v.device)) t.visitorNo.set(v.device, ++n);
  });
}
function contributorLabel(c) {
  if (!c) return 'Someone';
  if (TRK.owner_person_id && c.person_id === TRK.owner_person_id) return 'You';
  const n = c.person_id && TRK.names[c.person_id];
  if (n) return n + (c.status === 'approved' ? '' : ' (not confirmed yet)');
  return c.display_name || 'A relative who hasn\'t said who they are';
}
function deviceLabel(device) {
  const c = TRK.byDevice.get(device);
  if (c && (c.person_id || c.display_name)) return contributorLabel(c);
  return 'Visitor ' + (TRK.visitorNo.get(device) || '?');
}
const linkLabel = from => from ? `${TRK.names[from] || 'someone no longer on the tree'}'s link` : 'plain link';
function trackerShell(el, html) {
  el.innerHTML = `<div class="trkbar"><span class="muted">Updated ${when(TRK.generated_at)}</span><button class="btn quiet" data-refresh>Refresh</button></div>` + html;
  el.querySelector('[data-refresh]').onclick = async e => {
    try { await working(e.target, 'Refreshing…', () => loadTracker(true)); } catch (err) { toast(err.message); return; }
    renderTracker(el.id);
  };
}
async function showTracker(which) {
  const el = $('#' + which);
  if (!TRK) el.innerHTML = '<p class="empty">Loading…</p>';
  try { await loadTracker(); }
  catch (err) { el.innerHTML = ''; el.appendChild(retryBox(err.message, () => showTracker(which))); return; }
  renderTracker(which);
}
function renderTracker(which) { ({ visits: renderVisits, activity: renderActivity, contacts: renderContacts })[which]($('#' + which)); }

/* ---------- Visits ---------- */
// Every visit is kept for good; the range only picks what the page counts and draws (Jonny asked, 2026-11-24).
const RANGES = [[7, '7 days'], [30, '30 days'], [90, '90 days'], [365, 'Year'], [0, 'All time']];
let visitShow = 40, visitRange = +(store.get('roots_visit_range') || 30);
const startOfDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d; };
// Bars: one per day up to a month, one per week up to four months, one per month past that.
function visitBuckets(fromT, now) {
  const spanDays = Math.round((startOfDay(now) - startOfDay(fromT)) / 864e5) + 1;
  const unit = spanDays <= 31 ? 'day' : spanDays <= 120 ? 'week' : 'month';
  const keyOf = t => {
    const d = startOfDay(t);
    if (unit === 'week') d.setDate(d.getDate() - d.getDay());
    if (unit === 'month') d.setDate(1);
    return dayKey(d);
  };
  const keys = []; const d = new Date(keyOf(fromT) + 'T00:00:00'); const last = keyOf(now);
  while (dayKey(d) <= last) { keys.push(dayKey(d)); if (unit === 'day') d.setDate(d.getDate() + 1); else if (unit === 'week') d.setDate(d.getDate() + 7); else d.setMonth(d.getMonth() + 1); }
  const label = k => { const [y, m, dd] = k.split('-').map(Number); const x = new Date(y, m - 1, dd);
    return unit === 'day' ? dayLabel(k) : unit === 'week' ? 'Week of ' + x.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : x.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); };
  return { unit, keys, keyOf, label };
}
function renderVisits(el) {
  const all = TRK.visits, now = Date.now();
  const fromT = visitRange ? startOfDay(now - (visitRange - 1) * 864e5).getTime() : (all.length ? new Date(all[0].at).getTime() : now);
  const V = all.filter(v => new Date(v.at) >= fromT);
  const rangeWord = visitRange ? `in the last ${RANGES.find(r => r[0] === visitRange)[1].toLowerCase().replace('year', '12 months')}` : 'since the tracker started';
  const recent = V;
  const today = dayKey(now);
  const devs = new Set(recent.map(v => v.device));
  const newDevs = new Set(recent.filter(v => v.first).map(v => v.device));
  const tiles = [
    [recent.length, recent.length === 1 ? 'visit' : 'visits', rangeWord],
    [devs.size, devs.size === 1 ? 'device' : 'devices', 'phones and computers, ' + rangeWord.replace(/^in the /, '')],
    [newDevs.size, 'first-timers', 'opened the tree for the first time'],
    [all.filter(v => dayKey(v.at) === today).length, 'today', 'visits so far today']
  ];
  // One series, so one color and no legend; the heading names it.
  const B = visitBuckets(fromT, now);
  const perDay = new Map(B.keys.map(k => [k, 0]));
  recent.forEach(v => { const k = B.keyOf(v.at); if (perDay.has(k)) perDay.set(k, perDay.get(k) + 1); });
  const max = Math.max(1, ...perDay.values());
  const top = max <= 4 ? max : Math.ceil(max / 5) * 5;
  const days = B.keys;
  const bars = days.map(k => {
    const n = perDay.get(k), h = n ? Math.max(3, Math.round(n / top * 100)) : 0;
    return `<div class="vcol" tabindex="0" data-tip="${esc0(B.label(k))}: ${plural(n, 'visit')}"><i style="height:${h}%"></i></div>`;
  }).join('');
  const per = { day: 'day', week: 'week', month: 'month' }[B.unit];
  const lastLabel = B.unit === 'day' ? 'Today' : B.unit === 'week' ? 'This week' : 'This month';
  // Whose link brought them: by each device's first link.
  const senders = new Map();
  const devicesAll = [...new Set(V.map(v => v.device))];   // devices seen in this range
  devicesAll.forEach(d => {
    const from = TRK.firstFrom.get(d) || '';
    const s = senders.get(from) || { devices: 0, visits: 0, joined: 0 };
    s.devices++; s.visits += V.filter(v => v.device === d).length;
    const c = TRK.byDevice.get(d); if (c && c.person_id) s.joined++;
    senders.set(from, s);
  });
  const senderRows = [...senders.entries()].sort((a, b) => b[1].devices - a[1].devices || (a[0] ? 0 : 1) - (b[0] ? 0 : 1)).map(([from, s]) =>
    `<tr><td>${esc0(from ? TRK.names[from] || 'Someone no longer on the tree' : 'Plain link (no sender)')}</td><td class="num">${s.devices}</td><td class="num">${s.visits}</td><td class="num">${s.joined}</td></tr>`).join('');
  const log = [...V].reverse();
  let lastDay = '';
  const logRows = log.slice(0, visitShow).map(v => {
    const k = dayKey(v.at), head = k !== lastDay ? `<li class="dayhead">${esc0(dayLabel(k))}</li>` : ''; lastDay = k;
    return head + `<li class="vrow"><span class="t">${esc0(clock(v.at))}</span><span class="w"><b>${esc0(deviceLabel(v.device))}</b>${v.first ? ' <span class="new">first visit</span>' : ''}
      <small>${esc0([linkLabel(v.from), v.browser || v.kind].filter(Boolean).join(' · '))}</small></span></li>`;
  }).join('');
  const chips = `<div class="ranges" role="group" aria-label="Show visits from">${RANGES.map(([d, w]) => `<button class="btn${d === visitRange ? ' on' : ''}" data-range="${d}" aria-pressed="${d === visitRange}">${w}</button>`).join('')}</div>`;
  trackerShell(el, !all.length ? `<p class="empty">No visits logged yet. They start the first time someone opens the tree after this update. Your own devices aren't counted.</p>` : chips + (!V.length ? `<p class="empty">No visits ${esc0(rangeWord)}. Pick a longer range.</p>` : `
    <div class="tiles">${tiles.map(([n, w, sub]) => `<div class="tile"><b>${n}</b><span>${w}</span><small>${sub}</small></div>`).join('')}</div>
    <section class="tcard"><h2>Visits per ${per}, ${esc0(rangeWord.replace(/^in the /, ''))}</h2>
      <div class="vchart" role="img" aria-label="Visits per ${per} ${esc0(rangeWord)}, at most ${max} in a ${per}"><div class="vaxis"><span>${top}</span><span>0</span></div><div class="vbars">${bars}</div></div>
      <div class="vdates"><span>${esc0(B.label(days[0]))}</span><span>${lastLabel}</span></div>
      <p class="tip" id="vTip" aria-live="polite"></p></section>
    <section class="tcard"><h2>Whose link brought them</h2>
      <p class="muted">Every link from Send carries the sender. A device counts for whoever first brought it.</p>
      <table class="ttable"><thead><tr><th>Sender</th><th class="num">Devices</th><th class="num">Visits</th><th class="num">Said who they are</th></tr></thead><tbody>${senderRows}</tbody></table></section>
    <section class="tcard"><h2>Every visit</h2>
      <p class="muted">A visit is opening the tree. Opening it again within 30 minutes on the same device counts once. Your own devices aren't counted.</p>
      <ul class="vlog">${logRows}</ul>
      ${log.length > visitShow ? `<button class="btn" id="vMore">Show ${Math.min(40, log.length - visitShow)} more</button>` : ''}</section>`));
  el.querySelectorAll('[data-range]').forEach(b => b.onclick = () => { visitRange = +b.dataset.range; visitShow = 40; store.set('roots_visit_range', String(visitRange)); renderVisits(el); });
  const tip = el.querySelector('#vTip');
  el.querySelectorAll('.vcol').forEach(c => {
    const show = () => { tip.textContent = c.dataset.tip; el.querySelectorAll('.vcol.on').forEach(x => x.classList.remove('on')); c.classList.add('on'); };
    c.onmouseenter = show; c.onfocus = show; c.onclick = show;
  });
  const more = el.querySelector('#vMore'); if (more) more.onclick = () => { visitShow += 40; renderVisits(el); };
}

/* ---------- Activity ---------- */
const ACT_WORDS = { People: ['person', 'people'], Relationships: ['link', 'links'], Suggestions: ['change', 'changes'],
  Photos: ['photo or document', 'photos and documents'], PhotoTags: ['photo tag', 'photo tags'] };
const STATUS_WORDS = [['approved', 'approved'], ['pending', 'waiting'], ['rejected', 'declined'], ['withdrawn', 'taken back'], ['merged', 'merged']];
function renderActivity(el) {
  const mine = $('#actMine') ? $('#actMine').checked : false;
  const groups = new Map();
  TRK.activity.forEach(([by, at, table, status]) => {
    if (!at) return;
    const c = TRK.byId.get(by);
    const isOwner = by && c && TRK.owner_person_id && c.person_id === TRK.owner_person_id;
    if (isOwner && !mine) return;
    const k = dayKey(at) + '|' + (by || '');
    const g = groups.get(k) || { day: dayKey(at), by, last: at, kinds: {}, status: {} };
    if (at > g.last) g.last = at;
    g.kinds[table] = (g.kinds[table] || 0) + 1;
    if (table !== 'Claims') g.status[status] = (g.status[status] || 0) + 1;
    groups.set(k, g);
  });
  const list = [...groups.values()].sort((a, b) => b.day.localeCompare(a.day) || b.last.localeCompare(a.last));
  let lastDay = '';
  const rows = list.map(g => {
    const head = g.day !== lastDay ? `<li class="dayhead">${esc0(dayLabel(g.day))}</li>` : ''; lastDay = g.day;
    const what = Object.keys(ACT_WORDS).filter(t => g.kinds[t]).map(t => `${g.kinds[t]} ${ACT_WORDS[t][g.kinds[t] === 1 ? 0 : 1]}`);
    const sent = what.length ? 'sent ' + what.join(', ') : '';
    const claim = g.kinds.Claims ? 'said who they are' : '';
    const st = STATUS_WORDS.filter(([s]) => g.status[s]).map(([s, w]) => `<span class="st ${s}">${g.status[s]} ${w}</span>`).join('');
    return head + `<li class="arow"><b>${esc0(contributorLabel(TRK.byId.get(g.by)))}</b> <span>${esc0([sent, claim].filter(Boolean).join('; '))}.</span>${st ? `<span class="sts">${st}</span>` : ''}</li>`;
  }).join('');
  trackerShell(el, `
    <section class="tcard"><h2>Who added what</h2>
      <p class="muted">One line per relative per day, counted from the tree itself, back to the start. Each line says what became of it.</p>
      <label class="chk"><input type="checkbox" id="actMine"${mine ? ' checked' : ''}> Include what you added yourself</label>
      ${rows ? `<ul class="vlog">${rows}</ul>` : '<p class="empty">Nothing from relatives yet.</p>'}</section>`);
  el.querySelector('#actMine').onchange = () => renderActivity(el);
}

/* ---------- Contacts ---------- */
function contactList() {
  // One row per person (someone on two phones is one row); a device that never said who it is stands alone.
  const rows = new Map();
  TRK.contributors.filter(c => c.email).forEach(c => {
    if (TRK.owner_person_id && c.person_id === TRK.owner_person_id) return;
    const k = c.person_id || c.id;
    const r = rows.get(k) || { key: k, name: contributorLabel(c), status: c.status, emails: [], since: c.email_given_at };
    if (!r.emails.includes(c.email)) r.emails.push(c.email);
    if (c.email_given_at < r.since) r.since = c.email_given_at;
    if (c.status === 'approved') { r.status = 'approved'; r.name = contributorLabel(c); }
    rows.set(k, r);
  });
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}
// One person: plain To. More than one: BCC, so relatives don't get each other's addresses.
// Addresses stay readable (some mail apps choke on %40); anything unusual is escaped.
const mailEnc = e => String(e).replace(/[^A-Za-z0-9@._+-]/g, c => encodeURIComponent(c));
const contactHref = to => to.length === 1 ? 'mailto:' + mailEnc(to[0]) : 'mailto:?bcc=' + to.map(mailEnc).join(',');
function renderContacts(el) {
  const list = contactList();
  trackerShell(el, `
    <section class="tcard"><h2>Contacts</h2>
      <p class="muted">Relatives who shared an email so you can send news or ask about something they added. They can change or remove it from their own card. Group emails go out as BCC, so nobody sees anyone else's address.</p>
      ${!list.length ? '<p class="empty">Nobody has shared an email yet. The tree asks right after someone says who they are.</p>' : `
      <div class="cbar"><label class="chk"><input type="checkbox" id="cAll" checked> Everyone (${list.length})</label><span class="spacer"></span>
        <button class="btn primary" id="cWrite">Write email</button><button class="btn" id="cCopy">Copy addresses</button></div>
      <p class="err" id="cErr" hidden></p>
      <ul class="clist">${list.map((r, i) => `<li><label class="chk"><input type="checkbox" data-c="${i}" checked>
        <span><b>${esc0(r.name)}</b><small>${r.emails.map(esc0).join(', ')} · shared ${esc0(when(r.since))}</small></span></label>
        <a class="btn quiet" href="${esc0(contactHref(r.emails))}">Email</a></li>`).join('')}</ul>`}
    </section>`);
  if (!list.length) return;
  const boxes = () => [...el.querySelectorAll('[data-c]')];
  const picked = () => boxes().filter(b => b.checked).flatMap(b => list[+b.dataset.c].emails);
  const sync = () => { const n = boxes().filter(b => b.checked).length; $('#cAll').checked = n === list.length; $('#cAll').indeterminate = n > 0 && n < list.length;
    $('#cWrite').textContent = n === list.length ? 'Write email to everyone' : n ? `Write email to ${n}` : 'Write email'; };
  $('#cAll').onchange = () => { boxes().forEach(b => { b.checked = $('#cAll').checked; }); sync(); };
  boxes().forEach(b => { b.onchange = sync; });
  const err = m => { $('#cErr').textContent = m; $('#cErr').hidden = !m; };
  $('#cWrite').onclick = () => {
    const to = picked(); err('');
    if (!to.length) { err('Tick at least one person.'); return; }
    const href = contactHref(to);
    if (href.length > 1900) { err('Too many addresses for your mail app to take from a link. Tap Copy addresses and paste them into BCC.'); return; }
    location.href = href;
  };
  $('#cCopy').onclick = async () => {
    const to = picked(); err('');
    if (!to.length) { err('Tick at least one person.'); return; }
    try { await navigator.clipboard.writeText(to.join(', ')); toast(`${plural(to.length, 'address', 'addresses')} copied. Paste them into BCC.`); }
    catch (e) { err('Couldn\'t copy. Here they are: ' + to.join(', ')); }
  };
  sync();
}

/* ---------- start ---------- */
// Forget the saved key only when the server rejects it. A busy or slow server keeps it, and Unlock retries.
if (KEY) {
  $('#gate').hidden = false;
  working($('#gateForm button[type="submit"]'), 'Unlocking…', () => unlock(KEY)).catch(err => {
    KEY = '';
    if (err.message === KEY_REJECTED) { store.del('roots_admin_key'); gateError(err); return; }
    gateError(new Error(err.message + ' Your key is still saved; tap Unlock when ready.'));
  });
}

/* =====================================================================
 * Info buttons (2026-11-22): a small circled "i" that explains a control in a few lines.
 * Tap or click opens it, a tap anywhere else closes it, and with a mouse it also opens on hover.
 * Anything with data-info works the same way, so a tag on a card ("Unconfirmed") can explain itself.
 * Text is ours, never a relative's: each line of the text becomes its own paragraph, and **bold** is the only markup.
 * ===================================================================== */
const INFO_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 9v5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="10" cy="6.1" r="1.05" fill="currentColor"/></svg>';
const infoAttr = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// The tags on cards (the card is itself a button, so the tag answers taps and hover but isn't a second tab stop).
const TAG_INFO = typeof OWNER_NAME === 'undefined' ? {} : {
  pending: infoAttr(`Something you added. Only you see it until ${OWNER_NAME} confirms it.\nTap the card to change it or take it back.`),
  edit: infoAttr(`You changed something about this person. You see your version; everyone else sees the old one until ${OWNER_NAME} confirms it.\nTap the card to change it again or take it back.`)
};
function infoBtn(text, label = 'What this means') {
  const t = infoAttr(text);
  return `<button type="button" class="infobtn" data-info="${t}" aria-label="${label}" aria-expanded="false">${INFO_ICON}</button>`;
}
const infoPop = document.createElement('div');
infoPop.className = 'infopop'; infoPop.setAttribute('role', 'tooltip'); infoPop.id = 'infoPop'; infoPop.hidden = true;
document.body.appendChild(infoPop);
let infoFor = null, infoPinned = false;
function infoHTML(text) {
  return text.split('\n').filter(s => s.trim()).map(s => '<p>' + s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>') + '</p>').join('');
}
function showInfo(el, pinned) {
  if (infoFor && infoFor !== el) infoFor.setAttribute('aria-expanded', 'false');
  infoFor = el; infoPinned = !!pinned;
  infoPop.innerHTML = infoHTML(el.dataset.info || '');
  infoPop.hidden = false;
  el.setAttribute('aria-expanded', 'true'); el.setAttribute('aria-describedby', 'infoPop');
  // Below the button when there's room, else above; kept inside the screen.
  const r = el.getBoundingClientRect(), vw = innerWidth, vh = innerHeight;
  const w = Math.min(320, vw - 24); infoPop.style.width = w + 'px';
  const ph = infoPop.offsetHeight;
  const left = Math.max(12, Math.min(vw - w - 12, r.left + r.width / 2 - w / 2));
  const top = r.bottom + 8 + ph <= vh - 8 ? r.bottom + 8 : Math.max(8, r.top - 8 - ph);
  infoPop.style.left = left + 'px'; infoPop.style.top = top + 'px';
}
function hideInfo() {
  if (infoFor) { infoFor.setAttribute('aria-expanded', 'false'); infoFor.removeAttribute('aria-describedby'); }
  infoFor = null; infoPinned = false; infoPop.hidden = true;
}
// Capture phase, so a tap on an info target never also opens the card or presses the button it sits beside.
document.addEventListener('click', e => {
  const t = e.target.closest && e.target.closest('[data-info]');
  if (t) { e.preventDefault(); e.stopPropagation(); if (infoFor === t && infoPinned) hideInfo(); else showInfo(t, true); return; }
  if (infoFor && !infoPop.contains(e.target)) hideInfo();
}, true);
document.addEventListener('pointerdown', e => { if (infoFor && !infoPop.contains(e.target) && !(e.target.closest && e.target.closest('[data-info]'))) hideInfo(); }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && infoFor) { const f = infoFor; hideInfo(); f.focus(); } });
addEventListener('resize', () => { if (infoFor) hideInfo(); });
document.addEventListener('scroll', () => { if (infoFor) hideInfo(); }, true);
if (matchMedia('(hover: hover)').matches) {
  document.addEventListener('mouseover', e => { const t = e.target.closest && e.target.closest('[data-info]'); if (t && !infoPinned && infoFor !== t) showInfo(t, false); });
  document.addEventListener('mouseout', e => {
    if (!infoFor || infoPinned) return;
    const to = e.relatedTarget;
    if (to && (infoFor.contains(to) || infoPop.contains(to))) return;
    if (e.target.closest && (e.target.closest('[data-info]') === infoFor || infoPop.contains(e.target))) hideInfo();
  });
}

/* ---- Stay current. GitHub Pages lets browsers keep every file for about 10 minutes, so right after a deploy a
 * phone can run yesterday's page. On load (and when the page comes back to the front) ask for version.json, which
 * is never cached; when it's newer, refresh this page's files once and reload. Never mid-form: a busy page waits
 * for its next check. One reload per version, so a slow CDN can't cause a loop. ---- */
(function () {
  const BUILD = 'e2e37c9eba';
  let last = 0;
  async function check() {
    if (Date.now() - last < 60000) return;
    last = Date.now();
    let v;
    try { v = (await (await fetch('version.json', { cache: 'no-store' })).json()).v; } catch (e) { return; }
    if (!v || v === BUILD) return;
    if (typeof window.ROOTS_BUSY === 'function' && window.ROOTS_BUSY()) { last = 0; return; }
    let tried = null; try { tried = sessionStorage.getItem('roots_fresh'); } catch (e) {}
    if (tried === v) return;
    try { sessionStorage.setItem('roots_fresh', v); } catch (e) {}
    const files = [...document.querySelectorAll('script[src], link[rel="stylesheet"][href]')]
      .map(el => el.src || el.href).filter(u => u.startsWith(location.origin));
    await Promise.all([location.href, ...files].map(u => fetch(u, { cache: 'reload' }).catch(() => {})));
    location.reload();
  }
  window.ROOTS_CHECK_VERSION = () => { last = 0; return check(); };
  check();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
})();
