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
