// imports.mjs — test headless de veninfo.wasm bajo Node con el mismo shim del
// navegador: node /home/admin/NyxLang/examples/browser/run-node.mjs \
//   static/assets/veninfo.wasm wasm/tests/imports.mjs
// Mockea el DOM y localStorage (los externs que provee nyx-loader.js) y
// asevera los exports de cada fase.

export const texts = {};   // selector -> innerHTML/textContent capturado
export const store = {};   // localStorage mock
export const values = {};  // selector -> value de inputs mock

export default (nyx) => ({
  js_console_log: (p) => console.log("[log]", nyx.readString(p)),
  js_dom_set_text: (sel, txt) => { texts[nyx.readString(sel)] = nyx.readString(txt); },
  js_dom_set_html: (sel, html) => { texts[nyx.readString(sel)] = nyx.readString(html); },
  js_dom_get_value: (sel) => nyx.makeString(values[nyx.readString(sel)] ?? ""),
  js_dom_on: (sel, ev, name) => { console.log("[dom_on]", nyx.readString(sel), nyx.readString(ev), "->", nyx.readString(name)); },
  js_ls_get: (k) => nyx.makeString(store[nyx.readString(k)] ?? ""),
  js_ls_set: (k, v) => { store[nyx.readString(k)] = nyx.readString(v); },
  js_set_attr: (sel, name, val) => { console.log("[set_attr]", nyx.readString(sel), nyx.readString(name), nyx.readString(val)); },
  js_remove_attr: (sel, name) => { console.log("[remove_attr]", nyx.readString(sel), nyx.readString(name)); },
  js_toggle_class: (sel, cls, on) => { console.log("[toggle_class]", nyx.readString(sel), nyx.readString(cls), on); },
  js_set_value: (sel, v) => { values[nyx.readString(sel)] = nyx.readString(v); },
});

function eq(got, want, label) {
  if (got !== want) throw new Error(`FALLO ${label}: esperado ${JSON.stringify(want)}, obtenido ${JSON.stringify(got)}`);
  console.log(`ok ${label} = ${JSON.stringify(got)}`);
}

export async function afterStart({ exports, nyx }) {
  const S = (p) => nyx.readString(p);
  const M = (s) => nyx.makeString(s);

  // Fase 1: helpers puros
  eq(S(exports.wdesc(0n)), "Despejado|☀", "wdesc(0)");
  eq(S(exports.wdesc(95n)), "Tormenta|⛈", "wdesc(95)");
  eq(S(exports.wdesc(2n)), "Parcialmente nublado|⛅", "wdesc(2)");
  eq(S(exports.rel_time(30n)), "hace 30 s", "rel_time(30)");
  eq(S(exports.rel_time(90n)), "hace 1 min", "rel_time(90)");
  eq(S(exports.rel_time(7200n)), "hace 2 h", "rel_time(7200)");
  eq(S(exports.rel_time(259200n)), "hace 3 d", "rel_time(259200)");
  eq(S(exports.compass(0n)), "N", "compass(0)");
  eq(S(exports.compass(90n)), "E", "compass(90)");
  eq(S(exports.compass(225n)), "SO", "compass(225)");
  eq(S(exports.compass(359n)), "N", "compass(359)");
  eq(S(exports.aqi_label(40n)), "Buena|#2e7d32", "aqi_label(40)");
  eq(S(exports.aqi_label(75n)), "Moderada|#f9a825", "aqi_label(75)");
  eq(S(exports.aqi_label(500n)), "Peligrosa|#4a148c", "aqi_label(500)");

  // Haversine Caracas -> Maracaibo ≈ 515 km (tolerancia ±3)
  const km = Number(S(exports.hav_km(M("10.4806"), M("-66.9036"), M("10.65"), M("-71.61"))));
  if (Math.abs(km - 515) > 3) throw new Error(`FALLO hav_km: ${km} (esperado ~515)`);
  console.log(`ok hav_km(CCS->MCB) = ${km} km`);

  eq(S(exports.fmt_bs(M("36421.5"))), "36.421,50", "fmt_bs(36421.5)");
  eq(S(exports.fmt_bs(M("36.42"))), "36,42", "fmt_bs(36.42)");
  eq(S(exports.fmt_bs(M("1234567.891"))), "1.234.567,89", "fmt_bs(1234567.891)");
  eq(S(exports.fmt_cop(M("4123.55"))), "4.124", "fmt_cop(4123.55)");
  eq(S(exports.fmt_cop(M("999.2"))), "999", "fmt_cop(999.2)");

  // Fase 2: finanzas (captura el HTML que fx_render inyecta en el DOM mock)
  eq(S(exports.fmt_bs(M("44.65"))), "44,65", "fmt_bs(44.65)");
  exports.fx_render(M("bcv=36.42|eur=39.91|uc=44.10|uv=45.20|cop=4123.55|fch=02/07/2026 10:15"));
  const card = texts["#fin-body"], page = texts["#fz-div"];
  if (!card.includes("BCV") || !card.includes(" Bs 36,42")) throw new Error("FALLO fx_render BCV: " + card);
  // 1.000 COP = (44.10+45.20)/2 / 4123.55 * 1000 = 10.8281... -> "10,83"
  if (!card.includes("1.000 COP") || !card.includes("Bs 10,83")) throw new Error("FALLO fx_render 1.000 COP: " + card);
  if (!card.includes("Actualizado 02/07/2026 10:15")) throw new Error("FALLO fx_render fch: " + card);
  if (!page.includes("USD en Colombia") || !page.includes("COP 4.124")) throw new Error("FALLO fz-div COP: " + page);
  // Bs 100 = 100/0.0108281 = 9.235,2... -> "9.235" COP
  if (!page.includes("Bs 100 = 9.235 COP")) throw new Error("FALLO fz-div peso<->bolivar: " + page);
  console.log("ok fx_render (tarjeta + /finanzas)");

  exports.fx_render(M(""));
  eq(texts["#fin-body"], "Cargando…", "fx_render sin datos");

  exports.fx_render_cripto(M("btc=108950.31|eth=3901.2|usdt=1.0"));
  const cr = texts["#fz-cripto"];
  if (!cr.includes("$ 108.950,31")) throw new Error("FALLO cripto btc: " + cr);
  if (!cr.includes("$ 3.901,2")) throw new Error("FALLO cripto eth: " + cr);
  if (!cr.includes("$ 1,00")) throw new Error("FALLO cripto usdt: " + cr);
  console.log("ok fx_render_cripto");

  // Fase 3: sismos — fixture de 15 filas (paginación a 2 páginas)
  // id, epoch, iso, lat, lon, depth, magtype, mag, place, dia, hora
  const now = Math.floor(Date.now() / 1000);
  const mk = (i, mag, lat, lon, place, ageS) =>
    [`ev${i}`, now - ageS, `2026-07-02T0${i % 10}:00:00Z`, lat, lon, "10", "ML", mag, place, "2026-07-02", `0${i % 10}:00`].join("\t");
  const fixture = [];
  for (let i = 0; i < 14; i++) fixture.push(mk(i, (3 + (i % 4) * 0.5).toFixed(1), "10.5", "-66.9", `ZONA${i}, VENEZUELA`, 3600 * (i + 1)));
  fixture.push(mk(14, "6.2", "10.65", "-71.61", "ZULIA, VENEZUELA", 1800)); // el más fuerte, cerca de Maracaibo
  exports.sismos_load(M(fixture.join("\n")));

  let tb = texts["#qtbody"];
  eq(texts["#s-count"], "15 sismos", "sismos count");
  eq(texts["#p-info"], "1 / 2", "sismos paginas");
  if ((tb.match(/<tr /g) || []).length !== 12) throw new Error("FALLO pagina de 12 filas: " + tb.slice(0, 200));
  if (!tb.startsWith('<tr data-id="ev14"')) throw new Error("FALLO orden por fecha (ev14 primero): " + tb.slice(0, 120));
  if (!texts["#sismo-destacado"].includes("M 6.2") || !texts["#sismo-destacado"].includes("ZULIA")) throw new Error("FALLO destacado: " + texts["#sismo-destacado"]);
  console.log("ok sismos_load (15 filas, orden fecha, destacado M 6.2)");

  // Filtro por magnitud >= 5 (solo ev14 con 6.2 pasa... y ninguna de 4.5)
  values["#f-mag"] = "5";
  exports.s_refiltrar();
  eq(texts["#s-count"], "1 sismos", "filtro mag 5+");
  eq(store["f_mag"], "5", "persistencia f_mag");
  values["#f-mag"] = "";

  // Filtro por lugar (case-insensitive)
  values["#f-text"] = "zulia";
  exports.s_refiltrar();
  eq(texts["#s-count"], "1 sismos", "filtro lugar zulia");
  values["#f-text"] = "";

  // Orden por magnitud
  values["#f-orden"] = "magnitud";
  exports.s_refiltrar();
  tb = texts["#qtbody"];
  if (!tb.startsWith('<tr data-id="ev14"')) throw new Error("FALLO orden magnitud: " + tb.slice(0, 120));
  values["#f-orden"] = "fecha";

  // Paginación
  exports.s_refiltrar();
  exports.s_next();
  eq(texts["#p-info"], "2 / 2", "s_next");
  exports.s_prev();
  eq(texts["#p-info"], "1 / 2", "s_prev");

  // Ubicación (Maracaibo): ev14 queda a ~0 km, orden por distancia lo pone primero
  exports.sismos_set_loc(M("10.65"), M("-71.61"));
  values["#f-orden"] = "distancia";
  exports.s_refiltrar();
  tb = texts["#qtbody"];
  if (!tb.startsWith('<tr data-id="ev14"')) throw new Error("FALLO orden distancia: " + tb.slice(0, 120));
  if (!tb.includes(">0 km<") && !tb.includes(">1 km<")) throw new Error("FALLO distancia ~0 km: " + tb.slice(0, 300));
  values["#f-orden"] = "fecha";
  exports.s_refiltrar();

  // Selección: detalle desplegable inline
  values["#s-selected"] = "ev14";
  exports.s_select();
  tb = texts["#qtbody"];
  if (!tb.includes("detalle-band") || !tb.includes("/sismos/ev14")) throw new Error("FALLO detalle: " + tb.slice(0, 300));
  exports.s_select(); // segundo click colapsa
  if (texts["#qtbody"].includes("detalle-band")) throw new Error("FALLO colapso del detalle");
  console.log("ok sismos: filtros, orden, paginacion, distancia, seleccion");

  console.log("TODOS LOS ASSERTS PASARON");
}
