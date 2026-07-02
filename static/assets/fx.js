// fx.js — finanzas: capa de DATOS. Los fetch y la extraccion de floats del
// JSON quedan en JS (wasm no tiene fetch); el calculo y el HTML los hace
// veninfo.wasm (fx_render / fx_render_cripto, via nyx-loader.js). Pinta la
// tarjeta de la portada (#fin-body) y/o /finanzas (#fz-div/#fz-cripto) segun
// lo que exista en el DOM (el wasm hace no-op si el selector falta).
(function(){
var card=document.getElementById('fin-body');
var divEl=document.getElementById('fz-div');
var criEl=document.getElementById('fz-cripto');
if(!card&&!divEl&&!criEl)return;
window.nyxReady.then(function(nyx){
var R={};
function s(v){return String(v).replace(/[|=]/g,'');}
function paint(){var p=[];for(var k in R)p.push(k+'='+s(R[k]));nyx.fxRender(p.join('|'));}
fetch('https://ve.dolarapi.com/v1/dolares').then(function(r){return r.json();}).then(function(d){for(var i=0;i<d.length;i++){if(d[i].fuente==='oficial'){R.bcv=d[i].promedio;
var f=new Date(d[i].fechaActualizacion);if(!isNaN(f.getTime()))R.fch=f.toLocaleDateString('es-VE')+' '+('0'+f.getHours()).slice(-2)+':'+('0'+f.getMinutes()).slice(-2);}}paint();}).catch(function(){});
fetch('https://criptoya.com/api/USDT/VES/1').then(function(r){return r.json();}).then(function(c){if(c.binancep2p){R.uc=c.binancep2p.ask;R.uv=c.binancep2p.bid;}paint();}).catch(function(){});
fetch('https://ve.dolarapi.com/v1/euros').then(function(r){return r.json();}).then(function(d){for(var i=0;i<d.length;i++){if(d[i].fuente==='oficial')R.eur=d[i].promedio;}paint();}).catch(function(){});
fetch('https://open.er-api.com/v6/latest/USD').then(function(r){return r.json();}).then(function(d){if(d&&d.rates&&d.rates.COP)R.cop=d.rates.COP;paint();}).catch(function(){});
if(criEl){fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,tether&vs_currencies=usd').then(function(r){return r.json();}).then(function(c){
var p=[];if(c.bitcoin)p.push('btc='+s(c.bitcoin.usd));if(c.ethereum)p.push('eth='+s(c.ethereum.usd));if(c.tether)p.push('usdt='+s(c.tether.usd));
nyx.fxRenderCripto(p.join('|'));}).catch(function(){criEl.textContent='No se pudo cargar cripto.';});}
}).catch(function(){var m='No se pudo cargar el modulo de finanzas.';if(card)card.textContent=m;if(divEl)divEl.textContent=m;if(criEl)criEl.textContent=m;});
})();
