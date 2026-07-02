// nyx-loader.js — carga veninfo.wasm (front en Nyx) y expone window.nyxReady,
// una promesa que resuelve a la API con el marshalling ya resuelto (int=BigInt,
// String=puntero+readString/makeString). Además provee la PASARELA de
// capacidades del navegador que el target wasm aún no tiene (fetch, timers,
// geolocalización, delegación de eventos, localStorage) con el patrón
// "callback por NOMBRE de export" — el mismo de dom_on. Los consumidores JS
// restantes hacen nyxReady.then(...).catch(...): si el wasm no carga, cada uno
// pinta su aviso. Subir el ?v= de este archivo y del .wasm JUNTOS
// (ver deploy/build-wasm.sh).
import { runNyxWasm, domBindings, browserBindings } from '/assets/nyx-wasi-shim.js?v=8';

window.nyxReady = (async () => {
  const bytes = await (await fetch('/assets/veninfo.wasm?v=8')).arrayBuffer();
  const dom = domBindings();
  const br = browserBindings();             // std/browser: fetch/timers/ls/tz/media
  const ref = { exports: null };            // los callbacks re-entran vía ref
  const call = (h, ...args) => { if (ref.exports && ref.exports[h]) ref.exports[h](...args); };
  const r = await runNyxWasm(bytes, { js: (nyx) => {
    const S = (p) => nyx.readString(p), M = (s) => nyx.makeString(s);
    return {
    ...dom.imports(nyx),
    ...br.imports(nyx),   // std/browser: js_browser_fetch/interval/timeout/clear_timer/geo, js_ls_get/set, js_tz_offset, js_match_media
    // — DOM extra (hasta que std/dom lo cubra) —
    js_set_attr: (sel, name, val) => { const el = document.querySelector(S(sel)); if (el) el.setAttribute(S(name), S(val)); },
    js_remove_attr: (sel, name) => { const el = document.querySelector(S(sel)); if (el) el.removeAttribute(S(name)); },
    js_toggle_class: (sel, cls, on) => { const el = document.querySelector(S(sel)); if (el) el.classList.toggle(S(cls), on !== 0n); },
    js_set_value: (sel, v) => { const el = document.querySelector(S(sel)); if (el) el.value = S(v); },
    js_count: (sel) => BigInt(document.querySelectorAll(S(sel)).length),
    // — Compartir: Web Share API (móvil) con respaldo a copiar al portapapeles —
    js_share: (text, url) => {
      const t = S(text), u = location.origin + S(url);
      const btn = document.querySelector('#calc-share');
      const flash = () => { if (!btn) return; const o = btn.getAttribute('data-lbl') || btn.textContent; btn.setAttribute('data-lbl', o); btn.textContent = '¡Copiado!'; setTimeout(() => { btn.textContent = o; }, 1800); };
      if (navigator.share) { navigator.share({ title: 'VenezuelaInfo', text: t, url: u }).catch(() => {}); return; }
      const full = t + ' ' + u;
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(full).then(flash, () => prompt('Copia el enlace:', full)); return; }
      try { const ta = document.createElement('textarea'); ta.value = full; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); flash(); } catch (e) { prompt('Copia el enlace:', full); }
    },
    // — Geolocalización: ok → handler(lat:String, lon:String); error → err_handler() ("" = ignorar) —
    //   (se queda local: std/browser.browser_geo no propaga el err_handler) —
    js_geo: (handler, err_handler) => {
      const h = S(handler), he = S(err_handler);
      if (!navigator.geolocation) { if (he) call(he); return; }
      navigator.geolocation.getCurrentPosition(
        (p) => call(h, nyx.makeString(String(p.coords.latitude)), nyx.makeString(String(p.coords.longitude))),
        () => { if (he) call(he); });
    },
    // — Delegación de click: escribe attr del item clicado en el hidden y llama
    //   al handler (cero args). Ignora clicks sobre <a> (enlaces siguen navegando) —
    js_delegate: (contSel, itemSel, attr, hiddenSel, handler) => {
      const c = S(contSel), it = S(itemSel), a = S(attr), hs = S(hiddenSel), h = S(handler);
      const cont = document.querySelector(c);
      if (!cont) return;
      cont.addEventListener('click', (e) => {
        if (e.target.closest && e.target.closest('a')) return;
        const item = e.target.closest && e.target.closest(it);
        if (!item || !cont.contains(item)) return;
        const hid = document.querySelector(hs);
        if (hid) hid.value = item.getAttribute(a) || '';
        call(h);
      });
    },
    // — Enter en un input (preventDefault) —
    js_on_enter: (sel, handler) => {
      const s = S(sel), h = S(handler);
      const el = document.querySelector(s);
      if (el) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); call(h); } });
    },
  }; }});
  ref.exports = r.exports;
  dom.ref.exports = r.exports; // habilita la re-entrada de dom_on
  br.ref.exports = r.exports;  // habilita las re-entradas de std/browser (fetch/timers/geo)
  const S = (p) => r.nyx.readString(p), M = (s) => r.nyx.makeString(s);
  // El wasm pinta finanzas/clima/sismos/noticias internamente (dom_set_html).
  // Único wrapper con consumidor JS: havKm (quake.js, distancia en el mapa Leaflet).
  return {
    raw: r.exports,
    havKm: (la1, lo1, la2, lo2) => Number(S(r.exports.hav_km(M(String(la1)), M(String(lo1)), M(String(la2)), M(String(lo2))))),
  };
})();
window.nyxReady.catch(() => {}); // sin unhandledrejection; cada consumidor maneja el fallo
