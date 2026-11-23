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
  const l = b.querySelector('.lbl'); if (l) l.textContent = 'Show: ' + LEVELS[STATE.level];
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
