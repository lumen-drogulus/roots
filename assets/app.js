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
function treeToGraphData(tree) {
  const people = [], rels = [];
  (tree.people || []).forEach(p => people.push(fromPublic(p)));
  PC_ID.clear(); PT_ID.clear();
  (tree.relationships || []).forEach(r => { if (r.type !== 'partner') PC_ID.set(r.a + '>' + r.b, r.id); else PT_ID.set([r.a, r.b].sort().join('~'), r.id); rels.push(r.type === 'partner' ? ['partner', r.a, r.b, r.subtype] : ['pc', r.a, r.b, r.subtype]); });
  const own = tree.own || {};
  (own.people || []).forEach(p => people.push(fromOwn(p)));
  const ids = new Set(people.map(p => p.id));
  (own.relationships || []).forEach(r => {
    if (!ids.has(r.a) || !ids.has(r.b)) return;
    rels.push(r.type === 'partner' ? ['partner', r.a, r.b, r.subtype || 'unknown'] : ['pc', r.a, r.b, r.subtype || 'biological', true]);
  });
  PHOTOS.clear();
  (tree.photos || []).forEach(f => (f.tags || []).forEach(pid => { if (!PHOTOS.has(pid)) PHOTOS.set(pid, []); PHOTOS.get(pid).push(f); }));
  people.forEach(p => { p.photos = (PHOTOS.get(p.id) || []).length; });
  return { people, rels };
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
  if (path === 'P') { const sub = (partnersOf(v).find(x => x.id === id) || {}).sub; return sub === 'divorced' ? 'Former partner' : w('Husband', 'Wife', 'Partner'); }
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
  if (path === 'UP') return w('Stepfather', 'Stepmother', 'Step-parent');
  if (path === 'PD') return w('Stepson', 'Stepdaughter', 'Stepchild');
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
const STATE = { viewer: null, owner: null, focus: null, open: new Set(), all: false, rootsBelow: true, selected: null };
const isOpen = k => STATE.all || STATE.open.has(k);
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
      if (sibs.length) { if (isOpen('sib:' + id)) sibExtras.push(...sibs.map(s => ({ id: s }))); else sibExtras.push({ bud: { key: 'sib:' + id, label: sibs.length === 1 ? '1 sibling' : sibs.length + ' siblings', count: '' } }); }
      if (others.length) { if (depth === 1 || isOpen('op:' + id)) t.extras.push(...others.map(s => ({ id: s, partnerOf: id }))); else t.extras.push({ bud: { key: 'op:' + id, label: others.length === 1 ? 'Another marriage' : others.length + ' marriages', count: '' } }); }
      t.extras.push(...sibExtras);
    }
    const extraW = t.extras.reduce((s, e) => s + (e.bud ? BUDW : CW) + GAP, 0);
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
      if (e.partnerOf) off += CG - GAP;
      const ex = t.side === 'left' ? x - off - w / 2 : x + off + w / 2;
      if (e.bud) addBud(e.bud.key, e.bud.label, e.bud.count, ex, g, t.id);
      else addNode(e.id, ex, g, { extraOf: t.id, partnerOf: e.partnerOf });
      off += w + GAP;
    }
    if (t.bud) addBud(t.bud.key, t.bud.label, t.bud.count, x, g + 1, t.id);
    if (t.parents.length === 2) { pedPlace(t.parents[0], x - t.da, g + 1); pedPlace(t.parents[1], x + t.db, g + 1); }
    else if (t.parents.length === 1) pedPlace(t.parents[0], x, g + 1);
  }
  const ped = pedExtents(F, 0, 'right');
  addNode(F, 0, 0, { focus: true });
  pedPlace(ped, 0, 0);
  for (const n of nodes.values()) { const [a, b] = nodeSpan(n); occupy(n.g, a, b); }

  /* ---- the centered person's row: former partners left, current partners right ---- */
  const prts = partnersOf(F).filter(pt => !nodes.has(pt.id));
  const current = prts.filter(pt => pt.sub !== 'divorced'), former = prts.filter(pt => pt.sub === 'divorced');
  let rx = FW / 2 + CG, lx = -(FW / 2 + CG);
  const sideOf = {};
  current.forEach(pt => { addNode(pt.id, rx + CW / 2, 0, { partnerOf: F }); occupy(0, rx, rx + CW); sideOf[pt.id] = 1; rx += CW + CG; });
  former.forEach(pt => { addNode(pt.id, lx - CW / 2, 0, { partnerOf: F }); occupy(0, lx - CW, lx); sideOf[pt.id] = -1; lx -= CW + CG; });

  /* ---- descendants, grouped by co-parent, under each couple ---- */
  function descUnit(id, depth) {
    const u = { id, prt: [], kids: [], bud: null };
    if (depth > 0) partnersOf(id).forEach(pt => u.prt.push(pt.id));
    const kids = childrenOf(id).filter(c => !parentsOf(c).some(pp => pp !== id && !u.prt.includes(pp) && depth > 0 && false));
    if (kids.length && (depth < MAX_DOWN || isOpen('down:' + id))) u.kids = kids.map(k => descUnit(k, depth + 1));
    else if (kids.length) u.bud = { key: 'down:' + id, label: kids.length === 1 ? '1 child' : kids.length + ' children' };
    const selfW = CW + u.prt.length * (CW + CG);
    const kidsW = u.kids.reduce((s, k) => s + k.w, 0) + Math.max(0, u.kids.length - 1) * GAP;
    u.w = Math.max(selfW, kidsW, u.bud ? BUDW : 0);
    return u;
  }
  function descPlace(u, x, g, block) {
    // the person sits left within the unit when they have a partner, so the couple is centered
    const selfW = CW + u.prt.length * (CW + CG);
    let px = x - selfW / 2 + CW / 2;
    block.push({ id: u.id, x: px, y: genY(g), g, kind: 'person' });
    const formerP = u.prt.filter(pid => (partnersOf(u.id).find(x => x.id === pid) || {}).sub === 'divorced');
    const currentP = u.prt.filter(pid => !formerP.includes(pid));
    px += formerP.length * (CW + CG);
    block[block.length - 1].x = px;
    let ox = px;
    currentP.forEach(pid => { ox += CW + CG; block.push({ id: pid, x: ox, y: genY(g), g, kind: 'person', partnerOf: u.id }); });
    ox = px;
    formerP.forEach(pid => { ox -= CW + CG; block.push({ id: pid, x: ox, y: genY(g), g, kind: 'person', partnerOf: u.id }); });
    const mid = currentP.length ? px + (CW + CG) / 2 : formerP.length ? px - (CW + CG) / 2 : px;
    if (u.bud) block.push({ id: 'bud:' + u.bud.key, key: u.bud.key, x: mid, y: genY(g - 1), g: g - 1, kind: 'bud', label: u.bud.label, anchor: u.id });
    const kidsW = u.kids.reduce((s, k) => s + k.w, 0) + Math.max(0, u.kids.length - 1) * GAP;
    let kx = mid - kidsW / 2;
    u.kids.forEach(k => { descPlace(k, kx + k.w / 2, g - 1, block); kx += k.w + GAP; });
  }
  const groups = new Map();
  childrenOf(F).forEach(c => { const other = parentsOf(c).find(pp => pp !== F) || ''; if (!groups.has(other)) groups.set(other, []); groups.get(other).push(c); });
  const orderedGroups = [...groups.entries()].sort((a, b) => (sideOf[a[0]] || 0) - (sideOf[b[0]] || 0));
  for (const [other, kids] of orderedGroups) {
    const ox = nodes.has(other) ? nodes.get(other).x : 0;
    const mid = other && nodes.has(other) ? (ox + 0) / 2 : 0;
    const units = kids.map(k => descUnit(k, 1));
    const total = units.reduce((s, u) => s + u.w, 0) + (units.length - 1) * GAP;
    const block = [];
    let kx = mid - total / 2;
    units.forEach(u => { descPlace(u, kx + u.w / 2, -1, block); kx += u.w + GAP; });
    placeBlock(block, (sideOf[other] || 1));
  }

  /* ---- siblings of the centered person (left), with their families folded ---- */
  const sibs = siblingsOf(F).filter(s => !nodes.has(s.id));
  sibs.sort((a, b) => a.half - b.half);
  for (const s of sibs) {
    const block = [{ id: s.id, x: lx - CW / 2, y: 0, g: 0, kind: 'person', sibling: true, half: s.half }];
    const fam = partnersOf(s.id).length + childrenOf(s.id).length;
    if (fam) {
      if (isOpen('fam:' + s.id)) {
        let ox = lx - CW / 2;
        partnersOf(s.id).forEach(pt => { ox -= CW + CG; block.push({ id: pt.id, x: ox, y: 0, g: 0, kind: 'person', partnerOf: s.id }); });
        const mid = partnersOf(s.id).length ? (lx - CW / 2 + lx - CW / 2 - CW - CG) / 2 : lx - CW / 2;
        const ks = childrenOf(s.id);
        let kx = mid - (ks.length * CW + (ks.length - 1) * GAP) / 2;
        ks.forEach(k => { block.push({ id: k, x: kx + CW / 2, y: genY(-1), g: -1, kind: 'person' }); kx += CW + GAP; });
      } else {
        block.push({ id: 'bud:fam:' + s.id, key: 'fam:' + s.id, x: lx - CW / 2, y: -(STATE.rootsBelow ? 1 : -1) * (CH / 2 + 26), g: -0.5, kind: 'bud', label: (P(s.id).first || '') + "'s family", count: fam, anchor: s.id });
      }
    }
    placeBlock(block, -1);
    lx = Math.min(...block.filter(n => n.g === 0).map(n => nodeSpan(n)[0])) - GAP;
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
      half: gp.length === 1 && parentsOf(n.id).length === 2 && parentsOf(n.id).every(x => !pcKind(x, n.id)) }));
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
  // which opened groups hang from which card, so each can be folded again
  if (!STATE.all) for (const key of STATE.open) {
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
    + (p.pending ? '<span class="tag">Unconfirmed</span>' : '')
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
    el.className = 'card' + (n.id === STATE.focus ? ' focus' : '') + (p.placeholder ? ' placeholder' : '') + (p.pending ? ' pending' : '') + (!isLiving(p) && !p.placeholder ? ' deceased' : '') + (STATE.selected === n.id ? ' selected' : '');
    el.innerHTML = cardHTML(n);
    el.setAttribute('aria-label', displayName(p) + ', ' + relation(n.id));
    rec.el.querySelectorAll('.fold').forEach(f => f.remove());
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
    cls += ' partner' + (e.sub === 'divorced' ? ' former' : '');
    r.dash = e.sub === 'divorced' ? '0.05 0.05' : null;
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
  r.deco.style.opacity = sub === 'divorced' ? .4 : 1;
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
    <p class="hint">Only a name is needed. "Unknown" counts as a name. For living people, only names show (first, middle, goes by, last now); everything else stays private.</p>`;
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
      changes = Object.keys(now).filter(k => now[k] !== was[k])
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
        ${['parent', 'partner', 'sibling', 'child'].map(v => `<button type="button" data-v="${v}" aria-pressed="${v === rel}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div></div>
      <div class="field" id="fPcWrap" hidden><span class="lab" id="fPcLab">What kind of parent?</span><div class="seg" id="fPc">${PC_KINDS.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${v === 'biological'}">${l}</button>`).join('')}</div>
        <p class="hint" id="fPcHint" hidden>This takes one of the two parent spots. If the birth parent might be added later, add a step-parent as the parent's partner instead; the tree labels them Stepfather or Stepmother on its own.</p></div>
      <div class="field" id="fOtherWrap" hidden><label for="fOther" id="fOtherLab">Their other parent</label><select id="fOther"></select></div>
      <div class="field" id="fKindWrap" hidden><span class="lab">Together as</span><div class="seg" id="fKind"><button type="button" data-v="married" aria-pressed="true">Married</button><button type="button" data-v="partner" aria-pressed="false">Partners</button><button type="button" data-v="divorced" aria-pressed="false">Divorced</button><button type="button" data-v="widowed" aria-pressed="false">Widowed</button></div></div>
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
  };
  if (p) {
    wireSeg('fRel', syncRel); wireSeg('fKind'); wireSeg('fPc', syncParent);
    // Grayed kinds explain themselves instead of doing nothing.
    document.querySelectorAll('#fPc button').forEach(b => { const on = b.onclick; b.onclick = () => {
      if (b.classList.contains('off')) { toast(`${p.first || 'They'} already ${self ? 'have' : 'has'} two birth parents. Choose Step.`); return; }
      on();
    }; });
    syncRel(rel);
  }
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
      <li><span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="#1D2B24" stroke-width="1.8" stroke-linecap="round"><path d="M12 20V10"/><path d="M12 14c-3 0-5-2-6-5"/><path d="M12 12c3 0 5-2 6-5"/></svg></span><div><b>Branches far from the center fold into buds.</b><span>Tap a bud to open it, or use Show all.</span></div></li>
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
      const hits = [...G.people.values()].filter(p => !p.placeholder && isLiving(p) && (!q || displayName(p).toLowerCase().includes(q))).slice(0, 6);
      $('#iList').innerHTML = hits.map(p => `<button data-id="${p.id}"><span>${esc(displayName(p))}</span><small>That's me</small></button>`).join('') + '<button data-id="new"><span>I’m not in the tree yet</span><small>Add me</small></button>';
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
  introStep = Math.min(step, introSteps.length - 1); renderIntro(); showPage('intro');
}
function finishIntro(quiet) {
  hidePage('intro');
  store.set('roots_intro_seen', '1');
  if (!quiet && G.people.size) { clearTree(); setTimeout(() => render({ camera: 'instant' }), 250); }
  if (!G.people.size) showEmpty();
}
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
  render({ camera: firstTime || nothingShown || opts.camera ? 'instant' : false, grow: true });
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
