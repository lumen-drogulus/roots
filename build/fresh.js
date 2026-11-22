/* ---- Stay current. GitHub Pages lets browsers keep every file for about 10 minutes, so right after a deploy a
 * phone can run yesterday's page. On load (and when the page comes back to the front) ask for version.json, which
 * is never cached; when it's newer, refresh this page's files once and reload. Never mid-form: a busy page waits
 * for its next check. One reload per version, so a slow CDN can't cause a loop. ---- */
(function () {
  const BUILD = '__BUILD__';
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
