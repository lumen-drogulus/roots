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
  is_placeholder: 'Unknown placeholder', subtype: 'Kind of link', start_date: 'Start', end_date: 'End' };
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
$('#btnLock').onclick = () => { store.del('roots_admin_key'); location.reload(); };

/* ---------- tabs ---------- */
function tab(which) {
  $('#tabQueue').setAttribute('aria-selected', which === 'queue'); $('#tabPeople').setAttribute('aria-selected', which === 'people');
  $('#queue').hidden = which !== 'queue'; $('#people').hidden = which !== 'people';
  if (which === 'people') loadPeople(); else loadQueue();
}
$('#tabQueue').onclick = () => tab('queue');
$('#tabPeople').onclick = () => tab('people');

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
function describe(it) {
  const r = it.row;
  switch (it.kind) {
    case 'person': {
      const facts = [r.living && `Living: ${r.living}`, r.birth_date && `Born ${fuzzy(r.birth_date)}${r.birth_place ? ', ' + r.birth_place : ''}`,
        r.death_date && `Died ${fuzzy(r.death_date)}${r.death_place ? ', ' + r.death_place : ''}`, r.source && `Source: ${r.source}`].filter(Boolean);
      const dups = (it.possible_duplicates || []).map(d => `<span>Might be <b>${esc(d.label)}</b>${d.birth_date ? ' (born ' + esc(fuzzy(d.birth_date)) + ')' : ''}</span><button class="btn" data-merge="${esc(d.id)}">Same person: merge</button>`).join('');
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
        detail: `<span class="change"><s>${esc(showVal(r.field, it.current_value))}</s> → <b>${esc(showVal(r.field, it.proposed))}</b></span>${r.source ? '<br>Source: ' + esc(r.source) : ''}` };
    case 'photo': {
      const tagged = (it.tagged || []).map(t => t.name).join(', ') || 'nobody tagged';
      const warn = (it.living_tagged || []).length ? `<div class="livingwarn">Shows ${it.living_tagged.length} living ${it.living_tagged.length === 1 ? 'person' : 'people'}: ${esc(it.living_tagged.map(p => p.name).join(', '))}. Approving makes this photo public.</div>` : '';
      return { label: 'New photo', what: esc(r.caption || 'Photo'), detail: `Tagged: ${esc(tagged)}${it.thumbnail ? `<img class="thumb" src="${it.thumbnail}" alt="Photo preview">` : ''}${warn}` };
    }
    case 'tag':
      return { label: 'Photo tag', what: `${esc(it.person_label)} tagged in a photo`, detail: it.living ? '<div class="livingwarn">This person is living. Approving shows them in a public photo.</div>' : '' };
    case 'claim':
      return { label: 'Who they are', what: `${esc(r.display_name || 'A relative')} says they are ${esc(it.person_label)}`, detail: 'Approve if that sounds right. Until then their additions show no name.' };
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
        ? '<button class="btn" data-a="unmerge">Undo merge</button>'
        : `<button class="btn" data-a="links">Links</button><select data-a="mergesel" aria-label="Merge ${esc(p.first_name)} into"><option value="">Merge into…</option>${opts}</select><button class="btn bad" data-a="retract">Take back</button>`}
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

/* ---- Stay current. GitHub Pages lets browsers keep every file for about 10 minutes, so right after a deploy a
 * phone can run yesterday's page. On load (and when the page comes back to the front) ask for version.json, which
 * is never cached; when it's newer, refresh this page's files once and reload. Never mid-form: a busy page waits
 * for its next check. One reload per version, so a slow CDN can't cause a loop. ---- */
(function () {
  const BUILD = '355abb614c';
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
