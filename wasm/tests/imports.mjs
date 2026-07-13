// imports.mjs — test headless de veninfo.wasm bajo Node con el mismo shim del
// navegador: node /home/admin/NyxLang/examples/browser/run-node.mjs \
//   static/assets/veninfo.wasm wasm/tests/imports.mjs
// Mockea el DOM y localStorage (los externs que provee nyx-loader.js) y
// asevera los exports de cada fase.

export const texts = {};   // selector -> innerHTML/textContent capturado
export const store = {};   // localStorage mock
export const values = {};  // selector -> value de inputs mock
export const fetches = []; // llamadas a js_fetch registradas: {url, method, handler}
export const toggles = []; // llamadas a js_toggle_class: {sel, cls, on}
export const timers = [];  // llamadas a js_interval/js_timeout: {ms, handler}
export const shares = []; // llamadas a js_share: {text, url}
export const copies = []; // llamadas a js_copy: text
export const chatAdds = []; // llamadas a js_chat_add: {key, html, fromWs}
export const TZ_MIN = -240; // zona fija del test: UTC-4 (Venezuela)
export const NOW_EPOCH = 1782000000; // "ahora" fijo del test (2026-07-... UTC)

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
  js_toggle_class: (sel, cls, on) => { const rec = { sel: nyx.readString(sel), cls: nyx.readString(cls), on: Number(on) }; toggles.push(rec); console.log("[toggle_class]", rec.sel, rec.cls, rec.on); },
  js_set_value: (sel, v) => { values[nyx.readString(sel)] = nyx.readString(v); },
  // std/browser (fase 6): fetch/timers/ls/tz/media. En el test no hay red ni
  // timers reales — se registran las llamadas y el test dispara los handlers a
  // mano con fixtures. Nombres = imports que genera std/browser (js_browser_*).
  js_browser_fetch: (url, method, body, handler) => { fetches.push({ url: nyx.readString(url), method: nyx.readString(method), handler: nyx.readString(handler) }); },
  js_browser_interval: (ms, handler) => { timers.push({ kind: "interval", ms: Number(ms), handler: nyx.readString(handler) }); return BigInt(timers.length); },
  js_browser_timeout: (ms, handler) => { timers.push({ kind: "timeout", ms: Number(ms), handler: nyx.readString(handler) }); return BigInt(timers.length); },
  js_browser_clear_timer: (id) => {},
  js_browser_geo: (handler) => { console.log("[browser_geo]", nyx.readString(handler)); },
  js_tz_offset: () => BigInt(TZ_MIN),
  js_match_media: (q) => 0n,
  // Externs propios que se quedan locales (no migrados a std/browser)
  js_geo: (handler) => { console.log("[geo]", nyx.readString(handler)); },
  js_delegate: (c, i, a, h, f) => { console.log("[delegate]", nyx.readString(c), nyx.readString(i), "->", nyx.readString(f)); },
  js_on_enter: (sel, handler) => { console.log("[on_enter]", nyx.readString(sel), "->", nyx.readString(handler)); },
  js_count: (sel) => 0n,
  js_share: (text, url) => { shares.push({ text: nyx.readString(text), url: nyx.readString(url) }); },
  js_copy: (text) => { copies.push(nyx.readString(text)); },
  // Chat (Fase F): WS/submit/visibility mockeados; el historial se captura en chatAdds.
  js_ws: (u, a, b, c) => { console.log("[ws]", nyx.readString(u)); },
  js_ws_send: (d) => {},
  js_ws_close: () => {},
  js_on_submit: (sel, h) => { console.log("[on_submit]", nyx.readString(sel), "->", nyx.readString(h)); },
  js_on_visibility: (h) => {},
  js_hidden: () => 0n,
  js_now_epoch: () => BigInt(NOW_EPOCH),
  js_chat_add: (key, html, fromWs) => { chatAdds.push({ key: nyx.readString(key), html: nyx.readString(html), fromWs: Number(fromWs) }); },
  js_chat_clear: () => { chatAdds.length = 0; },
  js_chat_empty_check: () => {},
});

// main() corre en _start y lee #pg — se pre-siembra ANTES de instanciar
values["#pg"] = "finanzas";

// Fixtures con la forma REAL de cada API (capturadas 2026-07-02; dolarapi
// viene pretty-printed — el scanner debe tolerar espacios tras los ":")
const FIX_DOLARES = `[
  {
    "moneda": "USD",
    "fuente": "oficial",
    "nombre": "Dólar",
    "compra": null,
    "venta": null,
    "promedio": 639.7029,
    "fechaActualizacion": "2026-07-02T00:00:00-04:00"
  },
  {
    "moneda": "USD",
    "fuente": "paralelo",
    "promedio": 733.39,
    "fechaActualizacion": "2026-07-02T13:01:09.862Z"
  }
]`;
const FIX_EUROS = `[ { "moneda": "EUR", "fuente": "oficial", "promedio": 728.48086846, "fechaActualizacion": "2026-07-02T00:00:00-04:00" } ]`;
// Nuevo: respuesta de /api/rates (BCV directo por fecha valor: hoy + prox).
const FIX_RATES = `{"hoy":{"bcv":639.7029,"eur":728.48086846,"fecha":"2026-07-02"},"prox":{"bcv":645.10,"eur":735.00,"fecha":"2026-07-03"},"bin":734.04}`;
const FIX_CRIPTOYA = `{"binancep2p":{"ask":734.588,"totalAsk":734.588,"bid":733.5,"totalBid":733.5,"time":1782999810},"okexp2p":{"ask":742}}`;
const FIX_COP = `{"result":"success","rates":{"CNY":7.16,"COP":3401.617171,"CRC":515.4}}`;
const FIX_CRIPTO = `{"bitcoin":{"usd":61835},"ethereum":{"usd":1705.37},"tether":{"usd":0.998706}}`;

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

  // Fase A: main() leyó #pg="finanzas" y fx_boot(1) registró los 4 fetch
  eq(fetches.length, 4, "fx_boot: 4 fetches");
  eq(fetches[0].handler, "fx_on_rates", "handler rates (BCV directo)");
  eq(fetches[3].handler, "fx_on_cripto", "handler cripto");

  // Fechas: ISO con offset -04:00 → epoch UTC → local (TZ_MIN=-240) ida y vuelta
  // 2026-07-02T00:00:00-04:00 == 2026-07-02T04:00:00Z; local UTC-4 → 2/7/2026 00:00

  // Fase B: disparar los handlers con los fixtures (como haría js_fetch)
  exports.fx_on_rates(200n, M(FIX_RATES));
  exports.fx_on_criptoya(200n, M(FIX_CRIPTOYA));
  exports.fx_on_cop(200n, M(FIX_COP));
  const card = texts["#fin-body"], page = texts["#fz-div"];
  if (!card.includes("Dólar BCV") || !card.includes(" Bs 639,70")) throw new Error("FALLO Dólar BCV (scanner con espacios): " + card);
  // Dólar Binance = promedio compra/venta = (734,588+733,5)/2 = 734,044 → 734,04
  if (!card.includes("Dólar Binance") || !card.includes("Bs 734,04")) throw new Error("FALLO Dólar Binance (promedio P2P): " + card);
  if (!card.includes("Euro BCV") || !card.includes("Bs 728,48")) throw new Error("FALLO EUR: " + card);
  if (!card.includes("USD en COP") || !card.includes("COP 3.402")) throw new Error("FALLO COP: " + card);
  // base=(734.588+733.5)/2=734.044; 1.000 COP = 734.044/3401.617171*1000 = 215,79
  if (!card.includes("1.000 COP") || !card.includes("Bs 215,79")) throw new Error("FALLO 1.000 COP: " + card);
  // BCV directo: fecha valor de hoy + fila/valor de mañana (prox)
  if (!card.includes("Tasa BCV válida 02/07")) throw new Error("FALLO fecha valor hoy: " + card);
  if (!card.includes("Dólar BCV mañana") || !card.includes("Bs 645,10")) throw new Error("FALLO BCV mañana: " + card);
  if (!page.includes("USD oficial mañana") || !page.includes("válido 03/07")) throw new Error("FALLO fz-div mañana: " + page);
  if (!page.includes("USD en Colombia") || !page.includes("COP 3.402")) throw new Error("FALLO fz-div COP: " + page);
  if (!page.includes("Bs 100 = 463 COP")) throw new Error("FALLO peso<->bolivar: " + page);
  console.log("ok finanzas 100% Nyx (fetch propio + scanners JSON + fecha local)");

  exports.fx_on_cripto(200n, M(FIX_CRIPTO));
  const cr = texts["#fz-cripto"];
  if (!cr.includes("$ 61.835")) throw new Error("FALLO cripto btc: " + cr);
  if (!cr.includes("$ 1.705,37")) throw new Error("FALLO cripto eth: " + cr);
  if (!cr.includes("$ 0,999")) throw new Error("FALLO cripto usdt: " + cr);
  console.log("ok cripto");

  // Respuesta con error de red → status 0 → no rompe ni pisa el estado
  exports.fx_on_rates(0n, M(""));
  if (!texts["#fin-body"].includes("Bs 639,70")) throw new Error("FALLO: error de red piso el estado");
  console.log("ok manejo de status!=200");

  // Calculadora: estado ya poblado por los fx_on_* de arriba
  // Tasas Bs por divisa: bcv=639,7029 · eur=728,48086846 · bin=(734,588+733,5)/2=734,044
  values["#calc-amt"] = "100";
  values["#calc-dir"] = "d2b";
  values["#calc-rate-sel"] = "bcv";
  exports.calc_render();
  // 100 Dólar BCV → Bs = 100 * 639,7029 = 63.970,29. El resultado es SOLO el número:
  // la unidad la muestra el span #calc-to-unit (no debe repetirse dentro del resultado).
  if (texts["#calc-result"] !== "63.970,29") throw new Error("FALLO calc bcv→Bs: " + texts["#calc-result"]);
  if (!texts["#calc-rate"].includes("1 Dólar BCV = 639,70 Bs")) throw new Error("FALLO calc línea de tasa: " + texts["#calc-rate"]);
  if (texts["#calc-from-unit"] !== "$" || texts["#calc-to-unit"] !== "Bs") throw new Error("FALLO calc unidades d2b: " + texts["#calc-from-unit"] + "/" + texts["#calc-to-unit"]);
  values["#calc-rate-sel"] = "eur"; exports.calc_render();
  // 100 Euro BCV → Bs = 100 * 728,48086846 = 72.848,09
  if (texts["#calc-result"] !== "72.848,09") throw new Error("FALLO calc eur→Bs: " + texts["#calc-result"]);
  if (texts["#calc-to-unit"] !== "Bs" || texts["#calc-from-unit"] !== "€") throw new Error("FALLO calc unidades eur: " + texts["#calc-from-unit"] + "/" + texts["#calc-to-unit"]);
  values["#calc-rate-sel"] = "bin"; exports.calc_render();
  // 100 Dólar Binance → Bs = 100 * 734,044 = 73.404,40 (paralelo, NO el BCV 63.970)
  if (texts["#calc-result"] !== "73.404,40") throw new Error("FALLO calc bin→Bs: " + texts["#calc-result"]);
  if (!texts["#calc-rate"].includes("1 Dólar Binance = 734,04 Bs")) throw new Error("FALLO calc bin línea de tasa: " + texts["#calc-rate"]);
  // Sentido inverso Bs→divisa: 100 Bs / 639,7029 = 0,16 (resultado sin símbolo; el span da "$")
  values["#calc-rate-sel"] = "bcv"; values["#calc-dir"] = "b2d"; exports.calc_render();
  if (texts["#calc-result"] !== "0,16") throw new Error("FALLO calc Bs→bcv: " + texts["#calc-result"]);
  if (texts["#calc-from-unit"] !== "Bs" || texts["#calc-to-unit"] !== "$") throw new Error("FALLO calc unidades b2d: " + texts["#calc-from-unit"] + "/" + texts["#calc-to-unit"]);
  console.log("ok calculadora (bcv/eur/bin en Bs + inverso Bs→divisa + unidades + línea de tasa)");

  // Toggle Hoy/Mañana: "man" usa la tasa BCV de MAÑANA (prox bcv=645,10 del FIX_RATES)
  values["#calc-rate-sel"] = "bcv"; values["#calc-dir"] = "d2b"; values["#calc-day"] = "man";
  exports.calc_render();
  if (texts["#calc-result"] !== "64.510,00") throw new Error("FALLO calc bcv MAÑANA→Bs: " + texts["#calc-result"]);
  if (!texts["#calc-rate"].includes("1 Dólar BCV (mañana) = 645,10 Bs")) throw new Error("FALLO calc línea mañana: " + texts["#calc-rate"]);
  values["#calc-day"] = "hoy"; exports.calc_render();
  console.log("ok calculadora toggle Hoy/Mañana");

  // Guard: tasa sin base → "Esperando tasas…" y tasa vacía
  values["#calc-dir"] = "d2b"; values["#calc-rate-sel"] = "zzz"; exports.calc_render();
  if (!texts["#calc-result"].includes("Esperando tasas")) throw new Error("FALLO calc guard: " + texts["#calc-result"]);
  if (texts["#calc-rate"] !== "") throw new Error("FALLO calc guard rate: " + texts["#calc-rate"]);

  // Swap: invierte el sentido (js_set_value escribe en el mock `values`)
  values["#calc-dir"] = "d2b";
  exports.calc_swap();
  if (values["#calc-dir"] !== "b2d") throw new Error("FALLO calc_swap d2b→b2d: " + values["#calc-dir"]);
  exports.calc_swap();
  if (values["#calc-dir"] !== "d2b") throw new Error("FALLO calc_swap b2d→d2b: " + values["#calc-dir"]);
  console.log("ok calc_swap (invierte sentido)");

  // Compartir: arma texto con la conversión y llama js_share(text, "/calculadora")
  values["#calc-amt"] = "100"; values["#calc-dir"] = "d2b"; values["#calc-rate-sel"] = "bcv";
  exports.calc_share();
  const sh = shares[shares.length - 1];
  if (!sh || sh.url !== "/calculadora") throw new Error("FALLO calc_share url: " + JSON.stringify(sh));
  if (!sh.text.includes("63.970,29 Bs") || !sh.text.includes("Convierte")) throw new Error("FALLO calc_share text: " + sh.text);
  console.log("ok calc_share");

  // Copiar: copia solo el resultado formateado (100 Dólar BCV → 63.970,29 Bs)
  exports.calc_copy();
  const cp = copies[copies.length - 1];
  if (cp !== "63.970,29 Bs") throw new Error("FALLO calc_copy: " + cp);
  console.log("ok calc_copy");

  // ── Mini-calculadora de expresión (evalúa y pasa el resultado a #calc-amt) ──
  values["#calc-dir"] = "d2b"; values["#calc-rate-sel"] = "bcv";
  values["#mc-expr"] = "12*3+5"; exports.mcalc_eval();
  if (values["#calc-amt"] !== "41") throw new Error("FALLO mc 12*3+5: " + values["#calc-amt"]);
  values["#mc-expr"] = "(2+3)*4"; exports.mcalc_eval();
  if (values["#calc-amt"] !== "20") throw new Error("FALLO mc (2+3)*4: " + values["#calc-amt"]);
  values["#mc-expr"] = "10/4"; exports.mcalc_eval();
  if (values["#calc-amt"] !== "2.5") throw new Error("FALLO mc 10/4: " + values["#calc-amt"]);
  values["#mc-expr"] = "12,5+1,5"; exports.mcalc_eval();      // coma decimal → punto
  if (values["#calc-amt"] !== "14") throw new Error("FALLO mc coma: " + values["#calc-amt"]);
  values["#mc-expr"] = "6×7"; exports.mcalc_eval();           // × normaliza a *
  if (values["#calc-amt"] !== "42") throw new Error("FALLO mc ×: " + values["#calc-amt"]);
  // Inválida: NO cambia #calc-amt y avisa
  values["#calc-amt"] = "99"; values["#mc-expr"] = "2++"; exports.mcalc_eval();
  if (values["#calc-amt"] !== "99") throw new Error("FALLO mc inválida cambió monto: " + values["#calc-amt"]);
  if (!texts["#mc-out"].includes("no v")) throw new Error("FALLO mc aviso inválida: " + texts["#mc-out"]);
  values["#calc-amt"] = "99"; values["#mc-expr"] = "5/0"; exports.mcalc_eval();  // /0
  if (values["#calc-amt"] !== "99") throw new Error("FALLO mc /0 cambió monto: " + values["#calc-amt"]);
  // Chips de operador: insertan ASCII (* / etc.), borrar / limpiar en #mc-expr
  values["#mc-expr"] = "5"; values["#mc-opkey"] = "*"; exports.mcalc_ins();
  if (values["#mc-expr"] !== "5*") throw new Error("FALLO mc_ins append: " + values["#mc-expr"]);
  values["#mc-opkey"] = "del"; exports.mcalc_ins();
  if (values["#mc-expr"] !== "5") throw new Error("FALLO mc_ins del: " + values["#mc-expr"]);
  values["#mc-opkey"] = "clr"; exports.mcalc_ins();
  if (values["#mc-expr"] !== "") throw new Error("FALLO mc_ins clr: " + values["#mc-expr"]);
  console.log("ok mini-calc (precedencia, paréntesis, coma, ×, inválida, /0, chips)");

  // ── Chat (Fase F): fila escapada, parseo de lista y de mensaje WS ──────────
  values["#chat-room"] = "general";
  chatAdds.length = 0;
  const rowHtml = S(exports.chat_row_html(BigInt(NOW_EPOCH), M("Ana <b>"), M("hola & chau")));
  if (!rowHtml.includes("Ana &lt;b&gt;") || !rowHtml.includes("hola &amp; chau")) throw new Error("FALLO chat_row_html escape: " + rowHtml);
  if (!rowHtml.includes("chat-msg-nick") || !rowHtml.includes("chat-msg-body")) throw new Error("FALLO chat_row_html markup: " + rowHtml);
  console.log("ok chat_row_html (escape + markup)");
  exports.chat_on_list(200n, M('[{"t":1782000000,"n":"Ana","m":"hola"},{"t":1782000100,"n":"Beto","m":"que tal"}]'));
  if (chatAdds.length !== 2) throw new Error("FALLO chat_on_list count: " + chatAdds.length);
  if (chatAdds[0].key !== "1782000000|Ana|hola") throw new Error("FALLO chat_on_list key: " + chatAdds[0].key);
  if (chatAdds[0].fromWs !== 0 || !chatAdds[1].html.includes("que tal")) throw new Error("FALLO chat_on_list contenido");
  console.log("ok chat_on_list (parse array {t,n,m})");
  chatAdds.length = 0;
  exports.chat_on_msg(M('{"t":1782000200,"n":"Caro","m":"buenas"}'));
  if (chatAdds.length !== 1 || chatAdds[0].fromWs !== 1 || chatAdds[0].key !== "1782000200|Caro|buenas") throw new Error("FALLO chat_on_msg: " + JSON.stringify(chatAdds));
  console.log("ok chat_on_msg (mensaje WS en vivo)");

  // Fase C: clima — fixtures con decoys current_units/hourly_units (el marcador
  // "key":{ debe saltarlos). Horas generadas relativas a ahora (TZ -240).
  const nowLoc = new Date(Date.now() + TZ_MIN * 60000);
  const p2 = (n) => ("0" + n).slice(-2);
  const isoH = (d) => d.getUTCFullYear() + "-" + p2(d.getUTCMonth() + 1) + "-" + p2(d.getUTCDate()) + "T" + p2(d.getUTCHours()) + ":00";
  const hTimes = [], hTemps = [], hProbs = [], hCodes = [];
  for (let i = -2; i < 16; i++) {
    hTimes.push('"' + isoH(new Date(nowLoc.getTime() + i * 3600000)) + '"');
    hTemps.push("25.4"); hProbs.push("10"); hCodes.push("2");
  }
  const FIX_FORECAST = `{"latitude":10.5,"utc_offset_seconds":-14400,"current_units":{"time":"iso8601","temperature_2m":"°C"},"current":{"time":"2026-07-02T09:45","interval":900,"temperature_2m":26.1,"relative_humidity_2m":62,"apparent_temperature":28.3,"is_day":1,"weather_code":3,"cloud_cover":75,"surface_pressure":1013.4,"wind_speed_10m":7.6,"wind_direction_10m":92,"wind_gusts_10m":14.8,"precipitation":0.00},"hourly_units":{"time":"iso8601"},"hourly":{"time":[${hTimes.join(",")}],"temperature_2m":[${hTemps.join(",")}],"precipitation_probability":[${hProbs.join(",")}],"weather_code":[${hCodes.join(",")}]},"daily_units":{"time":"iso8601"},"daily":{"time":["2026-07-02","2026-07-03"],"weather_code":[80,3],"temperature_2m_max":[27.6,28.1],"temperature_2m_min":[18.9,19.2],"precipitation_probability_max":[65,30],"uv_index_max":[7.55,8.0],"sunrise":["2026-07-02T06:15","2026-07-03T06:15"],"sunset":["2026-07-02T18:59","2026-07-03T18:59"]}}`;
  const FIX_AIRE = `{"current_units":{"pm2_5":"μg/m³"},"current":{"time":"2026-07-02T09:00","interval":3600,"pm2_5":13.2,"pm10":22.9,"us_aqi":51}}`;
  const FIX_GEO = `{"results":[{"id":1,"name":"Valencia","latitude":39.47391,"longitude":-0.37966,"country_code":"ES","admin1":"Comunidad Valenciana"},{"id":2,"name":"Valencia","latitude":10.18,"longitude":-68.0,"country_code":"VE","admin1":"Carabobo"}]}`;

  // Tarjeta de la portada
  exports.wcard_on_meteo(200n, M(FIX_FORECAST));
  const wb = texts["#w-body"];
  if (!wb.includes("26°C") || !wb.includes("Nublado") || !wb.includes("Sensacion 28°C") || !wb.includes("Humedad 62%") || !wb.includes("Viento 8 km/h")) throw new Error("FALLO tarjeta clima: " + wb);
  console.log("ok wcard_on_meteo");

  // Página /clima: actual + horas + días
  exports.clima_on_forecast(200n, M(FIX_FORECAST));
  const ca = texts["#c-actual"];
  if (!ca.includes("26°C") || !ca.includes("km/h E") || !ca.includes("1013 hPa") || !ca.includes("Amanece 06:15") || !ca.includes("UV max 7.55")) throw new Error("FALLO c-actual: " + ca);
  const nHoras = (texts["#c-horas"].match(/ch-item/g) || []).length;
  if (nHoras !== 12) throw new Error("FALLO c-horas: " + nHoras + " items (esperado 12)");
  const cd = texts["#c-dias"];
  if (!cd.includes(">Jue<") || !cd.includes(">Vie<") || !cd.includes(">28°<") || !cd.includes(">19°<") || !cd.includes(">65%<")) throw new Error("FALLO c-dias: " + cd);
  exports.clima_on_aire(200n, M(FIX_AIRE));
  if (!texts["#c-aire"].includes("51") || !texts["#c-aire"].includes("Moderada") || !texts["#c-aire"].includes("PM2.5 13.2")) throw new Error("FALLO c-aire: " + texts["#c-aire"]);
  console.log("ok clima_on_forecast + horas + dias + aire");

  // Buscador: resultados + selección
  const fBefore = fetches.length;
  exports.clima_on_geo(200n, M(FIX_GEO));
  const res = texts["#c-results"];
  if (!res.includes('id="c-sel"') || !res.includes("Carabobo") || !res.includes('data-i="1"')) throw new Error("FALLO c-results: " + res);
  values["#c-sel"] = "1";
  exports.clima_pick();
  eq(store["w_name"], "Valencia, Carabobo", "clima_pick guarda ciudad");
  eq(store["w_lat"], "10.18", "clima_pick guarda lat");
  if (fetches.length !== fBefore + 2) throw new Error("FALLO clima_pick: no re-fetcheo (fetches=" + fetches.length + ")");
  console.log("ok buscador de ciudades + pick");

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

  // Fase D: self-boot desde el <textarea id="s-data"> del servidor (8 campos,
  // ISO UTC del EMSC) — el wasm deriva epoch y fecha/hora local (TZ -240).
  values["#s-data"] = [
    ["evA", "2026-07-02T10:20:00.0Z", "10.48", "-66.90", "12", "ML", "4.2", "CARABOBO, VENEZUELA"].join("\t"),
    ["evB", "2026-07-01T02:00:00.0Z", "10.65", "-71.61", "8", "ML", "3.1", "ZULIA, VENEZUELA"].join("\t"),
  ].join("\n");
  values["#s-upd-epoch"] = "1783082100"; // 2026-07-03T12:35:00Z -> local 08:35 (TZ-240)
  values["#f-mag"] = ""; values["#f-text"] = ""; values["#f-orden"] = "fecha"; values["#f-dist"] = "";
  exports.sismos_boot();
  eq(texts["#s-count"], "2 sismos", "sismos_boot count");
  // 10:20 UTC en TZ-240 = 06:20 local del 2026-07-02
  const tb2 = texts["#qtbody"];
  if (!tb2.includes(">2026-07-02<") || !tb2.includes(">06:20<")) throw new Error("FALLO hora local en boot: " + tb2.slice(0, 300));
  // 2026-07-01T02:00Z en TZ-240 = 2026-06-30 22:00 local (cruza medianoche)
  if (!tb2.includes(">2026-06-30<") || !tb2.includes(">22:00<")) throw new Error("FALLO cruce de medianoche: " + tb2.slice(0, 400));
  eq(texts["#s-updated"], "Actualizado 08:35", "s-updated local");
  console.log("ok sismos_boot (textarea + epoch/hora local derivados en Nyx)");

  // Fase E: expand de noticias (news_toggle vía #n-sel + nth-child)
  toggles.length = 0;
  values["#n-sel"] = "3";
  exports.news_toggle();
  if (!toggles.some((t) => t.sel === ".news-list .news-item:nth-child(3)" && t.cls === "open" && t.on === 1)) throw new Error("FALLO news_toggle abrir: " + JSON.stringify(toggles));
  exports.news_toggle(); // mismo item -> colapsa
  if (!toggles.some((t) => t.sel === ".news-list .news-item:nth-child(3)" && t.on === 0)) throw new Error("FALLO news_toggle colapsar: " + JSON.stringify(toggles));
  values["#n-sel"] = "5";
  exports.news_toggle();
  values["#n-sel"] = "2";
  exports.news_toggle(); // abre otro -> cierra el 5 y abre el 2
  if (!toggles.some((t) => t.sel.includes("nth-child(5)") && t.on === 0) || !toggles.some((t) => t.sel.includes("nth-child(2)") && t.on === 1)) throw new Error("FALLO news_toggle uno-a-la-vez: " + JSON.stringify(toggles));
  console.log("ok news_toggle (expand uno a la vez)");

  console.log("TODOS LOS ASSERTS PASARON");
}
