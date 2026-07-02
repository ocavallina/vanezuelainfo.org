// nyx-loader.js — carga veninfo.wasm (front en Nyx) y expone window.nyxReady,
// una promesa que resuelve a la API con el marshalling ya resuelto (int=BigInt,
// String=puntero+readString/makeString). Los consumidores (veninfo/home/clima/
// fx/sismos/quake .js) hacen SIEMPRE nyxReady.then(...).catch(...): si el wasm
// no carga, cada uno pinta su propio aviso. Subir el ?v= de este archivo y del
// .wasm JUNTOS (ver deploy/build-wasm.sh).
import { runNyxWasm, domBindings } from '/assets/nyx-wasi-shim.js?v=4';

window.nyxReady = (async () => {
  const bytes = await (await fetch('/assets/veninfo.wasm?v=4')).arrayBuffer();
  const dom = domBindings();
  const r = await runNyxWasm(bytes, { js: (nyx) => ({
    ...dom.imports(nyx),
    // Externs propios (más allá de std/dom): localStorage y atributos/clases.
    js_ls_get: (k) => { let v = null; try { v = localStorage.getItem(nyx.readString(k)); } catch (e) {} return nyx.makeString(v ?? ''); },
    js_ls_set: (k, v) => { try { localStorage.setItem(nyx.readString(k), nyx.readString(v)); } catch (e) {} },
    js_set_attr: (sel, name, val) => { const el = document.querySelector(nyx.readString(sel)); if (el) el.setAttribute(nyx.readString(name), nyx.readString(val)); },
    js_remove_attr: (sel, name) => { const el = document.querySelector(nyx.readString(sel)); if (el) el.removeAttribute(nyx.readString(name)); },
    js_toggle_class: (sel, cls, on) => { const el = document.querySelector(nyx.readString(sel)); if (el) el.classList.toggle(nyx.readString(cls), on !== 0n); },
    js_set_value: (sel, v) => { const el = document.querySelector(nyx.readString(sel)); if (el) el.value = nyx.readString(v); },
  })});
  dom.ref.exports = r.exports; // habilita la re-entrada de dom_on
  const S = (p) => r.nyx.readString(p), M = (s) => r.nyx.makeString(s);
  return {
    raw: r.exports,
    wdesc: (c) => S(r.exports.wdesc(BigInt(c ?? -1))).split('|'),
    relTime: (d) => S(r.exports.rel_time(BigInt(Math.floor(d)))),
    compass: (d) => S(r.exports.compass(BigInt(Math.round(d)))),
    aqiLabel: (v) => S(r.exports.aqi_label(BigInt(Math.round(v)))).split('|'),
    havKm: (la1, lo1, la2, lo2) => Number(S(r.exports.hav_km(M(String(la1)), M(String(lo1)), M(String(la2)), M(String(lo2))))),
    fmtBs: (v) => S(r.exports.fmt_bs(M(String(v)))),
    fmtCop: (v) => S(r.exports.fmt_cop(M(String(v)))),
    fxRender: (data) => r.exports.fx_render(M(data)),
    fxRenderCripto: (data) => r.exports.fx_render_cripto(M(data)),
    sismosLoad: (data) => r.exports.sismos_load(M(data)),
    sismosSetLoc: (la, lo) => r.exports.sismos_set_loc(M(String(la)), M(String(lo))),
  };
})();
window.nyxReady.catch(() => {}); // sin unhandledrejection; cada consumidor maneja el fallo
