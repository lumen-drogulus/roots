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
