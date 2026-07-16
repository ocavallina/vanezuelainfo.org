// nyx-loader.js — carga veninfo.wasm (front en Nyx) y expone window.nyxReady,
// una promesa que resuelve a la API con el marshalling ya resuelto (int=BigInt,
// String=puntero+readString/makeString). Además provee la PASARELA de
// capacidades del navegador que el target wasm aún no tiene (fetch, timers,
// geolocalización, delegación de eventos, localStorage) con el patrón
// "callback por NOMBRE de export" — el mismo de dom_on. Los consumidores JS
// restantes hacen nyxReady.then(...).catch(...): si el wasm no carga, cada uno
// pinta su aviso. Subir el ?v= de este archivo y del .wasm JUNTOS
// (ver deploy/build-wasm.sh).
import { runNyxWasm, domBindings, browserBindings } from '/assets/nyx-wasi-shim.js?v=10';

window.nyxReady = (async () => {
  const bytes = await (await fetch('/assets/veninfo.wasm?v=18')).arrayBuffer();
  const dom = domBindings();
  const br = browserBindings();             // std/browser: fetch/timers/ls/tz/media
  const ref = { exports: null };            // los callbacks re-entran vía ref
  // Arena (Fase F): solo en /chat, cuyo estado persistente es arena-safe (ints).
  const pgEl = document.querySelector('#pg');
  const useArena = !!pgEl && pgEl.value === 'chat';
  // En /chat, cada re-entrada libera su memoria de turno (reset por evento).
  const call = (h, ...args) => { try { if (ref.exports && ref.exports[h]) ref.exports[h](...args); } finally { if (useArena && r && r.arenaReset) r.arenaReset(); } };
  let chatWs = null, chatSeen = {};         // Fase F: WS activo + dedup del historial (en JS, arena-safe)
  const r = await runNyxWasm(bytes, { arena: useArena, js: (nyx) => {
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
    // — Copiar el resultado al portapapeles (botón Copiar de la calculadora) —
    js_copy: (textPtr) => {
      const t = S(textPtr);
      const btn = document.querySelector('#calc-copy');
      const flash = () => { if (!btn) return; const o = btn.getAttribute('data-lbl') || btn.textContent; btn.setAttribute('data-lbl', o); btn.textContent = '¡Copiado!'; setTimeout(() => { btn.textContent = o; }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t).then(flash, () => prompt('Copia el resultado:', t)); return; }
      try { const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); flash(); } catch (e) { prompt('Copia el resultado:', t); }
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
    // — Chat (Fase F): WebSocket, submit/visibility y anexado del historial —
    //   El historial y el dedup viven aquí (JS/DOM), no en el wasm → arena-safe.
    js_ws: (pathPtr, onOpenPtr, onMsgPtr, onClosePtr) => {
      const path = S(pathPtr), onOpen = S(onOpenPtr), onMsg = S(onMsgPtr), onClose = S(onClosePtr);
      if (typeof WebSocket === 'undefined') { call(onClose); return; }
      try { if (chatWs) { chatWs.onclose = null; chatWs.close(); } } catch (e) {}
      const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + path;
      let s; try { s = new WebSocket(url); } catch (e) { call(onClose); return; }
      chatWs = s;
      s.onopen = () => { if (s === chatWs) call(onOpen); };
      s.onmessage = (ev) => { if (s === chatWs) call(onMsg, M(ev.data)); };
      s.onclose = () => { if (s === chatWs) { chatWs = null; call(onClose); } };
      s.onerror = () => {};
    },
    js_ws_send: (dataPtr) => { try { if (chatWs) chatWs.send(S(dataPtr)); } catch (e) {} },
    js_ws_close: () => { try { if (chatWs) { chatWs.onclose = null; chatWs.close(); chatWs = null; } } catch (e) {} },
    js_on_submit: (selPtr, hPtr) => { const el = document.querySelector(S(selPtr)); const h = S(hPtr); if (el) el.addEventListener('submit', (e) => { e.preventDefault(); call(h); }); },
    js_on_visibility: (hPtr) => { const h = S(hPtr); document.addEventListener('visibilitychange', () => call(h)); },
    js_hidden: () => BigInt(document.hidden ? 1 : 0),
    js_now_epoch: () => BigInt(Math.floor(Date.now() / 1000)),
    js_chat_clear: () => { const log = document.getElementById('chat-log'); if (log) log.innerHTML = ''; chatSeen = {}; },
    js_chat_empty_check: () => {
      const log = document.getElementById('chat-log');
      if (log && !log.childNodes.length) { const e = document.createElement('div'); e.className = 'chat-empty'; e.textContent = 'Aun no hay mensajes. Se el primero.'; log.appendChild(e); }
    },
    js_chat_add: (keyPtr, htmlPtr, fromWs) => {
      const key = S(keyPtr), html = S(htmlPtr);
      const log = document.getElementById('chat-log'); if (!log) return;
      if (chatSeen[key]) return; chatSeen[key] = 1;
      const empty = log.querySelector('.chat-empty'); if (empty) empty.remove();
      const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 40;
      log.insertAdjacentHTML('beforeend', html); // html ya escapado por el wasm (esc)
      if (atBottom) log.scrollTop = log.scrollHeight;
    },
  }; }});
  ref.exports = r.exports;
  dom.ref.exports = r.exports; // habilita la re-entrada de dom_on
  br.ref.exports = r.exports;  // habilita las re-entradas de std/browser (fetch/timers/geo)
  if (useArena) { dom.ref.afterEvent = r.arenaReset; br.ref.afterEvent = r.arenaReset; } // reset por evento en /chat
  const S = (p) => r.nyx.readString(p), M = (s) => r.nyx.makeString(s);
  // El wasm pinta finanzas/clima/sismos/noticias internamente (dom_set_html).
  // Único wrapper con consumidor JS: havKm (quake.js, distancia en el mapa Leaflet).
  return {
    raw: r.exports,
    havKm: (la1, lo1, la2, lo2) => Number(S(r.exports.hav_km(M(String(la1)), M(String(lo1)), M(String(la2)), M(String(lo2))))),
  };
})();
window.nyxReady.catch(() => {}); // sin unhandledrejection; cada consumidor maneja el fallo
