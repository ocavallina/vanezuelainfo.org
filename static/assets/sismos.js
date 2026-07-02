// sismos.js — pegamento de /sismos: serializa UNA vez las filas <tr data-*>
// del servidor y se las pasa a veninfo.wasm (sismos_load), que hace filtros,
// orden, paginacion, seleccion y destacado 24h en Nyx. Aqui queda solo lo que
// wasm no tiene: geolocalizacion, timers, hora local y la delegacion de click
// (las filas se regeneran dentro del wasm). Requiere nyx-loader.js.
(function(){
if(!document.getElementById('s-count'))return;
var rows=Array.prototype.slice.call(document.querySelectorAll('tr[data-lat]'));
function pad(n){return('0'+n).slice(-2);}
function hhmm(d){return pad(d.getHours())+':'+pad(d.getMinutes());}
(function(){var su=document.getElementById('s-updated');if(!su)return;var ep=parseInt(su.getAttribute('data-updated'),10)||0;su.textContent=ep?('Actualizado '+hhmm(new Date(ep*1000))):'';})();
window.nyxReady.then(function(nyx){
function clean(s){return String(s||'').replace(/[\t\n]/g,' ');}
var recs=rows.map(function(r){function a(n){return clean(r.getAttribute(n));}
var d=new Date(a('data-iso'));var ep=isNaN(d.getTime())?0:Math.floor(d.getTime()/1000);
var dia=isNaN(d.getTime())?'':(d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()));
var hora=isNaN(d.getTime())?'':(pad(d.getHours())+':'+pad(d.getMinutes()));
return [a('data-id'),ep,a('data-iso'),a('data-lat'),a('data-lon'),a('data-depth'),a('data-type'),a('data-mag'),a('data-place'),dia,hora].join('\t');});
if(!recs.length)return;
nyx.sismosLoad(recs.join('\n'));
// Click en fila -> seleccion (delegacion: el tbody se regenera en wasm)
var tbl=document.querySelector('.tabla-scroll');
if(tbl)tbl.addEventListener('click',function(e){var tr=e.target&&e.target.closest&&e.target.closest('tr[data-id]');if(!tr)return;
var hid=document.getElementById('s-selected');if(hid){hid.value=tr.getAttribute('data-id')||'';nyx.raw.s_select();}});
// Geolocalizacion persistente (cada 2 min); wasm recalcula distancias
var geoStatus=document.getElementById('geo-status');
function pedir(){if(!navigator.geolocation)return;navigator.geolocation.getCurrentPosition(function(p){
try{localStorage.setItem('ulat',p.coords.latitude);localStorage.setItem('ulon',p.coords.longitude);}catch(e){}
if(geoStatus)geoStatus.textContent='Ubicacion '+hhmm(new Date());nyx.sismosSetLoc(p.coords.latitude,p.coords.longitude);},function(){});}
var sla=parseFloat(localStorage.getItem('ulat')),slo=parseFloat(localStorage.getItem('ulon'));
if(!isNaN(sla)&&!isNaN(slo)){if(geoStatus)geoStatus.textContent='Ubicacion guardada';nyx.sismosSetLoc(sla,slo);}
pedir();setInterval(pedir,120000);
}).catch(function(){var sc=document.getElementById('s-count');if(sc)sc.textContent='No se pudo cargar el modulo';});
})();
