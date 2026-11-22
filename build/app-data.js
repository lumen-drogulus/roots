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
