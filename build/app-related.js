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
const gw = (p, m, f, n) => (p && p.sex === 'male') ? m : (p && p.sex === 'female') ? f : n;   // gender is public since 2026-11-22
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
  if (STATE.view !== 'tree') setView('tree');
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
