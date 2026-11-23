/* =====================================================================
 * Pop-out person panel
 * ===================================================================== */
const panel = $('#panel'), scrim = $('#scrim');
/* Person lists (Find, "Which one is you?", "Already in the tree?") name people the way their cards do, so look-alikes
   differ (Jonathon "Jonny" P. Ruzicka vs Jonathon "Jonny" S. Ruzicka), plus whose child they are: a relative knows
   who your parents are, not your middle initial. */
const shortName = q => (q.nicknames || '').split(',')[0].trim() || q.first || '';
// "Jonny" alone when only one person goes by it; "Jonny S. Ruzicka" when two do (a father and son, say).
function refName(q) {
  const s = shortName(q), k = s.toLowerCase();
  if (!k || ![...G.people.values()].some(o => o.id !== q.id && !o.placeholder && shortName(o).toLowerCase() === k)) return s;
  return [s, q.middle ? q.middle.trim()[0] + '.' : '', q.last].filter(Boolean).join(' ');
}
const andList = a => a.length <= 2 ? a.join(' and ') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
function whoLine(p) {
  const named = ids => ids.map(P).filter(q => q && !q.placeholder).map(refName).filter(Boolean);
  const pars = named(parentsOf(p.id));
  if (pars.length) return 'Child of ' + andList(pars);
  const kids = named(childrenOf(p.id));
  if (kids.length) return 'Parent of ' + (kids.length > 3 ? kids.slice(0, 2).join(', ') + ' and ' + (kids.length - 2) + ' more' : andList(kids));
  const pts = named(partnersOf(p.id).map(x => x.id));
  return pts.length ? 'Partner of ' + andList(pts) : '';
}
// Typing "Jonny", "Debby" or a maiden name finds the person, not only first and last names.
function nameMatches(p, q) {
  if (!q) return true;
  return [cardName(p), displayName(p), p.middle, p.nicknames, p.birth, p.birthSurname, ...(p.married || [])].some(x => (x || '').toLowerCase().includes(q));
}
const listName = p => `<span class="who">${esc(cardName(p))}<em>${esc(whoLine(p))}</em></span>`;
function openPanel(html) { panel.innerHTML = html; panel.classList.add('on'); if (innerWidth <= 700) scrim.classList.add('on'); }
function closePanel() { panel.classList.remove('on'); scrim.classList.remove('on'); formDirty = false; currentSave = null; if (STATE.selected) { STATE.selected = null; refreshCards(); }  updateMeBar(); }
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
    const how = sp.sub === 'divorced' ? ', divorced' : sp.sub === 'former' ? ', separated' : sp.sub === 'widowed' ? ', widowed' : '';
    parts.push(`${esc(nm)} <span class="muted">from marriage to <a href="#" data-goto="${esc(sp.id)}">${esc(displayName(P(sp.id)))}</a>${how}</span>`);
  });
  return parts.join('<br>');
}
/* A child with one parent whose parent has a partner who isn't linked to the child: probably a missed link.
   Asked from either side (the child's card and the partner's card). "Not a parent" hides it on this device. */
function missingParentPairs(id) {
  let no = []; try { no = JSON.parse(store.get('roots_nudge_no') || '[]'); } catch (e) {}
  const out = new Map();
  const ps = parentsOf(id);
  if (ps.length === 1) partnersOf(ps[0]).forEach(x => { if (x.id !== id && !P(x.id).placeholder) out.set(x.id + '>' + id, [x.id, id]); });
  partnersOf(id).forEach(x => childrenOf(x.id).forEach(c => { const cp = parentsOf(c); if (cp.length === 1 && cp[0] === x.id && c !== id && !P(c).placeholder) out.set(id + '>' + c, [id, c]); }));
  return [...out.entries()].filter(([k]) => !no.includes(k)).map(([, v]) => v);
}
/* What this relative sent about a person that Jonny hasn't confirmed yet, each with Take back.
   (Their own unconfirmed people carry Edit and Take back on their card instead.) */
const FIELD_WORDS = { first_name: 'first name', middle_name: 'middle name', nicknames: 'nickname', birth_surname: 'last name',
  married_names: 'last names', living: 'living or not', birth_date: 'birth date', death_date: 'death date', birth_place: 'birthplace',
  death_place: 'place of death', notes: 'story', sex: 'sex', is_placeholder: 'name' };
const whoIs = q => q.placeholder ? 'an unknown person' : displayName(q);
function ownWork(id) {
  const p = P(id), rows = [];
  if (p.edits) {
    const words = [...new Set(p.edits.map(s => FIELD_WORDS[s.field] || 'details'))];
    rows.push({ text: `You changed ${esc(p.base.placeholder ? 'who this is' : andList(words))}.`, ids: p.edits.map(s => s.id), ask: 'Take back your changes?', done: 'Your changes are taken back.' });
  }
  if (p.pending) return rows;
  OWN_RELS.filter(r => r.a === id || r.b === id).forEach(r => {
    const other = r.a === id ? r.b : r.a, o = P(other);
    const alone = o.pending && OWN_RELS.filter(x => x.a === other || x.b === other).length === 1;
    rows.push({ text: `You linked ${esc(r.type === 'partner' ? `${whoIs(P(r.a))} and ${whoIs(P(r.b))} as partners` : `${whoIs(P(r.a))} as ${whoIs(P(r.b))}'s parent`)}.`,
      ids: [r.id], ask: alone ? `Take back this link? ${esc(whoIs(o))} goes too, since nothing else connects them.` : 'Take back this link?', done: 'Link taken back.' });
  });
  [...PC_ID, ...PT_ID].filter(([k]) => k.split(/[>~]/).includes(id)).forEach(([k, rid]) => (OWN_SUGG.get(rid) || []).forEach(s => {
    const [a, b] = k.split(/[>~]/), pair = k.includes('~') ? `${whoIs(P(a))} and ${whoIs(P(b))} were never partners` : `${whoIs(P(a))} is not ${whoIs(P(b))}'s parent`;
    rows.push({ text: esc(s.field === 'remove' ? `You said ${pair}.` : `You changed how ${whoIs(P(a))} and ${whoIs(P(b))} are linked.`), ids: [s.id], ask: 'Take that back?', done: 'Taken back.' });
  }));
  return rows;
}
/* Take back their own unconfirmed entries. If the card in the middle of the tree goes with them, center on a relative who stays. */
async function takeBack(ids, done, stay) {
  let res;
  try { res = await api({ action: 'withdraw', ids }); } catch (err) { toast(err.message); return false; }
  const gone = new Set(res.withdrawn || []);
  if (gone.has(STATE.focus)) STATE.focus = (stay && !gone.has(stay) && stay) || (STATE.viewer && !gone.has(STATE.viewer) && STATE.viewer) || [...G.people.keys()].find(x => !gone.has(x) && !P(x).placeholder) || STATE.focus;
  if (gone.has(STATE.viewer)) STATE.viewer = null;
  closePanel(); toast(done); await reload();
  return true;
}
/* A Take back button asks once, in place, before doing anything. */
function confirmInPlace(btn, ask, run) {
  const box = btn.closest('[data-tbrow]') || btn.parentElement;
  box.innerHTML = `<span>${ask}</span><span class="nbtns"><button class="nbtn yes" data-go>Yes, take back</button><button class="nbtn" data-keep>Keep</button></span>`;
  box.classList.add('asking');
  box.querySelector('[data-keep]').onclick = () => openPerson(STATE.selected || '');
  box.querySelector('[data-go]').onclick = async () => { box.querySelectorAll('button').forEach(x => { x.disabled = true; }); if (!await run()) openPerson(STATE.selected); };
}
function neighborOf(id) { return [...parentsOf(id), ...childrenOf(id), ...partnersOf(id).map(x => x.id)].find(x => !P(x).pending && !P(x).placeholder); }

function openPerson(id) {
  STATE.selected = id; refreshCards();
  const p = P(id), living = isLiving(p), rel = relation(id), twice = connectedTwice(id);
  const name = p.placeholder ? 'Unknown' : displayName(p);
  const full = p.placeholder ? name : [p.first, p.nicknames && !sameName(p.nicknames, p.first) ? `"${p.nicknames}"` : '', p.middle, p.last].filter(Boolean).join(' ');
  let body = '';
  if (p.placeholder) {
    body += `<p class="story">Nobody has named this person yet. If you know who ${rel ? 'this ' + rel.toLowerCase() : 'they'} ${living ? 'is' : 'was'}, fill in what you know. Even a first name helps.</p>`;
  } else if (living && !p.pending) {
    body += id === STATE.viewer
      ? `<div class="private">${ICON.lock}<span>Relatives see only your names. Your dates, places and stories stay private. ${OWNER_NAME} can see everything.</span></div>`
      : `<div class="private">${ICON.lock}<span>${esc(p.first)} is living, so only their names show here. Dates, places, maiden name and stories stay private while they're alive.</span></div>`;
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
  if (!p.placeholder) missingParentPairs(id).forEach(([a, b]) => {
    body += `<div class="nudge" data-pair="${esc(a + '>' + b)}"><span>Is <b>${esc(displayName(P(a)))}</b> also <b>${esc(displayName(P(b)))}</b>'s parent?</span>
      <span class="nbtns"><button class="nbtn yes" data-yes>Yes, link them</button><button class="nbtn" data-no>No</button></span></div>`;
  });
  if (twice) body += `<div class="twicebox">${ICON.rings}<span>Related twice: ${esc(p.first)} and ${esc(P(twice.partner).first)} both descend from ${esc(displayName(P(twice.ancestor)))}.</span></div>`;
  body += relatedButtonHTML(id);
  if (p.pending) body += `<div class="ownwork" data-tbrow><span>You added ${esc(p.placeholder ? 'this unknown person' : p.first || 'this')}. ${OWNER_NAME} hasn't confirmed it yet, so only you can see it. Spot a mistake? <b>Edit</b> fixes it, <b>Take back</b> removes it.</span></div>`;
  const work = ownWork(id);
  if (work.length) body += `<div class="ownwork"><span class="owhead">Waiting for ${OWNER_NAME}. Only you see ${work.length > 1 ? 'these' : 'this'} until he confirms.</span>${work.map((w, i) =>
    `<div class="owrow" data-tbrow><span>${w.text}</span><button class="nbtn" data-tb="${i}">Take back</button></div>`).join('')}</div>`;
  if (!p.placeholder && !p.pending) {
    const ph = PHOTOS.get(id) || [];
    const tiles = ph.slice(0, 6).map(f => `<a class="photo real" href="${photoURL(f.file_id, 1600)}" target="_blank" rel="noopener" title="${esc(f.caption || 'Photo')}"><img src="${photoURL(f.file_id, 400)}" alt="${esc(f.caption || 'Photo of ' + p.first)}" loading="lazy"></a>`).join('');
    body += `<div><div class="label">Photos &amp; documents</div><div class="photos">${tiles}<button class="photo add" id="pAddPhoto">Add photos or documents</button></div></div>`;
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
      <button class="primary" id="pAdd">Add a relative</button>
      <button class="iconbtn" id="pEdit">${p.placeholder ? 'Fill in' : 'Edit'}</button>
      ${isFocus ? '' : `<button class="iconbtn" id="pCenter">${STATE.view === 'wheel' ? `Put ${esc(p.placeholder ? 'them' : p.first)} in the middle` : `Center on ${esc(p.placeholder ? 'them' : p.first)}`}</button>`}
      ${p.pending ? '<button class="iconbtn" id="pTakeBack">Take back</button>' : ''}
      ${canClaim ? '<button class="iconbtn" id="pMe">This is me</button>' : ''}
    </div>`);
  $('#pClose').onclick = closePanel;
  document.querySelectorAll('[data-tb]').forEach(b => b.onclick = () => {
    const w = work[+b.dataset.tb];
    confirmInPlace(b, w.ask, () => takeBack(w.ids, w.done, id));
  });
  if ($('#pTakeBack')) $('#pTakeBack').onclick = () => {
    const links = OWN_RELS.filter(r => r.a === id || r.b === id).length;
    confirmInPlace($('.ownwork[data-tbrow] span'), `Take back ${esc(p.placeholder ? 'this unknown person' : p.first || 'this person')}${links ? ` and the link${links > 1 ? 's' : ''} you added with them` : ''}? ${OWNER_NAME} won't see ${links ? 'them' : 'it'}.`,
      () => takeBack([id], p.placeholder ? 'Taken back.' : `${p.first || 'They'} is taken back.`, neighborOf(id)));
  };
  if (!isFocus) $('#pCenter').onclick = () => { closePanel(); STATE.focus = id; render(); };
  $('#pAdd').onclick = () => openAdd(id);
  if ($('#pEdit')) $('#pEdit').onclick = () => openEdit(id);
  if ($('#pMe')) $('#pMe').onclick = () => claimMe(id);
  const ap = $('#pAddPhoto'); if (ap) ap.onclick = () => toast('Adding photos and documents is coming soon.');
  document.querySelectorAll('.nudge').forEach(n => {
    const [a, b] = n.dataset.pair.split('>');
    n.querySelector('[data-no]').onclick = () => {
      let no = []; try { no = JSON.parse(store.get('roots_nudge_no') || '[]'); } catch (e) {}
      no.push(n.dataset.pair); store.set('roots_nudge_no', JSON.stringify(no)); n.remove();
    };
    n.querySelector('[data-yes]').onclick = async () => {
      n.querySelectorAll('button').forEach(x => { x.disabled = true; });
      try {
        await submit([{ kind: 'relationship', type: 'parent_child', a, b }]);
        toast(ADMIN_KEY ? 'Linked.' : `Linked. ${OWNER_NAME} will confirm it.`);
        closePanel(); await reload();
      } catch (err) { toast(err.message || "Couldn't link them."); n.querySelectorAll('button').forEach(x => { x.disabled = false; }); }
    };
  });
}

/* =====================================================================
 * Forms: add, edit, "this is me"
 * ===================================================================== */
const myName = () => store.get('roots_display_name') || '';
function whoField() {
  if (STATE.viewer || ADMIN_KEY) return '';
  return `<div class="field"><label for="fWho">Your name, so ${OWNER_NAME} knows who sent this</label><input id="fWho" value="${esc(myName())}" autocomplete="name" placeholder="For example: Linda, Carol's cousin"></div>`;
}
function livingSeg(v, hide) {
  return `<div class="field"${hide ? ' hidden' : ''}><span class="lab">Are they living? ${infoBtn(INFO.living)}</span><div class="seg" id="fLiving">
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
/* Info buttons on the choices where a wrong guess writes something Jonny then has to untangle (2026-11-22). */
const INFO = {
  parent: `**Birth:** the parent they were born to.\n**Step:** married to or partnered with one of their parents, but not their parent by birth or adoption.\n**Adoptive:** legally adopted them.\n**Foster:** raised them in foster care without adopting.\nWhile either of them is living, adoptive and foster show to everyone as plain "parent".`,
  sibling: `**Full:** the same two parents.\n**Half:** one parent in common. You'll pick which one, so their line comes from the right parent.\n**Step:** no parent in common. One of their parents is with one of the other's parents.`,
  couple: `**Married:** married now.\n**Partners:** together now, not married.\n**Divorced:** were married, aren't now.\n**Former partners:** were together, never married, and aren't together now.\n**Widowed:** married until one of them died.`,
  living: `**Living:** only their names show. Dates, places, maiden name and stories stay private while they're alive.\n**Passed away:** everything you add shows once ${OWNER_NAME} confirms it.\n**Not sure:** treated like Living, so their details stay hidden from everyone, including you, until someone marks them Passed away.`,
  which: `**Someone new:** they aren't on the tree yet.\n**Already in the tree:** they're on it somewhere, maybe as Unknown. Pick them from the list so they get linked, not added a second time.\nAdding someone who's already there makes a duplicate that ${OWNER_NAME} has to merge by hand.`
};
/* A link that shouldn't exist (a mis-tapped "Yes, link them", the wrong parent picked): chosen in Edit, sent as a
   correction that removes the link once confirmed. Both people stay. */
const REMOVE = '__remove';
const linkChange = (target_id, v, source) => v === REMOVE ? { kind: 'suggestion', target_id, field: 'remove', value: 'removed', source }
  : { kind: 'suggestion', target_id, field: 'subtype', value: v, source };
/* In the edit form: one row per confirmed parent link, so a parent can be marked step, adoptive or foster later.
   For living people the server shows adoptive and foster links as plain "parent"; that shows here as "Not shown". */
const PT_KINDS = [['married', 'Married'], ['partner', 'Partners'], ['divorced', 'Divorced'], ['former', 'Former partners'], ['widowed', 'Widowed']];
/* In the edit form: each confirmed partnership with whether it's still going. */
function partnerKindsHTML(id) {
  const rows = partnersOf(id).filter(x => PT_ID.has([id, x.id].sort().join('~')) && !P(x.id).placeholder).map(x => {
    const key = [id, x.id].sort().join('~'), base = LINK_BASE.has(key) ? LINK_BASE.get(key) : x.sub;
    const removing = (OWN_SUGG.get(PT_ID.get(key)) || []).some(s => s.field === 'remove');
    const cur = removing ? REMOVE : PT_KINDS.some(([v]) => v === x.sub) ? x.sub : 'married';
    return `<div class="field"><label for="fPt_${esc(x.id)}">${esc(displayName(P(x.id)))}</label><select id="fPt_${esc(x.id)}" data-partner="${esc(x.id)}" data-was="${esc(base || '')}">${PT_KINDS.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`).join('')}<option value="${REMOVE}"${cur === REMOVE ? ' selected' : ''}>Never partners: remove this link</option></select></div>`;
  });
  return rows.length ? `<div class="label">Marriages and partners ${infoBtn(INFO.couple)}</div><div class="row2">${rows.join('')}</div>` : '';
}
function parentKindsHTML(id) {
  const rows = parentsOf(id).filter(q => PC_ID.has(q + '>' + id) && !P(q).placeholder).map(q => {
    const key = q + '>' + id, base = LINK_BASE.has(key) ? LINK_BASE.get(key) || 'biological' : G.pcSub.get(key) || 'biological';
    const removing = (OWN_SUGG.get(PC_ID.get(key)) || []).some(s => s.field === 'remove');
    const cur = removing ? REMOVE : G.pcSub.get(key) || 'biological';
    const known = cur === REMOVE || PC_KINDS.some(([v]) => v === cur), knownBase = PC_KINDS.some(([v]) => v === base);
    const opts = (known ? '' : `<option value="" selected>Keep as is</option>`) +
      PC_KINDS.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l} parent</option>`).join('') +
      `<option value="${REMOVE}"${cur === REMOVE ? ' selected' : ''}>Not their parent: remove this link</option>`;
    return `<div class="field"><label for="fPk_${esc(q)}">${esc(displayName(P(q)))}</label><select id="fPk_${esc(q)}" data-parent="${esc(q)}" data-was="${knownBase ? base : ''}">${opts}</select></div>`;
  });
  const masked = parentsOf(id).some(q => PC_ID.has(q + '>' + id) && !PC_KINDS.some(([v]) => v === G.pcSub.get(q + '>' + id)));
  return rows.length ? `<div class="label">${esc(P(id).first || 'Their')}'s parents ${infoBtn(INFO.parent)}</div><div class="row2">${rows.join('')}</div>` +
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
  // opts.self: the form is about the person filling it in (2026-11-22): they're living, they know their own name,
  // and their own name says who sent it, so those questions go.
  const self = !!opts.self;
  const noName = !self && (!opts.edit || opts.noName) && !p.placeholder, unk = noName && isNoName(p);
  return `
    <div id="fPersonFields">
    <div id="fNameBlock"${unk ? ' hidden' : ''}>
    <div class="row2"><div class="field"><label for="fFirst">First name</label><input id="fFirst" value="${esc(p.first || '')}" autocomplete="off"><div class="dups" id="dups"></div></div>
      <div class="field"><label for="fMiddle">Middle name</label><input id="fMiddle" value="${esc(p.middle || '')}" autocomplete="off"></div></div>
    <div class="row2"><div class="field"><label for="fLast">Last name now</label><input id="fLast" value="${esc(nm.last)}" autocomplete="off" placeholder="${self ? '' : 'Or their last one'}"></div>
      <div class="field"><label for="fNick">Nickname</label><input id="fNick" value="${esc(p.nicknames || '')}" autocomplete="off" placeholder="Bobby, Dee"></div></div>
    <p class="hint warn" id="fNickWarn" hidden>Nickname is what everyone calls them, and it shows on their card. The tree works out Mom, Grandma or Uncle by itself, so leave that part out.</p>
    <button type="button" class="morelink" id="fNamesBtn"${showMore ? ' hidden' : ''}>+ Maiden name or earlier last names</button>
    <div class="namesmore" id="fNamesMore"${showMore ? '' : ' hidden'}>
      <div class="field"><label for="fBirthName">Last name at birth</label><input id="fBirthName" value="${esc(nm.birthName)}" autocomplete="off" placeholder="If different from now"></div>
      <div class="field"><span class="lab">Last names in between, oldest first</span><div id="fOtherList">${nm.otherNames.map(nameRowHTML).join('')}</div>
        <button type="button" class="morelink" id="fAddName">+ Add a last name</button>
        <p class="hint">One per marriage or change. A married name that matches a spouse in the tree is linked to that marriage on its own.</p></div>
    </div>
    </div>
    ${noName ? `<label class="kid noname"><input type="checkbox" id="fNoName"${unk ? ' checked' : ''}><span>I don't know their name</span></label>
    <p class="hint" id="fNoNameHint"${unk ? '' : ' hidden'}>They'll show as Unknown. Add what you do know below, and anyone who knows the name can fill it in later.</p>` : ''}
    <div class="field"><label for="fSex">Gender</label><select id="fSex">${[['', 'Not sure, or rather not say'], ['female', 'Female'], ['male', 'Male'], ['other', 'Other']].map(([v, t]) => `<option value="${v}"${(p.sex || '') === v ? ' selected' : ''}>${t}</option>`).join('')}</select>
      <p class="hint">Lets the tree say mother or grandson instead of parent or grandchild. Private while they're living${opts.edit && isLiving(p) && !p.pending ? ', so it shows blank here even if someone already chose one' : ''}.</p></div>
    ${livingSeg(self ? 'living' : livingV, self)}
    ${self ? `<div class="field"><label for="fBorn">When were you born?</label><input id="fBorn" value="${esc(fuzzyToText(p.bornRaw))}" placeholder="1952, or May 14, 1952"></div>
    <div class="field"><label for="fPlace">Where were you born?</label><input id="fPlace" value="${esc(p.bornPlace || '')}" placeholder="&quot;Cleveland&quot; or &quot;somewhere in Ohio&quot; is fine"></div>
    <div class="field"><label for="fNotes">Anything you'd like ${OWNER_NAME} to know</label><textarea id="fNotes" placeholder="Who your parents are, where you grew up">${esc(p.notes || '')}</textarea></div>`
    : `<div class="row2"><div class="field"><label for="fBorn">Born</label><input id="fBorn" value="${esc(fuzzyToText(p.bornRaw))}" placeholder="1932, about 1932, May 14, 1932"></div>
      <div class="field"><label for="fDied">Died</label><input id="fDied" value="${esc(fuzzyToText(p.diedRaw))}" placeholder="Year or date"></div></div>
    <div class="field"><label for="fPlace">Where were they born?</label><input id="fPlace" value="${esc(p.bornPlace || '')}" placeholder="&quot;Cleveland&quot; or &quot;somewhere in Ohio&quot; is fine"></div>
    <div class="field"><label for="fNotes">Anything you remember</label><textarea id="fNotes" placeholder="A job, a habit, a story they told">${esc(p.notes || '')}</textarea></div>`}
    </div>
    ${self ? '' : `<div class="field"><label for="fSource">Information source</label><input id="fSource" placeholder="Family Bible, Grandma told me, a gravestone" value="${esc(opts.edit ? '' : (p.source || ''))}"></div>
    ${whoField()}`}
    <p class="formerr" id="formErr" role="alert" hidden></p>
    <p class="hint" id="fNameHint">${self ? 'Only your first name is needed. While you\'re living, only your names show on the tree; your birthday, birthplace and notes stay private.'
      : 'Only a name is needed, and "I don\'t know their name" works too. For living people, only names show (first, middle, nickname, last now); everything else stays private.'}</p>`;
}
const isNoName = q => !q.placeholder && sameName(q.first, 'Unknown') && !q.middle && !q.last && !q.nicknames;
// "Mom", "great Grandma", "Uncle Rob": what the person typing calls them, not a nickname. A gentle note, never a block.
const KIN_WORD = /^(my |our )?((great|gr8)[- ]?)*(grand)?(ma|mom|mommy|mother|mama|pa|dad|daddy|father|papa|nana|nanna|granny|gramma|grammy|grandma|grandpa|grampa|gramps|grandmother|grandfather)$|^(aunt|auntie|aunty|uncle|cousin|sister|brother|sis|bro|step[- ]?\w+)\b/i;
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
    if (!e.target.closest('.seg button, #fNoName')) return;
    const f = readForm();
    if (kind === 'add' && ![f.first, f.middle, f.last, f.nick, f.birthName, f.otherNames.length, f.born, f.died, f.bornPlace, f.notes, f.source].some(Boolean)) return;
    keep();
  });
}
function clearDraft() { store.del('roots_draft'); }
function fillForm(f) {
  const set = (id, v) => { const el = $('#' + id); if (el && v) el.value = v; };
  set('fFirst', f.first); set('fMiddle', f.middle); set('fSex', f.sex); set('fLast', f.last); set('fNick', f.nick); set('fBirthName', f.birthName);
  const others = Array.isArray(f.otherNames) ? f.otherNames : (f.otherNames ? String(f.otherNames).split(',') : []);
  if ($('#fOtherList')) { $('#fOtherList').innerHTML = ''; others.forEach(v => addNameRow(v.trim(), false)); }
  if (f.birthName || others.length) showNames(); set('fBorn', f.born); set('fDied', f.died); set('fPlace', f.bornPlace); set('fNotes', f.notes); set('fSource', f.source);
  document.querySelectorAll('#fLiving button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === f.living));
  if (f.noName && $('#fNoName')) { $('#fNoName').checked = true; syncNoName(); }
}
function syncNoName() {
  const on = !!($('#fNoName') && $('#fNoName').checked);
  if ($('#fNameBlock')) $('#fNameBlock').hidden = on;
  if ($('#fNoNameHint')) $('#fNoNameHint').hidden = !on;
}
function readForm() {
  const v = id => (($('#' + id) || {}).value || '').trim();
  const noName = !!($('#fNoName') && $('#fNoName').checked);
  if (noName) return { noName, sex: v('fSex'), first: '', middle: '', last: '', nick: '', birthName: '', otherNames: [], born: v('fBorn'), died: v('fDied'), bornPlace: v('fPlace'), notes: v('fNotes'), source: v('fSource'), who: v('fWho'), living: segVal('fLiving') || 'unknown' };
  return { sex: v('fSex'), first: v('fFirst'), middle: v('fMiddle'), last: v('fLast'), nick: v('fNick'), birthName: v('fBirthName'), otherNames: [...document.querySelectorAll('.fOtherName')].map(x => x.value.trim()).filter(Boolean), born: v('fBorn'), died: v('fDied'), bornPlace: v('fPlace'), notes: v('fNotes'), source: v('fSource'), who: v('fWho'), living: segVal('fLiving') || 'unknown' };
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
  const nn = $('#fNoName'); if (nn) nn.onchange = syncNoName;
  const nick = $('#fNick'), warn = $('#fNickWarn');
  if (nick && warn) { const w = () => { warn.hidden = !KIN_WORD.test(nick.value.trim()); }; nick.addEventListener('input', w); w(); }
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
  d.sex = f.sex || '';
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
  lastReview = sessionAdded;
  sessionAdded = [];
  showReview();
}
/* Review after saving (Jonny, 2026-11-22): what they just sent, laid out to read rather than in form boxes, with Edit
   to go back and change it. Built from what they typed, so it shows before the tree has reloaded. Editing an unconfirmed
   person rewrites what they sent, then comes back here. */
let lastReview = [];
function reviewFacts(e) {
  const f = e.f || {}, rows = [];
  const name = [f.first, f.middle, f.last].filter(Boolean).join(' ') + (f.nick ? ` "${f.nick}"` : '');
  if (f.birthName && !sameName(f.birthName, f.last)) rows.push(['Last name at birth', f.birthName]);
  if ((f.otherNames || []).length) rows.push(['Other last names', f.otherNames.join(', ')]);
  if (e.line) rows.push([e.self ? 'Where you fit' : 'Where they fit', e.line]);
  const sexW = { female: 'Female', male: 'Male', other: 'Other' }[f.sex];
  if (sexW) rows.push(['Gender', sexW]);
  if (!e.self) rows.push(['Living?', { living: 'Living', deceased: 'Passed away' }[f.died ? 'deceased' : f.living] || 'Not sure']);
  if (f.born) rows.push(['Born', f.born + (f.bornPlace ? ', ' + f.bornPlace : '')]);
  else if (f.bornPlace) rows.push(['Born in', f.bornPlace]);
  if (f.died) rows.push(['Died', f.died]);
  // "How I'm related" was asked on its own and already shows as Where you fit.
  const notes = e.said && (f.notes || '').startsWith(e.said) ? f.notes.slice(e.said.length).trim() : f.notes;
  if (notes) rows.push([e.self ? 'Your note' : 'What you remember', notes]);
  if (f.source) rows.push(['Where you learned it', f.source]);
  return { name: f.noName ? 'Unknown (no name yet)' : name || e.name, rows };
}
function showReview() {
  const list = lastReview, n = list.length, people = list.filter(e => !e.linkOnly);
  const first = list[0] || {};
  const firstName = first.self ? 'You' : first.name;
  $('#thanksTitle').innerHTML = n > 1 ? `Thank you. ${n} ${people.length === n ? 'people' : 'additions'} planted.`
    : first.self ? "Thank you. You're on the tree." : `Thank you. ${esc(firstName)} is planted.`;
  $('#thanksBody').textContent = ADMIN_KEY ? 'Owner mode: it went live right away.'
    : `${OWNER_NAME} looks over every addition before everyone sees it. Until then ${n > 1 ? 'they show' : first.self ? 'you show' : esc(firstName) + ' shows'} on your tree, marked unconfirmed.`;
  const box = $('#thanksReview');
  box.innerHTML = `<h2>Here's what you sent</h2>` + list.map((e, i) => {
    if (e.linkOnly) return `<div class="rvcard"><p class="rvlink">${esc(e.line)}</p></div>`;
    const r = reviewFacts(e);
    return `<div class="rvcard"><div class="rvhead"><b>${esc(r.name)}</b>${e.id ? `<button class="iconbtn" data-rv="${i}">Edit</button>` : ''}</div>
      ${r.rows.length ? `<dl>${r.rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}</div>`;
  }).join('') + `<p class="hint">Something wrong, or remember more? Tap Edit. ${ADMIN_KEY ? '' : `You can change it until ${OWNER_NAME} confirms it.`}</p>`;
  box.hidden = !n;
  box.querySelectorAll('[data-rv]').forEach(b => b.onclick = () => reviewEdit(list[+b.dataset.rv]));
  showPage('thanks');
  $('#thanks').scrollTop = 0;
}
async function reviewEdit(e) {
  hidePage('thanks');
  if (pendingReload || !G.people.has(e.id)) { pendingReload = false; await reload(); }
  if (!G.people.has(e.id)) { toast("Couldn't find it on the tree yet. Try again in a moment."); return; }
  openEdit(e.id, null, e);
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
    box.innerHTML = hits.length ? `<span>Already in the tree?</span>` + hits.map(p => `<button type="button" data-id="${p.id}">${esc(cardName(p))}<small>${esc([relation(p.id) || whoLine(p), years(p)].filter(Boolean).join(' · '))}</small></button>`).join('') : '';
    box.querySelectorAll('button').forEach(b => b.onclick = () => onPick(b.dataset.id));
  };
  first.addEventListener('input', check); if (last) last.addEventListener('input', check);
}

function openEdit(id, restore, fromReview) {
  const p = P(id);
  // Their own unconfirmed person: the fix rewrites what they sent. A confirmed person: changes are compared with what
  // Jonny confirmed (p.base), and any changes they sent earlier are replaced, not stacked.
  const own = !!p.pending, b = p.base || p;
  const lvOf = q => q.placeholder ? 'unknown' : q.livingRaw || (isLiving(q) ? 'living' : 'deceased');
  const lv = lvOf(b), lvNow = p.edits && !p.livingRaw && b.placeholder ? 'unknown' : lvOf(p);
  const sub = ADMIN_KEY ? 'Owner mode: changes go live right away.'
    : own ? `Still waiting for ${OWNER_NAME}, so your fix replaces what you sent.`
    : `Your changes go to ${OWNER_NAME} to confirm. Nobody's entry gets overwritten.`;
  openPanel(`
    <div class="head"><div><h2>${b.placeholder ? 'Who was this?' : 'Edit ' + esc(p.first)}</h2><div class="sub">${sub}</div></div>
      <button class="x" id="pClose" aria-label="Close">${ICON.close}</button></div>
    <form class="body form" id="editForm" novalidate>${fieldsHTML(p, lvNow, { edit: !own, noName: own || isNoName(p), self: id === STATE.viewer && isLiving(p) })}${own ? '' : parentKindsHTML(id) + partnerKindsHTML(id)}</form>
    <div class="foot"><button class="iconbtn" id="pBack">Cancel</button><button class="primary" id="pSave">Save</button></div>`);
  wireCommon();
  if (restore) fillForm(restore.fields);
  watchForm('edit', id);
  if (restore) formDirty = true;
  $('#pClose').onclick = () => guardClose(); $('#pBack').onclick = () => guardClose(() => fromReview ? (closePanel(), showReview()) : openPerson(id));
  $('#editForm').onsubmit = e => { e.preventDefault(); currentSave(); };
  const done = f => {
    busy(false); clearDraft(); closePanel();
    if (fromReview && own) {
      // Back to "Here's what you sent", with the new version. The tree reloads when they leave it.
      fromReview.f = { ...f, notes: f.notes }; fromReview.name = f.first || f.last || fromReview.name;
      pendingReload = true; showReview(); return;
    }
    const who = f.first || p.first || 'it';
    showThanks(own ? `Fixed. ${esc(who === 'Unknown' ? 'Your entry' : who)} is updated.` : `Thank you. Your changes to ${esc(who)} are saved.`,
      ADMIN_KEY ? 'Owner mode: they went live right away.'
      : own ? `${OWNER_NAME} will see the new version, not the old one.`
      : `${OWNER_NAME} looks over every change before everyone sees it. Until then you see them on your tree, marked "Your edit". Both versions stay on record, with who said each.`);
    reload();
  };
  $('#pSave').onclick = currentSave = async () => {
    const f = readForm();
    if (own) {
      let data;
      try {
        data = personData(f);
        if (p.placeholder && !f.first && !f.last && !f.nick) { delete data.first_name; data.is_placeholder = true; }
        else if (p.placeholder) data.is_placeholder = false;
      } catch (err) { formError(err.message); return; }
      formError(''); busy(true);
      try { if (f.who) store.set('roots_display_name', f.who); await api({ action: 'own_edit', id, data, source: f.source }); }
      catch (err) { busy(false); formError(err.message); return; }
      done(f); return;
    }
    let changes;
    // Their earlier unconfirmed changes to this person and its links: replaced by this save.
    const linkIds = [...PC_ID, ...PT_ID].filter(([k]) => k.split(/[>~]/).includes(id)).map(([, rid]) => rid);
    const earlier = [id, ...linkIds].flatMap(t => (OWN_SUGG.get(t) || []).map(s => s.id));
    try {
      const n0 = namesFromPerson(b), was0 = namesToData(n0.last, n0.birthName, n0.otherNames), now0 = namesToData(f.last, f.birthName, f.otherNames);
      const was = { first_name: b.placeholder ? '' : b.first, middle_name: b.middle || '', nicknames: b.nicknames || '', birth_surname: was0.birth_surname, married_names: JSON.stringify(was0.married_names), living: lv,
        birth_date: b.bornRaw || '', death_date: b.diedRaw || '', birth_place: b.bornPlace || '', notes: b.notes || '', sex: b.sex || '' };
      const now = { first_name: f.first, middle_name: f.middle, nicknames: f.nick, birth_surname: now0.birth_surname, married_names: JSON.stringify(now0.married_names), living: f.living, birth_date: toFuzzy(f.born, 'Born'),
        death_date: toFuzzy(f.died, 'Died'), birth_place: f.bornPlace, notes: f.notes, sex: f.sex || '' };
      if (f.noName && !b.placeholder) now.first_name = 'Unknown';
      changes = Object.keys(now).filter(k => now[k] !== was[k])
        .map(k => ({ kind: 'suggestion', target_id: id, field: k, value: k === 'married_names' ? JSON.parse(now[k]) : now[k], source: f.source }));
      if (b.placeholder && (f.first || f.last)) changes.push({ kind: 'suggestion', target_id: id, field: 'is_placeholder', value: false, source: f.source });
      document.querySelectorAll('#editForm select[data-parent]').forEach(sel => {
        if (sel.value && sel.value !== sel.dataset.was) changes.push(linkChange(PC_ID.get(sel.dataset.parent + '>' + id), sel.value, f.source));
      });
      document.querySelectorAll('#editForm select[data-partner]').forEach(sel => {
        if (sel.value !== sel.dataset.was) changes.push(linkChange(PT_ID.get([id, sel.dataset.partner].sort().join('~')), sel.value, f.source));
      });
    } catch (err) { formError(err.message); return; }
    if (!changes.length && !earlier.length) { formError("Nothing has changed yet."); return; }
    formError(''); busy(true);
    try {
      if (changes.length) await api({ action: 'submit', display_name: f.who || myName() || undefined, items: changes, withdraw: earlier.length ? earlier : undefined });
      else await api({ action: 'withdraw', ids: earlier });   // they put everything back the way Jonny confirmed it
      if (f.who) store.set('roots_display_name', f.who);
    }
    catch (err) { busy(false); formError(err.message); return; }
    done(f);
  };
}

/* opts: { rel, fields, self } ; anchor may be null when the tree is empty (adding yourself first). */
function openAdd(id, opts = {}) {
  const p = id ? P(id) : null;
  const self = !!opts.self, loose = self && !p && !!opts.loose;
  const rel = opts.rel || (self ? 'child' : 'child');
  const done = sessionAdded.length;
  const relWord = p ? (self ? 'You are ' : 'They are ') + esc(p.first || 'this person') + "'s" : '';
  const parents = p ? parentsOf(p.id) : [];
  // Step-parents of p: partners of p's parents who aren't p's parents.
  const stepParents = p ? [...new Set(parents.flatMap(pp => partnersOf(pp).map(x => x.id)))].filter(sp => !parents.includes(sp) && !P(sp).placeholder) : [];
  openPanel(`
    <div class="head"><div><h2>${self ? 'Add yourself' : `Add someone to ${esc(p.placeholder ? 'this branch' : p.first + "'s branch")}`}</h2>
      <div class="sub">${done ? `${done} saved so far. Keep going, or tap Save on the last one.` : loose ? `Start with your name, then tell ${OWNER_NAME} how you're related. He'll put you in the right place.` : self ? 'Start with your name. You can add more later.' : 'Add who you know, including relatives who have died.'}</div></div>
      <button class="x" id="pClose" aria-label="Close">${ICON.close}</button></div>
    <form class="body form" id="addForm" novalidate>
      ${p ? `<div class="field"><span class="lab">${relWord}</span><div class="seg" id="fRel">
        ${['parent', 'partner', 'sibling', 'child', ...(self ? ['other'] : [])].map(v => `<button type="button" data-v="${v}" aria-pressed="${v === rel}">${v === 'other' ? 'Something else' : v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div></div>
      ${self ? `<div class="field" id="fHowWrap" hidden><label for="fHow">What are you to ${esc(p.first || 'them')}?</label><input id="fHow" autocomplete="off" placeholder="Niece, cousin, grandson, son-in-law">
        <p class="hint">${OWNER_NAME} will connect you in the right spot when he confirms it.</p></div>` : ''}
      <div class="field" id="fSibWrap" hidden><span class="lab">What kind of sibling? ${infoBtn(INFO.sibling)}</span><div class="seg" id="fSib"><button type="button" data-v="full" aria-pressed="true">Full</button><button type="button" data-v="half" aria-pressed="false">Half</button><button type="button" data-v="step" aria-pressed="false">Step</button></div></div>
      <div class="field" id="fSibParWrap" hidden><label for="fSibPar" id="fSibParLab">Which parent do you share?</label><select id="fSibPar"></select><p class="hint" id="fSibHint" hidden></p></div>
      <div class="field" id="fPcWrap" hidden><span class="lab"><span id="fPcLab">What kind of parent?</span> ${infoBtn(INFO.parent)}</span><div class="seg" id="fPc">${PC_KINDS.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${v === 'biological'}">${l}</button>`).join('')}</div>
        <p class="hint" id="fPcHint" hidden>This takes one of the two parent spots. If the birth parent might be added later, add a step-parent as the parent's partner instead; the tree labels them Stepfather or Stepmother on its own.</p></div>
      <div class="field" id="fOtherWrap" hidden><label for="fOther" id="fOtherLab">Their other parent</label><select id="fOther"></select></div>
      <div class="field" id="fKindWrap" hidden><span class="lab">Together as ${infoBtn(INFO.couple)}</span><div class="seg" id="fKind"><button type="button" data-v="married" aria-pressed="true">Married</button><button type="button" data-v="partner" aria-pressed="false">Partners</button><button type="button" data-v="divorced" aria-pressed="false">Divorced</button><button type="button" data-v="former" aria-pressed="false">Former partners</button><button type="button" data-v="widowed" aria-pressed="false">Widowed</button></div></div>
      <div class="field" id="fKidsWrap" hidden><span class="lab" id="fKidsLab">Are they also the parent of…</span><div class="kids" id="fKids"></div></div>
      ${self ? '' : `<div class="field"><span class="lab">Who are they? ${infoBtn(INFO.which)}</span><div class="seg" id="fWhich"><button type="button" data-v="new" aria-pressed="true">Someone new</button><button type="button" data-v="existing" aria-pressed="false">Already in the tree</button></div></div>
      <div id="fPickWrap" hidden><div class="field"><label for="fPickQ">Find them</label><input id="fPickQ" placeholder="Type a name, or tap one below" autocomplete="off"></div><div class="pick tall" id="fPickList"></div></div>`}
` : loose ? `<div class="field" id="fHowWrap"><label for="fHow">How are you related to the family?</label><input id="fHow" autocomplete="off" placeholder="Barbara Hale is my aunt">
        <p class="hint">Name someone in the family and what they are to you. ${OWNER_NAME} will connect you in the right spot when he confirms it.</p></div>` : ''}
      ${fieldsHTML({}, self ? 'living' : 'unknown', { self })}
      <input type="hidden" id="fLink" value="">
    </form>
    <div class="foot"><button class="iconbtn" id="pBack">Cancel</button>${self ? '' : '<button class="iconbtn" id="pMore">Save &amp; add another</button>'}<button class="primary" id="pSave">Save</button></div>`);
  /* Parents. Two birth parents fill a person's two spots. A step-parent is stored as the partner of a parent
     (the tree then labels them Stepfather or Stepmother), so the birth parents keep their spots. With both spots
     taken, only Step can be chosen; Birth, Adoptive and Foster are grayed out. */
  const full = parents.length >= 2;
  const pcSub = () => ($('#fPcWrap') && !$('#fPcWrap').hidden && segVal('fPc')) || 'biological';
  const optsOf = (list, none) => list.map(x => `<option value="${x}">${esc(displayName(P(x)))}</option>`).join('') + (none ? `<option value="">${none}</option>` : '');
  const syncParent = () => {
    const ow = $('#fOtherWrap'), kw = $('#fKindWrap'), h = $('#fPcHint');
    if (segVal('fRel') !== 'parent') { if (h) h.hidden = true; return; }
    document.querySelectorAll('#fPc button').forEach(b => {
      const off = full && b.dataset.v !== 'step';
      b.classList.toggle('off', off); b.setAttribute('aria-disabled', off ? 'true' : 'false');
    });
    if (full && segVal('fPc') !== 'step') document.querySelectorAll('#fPc button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === 'step'));
    const step = segVal('fPc') === 'step';
    $('#fOther').onchange = null; ow.hidden = true;
    if (step && parents.length) {
      $('#fOtherLab').textContent = 'Married to';
      $('#fOther').innerHTML = (full ? '<option value="" disabled selected>Choose one</option>' : '') + optsOf(parents, full ? '' : 'Neither, or not sure');
      ow.hidden = false; kw.hidden = !$('#fOther').value;
      $('#fOther').onchange = () => { kw.hidden = !$('#fOther').value; };
      h.textContent = full
        ? `${p.first || 'They'} already ${self ? 'have' : 'has'} two birth parents here, so a step-parent is linked through their marriage to one of them. The tree labels them Stepfather or Stepmother.`
        : 'Linked through their marriage, so the birth parent keeps their place. Choose "Neither" only if they weren\'t married to a parent in the tree.';
      h.hidden = false;
    } else if (parents.length) {
      $('#fOtherLab').textContent = 'Together with';
      $('#fOther').innerHTML = optsOf(parents, 'Neither, or not sure');
      if (parents.length > 1) $('#fOther').value = '';
      ow.hidden = false; kw.hidden = !$('#fOther').value;
      $('#fOther').onchange = () => { kw.hidden = !$('#fOther').value; };
      h.hidden = true;
    } else {
      h.textContent = 'This takes one of the two parent spots. If the birth parent might be added later, add the step-parent as that parent\'s partner instead.';
      h.hidden = !step;
    }
  };
  /* Siblings: Full links to all of p's parents; Half to the one parent they share; Step to one of p's step-parents. */
  const syncSib = () => {
    const on = segVal('fRel') === 'sibling';
    $('#fSibWrap').hidden = !on;
    const k = segVal('fSib'), wrap = $('#fSibParWrap'), sel = $('#fSibPar'), h = $('#fSibHint');
    wrap.hidden = !on || k === 'full'; h.hidden = true;
    if (!on || k === 'full') return;
    const who = self ? 'you' : (p.first || 'they');
    if (k === 'half') {
      $('#fSibParLab').textContent = self ? 'Which parent do you share?' : `Which of ${p.first || 'their'}'s parents do they share?`;
      sel.innerHTML = parents.map(x => `<option value="${x}">${esc(displayName(P(x)))}</option>`).join('');
      sel.hidden = !parents.length;
      if (!parents.length) { h.textContent = `Add the parent ${who} share first (Parent on this card), then come back for the half-sibling.`; h.hidden = false; }
    } else {
      $('#fSibParLab').textContent = 'Whose child are they?';
      sel.innerHTML = stepParents.map(x => `<option value="${x}">${esc(displayName(P(x)))}</option>`).join('');
      sel.hidden = !stepParents.length;
      h.textContent = stepParents.length ? 'Step-siblings are linked through their own parent, so the tree can show them beside the step-parent.'
        : `Add the step-parent first (Parent > Step on this card), then come back for their children.`;
      h.hidden = false;
    }
  };
  const syncRel = v => {
    if (!p) return;
    const ow = $('#fOtherWrap'), kw = $('#fKindWrap');
    ow.hidden = true; kw.hidden = v !== 'partner';
    if ($('#fHowWrap')) $('#fHowWrap').hidden = v !== 'other';
    $('#fPcWrap').hidden = v !== 'parent' && v !== 'child';
    $('#fPcLab').textContent = v === 'child' ? `What kind of parent is ${p.first || 'this person'}?` : 'What kind of parent?';
    document.querySelectorAll('#fPc button').forEach(b => { b.classList.remove('off'); b.setAttribute('aria-disabled', 'false'); });
    $('#fOther').onchange = null;
    if (v === 'child') {
      // Who else is this child's parent? Defaults to the current partner.
      const prts = partnersOf(p.id).map(x => x.id);
      // With two or more partners (an ex and a current spouse) there's no safe guess, so they choose (2026-11-22).
      if (prts.length) {
        $('#fOtherLab').textContent = self ? 'Your other parent' : 'Their other parent';
        $('#fOther').innerHTML = (prts.length > 1 ? '<option value="__choose" disabled selected>Choose one</option>' : '') + optsOf(prts, 'Someone else, or not sure');
        ow.hidden = false;
      }
    }
    syncParent();
    syncSib();
    // A new partner: offer the children who have only this one parent so far.
    const kw2 = $('#fKidsWrap');
    const lone = v === 'partner' ? childrenOf(p.id).filter(c => parentsOf(c).length === 1 && !P(c).placeholder) : [];
    kw2.hidden = !lone.length;
    if (lone.length) {
      $('#fKidsLab').textContent = `Are they also the parent of ${lone.length === 1 ? 'this child' : 'any of these children'}?`;
      $('#fKids').innerHTML = lone.map(c => `<label class="kid"><input type="checkbox" value="${esc(c)}"><span>${esc(displayName(P(c)))}</span></label>`).join('');
    }
  };
  if (p) {
    wireSeg('fRel', syncRel); wireSeg('fKind'); wireSeg('fPc', syncParent); wireSeg('fSib', syncSib);
    // Grayed kinds explain themselves instead of doing nothing.
    document.querySelectorAll('#fPc button').forEach(b => { const on = b.onclick; b.onclick = () => {
      if (b.classList.contains('off')) { toast(`${p.first || 'They'} already ${self ? 'have' : 'has'} two birth parents. Choose Step.`); return; }
      on();
    }; });
    syncRel(rel);
  }
  wireCommon();
  /* "Already in the tree": tap someone instead of typing them again (2026-11-21, Bo couldn't link Marilyn to the Unknown
     already there). Likely matches come first: for Parent, the partners of the parent already recorded; for Child,
     their partners' children; for Partner, the other parents of their children. Unknowns are included. */
  const picking = () => segVal('fWhich') === 'existing';
  const likely = () => {
    const r = segVal('fRel'), kids = childrenOf(p.id), pars = parentsOf(p.id), pts = partnersOf(p.id).map(x => x.id);
    if (r === 'parent') return pars.flatMap(pp => partnersOf(pp).map(x => x.id)).filter(x => !pars.includes(x));
    if (r === 'child') return pts.flatMap(pt => childrenOf(pt)).filter(c => !kids.includes(c));
    if (r === 'partner') return kids.flatMap(c => parentsOf(c)).filter(x => x !== p.id && !pts.includes(x));
    return pars.flatMap(pp => partnersOf(pp).flatMap(x => childrenOf(x.id))).filter(c => c !== p.id && !pars.every(pp => parentsOf(c).includes(pp)));
  };
  const renderPick = () => {
    const list = $('#fPickList'); if (!list) return;
    const q = $('#fPickQ').value.toLowerCase().trim(), chosen = $('#fLink').value;
    const sugg = [...new Set(likely())].filter(x => G.people.has(x) && nameMatches(P(x), q));
    const rest = [...G.people.values()].filter(x => x.id !== p.id && !sugg.includes(x.id) && (q ? nameMatches(x, q) : !x.placeholder)).slice(0, 40).map(x => x.id);
    const row = x => `<button type="button" data-id="${esc(x)}" aria-pressed="${x === chosen}">${listName(P(x))}<small>${x === chosen ? 'Chosen' : esc(relation(x) || '')}</small></button>`;
    list.innerHTML = (sugg.length ? `<span class="picklab">Most likely</span>${sugg.map(row).join('')}` : '') +
      (rest.length ? `<span class="picklab">${sugg.length ? 'Everyone else' : q ? 'Matches' : 'Everyone'}</span>${rest.map(row).join('')}` : '') ||
      '<p class="hint">Nobody by that name yet. Choose "Someone new" to add them.</p>';
    list.querySelectorAll('button').forEach(b => b.onclick = () => { $('#fLink').value = b.dataset.id; formDirty = true; renderPick(); });
  };
  const syncWhich = () => {
    const on = picking();
    if ($('#fPickWrap')) $('#fPickWrap').hidden = !on;
    ['#fPersonFields', '#fNameHint'].forEach(s => { const el = $(s); if (el) el.hidden = on; });
    $('#fLink').value = ''; if ($('#dups')) $('#dups').innerHTML = '';
    if (on) renderPick();
  };
  if (p && !self) {
    wireSeg('fWhich', syncWhich);
    $('#fPickQ').addEventListener('input', renderPick);
    // A different relationship changes who's most likely.
    document.querySelectorAll('#fRel button').forEach(b => b.addEventListener('click', () => { if (picking()) { $('#fLink').value = ''; renderPick(); } }));
  }
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
    if (!link && segVal('fWhich') === 'existing') throw new Error('Tap who they are in the list, or choose "Someone new".');
    const me = link || 'new:1';
    const items = [];
    const r = p ? segVal('fRel') : '';
    const dn = x => displayName(P(x));
    let line = '', said = '';   // how they connect, in words, for the review after saving
    if (self) {
      if (!f.first) throw new Error('Type your first name.');
      f.who = [f.first, f.last].filter(Boolean).join(' ');
      const how = (($('#fHow') || {}).value || '').trim();
      if (loose || r === 'other') {
        if (!how) throw new Error(loose ? 'Say how you\'re related, for example "Barbara Hale is my aunt".' : `Say what you are to ${p.first || 'them'}, for example "niece".`);
        // Saved in their notes (private while they're living) for Jonny to read when he places them.
        said = loose ? `How I'm related: ${how}` : `Related to ${dn(p.id)}: ${how}`;
        f.notes = f.notes ? said + '\n\n' + f.notes : said;
        line = loose ? `How you're related: ${how}` : `${dn(p.id)}'s ${how}`;
      }
    }
    if (!link) {
      if (!f.first && !f.last && !f.noName) throw new Error('Add at least a name, or tick "I don\'t know their name".');
      items.push({ kind: 'person', ref: 'new:1', data: personData(f), source: f.source });
    }
    if (p && r !== 'other') {
      if (r === 'child') {
        const k = pcSub();
        items.push({ kind: 'relationship', type: 'parent_child', a: p.id, b: me, subtype: k, source: f.source });
        const other = $('#fOtherWrap').hidden ? '' : $('#fOther').value;
        if (other === '__choose') throw new Error(`Choose ${self ? 'your' : 'their'} other parent, or "Someone else, or not sure".`);
        // A stepchild is usually their other parent's birth child; adopted or fostered children usually by both.
        if (other) items.push({ kind: 'relationship', type: 'parent_child', a: other, b: me, subtype: k === 'step' ? 'biological' : k, source: f.source });
        line = `Child of ${dn(p.id)}${other ? ' and ' + dn(other) : ''}${k !== 'biological' ? ` (${(PC_KINDS.find(x => x[0] === k) || [, k])[1].toLowerCase()} parent)` : ''}`;
      } else if (r === 'parent') {
        const k = pcSub();
        const other = $('#fOtherWrap').hidden ? '' : $('#fOther').value;
        if (k === 'step' && other) {
          // Stored as the parent's partner; the tree works out "Stepfather" from that.
          if (other !== me) items.push({ kind: 'relationship', type: 'partner', a: other, b: me, subtype: segVal('fKind') || 'married', source: f.source });
          line = `Step-parent of ${dn(p.id)}, through ${dn(other)}`;
        } else {
          if (full) throw new Error(k === 'step' ? 'Choose who they were married to.' : 'Two parents are already here. Choose Step and who they were married to.');
          items.push({ kind: 'relationship', type: 'parent_child', a: me, b: p.id, subtype: k, source: f.source });
          if (other && other !== me) items.push({ kind: 'relationship', type: 'partner', a: other, b: me, subtype: segVal('fKind') || 'married', source: f.source });
          line = `${k === 'biological' ? 'Parent' : (PC_KINDS.find(x => x[0] === k) || [, ''])[1] + ' parent'} of ${dn(p.id)}${other && other !== me ? `, with ${dn(other)}` : ''}`;
        }
      }
      else if (r === 'partner') {
        const kind = segVal('fKind') || 'married';
        items.push({ kind: 'relationship', type: 'partner', a: p.id, b: me, subtype: kind, source: f.source });
        // Children of p they're also a parent of (ticked on the form).
        const kids = [...document.querySelectorAll('#fKids input:checked')].map(cb => cb.value);
        kids.forEach(c => items.push({ kind: 'relationship', type: 'parent_child', a: me, b: c, source: f.source }));
        const with_ = { married: 'Married to', partner: 'Partners with', divorced: 'Divorced from', former: 'Former partner of', widowed: 'Was married to' }[kind] || 'Partner of';
        line = `${with_} ${dn(p.id)}${kids.length ? `. Parent of ${andList(kids.map(dn))}` : ''}`;
      }
      else if (r === 'sibling' && segVal('fSib') === 'half') {
        const shared = $('#fSibPar').value;
        if (!shared) throw new Error('Add the parent they share first, then add the half-sibling.');
        line = `Half-sibling of ${dn(p.id)}, through ${dn(shared)}`;
        items.push({ kind: 'relationship', type: 'parent_child', a: shared, b: me, source: f.source });
        if (parents.length < 2 && !link) {
          // With only one parent recorded, an unknown other parent keeps them a half-sibling rather than a full one.
          items.push({ kind: 'person', ref: 'new:hp', data: { is_placeholder: true } });
          items.push({ kind: 'relationship', type: 'parent_child', a: 'new:hp', b: me });
        }
      }
      else if (r === 'sibling' && segVal('fSib') === 'step') {
        const sp = $('#fSibPar').value;
        if (!sp) throw new Error('Add the step-parent first, then add their children.');
        items.push({ kind: 'relationship', type: 'parent_child', a: sp, b: me, source: f.source });
        line = `Step-sibling of ${dn(p.id)}, child of ${dn(sp)}`;
      }
      else if (r === 'sibling') {
        line = `Brother or sister of ${dn(p.id)}`;
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
    if (link) line = `${dn(link)}, already in the tree, linked as ${p.first || 'their'}'s ${r}`;
    return { items, line, said, name: link ? P(link).first : (f.first || f.last || 'Unknown') };
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
    const newId = (res && res.ids && res.ids['new:1']) || '';
    sessionAdded.push({ name: b.name, id: newId, f, line: b.line, said: b.said, linkOnly: !newId, self });
    // if the new person won't be on screen from here, the next reload centers on the card they were added to
    showAfterSave = { anchor: id, ids: [...Object.values((res && res.ids) || {}), $('#fLink') && $('#fLink').value].filter(Boolean) };
    if (self) {
      STATE.viewer = (res.ids && res.ids['new:1']) || $('#fLink').value || STATE.viewer;
      // Not linked yet ("Something else", or nobody they know): open on the relative they named, or on Jonny, so
      // they see family instead of one card on its own.
      STATE.focus = (b.said && (p ? p.id : STATE.owner)) || STATE.viewer;
    }
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
let showAfterSave = null;
function showPage(id) { $('#' + id).classList.add('on'); }
function hidePage(id) { $('#' + id).classList.remove('on'); }
function showThanks(title, body) { $('#thanksTitle').innerHTML = title; $('#thanksBody').textContent = body; $('#thanksReview').hidden = true; showPage('thanks'); }
$('#thanksBack').onclick = () => { hidePage('thanks'); if (pendingReload) { pendingReload = false; setTimeout(() => reload(), 150); } };
$('#thanksSend').onclick = () => { hidePage('thanks'); if (pendingReload) { pendingReload = false; reload(); } openSend(); };

function siteBase() { return location.origin + location.pathname.replace(/[^/]*$/, ''); }
function shareLink() { const from = STATE.viewer || ''; return siteBase() + (from ? '?from=' + encodeURIComponent(from) : ''); }
function openSend() {
  const v = STATE.viewer && P(STATE.viewer);
  // The owner's own message is short; a relative forwarding it needs to say who is building this and why it's reaching them.
  const msg = ADMIN_KEY
    ? `I'm helping build our family tree. Open this, look around, and add anyone you know, especially the relatives we've lost. It takes a minute.\n\n${shareLink()}`
    : `${OWNER_NAME} is putting together a family tree for our whole family, and he's asking each of us to pass it along to the relatives we know. That's how it reaches every branch. I'm sending it to you because you probably know names and stories I don't.\n\nOpen the link, look around, and add anyone you know, especially relatives who have passed. It takes a few minutes.\n\n${shareLink()}`;
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

function pickPerson(title, sub, onPick, filter = () => true, escape = null) {
  openPanel(`
    <div class="head"><div><h2>${title}</h2><div class="sub">${sub}</div></div>
      <button class="x" id="pClose" aria-label="Close">${ICON.close}</button></div>
    <div class="body"><div class="field"><label for="qName">Name</label><input id="qName" placeholder="Start typing a name" autocomplete="off"></div><div class="pick" id="qList"></div></div>
    ${escape ? `<div class="foot"><button class="iconbtn" id="qEscape">${esc(escape.label)}</button></div>` : ''}`);
  $('#pClose').onclick = closePanel;
  if (escape) $('#qEscape').onclick = escape.onClick;
  const list = () => {
    const q = $('#qName').value.toLowerCase().trim();
    const hits = [...G.people.values()].filter(p => !p.placeholder && filter(p) && nameMatches(p, q)).slice(0, 40);
    $('#qList').innerHTML = hits.map(p => `<button data-id="${p.id}">${listName(p)}<small>${esc([relation(p.id), years(p)].filter(Boolean).join(' · '))}</small></button>`).join('') || '<p class="hint">Nobody by that name yet.</p>';
    document.querySelectorAll('#qList button').forEach(b => b.onclick = () => onPick(b.dataset.id));
  };
  $('#qName').oninput = list; list(); setTimeout(() => $('#qName').focus(), 50);
}
$('#btnSearch').onclick = () => pickPerson('Find a person', 'Everyone in the tree, folded branches included.', id => { closePanel(); STATE.focus = id; render(); });
// The Show menu (#btnAll) lives in app-levels.js.

/* Names in the details card that point at another person (a spouse in the last-name history) open that person. */
panel.addEventListener('click', e => { const a = e.target.closest('[data-goto]'); if (!a) return; e.preventDefault(); openPerson(a.dataset.goto); });
