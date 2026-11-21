/* =====================================================================
 * Pop-out person panel
 * ===================================================================== */
const panel = $('#panel'), scrim = $('#scrim');
function openPanel(html) { panel.innerHTML = html; panel.classList.add('on'); if (innerWidth <= 700) scrim.classList.add('on'); }
function closePanel() { panel.classList.remove('on'); scrim.classList.remove('on'); formDirty = false; currentSave = null; if (STATE.selected) { STATE.selected = null; refreshCards(); } }
let formDirty = false, currentSave = null, sessionAdded = [], saving = false;
function guardClose(onDiscard) {
  if (saving) return;
  if (panel.classList.contains('on') && formDirty && currentSave) {
    if (panel.querySelector('.guard')) return;
    const g = document.createElement('div');
    g.className = 'guard';
    g.innerHTML = '<b>Save what you typed?</b><button class="iconbtn" id="gDiscard">Discard</button><button class="iconbtn" id="gKeep">Keep editing</button><button class="primary" id="gSave">Save</button>';
    panel.querySelector('.foot').prepend(g);
    $('#gDiscard').onclick = () => { clearDraft(); formDirty = false; if (onDiscard) onDiscard(); else { closePanel(); batchThanks(); } };
    $('#gKeep').onclick = () => g.remove();
    $('#gSave').onclick = () => { g.remove(); currentSave(); };
    return;
  }
  if (onDiscard && panel.classList.contains('on') && currentSave) { onDiscard(); return; }
  closePanel(); batchThanks();
}
scrim.onclick = () => guardClose();
function refreshCards() { for (const [id, r] of live) if (r.node && r.node.kind === 'person') updateNodeEl(r, r.node); }

function photoURL(fileId, w) { return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w${w}`; }

/* "Borders (at birth) · Smith, married to John Smith, divorced · Ruzicka, married to Jonathon Ruzicka".
   A married name is tied to a spouse in the tree when it matches that spouse's last name. */
function lastNameHistory(p) {
  const married = p.married || [];
  if (!married.length) return '';
  const used = new Set();
  const spouseFor = nm => partnersOf(p.id).find(x => !used.has(x.id) && [P(x.id).last, P(x.id).birthSurname].some(s => s && sameName(s, nm)));
  const parts = p.birthSurname ? [`${esc(p.birthSurname)} <span class="muted">at birth</span>`] : [];
  married.forEach(nm => {
    const sp = spouseFor(nm);
    if (!sp) { parts.push(esc(nm)); return; }
    used.add(sp.id);
    const how = sp.sub === 'divorced' ? ', divorced' : sp.sub === 'widowed' ? ', widowed' : '';
    parts.push(`${esc(nm)} <span class="muted">from marriage to <a href="#" data-goto="${esc(sp.id)}">${esc(displayName(P(sp.id)))}</a>${how}</span>`);
  });
  return parts.join('<br>');
}
function openPerson(id) {
  STATE.selected = id; refreshCards();
  const p = P(id), living = isLiving(p), rel = relation(id), twice = connectedTwice(id);
  const name = p.placeholder ? 'Unknown' : displayName(p);
  const full = living || p.placeholder ? name : [p.first, p.nicknames ? `"${p.nicknames}"` : '', p.middle, p.last].filter(Boolean).join(' ');
  let body = '';
  if (p.placeholder) {
    body += `<p class="story">Nobody has named this person yet. If you know who ${rel ? 'this ' + rel.toLowerCase() : 'they'} ${living ? 'is' : 'was'}, fill in what you know. Even a first name helps.</p>`;
  } else if (living && !p.pending) {
    body += id === STATE.viewer
      ? `<div class="private">${ICON.lock}<span>Relatives see only your name. Your dates, places and stories stay private. ${OWNER_NAME} can see everything.</span></div>`
      : `<div class="private">${ICON.lock}<span>${esc(p.first)} is living, so only their name shows here. Dates, places and stories stay private while they're alive.</span></div>`;
  } else {
    const facts = [];
    if (p.bornRaw || p.bornPlace) facts.push(`<dt>Born</dt><dd>${esc([fuzzyLong(p.bornRaw), p.bornPlace].filter(Boolean).join(', '))}</dd>`);
    if (p.diedRaw || p.diedPlace) facts.push(`<dt>Died</dt><dd>${esc([fuzzyLong(p.diedRaw), p.diedPlace].filter(Boolean).join(', '))}</dd>`);
    const hist = lastNameHistory(p);
    if (hist) facts.push(`<dt>Last names</dt><dd>${hist}</dd>`);
    if (facts.length) body += `<dl class="facts">${facts.join('')}</dl>`;
    if (p.notes) body += `<p class="story">${esc(p.notes)}</p>`;
    if (!facts.length && !p.notes && !p.pending) body += `<p class="story muted">Nothing written about ${esc(p.first)} yet. If you remember something, tap Edit and add it.</p>`;
  }
  const kindWords = { step: 'step-parent', adopted: 'adoptive parent', foster: 'foster parent' };
  const kinLines = [
    ...parentsOf(id).filter(q => kindWords[G.pcSub.get(q + '>' + id)]).map(q => `${esc(displayName(P(q)))} is ${esc(p.first || 'their')}'s ${kindWords[G.pcSub.get(q + '>' + id)]}.`),
    ...childrenOf(id).filter(c => kindWords[G.pcSub.get(id + '>' + c)]).map(c => `${esc(p.first || 'They')} is ${esc(displayName(P(c)))}'s ${kindWords[G.pcSub.get(id + '>' + c)]}.`)
  ];
  if (kinLines.length && !p.placeholder) body += `<p class="kinline">${kinLines.join(' ')}</p>`;
  if (twice) body += `<div class="twicebox">${ICON.rings}<span>Related twice: ${esc(p.first)} and ${esc(P(twice.partner).first)} both descend from ${esc(displayName(P(twice.ancestor)))}.</span></div>`;
  if (p.pending) body += `<div class="private"><span>You added ${esc(p.first || 'this')}. ${OWNER_NAME} hasn't confirmed it yet, so only you can see it.</span></div>`;
  if (!p.placeholder && !p.pending) {
    const ph = PHOTOS.get(id) || [];
    const tiles = ph.slice(0, 6).map(f => `<a class="photo real" href="${photoURL(f.file_id, 1600)}" target="_blank" rel="noopener" title="${esc(f.caption || 'Photo')}"><img src="${photoURL(f.file_id, 400)}" alt="${esc(f.caption || 'Photo of ' + p.first)}" loading="lazy"></a>`).join('');
    body += `<div><div class="label">Photos</div><div class="photos">${tiles}<button class="photo add" id="pAddPhoto">Add a photo</button></div></div>`;
  }
  if (!p.placeholder && !living && p.addedBy) body += `<p class="prov">Added by ${esc(p.addedBy)}${p.source ? ' · Source: ' + esc(p.source) : ''}</p>`;
  const isFocus = id === STATE.focus;
  const canClaim = !STATE.viewer && !p.placeholder && living;
  openPanel(`
    <div class="head"><div class="av"${living ? '' : ' style="background:#F1E7CF;color:#7A5D1E"'}>${initials(p)}</div>
      <div><h2>${esc(full)}</h2><div class="sub">${esc([rel, years(p)].filter(Boolean).join(' · '))}</div></div>
      <button class="x" id="pClose" aria-label="Close">${ICON.close}</button></div>
    <div class="body">${body}</div>
    <div class="foot">
      ${isFocus ? '' : `<button class="primary" id="pCenter">Center the tree on ${esc(p.placeholder ? 'them' : p.first)}</button>`}
      <button class="iconbtn" id="pAdd">Add a relative</button>
      ${p.pending ? '' : `<button class="iconbtn" id="pEdit">${p.placeholder ? 'Fill in' : 'Edit'}</button>`}
      ${canClaim ? '<button class="iconbtn" id="pMe">This is me</button>' : ''}
    </div>`);
  $('#pClose').onclick = closePanel;
  if (!isFocus) $('#pCenter').onclick = () => { closePanel(); STATE.focus = id; render(); };
  $('#pAdd').onclick = () => openAdd(id);
  if ($('#pEdit')) $('#pEdit').onclick = () => openEdit(id);
  if ($('#pMe')) $('#pMe').onclick = () => claimMe(id);
  const ap = $('#pAddPhoto'); if (ap) ap.onclick = () => toast('Adding photos is coming soon.');
}

/* =====================================================================
 * Forms: add, edit, "this is me"
 * ===================================================================== */
const myName = () => store.get('roots_display_name') || '';
function whoField() {
  if (STATE.viewer || ADMIN_KEY) return '';
  return `<div class="field"><label for="fWho">Your name, so ${OWNER_NAME} knows who sent this</label><input id="fWho" value="${esc(myName())}" autocomplete="name" placeholder="For example: Linda, Carol's cousin"></div>`;
}
function livingSeg(v) {
  return `<div class="field"><span class="lab">Are they living?</span><div class="seg" id="fLiving">
    <button type="button" data-v="living" aria-pressed="${v === 'living'}">Living</button><button type="button" data-v="deceased" aria-pressed="${v === 'deceased'}">Passed away</button><button type="button" data-v="unknown" aria-pressed="${v === 'unknown'}">Not sure</button></div></div>`;
}
/* Names are stored as birth_surname plus a list of later last names, oldest first; the last one is the name they go by now.
   Someone who went back to their birth name has it again at the end of the list. No backend change needed. */
const sameName = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
function namesToData(now, birth, othersIn) {
  const others = (Array.isArray(othersIn) ? othersIn : (othersIn || '').split(',')).map(x => x.trim()).filter(Boolean).filter(x => !sameName(x, now));
  if (!birth) return others.length ? { birth_surname: '', married_names: [...others, now].filter(Boolean) } : { birth_surname: now, married_names: [] };
  if (!now) return { birth_surname: birth, married_names: others };
  if (sameName(now, birth) && !others.length) return { birth_surname: birth, married_names: [] };
  return { birth_surname: birth, married_names: [...others, now] };
}
function namesFromPerson(p) {
  const married = p.married || [];
  return { last: p.last || '', birthName: married.length ? (p.birthSurname || '') : '', otherNames: married.slice(0, -1) };
}
const PC_KINDS = [['biological', 'Birth'], ['step', 'Step'], ['adopted', 'Adoptive'], ['foster', 'Foster']];
/* In the edit form: one row per confirmed parent link, so a parent can be marked step, adoptive or foster later.
   For living people the server shows adoptive and foster links as plain "parent"; that shows here as "Not shown". */
const PT_KINDS = [['married', 'Married'], ['partner', 'Partners'], ['divorced', 'Divorced'], ['widowed', 'Widowed']];
/* In the edit form: each confirmed partnership with whether it's still going. */
function partnerKindsHTML(id) {
  const rows = partnersOf(id).filter(x => PT_ID.has([id, x.id].sort().join('~')) && !P(x.id).placeholder).map(x => {
    const cur = PT_KINDS.some(([v]) => v === x.sub) ? x.sub : 'married';
    return `<div class="field"><label for="fPt_${esc(x.id)}">${esc(displayName(P(x.id)))}</label><select id="fPt_${esc(x.id)}" data-partner="${esc(x.id)}" data-was="${esc(x.sub || '')}">${PT_KINDS.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`).join('')}</select></div>`;
  });
  return rows.length ? `<div class="label">Marriages and partners</div><div class="row2">${rows.join('')}</div>` : '';
}
function parentKindsHTML(id) {
  const rows = parentsOf(id).filter(q => PC_ID.has(q + '>' + id) && !P(q).placeholder).map(q => {
    const cur = G.pcSub.get(q + '>' + id) || 'biological';
    const known = PC_KINDS.some(([v]) => v === cur);
    const opts = (known ? '' : `<option value="" selected>Keep as is</option>`) +
      PC_KINDS.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l} parent</option>`).join('');
    return `<div class="field"><label for="fPk_${esc(q)}">${esc(displayName(P(q)))}</label><select id="fPk_${esc(q)}" data-parent="${esc(q)}" data-was="${known ? cur : ''}">${opts}</select></div>`;
  });
  const masked = parentsOf(id).some(q => PC_ID.has(q + '>' + id) && !PC_KINDS.some(([v]) => v === G.pcSub.get(q + '>' + id)));
  return rows.length ? `<div class="label">${esc(P(id).first || 'Their')}'s parents</div><div class="row2">${rows.join('')}</div>` +
    (masked ? '<p class="hint">"Keep as is": while someone is living, whether a parent is by birth, adoption or fostering stays private, so it isn\'t shown here.</p>' : '') : '';
}
const nameRowHTML = (v = '') => `<div class="namerow"><input class="fOtherName" value="${esc(v)}" autocomplete="off" aria-label="Earlier last name"><button type="button" class="rm" aria-label="Remove this last name">×</button></div>`;
function addNameRow(v = '', focus = true) {
  const list = $('#fOtherList'); if (!list) return;
  list.insertAdjacentHTML('beforeend', nameRowHTML(v));
  const row = list.lastElementChild;
  row.querySelector('.rm').onclick = () => { row.remove(); formDirty = true; };
  if (focus) row.querySelector('input').focus();
}
function fieldsHTML(p, livingV, opts = {}) {
  const nm = namesFromPerson(p);
  const showMore = !!(nm.birthName || nm.otherNames.length);
  return `
    <div class="row2"><div class="field"><label for="fFirst">First name</label><input id="fFirst" value="${esc(p.first || '')}" autocomplete="off"><div class="dups" id="dups"></div></div>
      <div class="field"><label for="fMiddle">Middle name</label><input id="fMiddle" value="${esc(p.middle || '')}" autocomplete="off"></div></div>
    <div class="row2"><div class="field"><label for="fLast">Last name now</label><input id="fLast" value="${esc(nm.last)}" autocomplete="off" placeholder="Or their last one"></div>
      <div class="field"><label for="fNick">Goes by</label><input id="fNick" value="${esc(p.nicknames || '')}" autocomplete="off" placeholder="Bob, Aunt Dee"></div></div>
    <button type="button" class="morelink" id="fNamesBtn"${showMore ? ' hidden' : ''}>+ Maiden name or earlier last names</button>
    <div class="namesmore" id="fNamesMore"${showMore ? '' : ' hidden'}>
      <div class="field"><label for="fBirthName">Last name at birth</label><input id="fBirthName" value="${esc(nm.birthName)}" autocomplete="off" placeholder="If different from now"></div>
      <div class="field"><span class="lab">Last names in between, oldest first</span><div id="fOtherList">${nm.otherNames.map(nameRowHTML).join('')}</div>
        <button type="button" class="morelink" id="fAddName">+ Add a last name</button>
        <p class="hint">One per marriage or change. A married name that matches a spouse in the tree is linked to that marriage on its own.</p></div>
    </div>
    ${livingSeg(livingV)}
    <div class="row2"><div class="field"><label for="fBorn">Born</label><input id="fBorn" value="${esc(fuzzyToText(p.bornRaw))}" placeholder="1932, about 1932, May 14, 1932"></div>
      <div class="field"><label for="fDied">Died</label><input id="fDied" value="${esc(fuzzyToText(p.diedRaw))}" placeholder="Year or date"></div></div>
    <div class="field"><label for="fPlace">Where were they born?</label><input id="fPlace" value="${esc(p.bornPlace || '')}" placeholder="&quot;Cleveland&quot; or &quot;somewhere in Ohio&quot; is fine"></div>
    <div class="field"><label for="fNotes">Anything you remember</label><textarea id="fNotes" placeholder="A job, a habit, a story they told">${esc(p.notes || '')}</textarea></div>
    <div class="field"><label for="fSource">Information source</label><input id="fSource" placeholder="Family Bible, Grandma told me, a gravestone" value="${esc(opts.edit ? '' : (p.source || ''))}"></div>
    ${whoField()}
    <p class="formerr" id="formErr" role="alert" hidden></p>
    <p class="hint">Only a name is needed. "Unknown" counts as a name. Living people show first and last name only; everything else stays private.</p>`;
}
function wireSeg(id, onChange) {
  document.querySelectorAll('#' + id + ' button').forEach(b => b.onclick = () => {
    document.querySelectorAll('#' + id + ' button').forEach(x => x.setAttribute('aria-pressed', x === b));
    if (onChange) onChange(b.dataset.v);
  });
}
const segVal = id => ((document.querySelector('#' + id + ' [aria-pressed="true"]') || {}).dataset || {}).v;
function watchForm(kind, anchor, extra = {}) {
  formDirty = false;
  const form = panel.querySelector('form.form');
  const keep = () => {
    formDirty = true;
    store.set('roots_draft', JSON.stringify({ kind, anchor, rel: segVal('fRel') || null, self: !!extra.self, fields: readForm() }));
  };
  form.addEventListener('input', keep);
  // Tapping a button on an empty add form isn't worth a "Save what you typed?" question.
  form.addEventListener('click', e => {
    if (!e.target.closest('.seg button')) return;
    const f = readForm();
    if (kind === 'add' && ![f.first, f.middle, f.last, f.nick, f.birthName, f.otherNames.length, f.born, f.died, f.bornPlace, f.notes, f.source].some(Boolean)) return;
    keep();
  });
}
function clearDraft() { store.del('roots_draft'); }
function fillForm(f) {
  const set = (id, v) => { const el = $('#' + id); if (el && v) el.value = v; };
  set('fFirst', f.first); set('fMiddle', f.middle); set('fLast', f.last); set('fNick', f.nick); set('fBirthName', f.birthName);
  const others = Array.isArray(f.otherNames) ? f.otherNames : (f.otherNames ? String(f.otherNames).split(',') : []);
  if ($('#fOtherList')) { $('#fOtherList').innerHTML = ''; others.forEach(v => addNameRow(v.trim(), false)); }
  if (f.birthName || others.length) showNames(); set('fBorn', f.born); set('fDied', f.died); set('fPlace', f.bornPlace); set('fNotes', f.notes); set('fSource', f.source);
  document.querySelectorAll('#fLiving button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === f.living));
}
function readForm() {
  const v = id => (($('#' + id) || {}).value || '').trim();
  return { first: v('fFirst'), middle: v('fMiddle'), last: v('fLast'), nick: v('fNick'), birthName: v('fBirthName'), otherNames: [...document.querySelectorAll('.fOtherName')].map(x => x.value.trim()).filter(Boolean), born: v('fBorn'), died: v('fDied'), bornPlace: v('fPlace'), notes: v('fNotes'), source: v('fSource'), who: v('fWho'), living: segVal('fLiving') || 'unknown' };
}
function showNames() { const m = $('#fNamesMore'), b = $('#fNamesBtn'); if (m) m.hidden = false; if (b) b.hidden = true; }
/* Wires the parts every person form shares: the living buttons, a death date flipping them to Passed away, the names reveal. */
function wireCommon() {
  wireSeg('fLiving');
  const died = $('#fDied');
  if (died) died.addEventListener('input', () => {
    if (!died.value.trim() || segVal('fLiving') === 'deceased') return;
    document.querySelectorAll('#fLiving button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === 'deceased'));
  });
  const nb = $('#fNamesBtn'); if (nb) nb.onclick = () => { showNames(); $('#fBirthName').focus(); };
  const an = $('#fAddName'); if (an) an.onclick = () => addNameRow();
  document.querySelectorAll('#fOtherList .namerow').forEach(row => { row.querySelector('.rm').onclick = () => { row.remove(); formDirty = true; }; });
}
function formError(msg) { const e = $('#formErr'); if (!e) { toast(msg); return; } e.textContent = msg; e.hidden = !msg; if (msg) e.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
function busy(on, label) {
  saving = on;
  panel.querySelectorAll('.foot button').forEach(b => { b.disabled = on; });
  const s = $('#pSave'); if (s) { if (on) { s.dataset.label = s.textContent; s.textContent = label || 'Saving…'; } else if (s.dataset.label) s.textContent = s.dataset.label; }
}
function personData(f) {
  const d = { first_name: f.first || (f.last ? '' : 'Unknown'), living: f.living };
  if (f.middle) d.middle_name = f.middle;
  if (f.nick) d.nicknames = f.nick;
  const n = namesToData(f.last, f.birthName, f.otherNames);
  if (n.birth_surname) d.birth_surname = n.birth_surname;
  if (n.married_names.length) d.married_names = n.married_names;
  d.birth_date = toFuzzy(f.born, 'Born');
  d.death_date = toFuzzy(f.died, 'Died');
  if (f.bornPlace) d.birth_place = f.bornPlace;
  if (f.notes) d.notes = f.notes;
  if (f.died && f.living === 'unknown') d.living = 'deceased';
  return d;
}
async function submit(items, f) {
  if (f && f.who) store.set('roots_display_name', f.who);
  return api({ action: 'submit', display_name: (f && f.who) || myName() || undefined, items });
}
function batchThanks() {
  if (!sessionAdded.length) return;
  const n = sessionAdded.length, first = sessionAdded[0];
  sessionAdded = [];
  const live = !!ADMIN_KEY;
  showThanks(n > 1 ? `Thank you. ${n} people planted.` : `Thank you. ${esc(first)} is planted.`,
    live ? 'Owner mode: it went live right away.'
      : `${OWNER_NAME} looks over every addition before everyone sees it. Until then ${n > 1 ? 'they show' : first + ' shows'} on your tree, marked unconfirmed.`);
}

/* Duplicate check: as a name is typed, offer people already in the tree. */
function wireDupCheck(onPick) {
  const first = $('#fFirst'), last = $('#fLast'), box = $('#dups');
  if (!first || !box) return;
  const norm = s => (s || '').toLowerCase().replace(/[^a-z]/g, '');
  const check = () => {
    const f = norm(first.value), l = norm(last && last.value);
    if (f.length < 2) { box.innerHTML = ''; return; }
    const hits = [...G.people.values()].filter(p => !p.placeholder && norm(p.first).startsWith(f) &&
      (!l || [p.last, p.birth, p.birthSurname, ...(p.married || [])].some(x => norm(x) === l))).slice(0, 3);
    box.innerHTML = hits.length ? `<span>Already in the tree?</span>` + hits.map(p => `<button type="button" data-id="${p.id}">${esc(displayName(p))}<small>${esc([relation(p.id), years(p)].filter(Boolean).join(' · '))}</small></button>`).join('') : '';
    box.querySelectorAll('button').forEach(b => b.onclick = () => onPick(b.dataset.id));
  };
  first.addEventListener('input', check); if (last) last.addEventListener('input', check);
}

function openEdit(id, restore) {
  const p = P(id);
  const lv = p.placeholder ? 'unknown' : p.livingRaw || (isLiving(p) ? 'living' : 'deceased');
  openPanel(`
    <div class="head"><div><h2>${p.placeholder ? 'Who was this?' : 'Edit ' + esc(p.first)}</h2><div class="sub">${ADMIN_KEY ? 'Owner mode: changes go live right away.' : `Your changes go to ${OWNER_NAME} to confirm. Nobody's entry gets overwritten.`}</div></div>
      <button class="x" id="pClose" aria-label="Close">${ICON.close}</button></div>
    <form class="body form" id="editForm" novalidate>${fieldsHTML(p, lv, { edit: true })}${p.pending ? '' : parentKindsHTML(id) + partnerKindsHTML(id)}</form>
    <div class="foot"><button class="iconbtn" id="pBack">Cancel</button><button class="primary" id="pSave">Save</button></div>`);
  wireCommon();
  if (restore) fillForm(restore.fields);
  watchForm('edit', id);
  if (restore) formDirty = true;
  $('#pClose').onclick = () => guardClose(); $('#pBack').onclick = () => guardClose(() => openPerson(id));
  $('#editForm').onsubmit = e => { e.preventDefault(); currentSave(); };
  $('#pSave').onclick = currentSave = async () => {
    const f = readForm();
    let changes;
    try {
      const n0 = namesFromPerson(p), was0 = namesToData(n0.last, n0.birthName, n0.otherNames), now0 = namesToData(f.last, f.birthName, f.otherNames);
      const was = { first_name: p.placeholder ? '' : p.first, middle_name: p.middle || '', nicknames: p.nicknames || '', birth_surname: was0.birth_surname, married_names: JSON.stringify(was0.married_names), living: lv,
        birth_date: p.bornRaw || '', death_date: p.diedRaw || '', birth_place: p.bornPlace || '', notes: p.notes || '' };
      const now = { first_name: f.first, middle_name: f.middle, nicknames: f.nick, birth_surname: now0.birth_surname, married_names: JSON.stringify(now0.married_names), living: f.living, birth_date: toFuzzy(f.born, 'Born'),
        death_date: toFuzzy(f.died, 'Died'), birth_place: f.bornPlace, notes: f.notes };
      changes = Object.keys(now).filter(k => now[k] !== was[k] && !(k === 'living' && now[k] === 'unknown' && was[k] !== 'unknown' && false))
        .map(k => ({ kind: 'suggestion', target_id: id, field: k, value: k === 'married_names' ? JSON.parse(now[k]) : now[k], source: f.source }));
      if (p.placeholder && (f.first || f.last)) changes.push({ kind: 'suggestion', target_id: id, field: 'is_placeholder', value: false, source: f.source });
      document.querySelectorAll('#editForm select[data-parent]').forEach(sel => {
        if (sel.value && sel.value !== sel.dataset.was) changes.push({ kind: 'suggestion', target_id: PC_ID.get(sel.dataset.parent + '>' + id), field: 'subtype', value: sel.value, source: f.source });
      });
      document.querySelectorAll('#editForm select[data-partner]').forEach(sel => {
        if (sel.value !== sel.dataset.was) changes.push({ kind: 'suggestion', target_id: PT_ID.get([id, sel.dataset.partner].sort().join('~')), field: 'subtype', value: sel.value, source: f.source });
      });
    } catch (err) { formError(err.message); return; }
    if (!changes.length) { formError("Nothing has changed yet."); return; }
    formError(''); busy(true);
    try { await submit(changes, f); }
    catch (err) { busy(false); formError(err.message); return; }
    busy(false); clearDraft(); closePanel();
    const who = f.first || p.first || 'it';
    showThanks(`Thank you. Your changes to ${esc(who)} are saved.`, ADMIN_KEY ? 'Owner mode: they went live right away.'
      : `${OWNER_NAME} looks over every change before everyone sees it. Both versions stay on record, with who said each.`);
    reload();
  };
}

/* opts: { rel, fields, self } ; anchor may be null when the tree is empty (adding yourself first). */
function openAdd(id, opts = {}) {
  const p = id ? P(id) : null;
  const self = !!opts.self;
  const rel = opts.rel || (self ? 'child' : 'child');
  const done = sessionAdded.length;
  const relWord = p ? (self ? 'You are ' : 'They are ') + esc(p.first || 'this person') + "'s" : '';
  const parents = p ? parentsOf(p.id) : [];
  openPanel(`
    <div class="head"><div><h2>${self ? 'Add yourself' : `Add someone to ${esc(p.placeholder ? 'this branch' : p.first + "'s branch")}`}</h2>
      <div class="sub">${done ? `${done} saved so far. Keep going, or tap Save on the last one.` : self ? 'Start with your name. You can add more later.' : 'Add who you know, including relatives who have died.'}</div></div>
      <button class="x" id="pClose" aria-label="Close">${ICON.close}</button></div>
    <form class="body form" id="addForm" novalidate>
      ${p ? `<div class="field"><span class="lab">${relWord}</span><div class="seg" id="fRel">
        ${['parent', 'partner', 'sibling', 'child'].map(v => `<button type="button" data-v="${v}" aria-pressed="${v === rel}"${v === 'parent' && parents.length >= 2 ? ' disabled title="Already has two parents"' : ''}>${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div></div>
      <div class="field" id="fOtherWrap" hidden><label for="fOther" id="fOtherLab">Their other parent</label><select id="fOther"></select></div>
      <div class="field" id="fKindWrap" hidden><span class="lab">Together as</span><div class="seg" id="fKind"><button type="button" data-v="married" aria-pressed="true">Married</button><button type="button" data-v="partner" aria-pressed="false">Partners</button><button type="button" data-v="divorced" aria-pressed="false">Divorced</button><button type="button" data-v="widowed" aria-pressed="false">Widowed</button></div></div>
      <div class="field" id="fPcWrap" hidden><span class="lab" id="fPcLab">What kind of parent?</span><div class="seg" id="fPc">${PC_KINDS.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${v === 'biological'}">${l}</button>`).join('')}</div>
        <p class="hint" id="fPcHint" hidden>This takes one of the two parent spots. If the birth parent might be added later, add a step-parent as the parent's partner instead; the tree labels them Stepfather or Stepmother on its own.</p></div>` : ''}
      ${fieldsHTML(self ? { last: p ? p.last : '' } : {}, self ? 'living' : 'unknown')}
      <input type="hidden" id="fLink" value="">
    </form>
    <div class="foot"><button class="iconbtn" id="pBack">Cancel</button>${self ? '' : '<button class="iconbtn" id="pMore">Save &amp; add another</button>'}<button class="primary" id="pSave">Save</button></div>`);
  const syncPcHint = () => { const h = $('#fPcHint'); if (h) h.hidden = !(segVal('fRel') === 'parent' && segVal('fPc') === 'step'); };
  const pcSub = () => ($('#fPcWrap') && !$('#fPcWrap').hidden && segVal('fPc')) || 'biological';
  const syncRel = v => {
    if (!p) return;
    const ow = $('#fOtherWrap'), kw = $('#fKindWrap');
    ow.hidden = true; kw.hidden = v !== 'partner';
    $('#fPcWrap').hidden = v !== 'parent' && v !== 'child';
    $('#fPcLab').textContent = v === 'child' ? `What kind of parent is ${p.first || 'this person'}?` : 'What kind of parent?';
    syncPcHint();
    const opts = (list, none) => list.map(x => `<option value="${x}">${esc(displayName(P(x)))}</option>`).join('') + `<option value="">${none}</option>`;
    $('#fOther').onchange = null;
    if (v === 'child') {
      // Who else is this child's parent? Defaults to the current partner.
      const prts = partnersOf(p.id).map(x => x.id);
      if (prts.length) { $('#fOtherLab').textContent = 'Their other parent'; $('#fOther').innerHTML = opts(prts, 'Someone else, or not sure'); ow.hidden = false; }
    } else if (v === 'parent' && parents.length) {
      // A second parent: were they a couple with the parent already here?
      $('#fOtherLab').textContent = 'Together with';
      $('#fOther').innerHTML = opts(parents, 'Neither, or not sure');
      if (parents.length > 1) $('#fOther').value = '';
      ow.hidden = false; kw.hidden = !$('#fOther').value;
      $('#fOther').onchange = () => { kw.hidden = !$('#fOther').value; };
    }
  };
  if (p) { wireSeg('fRel', syncRel); wireSeg('fKind'); wireSeg('fPc', syncPcHint); syncRel(rel); }
  wireCommon();
  if (opts.fields) fillForm(opts.fields);
  watchForm('add', id, { self });
  if (opts.fields) formDirty = true;
  wireDupCheck(pickId => {
    $('#fLink').value = pickId;
    const q = P(pickId);
    $('#dups').innerHTML = `<span class="linked">Linking ${esc(displayName(q))}, who is already in the tree. <button type="button" id="unlink">Undo</button></span>`;
    $('#unlink').onclick = () => { $('#fLink').value = ''; $('#dups').innerHTML = ''; };
  });
  $('#pClose').onclick = () => guardClose();
  $('#pBack').onclick = () => guardClose(() => { closePanel(); if (sessionAdded.length) batchThanks(); else if (p) openPerson(p.id); });
  $('#addForm').onsubmit = e => { e.preventDefault(); currentSave(); };

  const build = f => {
    const link = $('#fLink').value;
    const me = link || 'new:1';
    const items = [];
    if (!link) {
      if (!f.first && !f.last) throw new Error('Add at least a name. "Unknown" works.');
      items.push({ kind: 'person', ref: 'new:1', data: personData(f), source: f.source });
    }
    if (p) {
      const r = segVal('fRel');
      if (r === 'child') {
        const k = pcSub();
        items.push({ kind: 'relationship', type: 'parent_child', a: p.id, b: me, subtype: k, source: f.source });
        const other = $('#fOtherWrap').hidden ? '' : $('#fOther').value;
        // A stepchild is usually their other parent's birth child; adopted or fostered children usually by both.
        if (other) items.push({ kind: 'relationship', type: 'parent_child', a: other, b: me, subtype: k === 'step' ? 'biological' : k, source: f.source });
      } else if (r === 'parent') {
        items.push({ kind: 'relationship', type: 'parent_child', a: me, b: p.id, subtype: pcSub(), source: f.source });
        const other = $('#fOtherWrap').hidden ? '' : $('#fOther').value;
        if (other && other !== me) items.push({ kind: 'relationship', type: 'partner', a: other, b: me, subtype: segVal('fKind') || 'married', source: f.source });
      }
      else if (r === 'partner') items.push({ kind: 'relationship', type: 'partner', a: p.id, b: me, subtype: segVal('fKind') || 'married', source: f.source });
      else if (r === 'sibling') {
        if (parents.length) parents.forEach(pp => items.push({ kind: 'relationship', type: 'parent_child', a: pp, b: me, source: f.source }));
        else {
          // Siblings are stored as shared parents. Nobody knows them yet, so an unknown parent holds the link.
          items.push({ kind: 'person', ref: 'new:p', data: { is_placeholder: true } });
          items.push({ kind: 'relationship', type: 'parent_child', a: 'new:p', b: p.id });
          items.push({ kind: 'relationship', type: 'parent_child', a: 'new:p', b: me, source: f.source });
        }
      }
    }
    if (self) items.push({ kind: 'claim', person: me });
    return { items, name: link ? P(link).first : (f.first || f.last || 'Unknown') };
  };
  const doSave = async more => {
    const f = readForm();
    let b;
    try { b = build(f); } catch (err) { formError(err.message); return; }
    formError(''); busy(true);
    let res;
    try { res = await submit(b.items, f); }
    catch (err) { busy(false); formError(err.message); return; }
    busy(false); clearDraft();
    sessionAdded.push(b.name);
    if (self) { STATE.viewer = (res.ids && res.ids['new:1']) || $('#fLink').value || STATE.viewer; STATE.focus = STATE.viewer; }
    if (more) {
      const keepRel = segVal('fRel');
      await reload();
      toast(`Saved ${b.name}. Add the next one.`);
      openAdd(id, { rel: keepRel });
    } else {
      closePanel();
      batchThanks();
      pendingReload = true;
    }
  };
  $('#pSave').onclick = currentSave = () => doSave(false);
  if ($('#pMore')) $('#pMore').onclick = () => doSave(true);
}

async function claimMe(id) {
  try { await submit([{ kind: 'claim', person: id }], { who: myName() }); }
  catch (err) { toast(err.message); return; }
  STATE.viewer = id;
  closePanel();
  toast(ADMIN_KEY ? "You're set as you." : `Thanks, ${P(id).first}. ${OWNER_NAME} will confirm it's you.`);
  reload();
}

/* =====================================================================
 * Pages: thank you, send to family, search
 * ===================================================================== */
let pendingReload = false;
function showPage(id) { $('#' + id).classList.add('on'); }
function hidePage(id) { $('#' + id).classList.remove('on'); }
function showThanks(title, body) { $('#thanksTitle').innerHTML = title; $('#thanksBody').textContent = body; showPage('thanks'); }
$('#thanksBack').onclick = () => { hidePage('thanks'); if (pendingReload) { pendingReload = false; setTimeout(() => reload(), 150); } };
$('#thanksSend').onclick = () => { hidePage('thanks'); if (pendingReload) { pendingReload = false; reload(); } openSend(); };

function siteBase() { return location.origin + location.pathname.replace(/[^/]*$/, ''); }
function shareLink() { const from = STATE.viewer || ''; return siteBase() + (from ? '?from=' + encodeURIComponent(from) : ''); }
function openSend() {
  const v = STATE.viewer && P(STATE.viewer);
  const msg = `I'm helping build our family tree. Open this, look around, and add anyone you know, especially the relatives we've lost. It takes a minute.\n\n${shareLink()}`;
  openPanel(`
    <div class="head"><div><h2>Send Roots to a family member</h2><div class="sub">${v ? `The link opens the tree on you, ${esc(v.first)}, so they start somewhere familiar.` : 'Tip: tap your own card and choose "This is me" first, so the link opens the tree on you.'}</div></div>
      <button class="x" id="pClose" aria-label="Close">${ICON.close}</button></div>
    <div class="body sendbox">
      <div class="field"><label for="sMsg">Message</label><textarea id="sMsg" style="min-height:140px">${esc(msg)}</textarea></div>
      <div class="field"><label for="sLink">Link</label><div class="linkrow"><input id="sLink" readonly value="${esc(shareLink())}"><button class="iconbtn" id="sCopyLink">Copy link</button></div></div>
      <p class="hint">Anyone with the link sees the tree as it stands. Living people show by first and last name only.</p>
    </div>
    <div class="foot">${navigator.share ? '<button class="iconbtn" id="sShare">Share…</button>' : ''}<button class="primary" id="sCopy">Copy message</button></div>`);
  $('#pClose').onclick = closePanel;
  const copy = async (text, done) => { try { await navigator.clipboard.writeText(text); toast(done); } catch (e) { const t = $('#sMsg'); t.focus(); t.select(); toast('Select the text and copy it'); } };
  $('#sCopy').onclick = () => copy($('#sMsg').value, 'Message copied. Paste it into a text or email.');
  $('#sCopyLink').onclick = () => copy(shareLink(), 'Link copied');
  const sh = $('#sShare'); if (sh) sh.onclick = () => navigator.share({ title: 'Roots', text: $('#sMsg').value }).catch(() => {});
}
$('#btnSend').onclick = openSend;

let toastT;
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 3200); }

function pickPerson(title, sub, onPick, filter = () => true) {
  openPanel(`
    <div class="head"><div><h2>${title}</h2><div class="sub">${sub}</div></div>
      <button class="x" id="pClose" aria-label="Close">${ICON.close}</button></div>
    <div class="body"><div class="field"><label for="qName">Name</label><input id="qName" placeholder="Start typing a name" autocomplete="off"></div><div class="pick" id="qList"></div></div>`);
  $('#pClose').onclick = closePanel;
  const list = () => {
    const q = $('#qName').value.toLowerCase().trim();
    const hits = [...G.people.values()].filter(p => !p.placeholder && filter(p) && (!q || displayName(p).toLowerCase().includes(q) || (p.birth || '').toLowerCase().includes(q) || (p.nicknames || '').toLowerCase().includes(q) || (p.married || []).some(m => m.toLowerCase().includes(q)))).slice(0, 40);
    $('#qList').innerHTML = hits.map(p => `<button data-id="${p.id}"><span>${esc(displayName(p))}</span><small>${esc([relation(p.id), years(p)].filter(Boolean).join(' · '))}</small></button>`).join('') || '<p class="hint">Nobody by that name yet.</p>';
    document.querySelectorAll('#qList button').forEach(b => b.onclick = () => onPick(b.dataset.id));
  };
  $('#qName').oninput = list; list(); setTimeout(() => $('#qName').focus(), 50);
}
$('#btnSearch').onclick = () => pickPerson('Find a person', 'Everyone in the tree, folded branches included.', id => { closePanel(); STATE.focus = id; render(); });
$('#btnAll').onclick = () => { STATE.all = !STATE.all; $('#btnAll').setAttribute('aria-pressed', STATE.all); if (!STATE.all) STATE.open.clear(); render({ camera: false }); };

/* Names in the details card that point at another person (a spouse in the last-name history) open that person. */
panel.addEventListener('click', e => { const a = e.target.closest('[data-goto]'); if (!a) return; e.preventDefault(); openPerson(a.dataset.goto); });
