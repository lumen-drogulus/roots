/* Roots: the tree page.
 * Talks to the Apps Script API in config.js. Privacy is enforced by the server: this page only ever
 * receives what a relative is allowed to see, plus that relative's own unconfirmed entries. */
'use strict';

/* =====================================================================
 * Setup: API address, this device's contributor id, owner mode
 * ===================================================================== */
const QS = new URLSearchParams(location.search);
const IS_LOCAL = /^(localhost|127\.0\.0\.1|)$/.test(location.hostname);
// A test API can only be swapped in on a local copy, never on the live site.
const API_URL = (IS_LOCAL && QS.get('api')) || window.ROOTS_CONFIG.API_URL;
const OWNER_NAME = 'Jonny Ruzicka';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};
function newToken() {
  const a = new Uint8Array(24); crypto.getRandomValues(a);
  return Array.from(a, b => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'[b % 64]).join('');
}
const TOKEN = store.get('roots_token') || (() => { const t = newToken(); store.set('roots_token', t); return t; })();
const ADMIN_KEY = store.get('roots_admin_key') || '';

async function api(body) {
  const payload = { token: TOKEN, ...body };
  if (ADMIN_KEY) payload.key = ADMIN_KEY;
  let res;
  try {
    res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
  } catch (e) { throw new Error("Couldn't reach the tree. Check your connection and try again."); }
  let json;
  try { json = await res.json(); } catch (e) { throw new Error('The tree sent back something unexpected. Try again in a minute.'); }
  if (!json.ok) throw new Error(json.error || 'Something went wrong. Try again in a minute.');
  return json;
}

/* =====================================================================
 * Dates: stored as "qualifier:YYYY[-MM[-DD]]"
 * ===================================================================== */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function parseFuzzy(s) {
  const m = /^(exact|about|before|after):(\d{1,4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(s || '');
  return m ? { q: m[1], y: +m[2], m: m[3] ? +m[3] : 0, d: m[4] ? +m[4] : 0 } : null;
}
function fuzzyShort(s) { const f = parseFuzzy(s); if (!f) return ''; return (f.q === 'exact' ? '' : f.q + ' ') + f.y; }
function fuzzyLong(s) {
  const f = parseFuzzy(s); if (!f) return '';
  const core = f.m ? (f.d ? `${MONTHS[f.m - 1]} ${f.d}, ${f.y}` : `${MONTHS[f.m - 1]} ${f.y}`) : String(f.y);
  return f.q === 'exact' ? core : f.q[0].toUpperCase() + f.q.slice(1) + ' ' + core;
}
/** What people type ("1932", "about 1932", "May 14, 1932", "5/14/1932", "before 1900") to the stored form. */
function toFuzzy(text, label) {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  if (!t) return '';
  const year = y => { if (y < 1000 || y > new Date().getFullYear() + 1) throw new Error(`${label}: that year doesn't look right.`); return y; };
  const pad = n => String(n).padStart(2, '0');
  let m;
  if ((m = /^(?:about|abt\.?|around|circa|c\.|ca\.?|~)\s*(\d{4})$/i.exec(t))) return 'about:' + year(+m[1]);
  if ((m = /^(?:before|bef\.?)\s*(\d{4})$/i.exec(t))) return 'before:' + year(+m[1]);
  if ((m = /^(?:after|aft\.?)\s*(\d{4})$/i.exec(t))) return 'after:' + year(+m[1]);
  if ((m = /^(\d{4})$/.exec(t))) return 'exact:' + year(+m[1]);
  if ((m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(t))) { if (+m[1] > 12 || +m[2] > 31) throw new Error(`${label}: use month/day/year.`); return `exact:${year(+m[3])}-${pad(m[1])}-${pad(m[2])}`; }
  const mi = s => MONTHS.findIndex(x => x.toLowerCase().startsWith(s.toLowerCase().slice(0, 3))) + 1;
  if ((m = /^([a-z]{3,})\.?\s+(\d{4})$/i.exec(t)) && mi(m[1])) return `exact:${year(+m[2])}-${pad(mi(m[1]))}`;
  if ((m = /^([a-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/i.exec(t)) && mi(m[1])) return `exact:${year(+m[3])}-${pad(mi(m[1]))}-${pad(m[2])}`;
  if ((m = /^(\d{1,2})\s+([a-z]{3,})\.?\s+(\d{4})$/i.exec(t)) && mi(m[2])) return `exact:${year(+m[3])}-${pad(mi(m[2]))}-${pad(m[1])}`;
  throw new Error(`${label}: try a year like 1932, "about 1932", or a full date like May 14, 1932.`);
}
function fuzzyToText(s) { const f = parseFuzzy(s); if (!f) return ''; if (f.q !== 'exact') return f.q + ' ' + f.y; return f.m ? (f.d ? `${MONTHS[f.m - 1]} ${f.d}, ${f.y}` : `${MONTHS[f.m - 1]} ${f.y}`) : String(f.y); }

/* =====================================================================
 * The tree from the API, shaped for the drawing engine
 * ===================================================================== */
let TREE = null;           // last API response
const PHOTOS = new Map();  // person id -> approved photos
const PT_ID = new Map();   // 'idA~idB' (sorted) -> approved partner relationship id
const PC_ID = new Map();   // 'parent>child' -> approved relationship id, for correcting the kind of parent

function fromPublic(p) {
  const married = p.married_names || [];
  return {
    id: p.id, first: p.first_name || '', last: p.last_name || '', middle: p.middle_name || '',
    birth: p.birth_surname && p.birth_surname !== p.last_name ? p.birth_surname : '',
    birthSurname: p.birth_surname || '', married,
    born: fuzzyShort(p.birth_date), died: fuzzyShort(p.death_date), bornRaw: p.birth_date || '', diedRaw: p.death_date || '',
    bornPlace: p.birth_place || '', diedPlace: p.death_place || '', notes: p.notes || '', source: p.source || '', nicknames: p.nicknames || '',
    living: !!p.living, sex: p.sex || '', placeholder: !!p.is_placeholder, addedBy: p.added_by || ''
  };
}
function fromOwn(p) {
  const married = p.married_names || [];
  const raw = p.living || 'unknown';
  const born = parseFuzzy(p.birth_date);
  const living = raw === 'living' || (raw !== 'deceased' && !p.death_date && !(born && born.q !== 'after' && born.y <= new Date().getFullYear() - 110));
  return {
    id: p.id, first: p.first_name || '', last: married.length ? married[married.length - 1] : (p.birth_surname || ''), middle: p.middle_name || '',
    birth: married.length ? p.birth_surname || '' : '', birthSurname: p.birth_surname || '', married,
    born: fuzzyShort(p.birth_date), died: fuzzyShort(p.death_date), bornRaw: p.birth_date || '', diedRaw: p.death_date || '',
    bornPlace: p.birth_place || '', diedPlace: p.death_place || '', notes: p.notes || '', source: p.source || '', nicknames: p.nicknames || '',
    living, livingRaw: raw, sex: p.sex || '', placeholder: !!p.is_placeholder, pending: true, addedBy: 'you'
  };
}
/* This relative's own unconfirmed work, so the page can show it and offer Edit and Take back.
   OWN_RELS: links they added. OWN_SUGG: their changes to confirmed people and links, by target id.
   LINK_BASE: each confirmed link's kind before their changes, so a re-edit compares against what Jonny confirmed. */
let OWN_RELS = [];
const OWN_SUGG = new Map();
const LINK_BASE = new Map();
const REL_BY_ID = new Map();

/* One of their unconfirmed changes, laid over a confirmed person so they see what they sent (Freddy, not Unknown). */
function applyOwnChange(p, field, v) {
  const s = v === undefined || v === null ? '' : v;
  if (field === 'first_name') p.first = s;
  else if (field === 'middle_name') p.middle = s;
  else if (field === 'nicknames') p.nicknames = s;
  else if (field === 'birth_surname' || field === 'married_names') {
    if (field === 'birth_surname') p.birthSurname = s; else p.married = Array.isArray(s) ? s : [];
    p.last = p.married.length ? p.married[p.married.length - 1] : p.birthSurname;
    p.birth = p.married.length ? p.birthSurname : '';
  }
  else if (field === 'living') p.livingRaw = s || 'unknown';
  else if (field === 'birth_date') { p.bornRaw = s; p.born = fuzzyShort(s); }
  else if (field === 'death_date') { p.diedRaw = s; p.died = fuzzyShort(s); }
  else if (field === 'birth_place') p.bornPlace = s;
  else if (field === 'death_place') p.diedPlace = s;
  else if (field === 'notes') p.notes = s;
  else if (field === 'sex') p.sex = s;
  else if (field === 'is_placeholder') p.placeholder = s === true || s === 'true';
}

function treeToGraphData(tree) {
  const people = [], rels = [];
  (tree.people || []).forEach(p => people.push(fromPublic(p)));
  PC_ID.clear(); PT_ID.clear(); LINK_BASE.clear(); REL_BY_ID.clear(); OWN_SUGG.clear();
  (tree.relationships || []).forEach(r => {
    const key = r.type !== 'partner' ? r.a + '>' + r.b : [r.a, r.b].sort().join('~');
    if (r.type !== 'partner') PC_ID.set(key, r.id); else PT_ID.set(key, r.id);
    LINK_BASE.set(key, r.subtype);
    const row = r.type === 'partner' ? ['partner', r.a, r.b, r.subtype] : ['pc', r.a, r.b, r.subtype];
    REL_BY_ID.set(r.id, { r, row }); rels.push(row);
  });
  const own = tree.own || {};
  (own.people || []).forEach(p => people.push(fromOwn(p)));
  const ids = new Set(people.map(p => p.id));
  OWN_RELS = (own.relationships || []).filter(r => ids.has(r.a) && ids.has(r.b));
  OWN_RELS.forEach(r => rels.push(r.type === 'partner' ? ['partner', r.a, r.b, r.subtype || 'unknown'] : ['pc', r.a, r.b, r.subtype || 'biological', true]));
  // Their changes to confirmed people and links show on their own screen right away, marked "Your edit".
  const byId = new Map(people.map(p => [p.id, p]));
  (own.suggestions || []).forEach(s => {
    const p = byId.get(s.target_id), link = REL_BY_ID.get(s.target_id);
    if (!p && !link) return;
    if (!OWN_SUGG.has(s.target_id)) OWN_SUGG.set(s.target_id, []);
    OWN_SUGG.get(s.target_id).push(s);
    if (link) { if (s.field === 'subtype' && s.value) link.row[3] = s.value; return; }
    if (p.pending) return;
    if (!p.base) p.base = { ...p, married: [...(p.married || [])] };
    applyOwnChange(p, s.field, s.value);
    p.edits = OWN_SUGG.get(s.target_id);
  });
  people.forEach(p => {
    if (!p.edits) return;
    const raw = p.livingRaw || (p.base.placeholder ? 'unknown' : p.base.living ? 'living' : 'deceased'), born = parseFuzzy(p.bornRaw);
    p.living = !p.placeholder && (raw === 'living' || (raw !== 'deceased' && !p.diedRaw && !(born && born.q !== 'after' && born.y <= new Date().getFullYear() - 110)));
  });
  PHOTOS.clear();
  (tree.photos || []).forEach(f => (f.tags || []).forEach(pid => { if (!PHOTOS.has(pid)) PHOTOS.set(pid, []); PHOTOS.get(pid).push(f); }));
  people.forEach(p => { p.photos = (PHOTOS.get(p.id) || []).length; });
  return { people, rels };
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

/* =====================================================================
 * Graph
 * ===================================================================== */
let G;
function buildGraph(data) {
  const g = { people: new Map(), parents: new Map(), children: new Map(), partners: new Map(), pcSub: new Map(), pending: new Set() };
  data.people.forEach(p => { g.people.set(p.id, { ...p }); g.parents.set(p.id, []); g.children.set(p.id, []); g.partners.set(p.id, []); });
  data.rels.forEach(([t, a, b, sub, pend]) => {
    if (!g.people.has(a) || !g.people.has(b)) return;
    if (t === 'partner') { g.partners.get(a).push({ id: b, sub }); g.partners.get(b).push({ id: a, sub }); }
    else { g.parents.get(b).push(a); g.children.get(a).push(b); g.pcSub.set(a + '>' + b, sub || 'biological'); if (pend) g.pending.add(a + '>' + b); }
  });
  return g;
}
const P = id => G.people.get(id);
const parentsOf = id => G.parents.get(id) || [];
const isFormer = s => s === 'divorced' || s === 'former';
const pcKind = (a, b) => { const s = G.pcSub.get(a + '>' + b); return s === 'step' || s === 'adopted' || s === 'foster' ? s : ''; };
const childrenOf = id => G.children.get(id) || [];
const partnersOf = id => G.partners.get(id) || [];
function siblingsOf(id) {
  const mine = parentsOf(id), out = new Map();
  mine.forEach(par => childrenOf(par).forEach(c => { if (c !== id) out.set(c, (out.get(c) || 0) + 1); }));
  return [...out].map(([sid, shared]) => ({ id: sid, half: shared < mine.length || parentsOf(sid).length !== shared }));
}
const isLiving = p => !p.placeholder && !!p.living;
function cardName(p) {
  if (p.placeholder) return 'Unknown';
  const nickOf = x => { const n = (x.nicknames || '').split(',')[0].trim(); return n && !sameNameE(n, x.first) ? n : ''; };
  const short = x => [x.first, nickOf(x) ? `"${nickOf(x)}"` : x.middle ? x.middle.trim()[0] + '.' : '', x.last].filter(Boolean).join(' ');
  const base = short(p);
  // Two people who would read the same (a father and son both going by Jonny) also get their middle initial.
  const clash = nickOf(p) && p.middle && [...G.people.values()].some(x => x.id !== p.id && !x.placeholder && short(x) === base);
  return clash ? [p.first, `"${nickOf(p)}"`, p.middle.trim()[0] + '.', p.last].join(' ') : base;
}
const sameNameE = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
function displayName(p) { return p.placeholder ? 'Unknown' : [p.first, p.last].filter(Boolean).join(' '); }
function initials(p) { return p.placeholder ? '?' : ((p.first || '')[0] || '') + ((p.last || '')[0] || ''); }
function years(p) { if (isLiving(p) || p.placeholder) return ''; const b = p.born ? String(p.born).replace('about ', 'c. ') : '?'; return b + '–' + (p.died || '?'); }

/* Relationship to the viewer, from the shortest path through parent (U), child (D) and partner (P) steps.
   Sex-specific words only for people who have died: living people's sex isn't public. */
function relation(id) {
  const v = STATE.viewer;
  if (!v) return '';
  if (id === v) return 'You';
  const prev = new Map([[v, null]]), q = [v];
  while (q.length) {
    const cur = q.shift();
    if (cur === id) break;
    const steps = [...parentsOf(cur).map(x => [x, 'U']), ...childrenOf(cur).map(x => [x, 'D']), ...partnersOf(cur).map(x => [x.id, 'P'])];
    for (const [nx, s] of steps) if (!prev.has(nx)) { prev.set(nx, [cur, s]); q.push(nx); }
  }
  if (!prev.has(id)) return '';
  let path = '', chain = [], cur = id;
  while (prev.get(cur)) { const [from, s] = prev.get(cur); path = s + path; chain.unshift(cur); cur = from; }
  const p = P(id), w = (m, f, n) => (!isLiving(p) && p.sex === 'male') ? m : (!isLiving(p) && p.sex === 'female') ? f : n;
  const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
  const greatX = (n, word) => cap('great-'.repeat(n) + word);
  if (path === 'U' || path === 'D') {
    const k = path === 'U' ? pcKind(id, v) : pcKind(v, id);
    if (k === 'step') return path === 'U' ? w('Stepfather', 'Stepmother', 'Step-parent') : w('Stepson', 'Stepdaughter', 'Stepchild');
    if (k === 'adopted') return path === 'U' ? w('Adoptive father', 'Adoptive mother', 'Adoptive parent') : w('Adopted son', 'Adopted daughter', 'Adopted child');
    if (k === 'foster') return path === 'U' ? w('Foster father', 'Foster mother', 'Foster parent') : w('Foster son', 'Foster daughter', 'Foster child');
  }
  if (/^U+$/.test(path)) { const n = path.length; return n === 1 ? w('Father', 'Mother', 'Parent') : greatX(n - 2, w('grandfather', 'grandmother', 'grandparent')); }
  if (/^D+$/.test(path)) { const n = path.length; return n === 1 ? w('Son', 'Daughter', 'Child') : greatX(n - 2, w('grandson', 'granddaughter', 'grandchild')); }
  if (path === 'P') { const sub = (partnersOf(v).find(x => x.id === id) || {}).sub; return isFormer(sub) ? 'Former partner' : w('Husband', 'Wife', 'Partner'); }
  if (path === 'UD') { const s = siblingsOf(v).find(x => x.id === id); return (s && s.half ? 'Half-' : '') + (s && s.half ? w('brother', 'sister', 'sibling') : w('Brother', 'Sister', 'Sibling')); }
  if (path === 'UUD') return w('Uncle', 'Aunt', "Parent's sibling");
  if (/^UUU+D$/.test(path)) { const n = path.length - 3; return isLiving(p) || !p.sex ? greatX(n - 1, "grandparent's sibling") : greatX(n, w('uncle', 'aunt', '')); }
  if (path === 'UDD') return w('Nephew', 'Niece', "Sibling's child");
  if (path === 'UUDD') return 'Cousin';
  if (path === 'UUUDDD') return 'Second cousin';
  if (path === 'UUDDD' || path === 'UUUDD') return 'Cousin once removed';
  if (path === 'PU') return w('Father-in-law', 'Mother-in-law', 'Parent-in-law');
  if (path === 'PUD' || path === 'UDP') return w('Brother-in-law', 'Sister-in-law', 'Sibling-in-law');
  if (path === 'DP') return w('Son-in-law', 'Daughter-in-law', 'Child-in-law');
  const ptSub = (x, y) => (partnersOf(x).find(z => z.id === y) || {}).sub;
  if (path === 'UP' && ptSub(chain[0], id) !== 'former') return w('Stepfather', 'Stepmother', 'Step-parent');
  if (path === 'UPD' && ptSub(chain[0], chain[1]) !== 'former' && !siblingsOf(v).some(x => x.id === id)) return w('Stepbrother', 'Stepsister', 'Step-sibling');
  if (path === 'PD' && ptSub(v, chain[0]) !== 'former') return w('Stepson', 'Stepdaughter', 'Stepchild');
  const via = P(chain[chain.length - 2]);
  const last = path[path.length - 1];
  const word = last === 'U' ? w('father', 'mother', 'parent') : last === 'D' ? w('son', 'daughter', 'child') : w('husband', 'wife', 'partner');
  return (via ? (via.first || 'Unknown') + "'s " : '') + word;
}

/* Someone married into the family who also descends from it: show the "connected twice" mark. */
function ancestorsSet(id, depth = 8) { const s = new Set(); const go = (x, d) => { if (d > depth) return; parentsOf(x).forEach(p => { s.add(p); go(p, d + 1); }); }; go(id, 0); return s; }
function connectedTwice(id) {
  for (const pt of partnersOf(id)) {
    const mine = ancestorsSet(id), theirs = ancestorsSet(pt.id);
    for (const a of mine) if (theirs.has(a)) return { partner: pt.id, ancestor: a };
  }
  return null;
}

/* =====================================================================
 * Layout. Generation g: 0 is the centered person, +1 their parents, -1 their children.
 * Far branches stay folded into buds unless opened (or "Show all" is on).
 * ===================================================================== */
const CW = 180, CH = 70, FW = 210, FH = 82, GAP = 22, CG = 44, ROW = 150, BUDW = 124;
const MAX_UP = 3, MAX_DOWN = 2;
const STATE = { viewer: null, owner: null, focus: null, open: new Set(), level: 0, rootsBelow: true, selected: null };
const isOpen = k => STATE.level >= 1 || STATE.open.has(k);
const genY = g => (STATE.rootsBelow ? g : -g) * ROW;

function layout() {
  const nodes = new Map(), edges = [], rows = new Map();
  const F = STATE.focus;
  const wOf = id => id === F ? FW : CW;
  const addNode = (id, x, g, extra = {}) => { const n = { id, x, y: genY(g), g, kind: 'person', ...extra }; nodes.set(id, n); return n; };
  const addBud = (key, label, count, x, g, anchor) => { const id = 'bud:' + key; nodes.set(id, { id, key, x, y: genY(g), g, kind: 'bud', label, count, anchor }); edges.push({ id: 'stem:' + key, kind: 'stem', a: anchor, b: id }); };
  const occupy = (g, x0, x1) => { if (!rows.has(g)) rows.set(g, []); rows.get(g).push([x0, x1]); };
  const nodeSpan = n => { const w = n.kind === 'bud' ? BUDW : wOf(n.id); return [n.x - w / 2, n.x + w / 2]; };

  const fits = block => block.every(n => { const [a, b] = nodeSpan(n); return !(rows.get(n.g) || []).some(([x0, x1]) => a < x1 + GAP && b > x0 - GAP); });
  // A bud beside its person if that spot is free; otherwise tucked just off the card, between rows.
  function placeBud(bud, n, dir, vdir) {
    if (fits([bud])) return placeBlock([bud], dir);
    const g = n.g + (vdir * (STATE.rootsBelow ? 1 : -1) > 0 ? 0.5 : -0.5);
    placeBlock([{ ...bud, x: n.x, y: n.y + vdir * (CH / 2 + 26), g }], dir);
  }
  // Place a block (a set of tentative nodes) shifted sideways in `dir` until it clears everything already placed.
  function placeBlock(block, dir) {
    let shift = 0;
    for (let guard = 0; guard < 200; guard++) {
      let moved = false;
      for (const n of block) {
        const [a, b] = nodeSpan(n);
        for (const [x0, x1] of rows.get(n.g) || []) {
          if (a + shift < x1 + GAP && b + shift > x0 - GAP) {
            shift += dir > 0 ? (x1 + GAP) - (a + shift) : -((b + shift) - (x0 - GAP));
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
    block.forEach(n => { n.x += shift; if (n.kind === 'bud') nodes.set(n.id, n); else nodes.set(n.id, n); const [a, b] = nodeSpan(n); occupy(n.g, a, b); });
    return shift;
  }

  /* ---- ancestors: a pedigree that grows away from the centered person ---- */
  function withPartners(s, side) {
    if (!isOpen('fam:' + s)) return [{ id: s }];
    const sd = splitSides(s, partnersOf(s).filter(pt => !lineSet.has(pt.id)));
    const inner = side === 'left' ? sd.right : sd.left, outer = side === 'left' ? sd.left : sd.right;
    return [...[...inner].reverse().map(pt => ({ id: pt, partnerOf: s, inner: true })), { id: s, coupleGap: inner.length > 0 }, ...outer.map(pt => ({ id: pt, partnerOf: s }))];
  }
  function pedExtents(id, depth, side) {
    const t = { id, depth, side, parents: [], extras: [], bud: null };
    const opened = depth < MAX_UP || isOpen('up:' + id);
    const pars = parentsOf(id);
    if (pars.length && opened) {
      const ordered = [...pars].sort((a, b) => (P(a).sex === 'female') - (P(b).sex === 'female'));
      t.parents = ordered.map((pid, i) => pedExtents(pid, depth + 1, ordered.length === 2 ? (i === 0 ? 'left' : 'right') : side));
    } else if (pars.length) t.bud = { key: 'up:' + id, label: 'Earlier generations', count: countAncestors(id) };
    if (depth > 0) {
      const sibs = siblingsOf(id).map(s => s.id);
      const others = partnersOf(id).filter(pt => !childrenOf(id).some(c => parentsOf(c).includes(pt.id) && isOnLine(c))).map(pt => pt.id);
      const sibExtras = [];
      if (sibs.length) { if (isOpen('sib:' + id)) sibExtras.push(...sibs.flatMap(s => withPartners(s, side))); else sibExtras.push({ bud: { key: 'sib:' + id, label: sibs.length === 1 ? '1 sibling' : sibs.length + ' siblings', count: '' } }); }
      if (others.length) { if (depth === 1 || isOpen('op:' + id)) t.extras.push(...others.map(s => ({ id: s, partnerOf: id }))); else t.extras.push({ bud: { key: 'op:' + id, label: others.length === 1 ? 'Another marriage' : others.length + ' marriages', count: '' } }); }
      t.extras.push(...sibExtras);
    }
    const extraW = t.extras.reduce((s, e) => s + (e.bud ? BUDW : CW) + GAP + ((e.partnerOf && !e.inner) || e.coupleGap ? CG - GAP : 0), 0);
    const half = (id === F ? FW : CW) / 2;
    t.selfL = half + (side === 'left' ? extraW : 0);
    t.selfR = half + (side !== 'left' ? extraW : 0);
    t.L = t.selfL; t.R = t.selfR;
    if (t.parents.length === 2) {
      const [a, b] = t.parents, H = (CW + CG) / 2;
      t.da = Math.max(H, a.R + GAP / 2); t.db = Math.max(H, b.L + GAP / 2);
      t.L = Math.max(t.L, t.da + a.L); t.R = Math.max(t.R, t.db + b.R);
    } else if (t.parents.length === 1) { t.L = Math.max(t.L, t.parents[0].L); t.R = Math.max(t.R, t.parents[0].R); }
    return t;
  }
  const lineSet = new Set([F, ...ancestorsSet(F, 12)]);
  function isOnLine(c) { return lineSet.has(c); }
  function countAncestors(id) { return ancestorsSet(id).size; }
  function pedPlace(t, x, g) {
    if (g > 0) addNode(t.id, x, g, { side: t.side });
    let off = (t.id === F ? FW : CW) / 2 + GAP;
    for (const e of t.extras) {
      const w = e.bud ? BUDW : CW;
      if ((e.partnerOf && !e.inner) || e.coupleGap) off += CG - GAP;
      const ex = t.side === 'left' ? x - off - w / 2 : x + off + w / 2;
      if (e.bud) addBud(e.bud.key, e.bud.label, e.bud.count, ex, g, t.id);
      else addNode(e.id, ex, g, { extraOf: t.id, partnerOf: e.partnerOf });
      off += w + GAP;
    }
    if (t.bud) addBud(t.bud.key, t.bud.label, t.bud.count, x, g + 1, t.id);
    if (t.parents.length === 2) { occupy(g + 1, x - t.da, x + t.db); pedPlace(t.parents[0], x - t.da, g + 1); pedPlace(t.parents[1], x + t.db, g + 1); }
    else if (t.parents.length === 1) pedPlace(t.parents[0], x, g + 1);
  }
  const ped = pedExtents(F, 0, 'right');
  addNode(F, 0, 0, { focus: true });
  pedPlace(ped, 0, 0);
  for (const n of nodes.values()) { const [a, b] = nodeSpan(n); occupy(n.g, a, b); }

  /* ---- partners beside a person: current right, former left, one each side before either doubles up ---- */
  function splitSides(id, pts) {
    const n = pid => childrenOf(id).filter(c => parentsOf(c).includes(pid)).length;
    const byKids = a => [...a].sort((x, y) => n(y.id) - n(x.id)).map(x => x.id);
    const right = byKids(pts.filter(pt => !isFormer(pt.sub))), left = byKids(pts.filter(pt => isFormer(pt.sub)));
    if (right.length > 1 && !left.length) left.push(right.pop());
    else if (left.length > 1 && !right.length) right.push(left.pop());
    return { left, right };
  }

  /* ---- the centered person's row ---- */
  const sidesF = splitSides(F, partnersOf(F).filter(pt => !nodes.has(pt.id)));
  const current = sidesF.right.map(id => ({ id })), former = sidesF.left.map(id => ({ id }));
  let rx = FW / 2 + CG, lx = -(FW / 2 + CG);
  const sideOf = {};
  sidesF.right.forEach(pid => { addNode(pid, rx + CW / 2, 0, { partnerOf: F }); occupy(0, rx, rx + CW); sideOf[pid] = 1; rx += CW + CG; });
  sidesF.left.forEach(pid => { addNode(pid, lx - CW / 2, 0, { partnerOf: F }); occupy(0, lx - CW, lx); sideOf[pid] = -1; lx -= CW + CG; });

  /* ---- descendants: each couple's children under that couple ---- */
  // A unit is measured from its person's x: L and R are how far it reaches left and right, every generation included.
  function descUnit(id, depth) {
    const u = { id, cards: [], groups: [], bud: null };
    const s = splitSides(id, partnersOf(id));
    s.right.forEach((pid, i) => u.cards.push({ id: pid, dx: (i + 1) * (CW + CG) }));
    s.left.forEach((pid, i) => u.cards.push({ id: pid, dx: -(i + 1) * (CW + CG) }));
    const midOf = pid => { const c = u.cards.find(c => c.id === pid); return c ? c.dx / 2 : 0; };
    let L = CW / 2 + s.left.length * (CW + CG), R = CW / 2 + s.right.length * (CW + CG);
    const kids = childrenOf(id);
    if (kids.length && (depth < MAX_DOWN || isOpen('down:' + id))) {
      const byOther = new Map();
      kids.forEach(k => { const o = parentsOf(k).find(pp => pp !== id && u.cards.some(c => c.id === pp)) || ''; if (!byOther.has(o)) byOther.set(o, []); byOther.get(o).push(k); });
      const order = [...[...s.left].reverse(), '', ...s.right].filter(o => byOther.has(o));
      let prev = -Infinity;
      const gs = order.map(o => {
        const units = byOther.get(o).map(k => descUnit(k, depth + 1));
        const gw = units.reduce((t, k) => t + k.L + k.R, 0) + (units.length - 1) * GAP;
        const want = midOf(o) - gw / 2, left = Math.max(want, prev + GAP);
        prev = left + gw;
        return { units, gw, want, left };
      });
      // groups pushed apart drift right; spread the drift so the whole family stays centered under its couples
      const drift = gs.reduce((t, g) => t + g.left - g.want, 0) / gs.length;
      for (const g of gs) {
        let cur = g.left - drift;
        L = Math.max(L, -cur); R = Math.max(R, cur + g.gw);
        for (const k of g.units) { u.groups.push({ unit: k, dx: cur + k.L }); cur += k.L + k.R + GAP; }
      }
    } else if (kids.length) {
      const near = s.right[0] || s.left[0];
      u.bud = { key: 'down:' + id, label: kids.length === 1 ? '1 child' : kids.length + ' children', dx: near ? midOf(near) : 0 };
      L = Math.max(L, BUDW / 2 - u.bud.dx); R = Math.max(R, u.bud.dx + BUDW / 2);
    }
    u.L = L; u.R = R;
    return u;
  }
  function descPlace(u, x, g, block) {
    block.push({ id: u.id, x, y: genY(g), g, kind: 'person' });
    u.cards.forEach(c => block.push({ id: c.id, x: x + c.dx, y: genY(g), g, kind: 'person', partnerOf: u.id }));
    if (u.bud) block.push({ id: 'bud:' + u.bud.key, key: u.bud.key, x: x + u.bud.dx, y: genY(g - 1), g: g - 1, kind: 'bud', label: u.bud.label, anchor: u.id });
    u.groups.forEach(k => descPlace(k.unit, x + k.dx, g - 1, block));
  }
  const groups = new Map();
  childrenOf(F).forEach(c => { const other = parentsOf(c).find(pp => pp !== F) || ''; if (!groups.has(other)) groups.set(other, []); groups.get(other).push(c); });
  const orderedGroups = [...groups.entries()].sort((a, b) => (sideOf[a[0]] || 0) - (sideOf[b[0]] || 0));
  for (const [other, kids] of orderedGroups) {
    const mid = other && nodes.has(other) && sideOf[other] ? nodes.get(other).x / 2 : 0;
    const units = kids.map(k => descUnit(k, 1));
    const total = units.reduce((s, u) => s + u.L + u.R, 0) + (units.length - 1) * GAP;
    const block = [];
    let kx = mid - total / 2;
    units.forEach(u => { descPlace(u, kx + u.L, -1, block); kx += u.L + u.R + GAP; });
    placeBlock(block, (sideOf[other] || 1));
  }

  /* ---- siblings of the centered person, with their families folded: full on the side with fewer partners (left on a
     tie), half on their shared parent's side ---- */
  const sibs = siblingsOf(F).filter(s => !nodes.has(s.id));
  sibs.sort((a, b) => a.half - b.half);
  const myPars = parentsOf(F);
  const ptX = partnersOf(F).map(x => nodes.get(x.id)).filter(n => n && n.y === 0).map(n => n.x);
  const fullDir = ptX.filter(x => x < 0).length > ptX.filter(x => x > 0).length ? 1 : -1;
  const sibSide = s => {
    if (!s.half) return fullDir;
    const shared = parentsOf(s.id).filter(x => myPars.includes(x) && nodes.has(x));
    return shared.length === 1 && nodes.get(shared[0]).x > 0 ? 1 : -1;
  };
  for (const s of sibs) {
    const dir = sibSide(s), cx = (dir < 0 ? lx : rx) + dir * CW / 2;
    const block = [{ id: s.id, x: cx, y: 0, g: 0, kind: 'person', sibling: true, half: s.half }];
    const fam = partnersOf(s.id).length + childrenOf(s.id).length;
    if (fam) {
      if (isOpen('fam:' + s.id)) {
        // the same couples layout as descendants: partners beside the sibling, each couple's children under it
        const u = descUnit(s.id, 1);
        block.length = 0;
        descPlace(u, dir < 0 ? (lx - u.R) : (rx + u.L), 0, block);
        Object.assign(block[0], { sibling: true, half: s.half });
      } else {
        block.push({ id: 'bud:fam:' + s.id, key: 'fam:' + s.id, x: cx, y: -(STATE.rootsBelow ? 1 : -1) * (CH / 2 + 26), g: -0.5, kind: 'bud', label: (P(s.id).first || '') + "'s family", count: fam, anchor: s.id });
      }
    }
    placeBlock(block, dir);
    const spans = block.filter(n => n.g === 0).map(n => nodeSpan(n));
    if (dir < 0) lx = Math.min(...spans.map(x => x[0])) - GAP; else rx = Math.max(...spans.map(x => x[1])) + GAP;
  }

  /* ---- step-siblings: children of the centered person's step-parents, on that step-parent's side ---- */
  {
    const mine = parentsOf(F);
    const steps = [...new Set(mine.flatMap(pp => partnersOf(pp).map(x => x.id)))].filter(sp => !mine.includes(sp) && nodes.has(sp));
    for (const sp of steps) {
      const kids = childrenOf(sp).filter(c => c !== F && !nodes.has(c) && !parentsOf(c).some(x => mine.includes(x)));
      if (!kids.length) continue;
      const dir = nodes.get(sp).x >= 0 ? 1 : -1;
      let kx = nodes.get(sp).x;
      const block = kids.map(k => { const n = { id: k, x: kx, y: 0, g: 0, kind: 'person', sibling: true }; kx += dir * (CW + GAP); return n; });
      placeBlock(block, dir);
    }
  }

  /* ---- aunts and uncles: their partners and children (cousins), folded into a family bud ---- */
  for (const n of [...nodes.values()].filter(n => n.kind === 'person' && n.extraOf && !n.partnerOf && n.g > 0)) {
    const s = n.id, host = nodes.get(n.extraOf);
    const dir = host && n.x < host.x ? -1 : 1, down = STATE.rootsBelow ? -1 : 1;
    const pts = partnersOf(s).map(x => x.id).filter(x => !nodes.has(x));
    const ks = childrenOf(s).filter(x => !nodes.has(x));
    if (!pts.length && !ks.length) continue;
    const key = 'fam:' + s;
    if (!isOpen(key)) {
      placeBlock([{ id: 'bud:' + key, key, x: n.x, y: n.y + down * (CH / 2 + 26), g: n.g - 0.5, kind: 'bud', label: (P(s).first || 'Their') + "'s family", count: pts.length + ks.length, anchor: s }], dir);
      continue;
    }
    // Their partners already sit beside them in the row (see withPartners); each couple's children go under that couple.
    const prt = partnersOf(s).map(x => x.id).filter(x => nodes.has(x) && nodes.get(x).partnerOf === s);
    const byOther = new Map();
    ks.forEach(k => { const o = parentsOf(k).find(pp => prt.includes(pp)) || ''; if (!byOther.has(o)) byOther.set(o, []); byOther.get(o).push(k); });
    for (const [o, kids] of byOther) {
      const mid = o ? (n.x + nodes.get(o).x) / 2 : n.x;
      if (STATE.level >= 2) {
        // All relatives: each cousin with their partners and every generation below, the descendants' couples layout.
        const units = kids.map(k => descUnit(k, 1));
        const total = units.reduce((t, u) => t + u.L + u.R, 0) + (units.length - 1) * GAP;
        let kx = mid - total / 2;
        const block = [];
        units.forEach(u => { descPlace(u, kx + u.L, n.g - 1, block); kx += u.L + u.R + GAP; });
        const seenB = new Set();
        placeBlock(block.filter(b => !nodes.has(b.id) && !seenB.has(b.id) && seenB.add(b.id)), dir);
        continue;
      }
      let kx = mid - (kids.length * CW + (kids.length - 1) * GAP) / 2;
      placeBlock(kids.map(k => { const c = { id: k, x: kx + CW / 2, y: genY(n.g - 1), g: n.g - 1, kind: 'person' }; kx += CW + GAP; return c; }), dir);
    }
  }

  /* ---- married-in families (partners of the centered person and of their children) ---- */
  const inlawFor = [...current.map(x => [x.id, 1]), ...former.map(x => [x.id, -1])];
  [...nodes.values()].filter(n => n.kind === 'person' && n.partnerOf && n.g < 0).forEach(n => inlawFor.push([n.id, 1]));
  for (const [pid, dir] of inlawFor) {
    const n = nodes.get(pid); if (!n) continue;
    const kin = parentsOf(pid).length + siblingsOf(pid).length;
    if (!kin) continue;
    const key = 'in:' + pid;
    if (!isOpen(key)) {
      placeBud({ id: 'bud:' + key, key, x: n.x + dir * (CW / 2 + GAP + BUDW / 2), y: n.y, g: n.g, kind: 'bud', label: (P(pid).first || 'Their') + "'s family", count: kin, anchor: pid }, n, dir, STATE.rootsBelow ? 1 : -1);
      continue;
    }
    const block = [];
    const sibIds = siblingsOf(pid).map(s => s.id);
    let sx = n.x + dir * (CW + GAP);
    sibIds.forEach(sid => { block.push({ id: sid, x: sx, y: n.y, g: n.g, kind: 'person', inlaw: pid }); sx += dir * (CW + GAP); });
    const pars = parentsOf(pid);
    const center = sibIds.length ? (n.x + sx - dir * (CW + GAP)) / 2 : n.x;
    pars.forEach((par, i) => block.push({ id: par, x: center + (i - (pars.length - 1) / 2) * (CW + CG), y: genY(n.g + 1), g: n.g + 1, kind: 'person', inlaw: pid }));
    placeBlock(block, dir);
  }

  /* ---- plus in-laws: everyone connected ---- */
  if (STATE.level >= 3) {
    const queue = [...nodes.values()].filter(n => n.kind === 'person').sort((a, b) => Math.abs(a.g) - Math.abs(b.g) || Math.abs(a.x) - Math.abs(b.x));
    const fresh = ids => [...new Set(ids)].filter(x => !nodes.has(x) && G.people.has(x));
    const put = (list, dir) => { const blk = list.filter(b => !nodes.has(b.id)); if (!blk.length) return; placeBlock(blk, dir); blk.forEach(b => queue.push(nodes.get(b.id))); };
    for (let qi = 0; qi < queue.length && qi < 20000; qi++) {
      const n = queue[qi], dir = n.x < 0 ? -1 : 1;
      const pars = fresh(parentsOf(n.id));
      // A missing parent whose partner is already drawn goes beside that partner, so the couple stays together.
      const mate = parentsOf(n.id).find(pp => nodes.has(pp) && pars.some(f => partnersOf(pp).some(x => x.id === f)));
      if (mate) {
        const m = nodes.get(mate), md = m.x <= n.x ? 1 : -1;
        let px = m.x; put(pars.map(id => { px += md * (CW + CG); return { id, x: px, y: m.y, g: m.g, kind: 'person', partnerOf: mate }; }), md);
      } else if (pars.length) put(pars.map((id, i) => ({ id, x: n.x + (i - (pars.length - 1) / 2) * (CW + CG), y: genY(n.g + 1), g: n.g + 1, kind: 'person' })), dir);
      const pts = fresh(partnersOf(n.id).map(x => x.id));
      if (pts.length) { let px = n.x; put(pts.map(id => { px += dir * (CW + CG); return { id, x: px, y: genY(n.g), g: n.g, kind: 'person', partnerOf: n.id }; }), dir); }
      const sibsW = fresh(siblingsOf(n.id).map(x => x.id));
      if (sibsW.length) { let sx = n.x; put(sibsW.map(id => { sx += dir * (CW + GAP); return { id, x: sx, y: genY(n.g), g: n.g, kind: 'person' }; }), dir); }
      const kids = fresh(childrenOf(n.id));
      if (kids.length) {
        const byOther = new Map();
        kids.forEach(k => { const o = parentsOf(k).find(pp => pp !== n.id && nodes.has(pp) && nodes.get(pp).g === n.g) || ''; if (!byOther.has(o)) byOther.set(o, []); byOther.get(o).push(k); });
        for (const [o, ks] of byOther) {
          const mid = o ? (n.x + nodes.get(o).x) / 2 : n.x;
          let kx = mid - (ks.length * CW + (ks.length - 1) * GAP) / 2;
          put(ks.map(id => { const b = { id, x: kx + CW / 2, y: genY(n.g - 1), g: n.g - 1, kind: 'person' }; kx += CW + GAP; return b; }), dir);
        }
      }
    }
  }

  /* ---- edges ---- */
  const placed = new Set(nodes.keys());
  // parent to child
  for (const n of nodes.values()) {
    if (n.kind !== 'person') continue;
    const pars = parentsOf(n.id).filter(p => placed.has(p));
    if (!pars.length) continue;
    // A couple shares one line from their rings, even when one is a step-parent (separate lines cross the other children's).
    const couple = pars.length === 2 && partnersOf(pars[0]).some(x => x.id === pars[1]);
    const groupsP = couple ? [pars] : pars.map(p => [p]);
    groupsP.forEach(gp => edges.push({ id: 'pc:' + gp.join('+') + '>' + n.id, kind: 'pc', parents: gp, child: n.id,
      pending: G.pending.has(gp[0] + '>' + n.id) || !!P(n.id).pending, sub: G.pcSub.get(gp[0] + '>' + n.id) || 'biological',
      half: (gp.length === 1 && parentsOf(n.id).length === 2 && parentsOf(n.id).every(x => !pcKind(x, n.id))) || !!n.half }));
  }
  // partners
  const seen = new Set();
  for (const n of nodes.values()) {
    if (n.kind !== 'person') continue;
    for (const pt of partnersOf(n.id)) {
      if (!placed.has(pt.id)) continue;
      const k = [n.id, pt.id].sort().join('~');
      if (seen.has(k)) continue; seen.add(k);
      const m = nodes.get(pt.id);
      if (m.g !== n.g) continue;
      edges.push({ id: 'pt:' + k, kind: 'partner', a: n.id, b: pt.id, sub: pt.sub });
    }
  }
  // close family that no bud on this screen would reveal: shown as "+N", tap to center there.
  // "Reveal" is everyone drawn with every bud open (one extra layout pass, about a millisecond).
  let reveal = placed;
  if (STATE.level < 1) { STATE.level = 1; try { reveal = new Set(layout().nodes.keys()); } finally { STATE.level = 0; } }
  for (const n of nodes.values()) {
    if (n.kind !== 'person' || n.id === F || P(n.id).placeholder) continue;
    const fam = [...parentsOf(n.id), ...childrenOf(n.id), ...partnersOf(n.id).map(x => x.id), ...siblingsOf(n.id).map(x => x.id)];
    const hidden = new Set(fam.filter(x => !reveal.has(x) && !P(x).placeholder));
    if (hidden.size) n.more = hidden.size;
  }
  // which opened groups hang from which card, so each can be folded again
  if (STATE.level < 1) for (const key of STATE.open) {
    const anchor = key.slice(key.indexOf(':') + 1);
    const n = nodes.get(anchor);
    if (n) (n.folds = n.folds || []).push(key);
  }
  return { nodes, edges };
}

/* =====================================================================
 * Rendering with a small animation engine: every node glides from where it was to where it goes;
 * new branches grow outward from the center, folded ones draw back in.
 * ===================================================================== */
const $ = s => document.querySelector(s);
const world = $('#world'), nodesEl = $('#nodes'), edgeG = $('#edgeg'), ringsG = $('#rings'), groundG = $('#groundg');
const SVGNS = 'http://www.w3.org/2000/svg';
const live = new Map();      // id -> { el, x, y, fx, fy, tx, ty, op, fop, top, leaving }
const liveEdges = new Map(); // id -> { el, grow, from, to, t0, delay, data, leaving, deco }
let anim = { t0: 0, dur: 650, running: false };
let currentLayout = null;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const ICON = {
  bud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20v-7"/><path d="M12 13c-4 0-6-3-6-7 4 0 6 3 6 7z"/><path d="M12 13c4 0 6-3 6-7-4 0-6 3-6 7z"/></svg>',
  fold: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M7 12h10"/></svg>',
  rings: '<svg viewBox="40 30 100 54"><circle cx="70" cy="57" r="22.5" fill="none" stroke="#A9822F" stroke-width="8" mask="url(#lgA)"/><circle cx="106" cy="57" r="22.5" fill="none" stroke="#A9822F" stroke-width="8" mask="url(#lgB)"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>'
};

function cardHTML(n) {
  const p = P(n.id);
  const rel = relation(n.id);
  const yrs = years(p);
  const twice = n.kind === 'person' && connectedTwice(n.id);
  return `<span class="av">${initials(p)}</span><span class="txt"><span class="nm">${esc(cardName(p))}</span><span class="rl">${esc(p.placeholder ? (rel || 'Add a name') : rel)}</span>${yrs ? `<span class="yr">${yrs}</span>` : ''}</span>`
    + (p.pending ? '<span class="tag" data-info="' + TAG_INFO.pending + '">Unconfirmed</span>' : p.edits ? '<span class="tag" data-info="' + TAG_INFO.edit + '">Your edit</span>' : '')
    + (twice ? `<span class="twice" title="Related twice">${ICON.rings}twice</span>` : '');
}
function foldLabel(key) {
  const [kind, id] = key.split(':'), p = P(id) || {};
  return { sib: (p.first || '') + "'s siblings", op: (p.first || '') + "'s other marriage", fam: (p.first || '') + "'s family", in: (p.first || '') + "'s family", up: 'earlier generations', down: (p.first || '') + "'s descendants" }[kind] || 'branch';
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }

function makeNodeEl(n) {
  const wrap = document.createElement('div');
  wrap.className = 'node';
  let el;
  if (n.kind === 'bud') {
    el = document.createElement('button');
    el.className = 'bud';
    el.innerHTML = `${ICON.bud}<span>${esc(n.label)}</span>${n.count ? `<span class="n">${n.count}</span>` : ''}`;
    el.setAttribute('aria-label', 'Open ' + n.label);
    el.addEventListener('click', e => { e.stopPropagation(); STATE.open.add(n.key); render({ grow: true }); });
  } else {
    el = document.createElement('button');
    el.className = 'card';
    el.addEventListener('click', e => { e.stopPropagation(); openPerson(n.id); });
  }
  wrap.appendChild(el);
  return wrap;
}
function updateNodeEl(rec, n) {
  const el = rec.el.firstChild;
  if (n.kind === 'person') {
    const p = P(n.id);
    el.className = 'card' + (n.id === STATE.focus ? ' focus' : '') + (p.placeholder ? ' placeholder' : '') + (p.pending || p.edits ? ' pending' : '') + (!isLiving(p) && !p.placeholder ? ' deceased' : '') + (STATE.selected === n.id ? ' selected' : '');
    el.innerHTML = cardHTML(n);
    el.setAttribute('aria-label', displayName(p) + ', ' + relation(n.id));
    rec.el.querySelectorAll('.fold, .more').forEach(f => f.remove());
    if (n.more) {
      const m = document.createElement('button');
      m.className = 'more';
      m.style.top = ((n.id === STATE.focus ? FH : CH) / 2 - 12) + 'px';
      m.style.left = ((n.id === STATE.focus ? FW : CW) / 2 - 30) + 'px';
      m.textContent = '+' + n.more;
      const who = P(n.id).first || 'them';
      m.title = `${n.more} more ${n.more === 1 ? 'relative' : 'relatives'}. Tap to center on ${who}.`;
      m.setAttribute('aria-label', m.title);
      m.addEventListener('click', e => { e.stopPropagation(); closePanel(); STATE.focus = n.id; render(); });
      rec.el.appendChild(m);
    }
    (n.folds || []).forEach((key, i) => {
      const f = document.createElement('button');
      f.className = 'fold';
      f.style.top = (-(n.id === STATE.focus ? FH : CH) / 2 - 12) + 'px'; f.style.zIndex = 3;
      f.style.left = (((n.id === STATE.focus ? FW : CW) / 2) - 26 - i * 30) + 'px';
      f.innerHTML = ICON.fold;
      f.title = 'Fold ' + foldLabel(key);
      f.setAttribute('aria-label', 'Fold ' + foldLabel(key));
      f.addEventListener('click', e => { e.stopPropagation(); STATE.open.delete(key); render({ camera: false }); });
      rec.el.appendChild(f);
    });
  }
}

function render(opts = {}) {
  if (!STATE.focus || !G.people.has(STATE.focus)) return;
  const L = layout();
  currentLayout = L;
  const now = performance.now();
  const anchorPos = id => { const r = live.get(id); return r && !r.leaving ? { x: r.x, y: r.y } : null; };
  const focusT = L.nodes.get(STATE.focus);
  // nodes
  for (const n of L.nodes.values()) {
    let rec = live.get(n.id);
    if (!rec || rec.leaving) {
      if (rec) rec.el.remove();
      const el = makeNodeEl(n);
      nodesEl.appendChild(el);
      const origin = (n.anchor && anchorPos(n.anchor)) || nearestOrigin(n, L) || { x: n.x, y: n.y };
      rec = { el, x: origin.x, y: origin.y, op: 0, sc: .6 };
      live.set(n.id, rec);
    }
    rec.leaving = false;
    rec.fx = rec.x; rec.fy = rec.y; rec.fop = rec.op; rec.fsc = rec.sc;
    rec.tx = n.x; rec.ty = n.y; rec.top = 1; rec.tsc = 1;
    rec.node = n;
    updateNodeEl(rec, n);
  }
  for (const [id, rec] of live) {
    if (L.nodes.has(id) || rec.leaving) continue;
    rec.leaving = true;
    const back = (rec.node && rec.node.anchor && L.nodes.get(rec.node.anchor)) || collapseTarget(id, L) || { x: rec.x, y: rec.y };
    rec.fx = rec.x; rec.fy = rec.y; rec.fop = rec.op; rec.fsc = rec.sc;
    rec.tx = back.x; rec.ty = back.y; rec.top = 0; rec.tsc = .6;
  }
  // edges
  const fg = n => Math.abs(n.g);
  for (const e of L.edges) {
    let rec = liveEdges.get(e.id);
    if (!rec || rec.leaving) {
      if (rec) rec.el.remove();
      const el = document.createElementNS(SVGNS, 'path');
      el.setAttribute('pathLength', '1');
      edgeG.appendChild(el);
      rec = { el, grow: 0 };
      liveEdges.set(e.id, rec);
      const outer = e.kind === 'pc' ? L.nodes.get(e.child) : L.nodes.get(e.b || e.a);
      const depth = outer ? Math.max(0, Math.abs(outer.g) - 1) : 0;
      rec.delay = opts.grow === false ? 0 : (e.kind === 'stem' ? 260 : 120 + depth * 140);
    } else rec.delay = 0;
    rec.leaving = false;
    rec.from = rec.grow; rec.to = 1; rec.data = e;
  }
  for (const [id, rec] of liveEdges) if (!L.edges.some(e => e.id === id) && !rec.leaving) { rec.leaving = true; rec.from = rec.grow; rec.to = 0; rec.delay = 0; }
  drawRings(focusT);
  drawGround();
  anim.t0 = now; anim.dur = reduceMotion ? 1 : 700;
  if (opts.camera !== false) cameraTo(focusT, opts.camera === 'instant');
  if (!anim.running) { anim.running = true; requestAnimationFrame(tick); }
}
function nearestOrigin(n, L) {
  // new people grow out of whoever they hang from
  const cand = [...parentsOf(n.id), ...childrenOf(n.id), ...partnersOf(n.id).map(x => x.id)];
  for (const c of cand) { const r = live.get(c); if (r && !r.leaving) return { x: r.x, y: r.y }; }
  return null;
}
function collapseTarget(id, L) {
  const cand = [...parentsOf(id), ...childrenOf(id), ...partnersOf(id).map(x => x.id)];
  for (const c of cand) { const n = L.nodes.get(c); if (n) return n; }
  return L.nodes.get(STATE.focus);
}
const ease = t => 1 - Math.pow(1 - t, 3);
function tick(now) {
  const t = Math.min(1, (now - anim.t0) / anim.dur), k = ease(t);
  for (const [id, r] of live) {
    r.x = r.fx + (r.tx - r.fx) * k; r.y = r.fy + (r.ty - r.fy) * k;
    r.op = r.fop + (r.top - r.fop) * k; r.sc = r.fsc + (r.tsc - r.fsc) * k;
    r.el.style.transform = `translate(${r.x}px, ${r.y}px) scale(${r.sc})`;
    r.el.style.opacity = r.op;
    if (r.leaving && t >= 1) { r.el.remove(); live.delete(id); }
  }
  let edgesBusy = false;
  for (const [id, r] of liveEdges) {
    const et = reduceMotion ? 1 : Math.max(0, Math.min(1, (now - anim.t0 - r.delay) / (r.leaving ? 300 : 650)));
    r.grow = r.from + (r.to - r.from) * ease(et);
    if (et < 1) edgesBusy = true;
    drawEdge(r);
    if (r.leaving && et >= 1) { r.el.remove(); liveEdges.delete(id); }
  }
  stepCamera(now);
  if (t < 1 || edgesBusy || cam.moving) requestAnimationFrame(tick); else anim.running = false;
}
function pos(id) { const r = live.get(id); return r ? r : null; }
function halfH(id) { return id === STATE.focus ? FH / 2 : CH / 2; }
function halfW(id) { return id === STATE.focus ? FW / 2 : CW / 2; }
function drawEdge(r) {
  const e = r.data, el = r.el;
  let d = '', cls = 'edge';
  if (e.kind === 'pc') {
    const c = pos(e.child), ps = e.parents.map(pos);
    if (!c || ps.some(x => !x)) { el.setAttribute('d', ''); return; }
    const ax = ps.reduce((s, p) => s + p.x, 0) / ps.length, ay = ps.reduce((s, p) => s + p.y, 0) / ps.length;
    const childOlder = false;
    const down = c.y > ay; // child is below the parents on screen
    const parentEdgeY = ps.length === 2 ? ay : ay + (down ? 1 : -1) * halfH(e.parents[0]);
    const childEdgeY = c.y + (down ? -1 : 1) * halfH(e.child);
    // grow from whichever end is nearer the center of the tree
    const fromParent = Math.abs(ay) < Math.abs(c.y) || e.parents.includes(STATE.focus);
    const [x1, y1, x2, y2] = fromParent ? [ax, parentEdgeY, c.x, childEdgeY] : [c.x, childEdgeY, ax, parentEdgeY];
    const my = (y1 + y2) / 2;
    d = `M${x1} ${y1} C${x1} ${my} ${x2} ${my} ${x2} ${y2}`;
    const parentGen = (STATE.rootsBelow ? ay : -ay) / ROW;
    const isRoot = parentGen > 0.5;
    const gen = Math.max(Math.abs(Math.round(ay / ROW)), Math.abs(Math.round(c.y / ROW)));
    cls += isRoot ? ' root' : ' branch';
    el.style.strokeWidth = Math.max(1.3, 3.4 - gen * 0.55);
    if (e.half) el.style.strokeOpacity = .55;
    else el.style.strokeOpacity = '';
    const nonBirth = e.parents.every(x => pcKind(x, e.child));
    if (nonBirth) el.style.strokeWidth = Math.max(1.1, (3.4 - gen * 0.55) * 0.6);
    r.dash = e.pending || P(e.child).placeholder || e.parents.some(x => P(x).placeholder) ? '0.02 0.03' : nonBirth ? '0.07 0.045' : null;
  } else if (e.kind === 'partner') {
    const a = pos(e.a), b = pos(e.b);
    if (!a || !b) { el.setAttribute('d', ''); return; }
    const [l, rr] = a.x < b.x ? [e.a, e.b] : [e.b, e.a];
    const L = pos(l), R = pos(rr);
    const x1 = L.x + halfW(l), x2 = R.x - halfW(rr), y = (L.y + R.y) / 2;
    d = `M${x1} ${y} L${x2} ${y}`;
    cls += ' partner' + (isFormer(e.sub) ? ' former' : '');
    r.dash = isFormer(e.sub) ? '0.05 0.05' : null;
    drawRingMark(r, (x1 + x2) / 2, y, e.sub);
  } else if (e.kind === 'stem') {
    const a = pos(e.a), b = pos(e.b);
    if (!a || !b) { el.setAttribute('d', ''); return; }
    const dx = b.x - a.x, dy = b.y - a.y;
    const x1 = a.x + Math.sign(dx) * (Math.abs(dy) > 10 ? 0 : halfW(e.a)), y1 = a.y + (Math.abs(dy) > 10 ? Math.sign(dy) * halfH(e.a) : 0);
    const x2 = b.x - Math.sign(dx) * (Math.abs(dy) > 10 ? 0 : BUDW / 2), y2 = b.y - (Math.abs(dy) > 10 ? Math.sign(dy) * 15 : 0);
    d = `M${x1} ${y1} L${x2} ${y2}`;
    cls += ' stem';
    r.dash = '0.04 0.05';
  }
  el.setAttribute('class', cls);
  el.setAttribute('d', d);
  // grow: draw the first `grow` of the path; dashed styles are masked by growth through dashoffset trick
  if (r.dash) { el.style.strokeDasharray = r.dash; el.style.opacity = r.grow; el.style.strokeDashoffset = 0; }
  else { el.style.strokeDasharray = `${r.grow} 2`; el.style.opacity = 1; el.style.strokeDashoffset = 0; }
}
function drawRingMark(r, x, y, sub) {
  if (!r.deco) {
    r.deco = document.createElementNS(SVGNS, 'g');
    r.deco.innerHTML = '<circle r="5" cx="-3.5" fill="#FFFDF9" stroke="#1D2B24" stroke-width="1.5"/><circle r="5" cx="3.5" fill="none" stroke="#1D2B24" stroke-width="1.5"/>';
    edgeG.appendChild(r.deco);
    const orig = r.el.remove.bind(r.el);
    r.el.remove = () => { orig(); r.deco.remove(); };
  }
  r.deco.setAttribute('transform', `translate(${x} ${y}) scale(${r.grow})`);
  r.deco.style.opacity = isFormer(sub) ? .4 : 1;
}
function drawRings(focusT) {
  ringsG.innerHTML = '';
  if (!focusT) return;
  for (let i = 1; i <= 6; i++) {
    const c = document.createElementNS(SVGNS, 'circle');
    c.setAttribute('class', 'ring'); c.setAttribute('cx', focusT.x); c.setAttribute('cy', focusT.y);
    c.setAttribute('r', 90 + i * i * 34); c.setAttribute('stroke-width', 1 + (i % 2));
    ringsG.appendChild(c);
  }
}
function drawGround() {
  groundG.innerHTML = '';
  if (!STATE.rootsBelow) return;
  const y = FH / 2 + 26;
  document.querySelector('#soilmask rect').setAttribute('y', y);
  groundG.innerHTML = `<rect class="soilband" x="-6000" y="${y}" width="12000" height="900" mask="url(#soilmask)"/><rect x="-6000" y="${y}" width="12000" height="900" fill="url(#soil)" mask="url(#soilmask)"/><line class="ground" x1="-6000" x2="6000" y1="${y}" y2="${y}"/>`;
}

/* =====================================================================
 * Camera: drag to pan, wheel or pinch to zoom, glide to the centered person.
 * ===================================================================== */
const stage = $('#stage');
const cam = { x: 0, y: 0, s: 1, fx: 0, fy: 0, fs: 1, tx: 0, ty: 0, ts: 1, t0: 0, moving: false };
function applyCam() { world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.s})`; }
function cameraTo(n, instant) {
  if (!n) return;
  const vw = innerWidth, vh = innerHeight;
  const s = cam.ts || (vw < 640 ? .48 : .8);
  const tx = vw / 2 - n.x * s, ty = vh * (STATE.rootsBelow ? .42 : .55) - n.y * s;
  if (instant || reduceMotion) { Object.assign(cam, { x: tx, y: ty, s, tx, ty, ts: s, moving: false }); applyCam(); return; }
  Object.assign(cam, { fx: cam.x, fy: cam.y, fs: cam.s, tx, ty, ts: s, t0: performance.now(), moving: true });
}
function stepCamera(now) {
  if (!cam.moving) return;
  const t = Math.min(1, (now - cam.t0) / 700), k = ease(t);
  cam.x = cam.fx + (cam.tx - cam.fx) * k; cam.y = cam.fy + (cam.ty - cam.fy) * k; cam.s = cam.fs + (cam.ts - cam.fs) * k;
  applyCam();
  if (t >= 1) cam.moving = false;
}
function zoomAt(f, cx, cy) {
  const ns = Math.min(1.8, Math.max(.3, cam.s * f));
  cam.x = cx - (cx - cam.x) * (ns / cam.s); cam.y = cy - (cy - cam.y) * (ns / cam.s); cam.s = ns; cam.ts = ns; cam.moving = false; applyCam();
}
const pointers = new Map(); let pinch = null, dragMoved = false;
stage.addEventListener('pointerdown', e => {
  if (e.target.closest('button')) return;
  stage.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); dragMoved = false; cam.moving = false;
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) }; }
  stage.classList.add('dragging');
});
stage.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId)) return;
  const prev = pointers.get(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2 && pinch) {
    const [a, b] = [...pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
    zoomAt(d / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2); pinch.d = d; return;
  }
  cam.x += e.clientX - prev.x; cam.y += e.clientY - prev.y; cam.tx = cam.x; cam.ty = cam.y; applyCam();
  if (Math.abs(e.clientX - prev.x) + Math.abs(e.clientY - prev.y) > 2) dragMoved = true;
});
const endPtr = e => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; if (!pointers.size) stage.classList.remove('dragging'); };
stage.addEventListener('pointerup', endPtr); stage.addEventListener('pointercancel', endPtr);
stage.addEventListener('wheel', e => { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * .0015), e.clientX, e.clientY); }, { passive: false });
stage.addEventListener('click', e => { if (!e.target.closest('button') && !dragMoved) guardClose(); });
$('#btnZoomIn').onclick = () => zoomAt(1.2, innerWidth / 2, innerHeight / 2);
$('#btnZoomOut').onclick = () => zoomAt(1 / 1.2, innerWidth / 2, innerHeight / 2);
addEventListener('resize', () => cameraTo(currentLayout && currentLayout.nodes.get(STATE.focus), true));


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
      ${isFocus ? '' : `<button class="primary" id="pCenter">${STATE.view === 'wheel' ? `Put ${esc(p.placeholder ? 'them' : p.first)} in the middle` : `Center the tree on ${esc(p.placeholder ? 'them' : p.first)}`}</button>`}
      <button class="iconbtn" id="pAdd">Add a relative</button>
      <button class="iconbtn" id="pEdit">${p.placeholder ? 'Fill in' : 'Edit'}</button>
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
function livingSeg(v) {
  return `<div class="field"><span class="lab">Are they living? ${infoBtn(INFO.living)}</span><div class="seg" id="fLiving">
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
  const noName = (!opts.edit || opts.noName) && !p.placeholder, unk = noName && isNoName(p);
  return `
    <div id="fPersonFields">
    <div id="fNameBlock"${unk ? ' hidden' : ''}>
    <div class="row2"><div class="field"><label for="fFirst">First name</label><input id="fFirst" value="${esc(p.first || '')}" autocomplete="off"><div class="dups" id="dups"></div></div>
      <div class="field"><label for="fMiddle">Middle name</label><input id="fMiddle" value="${esc(p.middle || '')}" autocomplete="off"></div></div>
    <div class="row2"><div class="field"><label for="fLast">Last name now</label><input id="fLast" value="${esc(nm.last)}" autocomplete="off" placeholder="Or their last one"></div>
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
    ${livingSeg(livingV)}
    <div class="row2"><div class="field"><label for="fBorn">Born</label><input id="fBorn" value="${esc(fuzzyToText(p.bornRaw))}" placeholder="1932, about 1932, May 14, 1932"></div>
      <div class="field"><label for="fDied">Died</label><input id="fDied" value="${esc(fuzzyToText(p.diedRaw))}" placeholder="Year or date"></div></div>
    <div class="field"><label for="fPlace">Where were they born?</label><input id="fPlace" value="${esc(p.bornPlace || '')}" placeholder="&quot;Cleveland&quot; or &quot;somewhere in Ohio&quot; is fine"></div>
    <div class="field"><label for="fNotes">Anything you remember</label><textarea id="fNotes" placeholder="A job, a habit, a story they told">${esc(p.notes || '')}</textarea></div>
    </div>
    <div class="field"><label for="fSource">Information source</label><input id="fSource" placeholder="Family Bible, Grandma told me, a gravestone" value="${esc(opts.edit ? '' : (p.source || ''))}"></div>
    ${whoField()}
    <p class="formerr" id="formErr" role="alert" hidden></p>
    <p class="hint" id="fNameHint">Only a name is needed, and "I don't know their name" works too. For living people, only names show (first, middle, nickname, last now); everything else stays private.</p>`;
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
    box.innerHTML = hits.length ? `<span>Already in the tree?</span>` + hits.map(p => `<button type="button" data-id="${p.id}">${esc(cardName(p))}<small>${esc([relation(p.id) || whoLine(p), years(p)].filter(Boolean).join(' · '))}</small></button>`).join('') : '';
    box.querySelectorAll('button').forEach(b => b.onclick = () => onPick(b.dataset.id));
  };
  first.addEventListener('input', check); if (last) last.addEventListener('input', check);
}

function openEdit(id, restore) {
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
    <form class="body form" id="editForm" novalidate>${fieldsHTML(p, lvNow, { edit: !own, noName: own || isNoName(p) })}${own ? '' : parentKindsHTML(id) + partnerKindsHTML(id)}</form>
    <div class="foot"><button class="iconbtn" id="pBack">Cancel</button><button class="primary" id="pSave">Save</button></div>`);
  wireCommon();
  if (restore) fillForm(restore.fields);
  watchForm('edit', id);
  if (restore) formDirty = true;
  $('#pClose').onclick = () => guardClose(); $('#pBack').onclick = () => guardClose(() => openPerson(id));
  $('#editForm').onsubmit = e => { e.preventDefault(); currentSave(); };
  const done = f => {
    busy(false); clearDraft(); closePanel();
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
  const self = !!opts.self;
  const rel = opts.rel || (self ? 'child' : 'child');
  const done = sessionAdded.length;
  const relWord = p ? (self ? 'You are ' : 'They are ') + esc(p.first || 'this person') + "'s" : '';
  const parents = p ? parentsOf(p.id) : [];
  // Step-parents of p: partners of p's parents who aren't p's parents.
  const stepParents = p ? [...new Set(parents.flatMap(pp => partnersOf(pp).map(x => x.id)))].filter(sp => !parents.includes(sp) && !P(sp).placeholder) : [];
  openPanel(`
    <div class="head"><div><h2>${self ? 'Add yourself' : `Add someone to ${esc(p.placeholder ? 'this branch' : p.first + "'s branch")}`}</h2>
      <div class="sub">${done ? `${done} saved so far. Keep going, or tap Save on the last one.` : self ? 'Start with your name. You can add more later.' : 'Add who you know, including relatives who have died.'}</div></div>
      <button class="x" id="pClose" aria-label="Close">${ICON.close}</button></div>
    <form class="body form" id="addForm" novalidate>
      ${p ? `<div class="field"><span class="lab">${relWord}</span><div class="seg" id="fRel">
        ${['parent', 'partner', 'sibling', 'child'].map(v => `<button type="button" data-v="${v}" aria-pressed="${v === rel}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div></div>
      <div class="field" id="fSibWrap" hidden><span class="lab">What kind of sibling? ${infoBtn(INFO.sibling)}</span><div class="seg" id="fSib"><button type="button" data-v="full" aria-pressed="true">Full</button><button type="button" data-v="half" aria-pressed="false">Half</button><button type="button" data-v="step" aria-pressed="false">Step</button></div></div>
      <div class="field" id="fSibParWrap" hidden><label for="fSibPar" id="fSibParLab">Which parent do you share?</label><select id="fSibPar"></select><p class="hint" id="fSibHint" hidden></p></div>
      <div class="field" id="fPcWrap" hidden><span class="lab"><span id="fPcLab">What kind of parent?</span> ${infoBtn(INFO.parent)}</span><div class="seg" id="fPc">${PC_KINDS.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${v === 'biological'}">${l}</button>`).join('')}</div>
        <p class="hint" id="fPcHint" hidden>This takes one of the two parent spots. If the birth parent might be added later, add a step-parent as the parent's partner instead; the tree labels them Stepfather or Stepmother on its own.</p></div>
      <div class="field" id="fOtherWrap" hidden><label for="fOther" id="fOtherLab">Their other parent</label><select id="fOther"></select></div>
      <div class="field" id="fKindWrap" hidden><span class="lab">Together as ${infoBtn(INFO.couple)}</span><div class="seg" id="fKind"><button type="button" data-v="married" aria-pressed="true">Married</button><button type="button" data-v="partner" aria-pressed="false">Partners</button><button type="button" data-v="divorced" aria-pressed="false">Divorced</button><button type="button" data-v="former" aria-pressed="false">Former partners</button><button type="button" data-v="widowed" aria-pressed="false">Widowed</button></div></div>
      <div class="field" id="fKidsWrap" hidden><span class="lab" id="fKidsLab">Are they also the parent of…</span><div class="kids" id="fKids"></div></div>
      ${self ? '' : `<div class="field"><span class="lab">Who are they? ${infoBtn(INFO.which)}</span><div class="seg" id="fWhich"><button type="button" data-v="new" aria-pressed="true">Someone new</button><button type="button" data-v="existing" aria-pressed="false">Already in the tree</button></div></div>
      <div id="fPickWrap" hidden><div class="field"><label for="fPickQ">Find them</label><input id="fPickQ" placeholder="Type a name, or tap one below" autocomplete="off"></div><div class="pick tall" id="fPickList"></div></div>`}
` : ''}
      ${fieldsHTML(self ? { last: p ? p.last : '' } : {}, self ? 'living' : 'unknown')}
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
    $('#fPcWrap').hidden = v !== 'parent' && v !== 'child';
    $('#fPcLab').textContent = v === 'child' ? `What kind of parent is ${p.first || 'this person'}?` : 'What kind of parent?';
    document.querySelectorAll('#fPc button').forEach(b => { b.classList.remove('off'); b.setAttribute('aria-disabled', 'false'); });
    $('#fOther').onchange = null;
    if (v === 'child') {
      // Who else is this child's parent? Defaults to the current partner.
      const prts = partnersOf(p.id).map(x => x.id);
      if (prts.length) { $('#fOtherLab').textContent = 'Their other parent'; $('#fOther').innerHTML = optsOf(prts, 'Someone else, or not sure'); ow.hidden = false; }
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
    if (!link) {
      if (!f.first && !f.last && !f.noName) throw new Error('Add at least a name, or tick "I don\'t know their name".');
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
        const k = pcSub();
        const other = $('#fOtherWrap').hidden ? '' : $('#fOther').value;
        if (k === 'step' && other) {
          // Stored as the parent's partner; the tree works out "Stepfather" from that.
          if (other !== me) items.push({ kind: 'relationship', type: 'partner', a: other, b: me, subtype: segVal('fKind') || 'married', source: f.source });
        } else {
          if (full) throw new Error(k === 'step' ? 'Choose who they were married to.' : 'Two parents are already here. Choose Step and who they were married to.');
          items.push({ kind: 'relationship', type: 'parent_child', a: me, b: p.id, subtype: k, source: f.source });
          if (other && other !== me) items.push({ kind: 'relationship', type: 'partner', a: other, b: me, subtype: segVal('fKind') || 'married', source: f.source });
        }
      }
      else if (r === 'partner') {
        items.push({ kind: 'relationship', type: 'partner', a: p.id, b: me, subtype: segVal('fKind') || 'married', source: f.source });
        // Children of p they're also a parent of (ticked on the form).
        document.querySelectorAll('#fKids input:checked').forEach(cb => items.push({ kind: 'relationship', type: 'parent_child', a: me, b: cb.value, source: f.source }));
      }
      else if (r === 'sibling' && segVal('fSib') === 'half') {
        const shared = $('#fSibPar').value;
        if (!shared) throw new Error('Add the parent they share first, then add the half-sibling.');
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
      }
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
    // if the new person won't be on screen from here, the next reload centers on the card they were added to
    showAfterSave = { anchor: id, ids: [...Object.values((res && res.ids) || {}), $('#fLink') && $('#fLink').value].filter(Boolean) };
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
let showAfterSave = null;
function showPage(id) { $('#' + id).classList.add('on'); }
function hidePage(id) { $('#' + id).classList.remove('on'); }
function showThanks(title, body) { $('#thanksTitle').innerHTML = title; $('#thanksBody').textContent = body; showPage('thanks'); }
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

function pickPerson(title, sub, onPick, filter = () => true) {
  openPanel(`
    <div class="head"><div><h2>${title}</h2><div class="sub">${sub}</div></div>
      <button class="x" id="pClose" aria-label="Close">${ICON.close}</button></div>
    <div class="body"><div class="field"><label for="qName">Name</label><input id="qName" placeholder="Start typing a name" autocomplete="off"></div><div class="pick" id="qList"></div></div>`);
  $('#pClose').onclick = closePanel;
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

/* =====================================================================
 * How much to show (2026-11-22): Open all became a menu with four levels, each adding to the one before.
 *   0 Close family   the default folding
 *   1 Open buds      every bud on screen opened (the old Open all)
 *   2 All relatives  plus every line of descent from an ancestor to its end: second cousins, great-aunts' grandchildren
 *   3 Plus in-laws   plus everyone connected by marriage, all the way out (no +N left)
 * The device remembers levels 0 to 2. "Plus in-laws" is big, so the next visit starts at Close family again.
 * ===================================================================== */
const LEVELS = ['Close family', 'Open buds', 'All relatives', 'Plus in-laws'];
const LEVEL_INFO = [
  `**Close family:** three generations up, two down, plus brothers, sisters and partners. Everyone else is folded into gold buds.`,
  `**Open buds:** every bud on the screen, opened.`,
  `**All relatives:** also everyone who shares an ancestor with the person in the middle, however distant, and their partners and children.`,
  `**Plus in-laws:** everyone connected, in-laws' families included, all the way out. Big and busy. Your next visit starts back at Close family.`,
  `A card with a dark **+3** has family this choice leaves out. Tap the number to put that person in the middle.`
].join('\n');
STATE.level = Math.max(0, Math.min(2, parseInt(store.get('roots_level'), 10) || 0));
const levelMenu = document.createElement('div');
levelMenu.className = 'levelmenu'; levelMenu.id = 'levelMenu'; levelMenu.hidden = true;
levelMenu.setAttribute('role', 'menu'); levelMenu.setAttribute('aria-label', 'How much of the family to show');
document.body.appendChild(levelMenu);
function syncLevelBtn() {
  const b = $('#btnAll'); if (!b) return;
  b.setAttribute('aria-pressed', STATE.level > 0);
  b.setAttribute('aria-label', 'Show: ' + LEVELS[STATE.level] + '. Choose how much of the family to show');
  const l = b.querySelector('.lbl'); if (l) l.textContent = LEVELS[STATE.level];
}
function setLevel(lv) {
  STATE.level = lv;
  delete STATE.pathLevel;                 // a level picked by hand outlasts "Show it on the tree"
  STATE.open.clear();
  store.set('roots_level', String(lv >= 3 ? 0 : lv));
  syncLevelBtn();
  render({ camera: false });
}
function renderLevelMenu() {
  levelMenu.innerHTML = `<div class="lmhead"><span>Show on the tree</span>${infoBtn(LEVEL_INFO, 'What each choice shows')}</div>` +
    LEVELS.map((l, i) => `<button type="button" role="menuitemradio" aria-checked="${i === STATE.level}" data-lv="${i}"><span class="tick" aria-hidden="true"></span>${l}</button>`).join('');
}
function openLevelMenu() {
  renderLevelMenu();
  levelMenu.hidden = false;
  const r = $('#btnAll').getBoundingClientRect(), w = levelMenu.offsetWidth;
  levelMenu.style.top = (r.bottom + 6) + 'px';
  levelMenu.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
  $('#btnAll').setAttribute('aria-expanded', 'true');
  const cur = levelMenu.querySelector('[aria-checked="true"]'); if (cur) cur.focus({ preventScroll: true });
}
function closeLevelMenu() { levelMenu.hidden = true; const b = $('#btnAll'); if (b) b.setAttribute('aria-expanded', 'false'); }
$('#btnAll').setAttribute('aria-haspopup', 'menu');
$('#btnAll').setAttribute('aria-expanded', 'false');
$('#btnAll').onclick = e => { e.stopPropagation(); if (levelMenu.hidden) openLevelMenu(); else closeLevelMenu(); };
levelMenu.addEventListener('click', e => {
  const b = e.target.closest('[data-lv]'); if (!b) return;
  closeLevelMenu();
  const lv = +b.dataset.lv;
  if (lv !== STATE.level || STATE.open.size || STATE.pathLevel !== undefined) setLevel(lv);
});
levelMenu.addEventListener('keydown', e => {
  const items = [...levelMenu.querySelectorAll('[data-lv]')], i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]; n && n.focus(); }
  if (e.key === 'Escape') { closeLevelMenu(); $('#btnAll').focus(); }
});
document.addEventListener('pointerdown', e => { if (!levelMenu.hidden && !levelMenu.contains(e.target) && !$('#btnAll').contains(e.target) && !infoPop.contains(e.target)) closeLevelMenu(); }, true);
addEventListener('resize', () => { if (!levelMenu.hidden) closeLevelMenu(); });
syncLevelBtn();

/* ---- key: every symbol and line, drawn the way the tree draws it ---- */
function keyCard(opts = {}) {
  const fill = opts.fill || '#FFFDF9', stroke = opts.stroke || 'rgba(29,43,36,.25)', dash = opts.dash ? ` stroke-dasharray="${opts.dash}"` : '';
  const txt = opts.text || '#1D2B24';
  return `<svg viewBox="0 0 92 34" aria-hidden="true"><rect x="${opts.wide ? 4 : 10}" y="3" width="${opts.wide ? 84 : 72}" height="28" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="${opts.sw || 1.5}"${dash}/>
    <circle cx="${opts.wide ? 18 : 23}" cy="17" r="7" fill="${opts.av || '#E7E4DA'}"${opts.avDash ? ' stroke="#1D2B24" stroke-opacity=".5" stroke-width="1.2" stroke-dasharray="2 2"' : ''}/>
    <rect x="${opts.wide ? 30 : 35}" y="11" width="34" height="4" rx="2" fill="${txt}"/><rect x="${opts.wide ? 30 : 35}" y="19" width="${opts.yr ? 20 : 24}" height="3" rx="1.5" fill="${opts.yr ? '#8A6A22' : txt}" fill-opacity=".7"/>
    ${opts.tag ? '<rect x="52" y="0" width="30" height="7" rx="3.5" fill="#A9822F"/>' : ''}</svg>`;
}
function keyLine(d, opts = {}) {
  return `<svg viewBox="0 0 92 34" aria-hidden="true"><path d="${d}" fill="none" stroke="${opts.color || '#1D2B24'}" stroke-width="${opts.w || 2.4}" stroke-linecap="round"${opts.dash ? ` stroke-dasharray="${opts.dash}"` : ''}${opts.op ? ` stroke-opacity="${opts.op}"` : ''}/>${opts.extra || ''}</svg>`;
}
const RINGS_MARK = (x, y, op = 1) => `<g transform="translate(${x} ${y})" opacity="${op}"><circle r="5" cx="-3.5" fill="#FFFDF9" stroke="#1D2B24" stroke-width="1.5"/><circle r="5" cx="3.5" fill="none" stroke="#1D2B24" stroke-width="1.5"/></g>`;
function openKey() {
  const row = (art, title, note) => `<div class="krow">${art}<div>${title}${note ? `<small>${note}</small>` : ''}</div></div>`;
  openPanel(`
    <div class="head"><div><h2>What the symbols mean</h2><div class="sub">Everything on the tree, in one place.</div></div>
      <button class="x" id="pClose" aria-label="Close">${ICON.close}</button></div>
    <div class="body key">
      <h3>People</h3>
      ${row(keyCard({ fill: '#FFFFFF', stroke: '#A9822F', sw: 2, av: '#1D2B24' }), 'The person the tree is centered on', 'Tap anyone, then "Center the tree" to move the center.')}
      ${row(keyCard({ yr: true, av: '#F1E7CF' }), 'Someone who has passed', 'Gold years, born and died. Tap for their story and photos.')}
      ${row(keyCard(), 'Someone living', 'No dates. Only their name shows; their details stay private.')}
      ${row(keyCard({ fill: '#FFF9EC', stroke: '#A9822F', dash: '4 3', tag: true }), 'Unconfirmed', 'Something you added. Only you see it until Jonny Ruzicka confirms it.')}
      ${row(keyCard({ fill: 'rgba(255,255,255,.3)', stroke: '#1D2B24', dash: '3 3', av: 'none', avDash: true }), 'Unknown person', 'We know someone was here but not their name. Tap to fill it in.')}
      ${row(`<svg viewBox="0 0 92 34" aria-hidden="true"><rect x="4" y="5" width="84" height="24" rx="12" fill="#FBF6E9" stroke="#A9822F" stroke-opacity=".55"/><path d="M18 24v-6M18 18c-3 0-4.5-2-4.5-5 3 0 4.5 2 4.5 5zM18 18c3 0 4.5-2 4.5-5-3 0-4.5 2-4.5 5z" fill="none" stroke="#A9822F" stroke-width="1.4" stroke-linecap="round"/><rect x="28" y="15" width="44" height="4" rx="2" fill="#1D2B24" fill-opacity=".7"/></svg>`, 'A folded branch', 'More relatives live here. Tap the bud to open it; tap the small minus on the card to fold it again.')}
      ${row(`<svg viewBox="0 0 92 34" aria-hidden="true"><rect x="8" y="4" width="70" height="26" rx="6" fill="#FFFDF9" stroke="#1D2B24" stroke-opacity=".12"/><rect x="58" y="20" width="28" height="14" rx="7" fill="#1D2B24"/><text x="72" y="30.5" text-anchor="middle" font-size="9" font-family="Jost, sans-serif" font-weight="600" fill="#FFFDF9">+3</text></svg>`, 'More family off the tree', 'This person has relatives who aren\'t on screen from here. Tap the number to center the tree on them.')}
      ${row(`<svg viewBox="0 0 92 34" aria-hidden="true"><rect x="16" y="9" width="60" height="16" rx="8" fill="#FFFDF9" stroke="#1D2B24" stroke-opacity=".2"/><g transform="translate(29 17) scale(.5)"><circle r="9" cx="-6" fill="none" stroke="#A9822F" stroke-width="3"/><circle r="9" cx="6" fill="none" stroke="#A9822F" stroke-width="3"/></g><rect x="40" y="15" width="26" height="4" rx="2" fill="#4A564F"/></svg>`, 'Related twice', 'Two people who married and also share an ancestor, like second cousins.')}
      <h3>Lines</h3>
      ${row(keyLine('M46 3 C46 16 46 18 46 31'), 'Parent to child', STATE.rootsBelow ? 'Ink branches above the ground line lead to children and grandchildren.' : 'Ink lines lead down to children and grandchildren.')}
      ${row(keyLine('M46 31 C46 18 46 16 46 3', { color: '#A9822F' }), 'Your roots', STATE.rootsBelow ? 'Gold lines below the ground line lead back to parents, grandparents and further.' : 'Gold lines lead up to parents, grandparents and further back.')}
      ${row(keyLine('M46 31 C46 18 46 16 46 3', { op: .45 }), 'Half sibling', 'A lighter line: they share one parent, not both.')}
      ${row(keyLine('M46 31 C46 18 46 16 46 3', { dash: '7 4', w: 1.6 }), 'Step, adoptive or foster parent', 'A thinner dashed line. With a birth parent beside them, they share the birth line; the card says Stepmother, Stepchild and so on.')}
      ${row(keyLine('M46 31 C46 18 46 16 46 3', { dash: '2 4' }), 'Unconfirmed or unknown link', 'Dotted: it leads to someone unconfirmed or unknown.')}
      ${row(keyLine('M6 17 H86', { w: 1.6, extra: RINGS_MARK(46, 17) }), 'Married or partners', 'Their children grow out of the rings.')}
      ${row(keyLine('M6 17 H86', { w: 1.6, dash: '5 5', op: .45, extra: RINGS_MARK(46, 17, .4) }), 'Former partners', 'Divorced or separated. Their children still connect to both.')}
      ${row(keyLine('M8 17 H84', { w: 1.4, dash: '3 4', color: '#55625B' }), 'Bud stem', 'Connects a folded branch to the person it belongs to.')}
      ${STATE.rootsBelow ? row(`<svg viewBox="0 0 92 34" aria-hidden="true"><rect x="0" y="17" width="92" height="17" fill="#6B5524" fill-opacity=".09"/><line x1="0" x2="92" y1="17" y2="17" stroke="#1D2B24" stroke-opacity=".32" stroke-width="1.5"/></svg>`, 'The ground line', 'The centered person stands on it: roots below, branches above.') : ''}
    </div>`);
  $('#pClose').onclick = closePanel;
}
$('#btnKey').onclick = openKey;

/* =====================================================================
 * Wheel view (2026-11-22): the same tree as a fan chart.
 * The centered person is a disc in the middle. Their parents fill the bottom half (the roots), split in two and
 * doubling every ring; their children and their children's children fill the top half (the branches), each child's
 * share sized by how many descendants they have. Built only from what the page already has, so privacy is the
 * server's, as everywhere else.
 * ===================================================================== */
STATE.view = store.get('roots_view') === 'wheel' ? 'wheel' : 'tree';
const wheelEl = $('#wheel');
const renderTree = render;
// One render for both views: everything that moves the center (Center, Back to you, a save) lands here.
render = function (opts = {}) { return STATE.view === 'wheel' ? renderWheel() : renderTree(opts); };

function setView(v) {
  if (v === STATE.view) return;
  STATE.view = v; store.set('roots_view', v);
  document.body.classList.toggle('wheelmode', v === 'wheel');
  $('#btnViewTree').setAttribute('aria-pressed', v === 'tree');
  $('#btnViewWheel').setAttribute('aria-pressed', v === 'wheel');
  wheelEl.hidden = v !== 'wheel';
  if (v === 'tree') { clearTree(); renderTree({ camera: 'instant', grow: true }); } else renderWheel();
}
$('#btnViewTree').onclick = () => setView('tree');
$('#btnViewWheel').onclick = () => setView('wheel');
document.body.classList.toggle('wheelmode', STATE.view === 'wheel');
$('#btnViewTree').setAttribute('aria-pressed', STATE.view === 'tree');
$('#btnViewWheel').setAttribute('aria-pressed', STATE.view === 'wheel');
wheelEl.hidden = STATE.view !== 'wheel';

/* Which two people fill someone's parent spots: birth parents first, in the tree's order. An adoptive parent (then
   foster, then a step link that holds a parent spot) takes a spot only where a birth parent is missing or Unknown.
   A step-parent who is only a parent's partner has no parent link, so never appears. */
function wheelParents(id) {
  const ps = parentsOf(id);
  const birth = ps.filter(x => !pcKind(x, id));
  const rank = { adopted: 0, foster: 1, step: 2 };
  const others = ps.filter(x => pcKind(x, id)).sort((a, b) => rank[pcKind(a, id)] - rank[pcKind(b, id)]);
  const out = birth.slice(0, 2);
  for (let i = 0; i < out.length && others.length; i++) if (P(out[i]).placeholder) out[i] = others.shift();
  while (out.length < 2 && others.length) out.push(others.shift());
  return out;
}
const wheelKids = id => [...childrenOf(id)].sort((a, b) => (parseInt(P(a).born) || 9999) - (parseInt(P(b).born) || 9999));

function wheelModel(F, maxRings) {
  const ahn = new Map([[1, F]]);
  for (let n = 1; n < 2 ** (maxRings + 1); n++) {
    const id = ahn.get(n);
    if (!id || P(id).placeholder || n >= 2 ** maxRings) continue;
    wheelParents(id).forEach((p, i) => ahn.set(2 * n + i, p));
  }
  const leaves = new Map();
  const leafCount = (id, d) => {
    if (d >= maxRings) return 1;
    const k = wheelKids(id); const v = k.length ? k.reduce((s, c) => s + leafCount(c, d + 1), 0) : 1;
    leaves.set(id + '@' + d, v); return v;
  };
  leafCount(F, 0);
  return { ahn, leaves };
}

/* ---- geometry: angles in degrees, clockwise from 12 o'clock ---- */
const wpt = (cx, cy, r, a) => { const t = a * Math.PI / 180; return [cx + r * Math.sin(t), cy - r * Math.cos(t)]; };
const f1 = n => n.toFixed(1);
function sectorPath(cx, cy, r0, r1, a0, a1) {
  const big = a1 - a0 > 180 ? 1 : 0;
  const [x0, y0] = wpt(cx, cy, r1, a0), [x1, y1] = wpt(cx, cy, r1, a1), [x2, y2] = wpt(cx, cy, r0, a1), [x3, y3] = wpt(cx, cy, r0, a0);
  return `M${f1(x0)},${f1(y0)} A${r1},${r1} 0 ${big} 1 ${f1(x1)},${f1(y1)} L${f1(x2)},${f1(y2)} A${r0},${r0} 0 ${big} 0 ${f1(x3)},${f1(y3)} Z`;
}

function renderWheel(opts = {}) {
  if (!STATE.focus || !G.people.has(STATE.focus)) return;
  const F = STATE.focus;
  const W = wheelEl.clientWidth, H = wheelEl.clientHeight;
  const phone = W <= 640;
  const maxRings = phone ? 3 : 5;
  const { ahn, leaves } = wheelModel(F, maxRings);
  // Only as many rings as there are people (plus one ring of empty spots to add to), so a young tree isn't a big empty disc.
  let ancNeed = 1;
  for (const n of ahn.keys()) if (n > 1) ancNeed = Math.max(ancNeed, Math.floor(Math.log2(n)) + (P(ahn.get(n)).placeholder ? 0 : 1));
  ancNeed = Math.min(maxRings, ancNeed);
  const descDepth = (id, d) => d >= maxRings ? d : Math.max(d, ...wheelKids(id).map(c => descDepth(c, d + 1)));
  const desNeed = descDepth(F, 0);
  const need = Math.max(ancNeed, desNeed);
  // As big as the screen allows: the full width holds both halves side to side; the height holds the roots below
  // and the branches above, so a wheel with few descendants sits higher and grows larger instead of floating low.
  const top = 64, bottom = phone ? 56 : 64, mx = phone ? 14 : 40;
  const r0 = phone ? 44 : 62;
  const Hav = H - top - bottom - 20;
  const w = Math.max(24, Math.min(phone ? 78 : 96, (W / 2 - mx - r0) / need, (Hav - 2 * r0) / (ancNeed + desNeed)));
  const above = r0 + desNeed * w + (desNeed ? 0 : 0), below = r0 + ancNeed * w + (phone ? 0 : 30);
  const cx = W / 2, cy = top + 10 + Math.max(0, (Hav - above - below) / 2) + above;
  const k = Math.max(.78, Math.min(1.12, w / 63));
  const seen = new Map();
  const count = id => seen.set(id, (seen.get(id) || 0) + 1);
  for (const [n, id] of ahn) if (n > 1 && n < 2 ** (need + 1)) count(id);
  const walkD = (id, d) => { if (d > need) return; if (d) count(id); wheelKids(id).forEach(c => walkD(c, d + 1)); };
  walkD(F, 0);

  const defs = [], out = [], over = [];
  let pid = 0;
  const arcId = (r, a0, a1, flip) => {
    const id = 'wp' + (++pid), big = a1 - a0 > 180 ? 1 : 0;
    const [x0, y0] = wpt(cx, cy, r, flip ? a1 : a0), [x1, y1] = wpt(cx, cy, r, flip ? a0 : a1);
    defs.push(`<path id="${id}" d="M${f1(x0)},${f1(y0)} A${r},${r} 0 ${big} ${flip ? 0 : 1} ${f1(x1)},${f1(y1)}"/>`);
    return id;
  };
  const nick = p => (p.nicknames || '').split(',')[0].trim();
  function labelLines(p) {
    if (p.placeholder) return [['Unknown', 'unk']];
    const nm = cardName(p), last = p.last || '';
    const l1 = last && nm.endsWith(' ' + last) ? nm.slice(0, -last.length - 1) : nm;
    const lines = [[l1, 'nm']];
    if (last && l1 !== nm) lines.push([last, 'nm2']);
    const y = years(p); if (y) lines.push([y, 'yr']);
    return lines;
  }
  const FS = { nm: 13.5, nm2: 12, yr: 10.5, add: 11.5, unk: 12 };
  const COL = { nm: '#1D2B24', nm2: '#1D2B24', yr: '#8A6A22', add: '#7A5D1E', unk: '#4A564F' };
  const WT = { nm: 500, nm2: 400, yr: 400, add: 500, unk: 400 };
  function label(ring, a0, a1, lines, short) {
    const rIn = r0 + (ring - 1) * w, rm = rIn + w / 2, span = a1 - a0;
    let mid = ((a0 + a1) / 2) % 360;
    const small = ring >= 4 || span < 20 ? .86 : 1;
    const arc = span * Math.PI / 180 * rm;
    const longest = Math.max(...lines.map(([t, c]) => t.length * FS[c] * k * small * .53));
    if (arc > longest + 12 && lines.length * 13.5 * k * small <= w - 6) {
      if (span >= 170) { // a wide spot: put the name near its top, where it reads nearly level
        const topA = a1 >= 360 ? 360 : 0, t = Math.min(Math.max(topA, a0 + 32), a1 - 32), h = Math.min(span / 2 - 2, 58);
        a0 = t - h; a1 = t + h; mid = t % 360;
      }
      const flip = mid > 90 && mid < 270, n = lines.length, gap = 13.5 * k * small;
      lines.forEach(([t, c], i) => {
        const o = (n - 1) / 2 * gap - i * gap, fs = FS[c] * k * small;
        const r = (flip ? rm - o : rm + o) - (flip ? -1 : 1) * fs * .35;
        out.push(`<text class="wl" font-size="${f1(fs)}" font-weight="${WT[c]}" fill="${COL[c]}" text-anchor="middle"><textPath href="#${arcId(r, a0, a1, flip)}" startOffset="50%">${esc(t)}</textPath></text>`);
      });
      return;
    }
    // A narrow spot: along the spoke, shortened to fit the ring.
    const [x, y] = wpt(cx, cy, rm, mid), rot = mid < 180 ? mid - 90 : mid + 90, room = w - 8 * k;
    const fit = (t, f) => t.length * f * .53 <= room ? t : t.slice(0, Math.max(2, Math.floor(room / (f * .53)) - 1)) + '…';
    const f0 = 9.4 * k, fl = 8.6 * k, gap = 10.5 * k;
    let tl = short.map(([t, c], i) => [fit(t, i ? fl : f0), c, i ? fl : f0]);
    while (tl.length > 1 && tl.length * gap > arc - 2) tl.pop();
    tl.forEach(([t, c, f], i) => {
      const dy = (i - (tl.length - 1) / 2) * gap + 3.3 * k;
      out.push(`<text class="wl" transform="translate(${f1(x)},${f1(y)}) rotate(${f1(rot)})" y="${f1(dy)}" font-size="${f1(f)}" font-weight="${i ? 400 : 500}" fill="${COL[c]}" text-anchor="middle">${esc(t)}</text>`);
    });
  }
  function shortLines(p) {
    if (p.placeholder) return [['Unknown', 'unk']];
    // Two people who'd read the same here (a father and son both going by Jonny) keep the middle initial the card gives them.
    const ini = (/ ([A-Z])\. \S+$/.exec(cardName(p)) || [])[1];
    const first = (nick(p) && !sameName(nick(p), p.first) ? nick(p) : p.first || '') + (ini ? ' ' + ini + '.' : '');
    const both = [first, p.last].filter(Boolean).join(' ');
    const l = [[both, 'nm']];
    if (both.length * 9.4 * k * .53 > w - 8 * k && p.last) l.splice(0, 1, [first, 'nm'], [p.last, 'nm2']);
    const y = years(p); if (y) l.push([y, 'yr']);
    return l;
  }
  function wedge(ring, a0, a1, id, side) {
    const p = P(id), rIn = r0 + (ring - 1) * w, rOut = rIn + w;
    const fill = side === 'anc' ? (ring % 2 ? '#F7EFDD' : '#FBF6EA') : (ring % 2 ? '#E3EBDF' : '#EEF3EB');
    const twice = (seen.get(id) || 0) > 1;
    const who = p.placeholder ? 'Unknown' : cardName(p);
    const rel = relation(id);
    const cls = 'wedge' + (p.placeholder ? ' unk' : '') + (p.pending || p.edits ? ' pend' : '') + (STATE.selected === id ? ' sel' : '');
    out.push(`<g class="${cls}" data-id="${esc(id)}" data-ring="${ring}" data-side="${side}" role="button" tabindex="0" aria-label="${esc(who + (rel ? ', ' + rel : ''))}">`
      + `<path d="${sectorPath(cx, cy, rIn, rOut, a0, a1)}" fill="${p.placeholder ? 'rgba(255,255,255,.35)' : p.pending ? '#FFF9EC' : fill}"/>`
      + (p.placeholder ? `<path class="dash" d="${sectorPath(cx, cy, rIn + 3, rOut - 3, a0 + .8, a1 - .8)}"/>` : '')
      + (p.pending || p.edits ? `<path class="pdash" d="${sectorPath(cx, cy, rIn + 2.5, rOut - 2.5, a0 + .6, a1 - .6)}"/>` : '')
      + (twice ? `<path class="twice" d="${sectorPath(cx, cy, rIn + 2, rOut - 2, a0 + .5, a1 - .5)}"/>` : '')
      + `</g>`);
    label(ring, a0, a1, labelLines(p), shortLines(p));
  }
  function addSpot(ring, a0, a1, childId) {
    const c = P(childId), rIn = r0 + (ring - 1) * w;
    const whose = isNoName(c) ? 'Add a parent' : `${shortName(c) || 'their'}'s parent`;
    out.push(`<g class="wedge add" data-add="${esc(childId)}" data-ring="${ring}" data-side="anc" role="button" tabindex="0" aria-label="Add ${esc(whose.replace(/^Add a /, 'a '))}">`
      + `<path d="${sectorPath(cx, cy, rIn + 2, rIn + w - 2, a0 + .6, a1 - .6)}"/></g>`);
    const arc = (a1 - a0) * Math.PI / 180 * (rIn + w / 2);
    label(ring, a0, a1, [[arc > 80 * k ? '+ ' + whose : '+', 'add']], [['+ parent', 'add']]);
  }
  // A short gold edge on the rim: this line goes on past the last ring. Tap the person to follow it.
  const edge = (a0, a1) => over.push(`<path class="more" d="${sectorPath(cx, cy, r0 + need * w + 3, r0 + need * w + 8, a0 + 1, a1 - 1)}"/>`);

  /* ---- ancestors: the bottom half, first parent on the left ---- */
  for (let g = 1; g <= need; g++) {
    const L = 180 / 2 ** g;
    for (let s = 0; s < 2 ** g; s++) {
      const n = 2 ** g + s, a0 = 270 - (s + 1) * L, a1 = a0 + L, id = ahn.get(n);
      if (id) {
        wedge(g, a0, a1, id, 'anc');
        if (g === need && !P(id).placeholder && wheelParents(id).length) edge(a0, a1);
      } else {
        const child = ahn.get(n >> 1);
        if (child && !P(child).placeholder) addSpot(g, a0, a1, child);
      }
    }
  }
  /* ---- descendants: the top half, each child's share sized by their descendants ---- */
  (function down(id, d, a0, span) {
    const kids = wheelKids(id); if (!kids.length || d >= need) return;
    const tot = kids.reduce((s, c) => s + (leaves.get(c + '@' + (d + 1)) || 1), 0);
    let a = a0;
    for (const c of kids) {
      const sp = span * (leaves.get(c + '@' + (d + 1)) || 1) / tot;
      wedge(d + 1, a, a + sp, c, 'des');
      if (d + 1 === need && wheelKids(c).length) edge(a, a + sp);
      down(c, d + 1, a, sp); a += sp;
    }
  })(F, 0, 270, 180);

  /* ---- the line between roots and branches, and the two halves named by the parents' names ---- */
  const rimR = r0 + need * w;
  const [lx0, ly0] = wpt(cx, cy, r0 - 4, 270), [lx1, ly1] = wpt(cx, cy, rimR + 10, 270), [rx0] = wpt(cx, cy, r0 - 4, 90), [rx1] = wpt(cx, cy, rimR + 10, 90);
  over.push(`<line class="ground" x1="${f1(lx1)}" y1="${f1(ly0)}" x2="${f1(lx0)}" y2="${f1(ly1)}"/><line class="ground" x1="${f1(rx0)}" y1="${f1(cy)}" x2="${f1(rx1)}" y2="${f1(cy)}"/>`);
  const [p0, p1] = [ahn.get(2), ahn.get(3)];
  if (!phone && p0 && p1) {
    const side = (id, a, anchor) => { const q = P(id); if (q.placeholder) return; const [x, y] = wpt(cx, cy, r0 + ancNeed * w + 22, a);
      over.push(`<text class="side" x="${f1(x)}" y="${f1(y)}" text-anchor="${anchor}">${esc((shortName(q) || 'Their') + "'s side")}</text>`); };
    side(p0, 232, 'end'); side(p1, 128, 'start');
  }
  /* ---- the centered person ---- */
  const fp = P(F), tag = F === STATE.viewer ? 'YOU' : (relation(F) || '').toUpperCase();
  const cn = fp.placeholder ? 'Unknown' : (nick(fp) && !sameName(nick(fp), fp.first) ? nick(fp) : fp.first) || '';
  over.push(`<g class="hub" role="button" tabindex="0" data-id="${esc(F)}" aria-label="${esc(fp.placeholder ? 'Unknown' : cardName(fp))}, in the middle">`
    + `<circle cx="${cx}" cy="${cy}" r="${r0 + 3}" fill="rgba(169,130,47,.18)"/><circle cx="${cx}" cy="${cy}" r="${r0 - 4}" fill="#1D2B24" stroke="#A9822F" stroke-width="2.5"/>`
    + (tag ? `<text x="${cx}" y="${f1(cy - 15 * k)}" class="htag" font-size="${f1(Math.min(9.5 * k, (2 * r0 - 18) / tag.length / .62))}">${esc(tag.slice(0, 26))}</text>` : '')
    + `<text x="${cx}" y="${f1(cy + 4 * k)}" class="hnm" font-size="${f1(Math.min(17 * k, (2 * r0 - 16) / Math.max(4, cn.length) / .55))}">${esc(cn)}</text>`
    + `<text x="${cx}" y="${f1(cy + 20 * k)}" class="hln" font-size="${f1(12 * k)}">${esc(fp.placeholder ? '' : fp.last || '')}</text></g>`);

  wheelEl.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="group" aria-label="Family wheel centered on ${esc(fp.placeholder ? 'Unknown' : cardName(fp))}"><defs>${defs.join('')}</defs>${out.join('')}${over.join('')}</svg>`;
  if (!reduceMotion && !opts.quiet) { wheelEl.classList.remove('grow'); void wheelEl.offsetWidth; wheelEl.classList.add('grow'); }
}

/* Tap a person for their card ("Put them in the middle" is on it); tap an empty spot to add that parent. */
function wheelAct(t) {
  const g = t.closest('[data-id],[data-add]'); if (!g) return;
  if (g.dataset.add) { STATE.selected = null; openAdd(g.dataset.add, { rel: 'parent' }); return; }
  openPerson(g.dataset.id);
}
wheelEl.addEventListener('click', e => wheelAct(e.target));
wheelEl.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); wheelAct(e.target); } });
// The card opening or closing marks the chosen person on the wheel, as it does on the tree.
const refreshTreeCards = refreshCards;
refreshCards = function () { if (STATE.view === 'wheel') renderWheel({ quiet: true }); else refreshTreeCards(); };
let wheelRZ;
addEventListener('resize', () => { if (STATE.view !== 'wheel') return; clearTimeout(wheelRZ); wheelRZ = setTimeout(renderWheel, 120); });

/* The Key explains the wheel's marks while the wheel is showing. */
const openTreeKey = openKey;
openKey = function () {
  if (STATE.view !== 'wheel') return openTreeKey();
  const row = (art, title, note) => `<div class="krow">${art}<div>${title}<small>${note}</small></div></div>`;
  const sw = st => `<svg viewBox="0 0 92 34" aria-hidden="true"><path d="M14 30 A46 46 0 0 1 78 30 L64 16 A26 26 0 0 0 28 16 Z" ${st}/></svg>`;
  openPanel(`
    <div class="head"><div><h2>Reading the wheel</h2><div class="sub">The same family as the tree, drawn as a circle.</div></div>
      <button class="x" id="pClose" aria-label="Close">${ICON.close}</button></div>
    <div class="body key">
      ${row(`<svg viewBox="0 0 92 34" aria-hidden="true"><circle cx="46" cy="17" r="13" fill="#1D2B24" stroke="#A9822F" stroke-width="2"/></svg>`, 'The person in the middle', 'Tap anyone, then "Put them in the middle". The arrow button brings you back.')}
      ${row(sw('fill="#F7EFDD" stroke="rgba(29,43,36,.2)"'), 'Ancestors, below the line', 'Parents split the first ring, grandparents the next, and so on. Each half is one parent’s side.')}
      ${row(sw('fill="#E3EBDF" stroke="rgba(29,43,36,.2)"'), 'Children and grandchildren, above the line', 'A child with more descendants gets a wider share.')}
      ${row(sw('fill="rgba(255,253,249,.5)" stroke="#A9822F" stroke-width="1.4" stroke-dasharray="4 3"'), 'No one here yet', 'Tap it to add that parent.')}
      ${row(sw('fill="rgba(255,255,255,.4)" stroke="#1D2B24" stroke-opacity=".5" stroke-dasharray="3 3"'), 'Unknown person', 'We know someone was here but not their name.')}
      ${row(sw('fill="#FFF9EC" stroke="#A9822F" stroke-width="1.5" stroke-dasharray="5 3"'), 'Unconfirmed', 'Something you added. Only you see it until ' + OWNER_NAME + ' confirms it.')}
      ${row(sw('fill="#F7EFDD" stroke="#A9822F" stroke-width="2.4"'), 'The same person twice', 'Two lines lead back to them, as when cousins married.')}
      ${row(`<svg viewBox="0 0 92 34" aria-hidden="true"><path d="M14 30 A46 46 0 0 1 78 30 L75 27 A42 42 0 0 0 17 27 Z" fill="#A9822F"/></svg>`, 'Their line goes further', 'Put them in the middle to see more.')}
      <p class="story muted">Birth parents fill the spots. An adoptive parent fills one only where the birth parent is missing or unknown. Step-parents, partners, brothers, sisters and cousins are on the tree view.</p>
    </div>`);
  $('#pClose').onclick = closePanel;
};
$('#btnKey').onclick = () => openKey();

/* =====================================================================
 * How are we related? (2026-11-22)
 * A button on every card opens the path between the viewer (or anyone) and that person:
 *  - blood relatives: the kinship word ("first cousin once removed") and a V-shaped diagram down to the ancestors
 *    they share, roots below like the tree;
 *  - related through a blood relative ("your child Jonny's half-sibling") or one marriage ("your child Jonny's spouse");
 *  - otherwise family by marriage, told as numbered steps.
 * Built only from what the page already has. Gender words only where the tree shows a gender (people who have died).
 * ===================================================================== */
let ancG = null, ancMemo = new Map();
// Every ancestor of id with how far up it is and the child we reached it through (id itself at 0).
function ancestry(id) {
  if (ancG !== G) { ancG = G; ancMemo = new Map(); }
  if (ancMemo.has(id)) return ancMemo.get(id);
  const m = new Map([[id, { d: 0, via: null }]]), q = [id];
  while (q.length) { const c = q.shift(); for (const p of parentsOf(c)) if (!m.has(p)) { m.set(p, { d: m.get(c).d + 1, via: c }); q.push(p); } }
  ancMemo.set(id, m); return m;
}
// Shared ancestry of a and b: up da generations from a and db from b to the nearest shared ancestor (or couple).
function bloodLink(a, b) {
  if (a === b) return { da: 0, db: 0, apex: [a] };
  const A = ancestry(a), B = ancestry(b);
  let best = Infinity, apex = [];
  for (const [x, { d }] of A) if (B.has(x)) {
    const s = d + B.get(x).d;
    if (s < best) { best = s; apex = [x]; } else if (s === best) apex.push(x);
  }
  if (!apex.length) return null;
  const da = A.get(apex[0]).d, db = B.get(apex[0]).d;
  apex = apex.filter(x => A.get(x).d === da && B.get(x).d === db);
  // Two shared ancestors at the same distance are usually a couple; show both, partners first.
  if (apex.length > 2) { const c = apex.find(x => apex.some(y => y !== x && partnersOf(x).some(pt => pt.id === y))); apex = c ? [c, apex.find(y => y !== c && partnersOf(c).some(pt => pt.id === y))] : apex.slice(0, 1); }
  return { da, db, apex };
}
const upPath = (from, to) => { const A = ancestry(from), out = []; let c = to; while (c) { out.unshift(c); c = A.get(c).via; } return out; };   // from ... to
const gw = (p, m, f, n) => (p && !isLiving(p) && p.sex === 'male') ? m : (p && !isLiving(p) && p.sex === 'female') ? f : n;
const ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];
const TIMES = ['', 'once', 'twice', 'three times', 'four times', 'five times'];
// The word for b, seen from a, when b is da generations below a shared ancestor that is da generations above a.
function kinWord(da, db, p, l) {
  const great = n => 'great-'.repeat(Math.max(0, n));
  if (!da && !db) return 'self';
  if (!da) return db === 1 ? gw(p, 'son', 'daughter', 'child') : great(db - 2) + gw(p, 'grandson', 'granddaughter', 'grandchild');
  if (!db) return da === 1 ? gw(p, 'father', 'mother', 'parent') : great(da - 2) + gw(p, 'grandfather', 'grandmother', 'grandparent');
  if (da === 1 && db === 1) return (l && l.half ? 'half-' : '') + gw(p, 'brother', 'sister', 'sibling');
  if (da === 1) return db === 2 ? gw(p, 'nephew', 'niece', "sibling's child") : gw(p, great(db - 3) + 'grandnephew', great(db - 3) + 'grandniece', "sibling's " + great(db - 3) + 'grandchild');
  if (db === 1) return da === 2 ? gw(p, 'uncle', 'aunt', "parent's sibling") : gw(p, great(da - 2) + 'uncle', great(da - 2) + 'aunt', great(da - 3) + "grandparent's sibling");
  const n = Math.min(da, db) - 1, r = Math.abs(da - db);
  return (ORD[n] || n + 'th') + ' cousin' + (r ? ' ' + (TIMES[r] || r + ' times') + ' removed' : '');
}
function bloodWord(a, b) {
  const l = bloodLink(a, b); if (!l) return null;
  // Siblings who share only one recorded parent, where either has two, are half-siblings.
  if (l.da === 1 && l.db === 1) l.half = l.apex.length === 1 && (parentsOf(a).length > 1 || parentsOf(b).length > 1);
  l.word = kinWord(l.da, l.db, P(b), l); return l;
}
const plural = w => w.endsWith('child') ? w + 'ren' : w + 's';
const nm = id => { const q = P(id); return q.placeholder ? 'Unknown' : shortName(q) || q.first || 'Unknown'; };
const fullNm = id => { const q = P(id); return q.placeholder ? 'an unknown person' : cardName(q); };
const andJoin = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
function partnerWord(a, b) {
  const sub = (partnersOf(a).find(x => x.id === b) || {}).sub, p = P(b);
  if (sub === 'married') return gw(p, 'husband', 'wife', 'spouse');
  if (sub === 'widowed') return gw(p, 'late husband', 'late wife', 'late spouse');
  if (sub === 'divorced') return gw(p, 'ex-husband', 'ex-wife', 'former spouse');
  if (sub === 'former') return 'former partner';
  return 'partner';
}

/* The relationship from a to b, in the best words the tree allows. */
function findRelation(a, b) {
  const blood = bloodWord(a, b);
  if (blood) return { kind: 'blood', a, b, l: blood };
  const ids = [...G.people.keys()].filter(x => !P(x).placeholder);
  const cost = l => l.da + l.db;
  // Through one blood relative of a who is also b's blood relative (Sharon: a's child is her half-sibling).
  let best = null;
  for (const x of ids) {
    if (x === a || x === b) continue;
    const l1 = bloodWord(a, x); if (!l1) continue;
    const l2 = bloodWord(x, b); if (!l2) continue;
    const c = cost(l1) + cost(l2);
    if (!best || c < best.c) best = { kind: 'bridge', a, b, x, l1, l2, c };
  }
  const bridge = best; best = null;
  // One marriage: b is the partner of a (or of a's blood relative), or a blood relative of a's partner.
  for (const x of [a, ...ids.filter(x => x !== a && bloodLink(a, x))]) {
    const l1 = x === a ? null : bloodWord(a, x);
    for (const pt of partnersOf(x)) {
      const y = pt.id; if (y === a) continue;
      const l2 = y === b ? null : bloodWord(y, b);
      if (y !== b && !l2) continue;
      if (l1 && l2) continue;   // three parts: told as steps below
      const c = (l1 ? cost(l1) : 0) + 1 + (l2 ? cost(l2) : 0);
      if (!best || c < best.c) best = { kind: 'marriage', a, b, x, y, l1, l2, c };
    }
  }
  // Blood ties win a near tie ("your child Jonny's half-sibling" over "your former partner Kayla's child"), but not
  // when the blood words come out clumsy ("your child Jonny's parent's sibling" loses to "your former partner Kayla's sibling").
  if (best && best.c === 1) return best;   // their own partner is just that
  if (bridge && (!best || bridge.c - 1 + (/'s /.test(bridge.l1.word + ' ' + bridge.l2.word) ? 1 : 0) <= best.c)) return bridge;
  if (best) return best;
  // Anything else: the shortest chain through parents, children and partners.
  const prev = new Map([[a, null]]), q = [a];
  while (q.length) {
    const c = q.shift(); if (c === b) break;
    for (const [nx, s] of [...parentsOf(c).map(x => [x, 'U']), ...childrenOf(c).map(x => [x, 'D']), ...partnersOf(c).map(x => [x.id, 'P'])])
      if (!prev.has(nx)) { prev.set(nx, [c, s]); q.push(nx); }
  }
  if (!prev.has(b)) return { kind: 'none', a, b };
  const path = []; let c = b;
  while (prev.get(c)) { const [f, s] = prev.get(c); path.unshift([f, s, c]); c = f; }
  return { kind: 'chain', a, b, path };
}
// A chain of single steps as readable steps: a run up then down is one blood step ("sibling", "first cousin").
function chainSteps(path) {
  const steps = []; let i = 0;
  while (i < path.length) {
    const [from, s] = path[i];
    if (s === 'P') { steps.push({ from, to: path[i][2], t: 'P' }); i++; continue; }
    let j = i; while (j < path.length && path[j][1] === 'U') j++;
    let k = j; while (k < path.length && path[k][1] === 'D') k++;
    if (j === i) { while (k < path.length && path[k][1] === 'D') k++; }
    const end = k > i ? k : i + 1, to = path[end - 1][2];
    steps.push({ from, to, t: 'B', l: bloodWord(from, to) });
    i = end;
  }
  return steps;
}
function stepsOf(r) {
  if (r.kind === 'chain') return chainSteps(r.path);
  if (r.kind === 'bridge') return [{ from: r.a, to: r.x, t: 'B', l: r.l1 }, { from: r.x, to: r.b, t: 'B', l: r.l2 }];
  if (r.kind === 'marriage') return [r.l1 && { from: r.a, to: r.x, t: 'B', l: r.l1 }, { from: r.x, to: r.y, t: 'P' }, r.l2 && { from: r.y, to: r.b, t: 'B', l: r.l2 }].filter(Boolean);
  return [];
}
function stepSentence(st, me) {
  const you = st.from === me;
  if (st.t === 'P') {
    const sub = (partnersOf(st.from).find(x => x.id === st.to) || {}).sub;
    const who = you ? 'You' : nm(st.from), to = fullNm(st.to), be = you ? 'are' : 'is', was = you ? 'were' : 'was';
    if (sub === 'married') return `${who} ${be} married to ${to}.`;
    if (sub === 'widowed' || sub === 'divorced') return `${who} ${was} married to ${to}.`;
    if (sub === 'former') return `${who} and ${to} were together.`;
    return `${who} and ${to} ${sub === 'partner' ? 'are' : 'were'} partners.`;
  }
  return `${you ? 'Your' : nm(st.from) + "'s"} ${st.l.word} is ${fullNm(st.to)}.`;
}

/* Headline and one plain sentence of explanation. me is who "you" is (a). */
function relationWords(r) {
  const me = r.a === STATE.viewer, A = me ? 'your' : nm(r.a) + "'s", B = fullNm(r.b);
  if (r.kind === 'none') return { head: `${B} isn't connected to ${me ? 'you' : nm(r.a)} in the tree yet.`, body: 'Somebody may know the missing link. Add the relative who joins the two families, and the path will show up here.' };
  if (r.kind === 'blood') {
    const l = r.l, head = `${B} is ${A} ${l.word}.`;
    const apexNames = andJoin(l.apex.map(fullNm));
    if (!l.da || !l.db) {
      const line = (l.da ? upPath(r.a, r.b) : upPath(r.b, r.a)).slice(1, -1).map(nm);
      return { head, body: line.length ? `The line runs through ${andJoin(line)}.` : '' };
    }
    const sharedWord = kinWord(l.da, 0, null);
    const share = l.apex.length > 1 ? `${plural(sharedWord)}: ${apexNames}` : `${l.half && l.da === 1 ? 'one parent' : 'a ' + sharedWord}: ${apexNames}`;
    if (l.da === 1 && l.db === 1) return { head, body: `${me ? 'You share' : nm(r.a) + ' and ' + nm(r.b) + ' share'} ${share}.` };
    const sa = upPath(r.a, l.apex[0]), sb = upPath(r.b, l.apex[0]);
    const ca = sa[sa.length - 2], cb = sb[sb.length - 2];
    const were = isLiving(P(ca)) || isLiving(P(cb)) ? 'are' : 'were';
    const ka = kinWord(l.da - 1, 0, P(ca)), kb = kinWord(l.db - 1, 0, P(cb));
    const left = l.da === 1 ? (me ? 'You' : nm(r.a)) : `${me ? 'Your' : nm(r.a) + "'s"} ${ka} ${nm(ca)}`;
    const right = l.db === 1 ? nm(r.b) : `${nm(r.b)}'s ${kb} ${nm(cb)}`;
    return { head, body: `${left} and ${right} ${l.da === 1 && me ? 'are' : were} siblings, so ${me ? 'you share' : 'they share'} ${share}.` };
  }
  if (r.kind === 'bridge') return { head: `${B} is ${A} ${r.l1.word} ${nm(r.x)}'s ${r.l2.word}.`, body: `${nm(r.b)} isn't related to ${me ? 'you' : nm(r.a)} by blood. The link is ${nm(r.x)}, who is related to both.` };
  if (r.kind === 'marriage') {
    const pw = partnerWord(r.x, r.y);
    const head = r.l1 ? `${B} is ${A} ${r.l1.word} ${nm(r.x)}'s ${pw}.`
      : r.y === r.b ? `${B} is ${A} ${pw}.` : `${B} is ${A} ${pw} ${nm(r.y)}'s ${r.l2.word}.`;
    return { head, body: r.l1 || r.y !== r.b ? 'Family by marriage, not by blood.' : '' };
  }
  return { head: `${B} is family by marriage.`, body: `No shared ancestor in the tree. The link runs through ${stepsOf(r).filter(s => s.t === 'P').length > 1 ? 'marriages' : 'a marriage'}, in ${stepsOf(r).length} steps:` };
}

/* ---- drawing: blood as a V down to the shared ancestors, everything else as a chain of steps ---- */
const RC = { w: 148, h: 62, gap: 30, row: 100 };   // fits the card panel on a phone (about 334 px inside)
function relCard(id, x, y, sub, end, shared) {
  const p = P(id), dead = !isLiving(p) && !p.placeholder;
  const cls = 'rcard' + (end ? ' end' : '') + (shared ? ' shared' : '') + (dead ? ' dead' : '') + (p.placeholder ? ' unk' : '');
  return `<button class="${cls}" data-goto="${esc(id)}" style="left:${x}px;top:${y}px"><span class="av">${esc(p.placeholder ? '?' : initials(p))}</span><span class="t"><span class="n">${esc(p.placeholder ? 'Unknown' : cardName(p))}</span>${sub ? `<span class="s">${esc(sub)}</span>` : ''}${years(p) ? `<span class="y">${esc(years(p))}</span>` : ''}</span></button>`;
}
const cap = t => t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
function subFor(a, id) {
  if (id === a) return a === STATE.viewer ? 'You' : '';
  const l = bloodWord(a, id); if (l) return cap(l.word);
  return a === STATE.viewer ? relation(id) : '';
}
function bloodDiagram(r) {
  const l = r.l, W = 2 * RC.w + RC.gap, cx = W / 2, L = Math.max(l.da, l.db);
  const y = lev => (L - lev) * RC.row;
  let cards = '', lines = '';
  const G2 = 'class="gl"';
  const col = (path, x0) => path.slice(0, -1).forEach((id, i) => {     // path from the end person down to just above the apex
    const lev = path.length - 1 - i;
    cards += relCard(id, x0, y(lev), subFor(r.a, id), id === r.a || id === r.b, false);
    if (lev > 1) lines += `<path ${G2} d="M${x0 + RC.w / 2} ${y(lev) + RC.h} V${y(lev - 1)}"/>`;
  });
  const apexY = y(0), two = l.apex.length > 1;
  if (!l.da || !l.db) {                                                 // a straight line: one column, oldest at the bottom
    const path = l.da ? upPath(r.a, r.b) : upPath(r.b, r.a), x0 = cx - RC.w / 2;
    path.forEach((id, i) => { const lev = path.length - 1 - i; cards += relCard(id, x0, y(lev), subFor(r.a, id), id === r.a || id === r.b, false);
      if (lev) lines += `<path ${G2} d="M${cx} ${y(lev) + RC.h} V${y(lev - 1)}"/>`; });
    return { html: cards, svg: lines, w: W, h: y(0) + RC.h, label: '' };
  }
  col(upPath(r.a, l.apex[0]), 0);
  col(upPath(r.b, l.apex[0]), RC.w + RC.gap);
  const meet = two ? apexY + RC.h / 2 : apexY;
  lines += `<path ${G2} d="M${RC.w / 2} ${y(1) + RC.h} C${RC.w / 2} ${(y(1) + RC.h + meet) / 2} ${cx} ${(y(1) + RC.h + meet) / 2 - 6} ${cx} ${meet}"/>`
        + `<path ${G2} d="M${W - RC.w / 2} ${y(1) + RC.h} C${W - RC.w / 2} ${(y(1) + RC.h + meet) / 2} ${cx} ${(y(1) + RC.h + meet) / 2 - 6} ${cx} ${meet}"/>`;
  if (two) {
    cards += relCard(l.apex[0], 0, apexY, subFor(r.a, l.apex[0]), false, true) + relCard(l.apex[1], RC.w + RC.gap, apexY, subFor(r.a, l.apex[1]), false, true);
    const sub = (partnersOf(l.apex[0]).find(x => x.id === l.apex[1]) || {}).sub, former = isFormer(sub);
    lines += `<path d="M${RC.w} ${meet} H${RC.w + RC.gap}" class="pl${former ? ' former' : ''}"/><g transform="translate(${cx} ${meet})" opacity="${former ? .45 : 1}"><circle r="5" cx="-3.5" class="rg"/><circle r="5" cx="3.5" class="rg2"/></g>`;
  } else cards += relCard(l.apex[0], cx - RC.w / 2, apexY, subFor(r.a, l.apex[0]), false, true);
  // The two children of the shared ancestors are siblings: say so between their lines.
  if (l.da > 1 && l.db > 1) cards += `<span class="rtag" style="left:${cx - 50}px;top:${y(1) + RC.h + 2}px">siblings</span>`;
  const sw = kinWord(l.da, 0, null);
  const label = `Shared ${two ? plural(sw) : sw}`;
  return { html: cards, svg: lines, w: W, h: apexY + RC.h, label };
}
function chainDiagram(r) {
  const steps = stepsOf(r), W = 2 * RC.w + RC.gap, x0 = W / 2 - RC.w / 2, row = RC.h + 44;
  let cards = relCard(r.a, x0, 0, subFor(r.a, r.a), true, false), lines = '', yy = 0;
  steps.forEach((st, i) => {
    const ny = yy + row, last = i === steps.length - 1;
    const word = st.t === 'P' ? partnerWord(st.from, st.to) : st.l.word;
    lines += st.t === 'P' ? `<path d="M${W / 2} ${yy + RC.h} V${ny}" class="pl"/><g transform="translate(${W / 2} ${yy + RC.h + 22})"><circle r="5" cx="-3.5" class="rg"/><circle r="5" cx="3.5" class="rg2"/></g>`
      : `<path class="${st.l.da && !st.l.db ? 'gl' : 'il'}" d="M${W / 2} ${yy + RC.h} V${ny}"/>`;
    cards += `<span class="rstep" style="left:${W / 2 + 14}px;top:${yy + RC.h + 13}px">${esc(word)}</span>`;
    cards += relCard(st.to, x0, ny, subFor(r.a, st.to), last, false);
    yy = ny;
  });
  return { html: cards, svg: lines, w: W, h: yy + RC.h, label: '' };
}
// The people on the path, for marking them on the tree.
function pathPeople(r) {
  if (r.kind === 'blood') { const l = r.l; if (!l.da || !l.db) return l.da ? upPath(r.a, r.b) : upPath(r.b, r.a); return [...upPath(r.a, l.apex[0]), ...upPath(r.b, l.apex[0]), ...l.apex]; }
  if (r.kind === 'chain') return [r.a, ...r.path.map(s => s[2])];
  const out = new Set([r.a, r.b]);
  stepsOf(r).forEach(st => { out.add(st.from); out.add(st.to); if (st.t === 'B') { const l = bloodLink(st.from, st.to); if (l) [...upPath(st.from, l.apex[0]), ...upPath(st.to, l.apex[0])].forEach(x => out.add(x)); } });
  return [...out];
}

/* ---- the card button and the panels ---- */
function relatedButtonHTML(id) {
  if (!G.people.has(id) || P(id).placeholder) return '';
  const v = STATE.viewer;
  let sub = 'Compare with anyone in the tree.';
  if (v && v !== id && G.people.has(v)) {
    const r = findRelation(v, id);
    sub = r.kind === 'blood' ? `${cap(r.l.word)}. See the path.` : r.kind === 'none' ? 'Not connected in the tree yet.' : 'Related through family. See how.';
  } else if (v === id) sub = 'Compare any two people in the tree.';
  return `<button class="relbtn" id="pRelated" data-id="${esc(id)}"><span class="ic">${ICON_LINK}</span><span class="tx"><b>How are we related?</b><small>${esc(sub)}</small></span>${ICON_CHEV}</button>`;
}
const ICON_LINK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M6 8.5v3a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3v-1"/></svg>';
const ICON_CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
const ICON_BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';
const ICON_SWAP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M7 4v16M4 17l3 3 3-3M17 20V4M14 7l3-3 3 3"/></svg>';
panel.addEventListener('click', e => {
  const b = e.target.closest('#pRelated'); if (!b) return;
  const id = b.dataset.id, v = STATE.viewer;
  if (v && v !== id && G.people.has(v)) openRelated(v, id, id); else openCompare(v && G.people.has(v) ? v : null, v === id ? null : id, id);
});

function openRelated(a, b, backTo) {
  const r = findRelation(a, b), words = relationWords(r);
  const d = r.kind === 'blood' ? bloodDiagram(r) : r.kind === 'none' ? null : chainDiagram(r);
  const steps = r.kind === 'chain' ? `<ol class="rsteps">${stepsOf(r).map(st => `<li>${esc(stepSentence(st, a))}</li>`).join('')}</ol>` : '';
  const back = backTo && G.people.has(backTo) ? `<button class="rback" id="rBack">${ICON_BACK}<span>${esc(nm(backTo))}'s card</span></button>` : '<span></span>';
  openPanel(`
    <div class="head rhead">${back}<button class="x" id="pClose" aria-label="Close">${ICON.close}</button></div>
    <div class="body related">
      <span class="kick">How are we related?</span>
      <h2 class="rh">${esc(words.head)}</h2>
      ${words.body ? `<p class="rb">${esc(words.body)}</p>` : ''}${steps}
      ${d ? `<div class="rdiag" style="width:${d.w}px;height:${d.h}px"><svg aria-hidden="true" width="${d.w}" height="${d.h}" viewBox="0 0 ${d.w} ${d.h}">${d.svg}</svg>${d.html}</div>${d.label ? `<span class="rshared">${esc(d.label)}</span>` : ''}` : ''}
      <div class="rbtns">
        ${d ? '<button class="primary" id="rShow">Show it on the tree</button>' : ''}
        <button class="nbtn" id="rCompare">Compare two other people</button>
      </div>
    </div>`);
  $('#pClose').onclick = closePanel;
  if ($('#rBack')) $('#rBack').onclick = () => openPerson(backTo);
  $('#rCompare').onclick = () => openCompare(a, b, backTo);
  if ($('#rShow')) $('#rShow').onclick = () => showPathOnTree(r);
}

let cmp = { a: null, b: null, back: null };
function openCompare(a, b, backTo) {
  cmp = { a, b, back: backTo };
  const slot = (key, label) => {
    const id = cmp[key], p = id && P(id);
    return `<div class="field"><span class="lab">${label}</span><div class="rslot">${p
      ? `<span class="av">${esc(initials(p))}</span><span class="t"><b>${esc(id === STATE.viewer ? 'You' : cardName(p))}</b><small>${esc(id === STATE.viewer ? cardName(p) : whoLine(p))}</small></span>`
      : '<span class="t"><small>Nobody chosen yet</small></span>'}<button class="nbtn" data-slot="${key}">${p ? 'Change' : 'Choose'}</button></div></div>`;
  };
  openPanel(`
    <div class="head rhead">${backTo && G.people.has(backTo) ? `<button class="rback" id="rBack">${ICON_BACK}<span>${esc(nm(backTo))}'s card</span></button>` : '<span></span>'}<button class="x" id="pClose" aria-label="Close">${ICON.close}</button></div>
    <div class="body related">
      <h2 class="rh">How are two people related?</h2>
      ${slot('a', 'From')}
      <div class="rswapw"><button class="iconbtn" id="rSwap" aria-label="Swap the two people">${ICON_SWAP}</button></div>
      ${slot('b', 'To')}
      <p class="formerr" id="rErr" hidden></p>
      <div class="rbtns"><button class="primary" id="rGo">Show how</button></div>
    </div>`);
  $('#pClose').onclick = closePanel;
  if ($('#rBack')) $('#rBack').onclick = () => openPerson(backTo);
  $('#rSwap').onclick = () => openCompare(cmp.b, cmp.a, backTo);
  document.querySelectorAll('[data-slot]').forEach(btn => btn.onclick = () => {
    const key = btn.dataset.slot, keep = { ...cmp };
    pickPerson(key === 'a' ? 'From whom?' : 'To whom?', 'Anyone in the tree.', id => { keep[key] = id; openCompare(keep.a, keep.b, keep.back); });
  });
  $('#rGo').onclick = () => {
    if (!cmp.a || !cmp.b) { const e = $('#rErr'); e.textContent = 'Choose both people first.'; e.hidden = false; return; }
    if (cmp.a === cmp.b) { const e = $('#rErr'); e.textContent = 'Those are the same person. Choose someone else for one of them.'; e.hidden = false; return; }
    openRelated(cmp.a, cmp.b, backTo);
  };
}

/* "Show it on the tree": center where the two lines meet and fade everyone not on the path, until the next tap. */
function showPathOnTree(r) {
  closePanel();
  if (STATE.view === 'wheel') setView('tree');
  STATE.path = new Set(pathPeople(r));
  STATE.focus = r.kind === 'blood' && r.l.da && r.l.db ? r.l.apex[0] : r.b;
  // Step up to the lowest level that draws the whole path; the next tap puts the level back the way it was.
  if (STATE.pathLevel === undefined) STATE.pathLevel = STATE.level;
  const need = [...STATE.path];
  for (let lv = STATE.level; lv <= 3; lv++) { STATE.level = lv; const ns = layout().nodes; if (need.every(id => ns.has(id))) break; }
  syncLevelBtn();
  render();
}
function markPath() {
  document.body.classList.toggle('pathmode', !!STATE.path);
  for (const [id, rec] of live) if (rec.el && rec.node && rec.node.kind === 'person') {
    rec.el.classList.toggle('onpath', !!STATE.path && STATE.path.has(id));
    rec.el.classList.toggle('offpath', !!STATE.path && !STATE.path.has(id));
  }
}
const renderBeforePath = render;
render = function (opts = {}) { const out = renderBeforePath(opts); if (STATE.view !== 'wheel') markPath(); return out; };
stage.addEventListener('pointerdown', () => {
  if (!STATE.path) return;
  STATE.path = null; markPath();
  if (STATE.pathLevel !== undefined) { const was = STATE.pathLevel; delete STATE.pathLevel; if (was !== STATE.level) { STATE.level = was; STATE.open.clear(); syncLevelBtn(); render({ camera: false }); } }
});

/* =====================================================================
 * Intro (first visit), Guide, "Why I built this"
 * ===================================================================== */
const INTRO = [
  () => `
    <svg viewBox="4 8 216 112" style="width:180px;height:auto" aria-hidden="true">${document.querySelector('.topbar .logo').innerHTML}</svg>
    <h1>Welcome to our family tree.</h1>
    <div class="why">
      <p>When I was a kid, our family got together all the time. Card games at someone's house. Big reunions at the park. Christmas parties where one of us played Santa.</p>
      <p>Over the years, the patriarchs and matriarchs who held us together passed on, and many of us lost touch.</p>
      <p>Now I have a family of my own, an adult son and a daughter-in-law, and I want to bring back the family spirit I grew up with. This tree is where I'm starting: a detailed picture of who we are and how we're all connected.</p>
      <p>It only grows if you help. Add the relatives you know, especially the ones we've lost, then send the link to every relative you can. Together we can build something beautiful.</p>
      <p>Questions? Email me at <a href="mailto:jonathonpr@gmail.com">jonathonpr@gmail.com</a>.</p>
      <p>Thank you for helping this tree grow. I hope it brings us back around the same table.</p>
    </div>
    <p class="sig">Jonny Ruzicka</p>`,
  () => `
    <h1>How it works</h1>
    <ul class="howto">
      <li><span class="ic">${ICON.bud.replace('currentColor', '#A9822F')}</span><div><b>Tap anyone to see their story.</b><span>Names, dates and memories for those who've passed. Living relatives show by name only.</span></div></li>
      <li><span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="#1D2B24" stroke-width="1.8" stroke-linecap="round"><path d="M12 20V10"/><path d="M12 14c-3 0-5-2-6-5"/><path d="M12 12c3 0 5-2 6-5"/></svg></span><div><b>Branches far from the center fold into buds.</b><span>Tap a bud to open it, or use the menu at the top that starts as Close family to open more at once. A small +3 on a card means more family there: tap it to center the tree on them.</span></div></li>
      <li><span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="#1D2B24" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></span><div><b>Add who you know.</b><span>Especially the relatives we've lost. A first name is enough to start. ${OWNER_NAME} confirms each addition.</span></div></li>
      <li><span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="#1D2B24" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h3M4 12h3M4 17h3"/><path d="M10 7h10M10 12h10M10 17h10"/></svg></span><div><b>Not sure what a line means?</b><span>Tap Key at the top for every symbol and line type.</span></div></li>
      <li><span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="#1D2B24" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l16-8-6 16-3-7-7-1z"/></svg></span><div><b>Send it on.</b><span>Every relative who adds a branch fills in a gap nobody else could.</span></div></li>
    </ul>`,
  () => `
    <h1>Which one is you?</h1>
    <p>Pick yourself so the tree knows where you fit and opens on you. You can skip this and do it later from your own card.</p>
    <div class="field"><label for="iName">Your name</label><input id="iName" placeholder="Start typing" autocomplete="off"></div>
    <div class="pick" id="iList"></div>`
];
let introSteps = [0, 1, 2], introStep = 0;
function renderIntro() {
  const step = introSteps[introStep], last = introStep === introSteps.length - 1;
  $('#introInner').innerHTML = INTRO[step]() + `
    <div class="actions">
      ${introStep > 0 ? '<button class="iconbtn" id="iBack">Back</button>' : ''}
      <button class="primary" id="iNext">${last ? (step === 2 ? 'Skip for now' : 'Start exploring') : step === 0 ? 'Show me how it works' : 'Next'}</button>
      <span style="flex:1"></span><div class="dots">${introSteps.map((_, i) => `<i class="${i === introStep ? 'on' : ''}"></i>`).join('')}</div>
    </div>`;
  $('#intro').scrollTop = 0;
  if (introStep > 0) $('#iBack').onclick = () => { introStep--; renderIntro(); };
  $('#iNext').onclick = () => { if (last) finishIntro(); else { introStep++; renderIntro(); } };
  if (step === 2) {
    const list = () => {
      const q = $('#iName').value.toLowerCase().trim();
      const hits = [...G.people.values()].filter(p => !p.placeholder && isLiving(p) && nameMatches(p, q)).slice(0, 6);
      $('#iList').innerHTML = hits.map(p => `<button data-id="${p.id}">${listName(p)}<small>That's me</small></button>`).join('') + '<button data-id="new"><span>I’m not in the tree yet</span><small>Add me</small></button>';
      document.querySelectorAll('#iList button').forEach(b => b.onclick = () => {
        finishIntro(true);
        if (b.dataset.id === 'new') addMeFlow(); else claimMe(b.dataset.id).then(() => { STATE.focus = STATE.viewer; render(); });
      });
    };
    $('#iName').oninput = list; list();
  }
}
function openIntro(step = 0) {
  introSteps = G.people.size && !STATE.viewer ? [0, 1, 2] : [0, 1];
  introStep = Math.min(step, introSteps.length - 1); renderIntro(); showPage('intro'); updateMeBar();
}
function finishIntro(quiet) {
  hidePage('intro');
  store.set('roots_intro_seen', '1');
  if (!quiet && G.people.size) { clearTree(); setTimeout(() => render({ camera: 'instant' }), 250); }
  if (!G.people.size) showEmpty();
  updateMeBar();
}
/* Not on the tree yet (2026-11-22): the intro offers "Which one is you?" once. A relative who skipped it, or started
   adding themselves and never finished saving, gets this standing offer until the device has a saved person.
   "Not now" hides it until the next visit. Never in owner mode. */
var meBarOff = false;
function updateMeBar() {
  $('#meBar').hidden = meBarOff || !!ADMIN_KEY || !!STATE.viewer || !G.people.size || QS.has('nointro')
    || !$('#paused').hidden || store.get('roots_intro_seen') !== '1' || $('#intro').classList.contains('on');
}
$('#meYes').onclick = () => { $('#meBar').hidden = true; openIntro(2); };
$('#meNo').onclick = () => { meBarOff = true; updateMeBar(); };
function addMeFlow() {
  if (!G.people.size) { openAdd(null, { self: true }); return; }
  pickPerson("Who's your closest relative here?", "Pick a parent, sibling, partner or child who's already in the tree. You'll add yourself next to them.",
    id => openAdd(id, { self: true, rel: 'child' }));
}
$('#btnHelp').onclick = () => openIntro(1);
$('#btnWhy').onclick = () => openIntro(0);

/* =====================================================================
 * Loading, empty tree, refresh
 * ===================================================================== */
function clearTree() { for (const r of live.values()) r.el.remove(); live.clear(); for (const r of liveEdges.values()) { r.el.remove(); } liveEdges.clear(); }
function showEmpty() {
  const el = $('#empty');
  el.hidden = false;
  el.innerHTML = ADMIN_KEY
    ? `<h2>The tree is ready to plant.</h2><p>Start with yourself. Then add your parents, partner and children, and the tree grows from there.</p><button class="primary" id="eStart">Add yourself</button>`
    : `<h2>The tree hasn't been planted yet.</h2><p>${OWNER_NAME} is just getting started. You can add yourself now, or check back soon.</p><button class="primary" id="eStart">Add yourself</button>`;
  $('#eStart').onclick = () => { el.hidden = true; openAdd(null, { self: true }); };
}
function pickFocus() {
  const has = id => id && G.people.has(id);
  const from = QS.get('from');
  if (has(STATE.focus)) return STATE.focus;
  if (has(from)) return from;
  if (has(STATE.viewer)) return STATE.viewer;
  if (TREE && has(TREE.meta && TREE.meta.owner_person_id)) return TREE.meta.owner_person_id;
  const first = [...G.people.values()].find(p => !p.placeholder);
  return first ? first.id : null;
}
function applyTree(tree) {
  TREE = tree;
  G = buildGraph(treeToGraphData(tree));
  const own = tree.own || {};
  STATE.viewer = (own.person_id && G.people.has(own.person_id)) ? own.person_id : (STATE.viewer && G.people.has(STATE.viewer) ? STATE.viewer : null);
  STATE.owner = tree.meta && tree.meta.owner_person_id;
  STATE.focus = pickFocus();
  $('#paused').hidden = !(tree.meta && tree.meta.paused) || !!ADMIN_KEY;
  updateMeBar();
}
let loadedOnce = false;
async function reload(opts = {}) {
  let tree;
  try { tree = await api({ action: 'tree' }); }
  catch (err) { if (!loadedOnce) showLoadError(err.message); else toast(err.message); return; }
  const firstTime = !loadedOnce;
  loadedOnce = true;
  $('#loading').hidden = true;
  store.set('roots_cache', JSON.stringify({ at: Date.now(), tree: { ...tree, own: undefined } }));
  applyTree(tree);
  if (!G.people.size) { clearTree(); if (!$('#intro').classList.contains('on')) showEmpty(); return; }
  $('#empty').hidden = true;
  const nothingShown = !live.size;   // first paint, or first person after an empty tree
  // Just saved someone who has no place on screen from here: center on the person they were added to,
  // whose close family always draws, so the new person never seems to vanish.
  let moved = false;
  // On the wheel a new parent lands in the spot that was tapped, so the center stays put.
  if (showAfterSave && STATE.view === 'wheel') showAfterSave = null;
  if (showAfterSave) {
    const { anchor, ids } = showAfterSave; showAfterSave = null;
    const added = ids.filter(x => G.people.has(x));
    if (added.length && G.people.has(anchor) && STATE.focus !== anchor && G.people.has(STATE.focus)) {
      const L = layout();
      if (added.some(x => !L.nodes.has(x))) { STATE.focus = anchor; moved = true; }
    }
  }
  render({ camera: firstTime || nothingShown || opts.camera ? 'instant' : moved ? undefined : false, grow: true });
}
function showLoadError(msg) {
  const el = $('#loading');
  el.hidden = false;
  el.innerHTML = `<p>${esc(msg)}</p><button class="primary" id="lRetry">Try again</button>`;
  $('#lRetry').onclick = () => { el.innerHTML = '<p>Growing the tree…</p>'; reload(); };
}
$('#btnHome').onclick = () => { closePanel(); STATE.focus = STATE.viewer || STATE.owner || STATE.focus; render(); };

(function boot() {
  cam.ts = cam.s = innerWidth < 640 ? .48 : .8;
  if (ADMIN_KEY) $('#ownerBar').hidden = false;
  // Show the last tree this device saw right away, then refresh from the server.
  let cached = null; try { cached = JSON.parse(store.get('roots_cache') || 'null'); } catch (e) {}
  if (cached && cached.tree && (cached.tree.people || []).length) {
    applyTree(cached.tree);
    $('#loading').hidden = true;
    render({ camera: 'instant' });
  } else G = buildGraph({ people: [], rels: [] });
  const seen = store.get('roots_intro_seen') === '1' || QS.has('nointro');
  reload().then(() => {
    if (!seen) openIntro(0);
    offerResume();
  });
})();

function offerResume() {
  let d = null; try { d = JSON.parse(store.get('roots_draft') || 'null'); } catch (e) {}
  if (!d || !d.fields) return;
  if (d.anchor && !G.people.has(d.anchor)) return;
  const f = d.fields;
  if (![f.first, f.last, f.notes, f.born, f.bornPlace, f.source].some(Boolean)) return;
  const who = f.first || f.last || 'someone';
  $('#resumeText').textContent = d.kind === 'edit' ? `You didn't finish your changes to ${P(d.anchor).first || 'someone'}.` : `You didn't finish adding ${who}.`;
  $('#resume').hidden = false;
  $('#resumeNo').onclick = () => { clearDraft(); $('#resume').hidden = true; };
  $('#resumeYes').onclick = () => { $('#resume').hidden = true; d.kind === 'edit' ? openEdit(d.anchor, d) : openAdd(d.anchor, { rel: d.rel, fields: d.fields, self: d.self }); };
}

window.ROOTS_BUSY = () => panel.classList.contains('on') || !!formDirty || saving;

/* ---- Stay current. GitHub Pages lets browsers keep every file for about 10 minutes, so right after a deploy a
 * phone can run yesterday's page. On load (and when the page comes back to the front) ask for version.json, which
 * is never cached; when it's newer, refresh this page's files once and reload. Never mid-form: a busy page waits
 * for its next check. One reload per version, so a slow CDN can't cause a loop. ---- */
(function () {
  const BUILD = '6d85060e9b';
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
