// home.js — portada: tarjeta del clima + orden/reorden de tarjetas.
// wdesc vive en veninfo.wasm (Nyx, via nyx-loader.js). La tarjeta de finanzas
// la pinta fx.js.

// Tarjeta del clima (#w-body): actual de Open-Meteo con la ciudad guardada
(function(){
var body=document.getElementById('w-body'),nameEl=document.getElementById('w-city-name');
if(!body){return;}
window.nyxReady.then(function(nyx){
var la='10.4806',lo='-66.9036',nm='Caracas';
try{var sla=localStorage.getItem('w_lat'),slo=localStorage.getItem('w_lon'),snm=localStorage.getItem('w_name');if(sla&&slo){la=sla;lo=slo;if(snm)nm=snm;}else{var ula=localStorage.getItem('ulat'),ulo=localStorage.getItem('ulon');if(ula&&ulo){la=ula;lo=ulo;nm='Tu ubicacion';}}}catch(e){}
function setName(n){nm=n;if(nameEl)nameEl.textContent=n;}
setName(nm);
function loadW(){fetch('https://api.open-meteo.com/v1/forecast?latitude='+la+'&longitude='+lo+'&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto')
.then(function(r){return r.json();}).then(function(d){var c=d.current;if(!c){body.textContent='Sin datos de clima.';return;}var w=nyx.wdesc(c.weather_code);
body.innerHTML='<div class="w-main"><span class="w-emoji">'+w[1]+'</span><span class="w-temp">'+Math.round(c.temperature_2m)+'°C</span></div>'
+'<div class="w-desc">'+w[0]+'</div>'
+'<div class="w-meta">Sensacion '+Math.round(c.apparent_temperature)+'°C · Humedad '+c.relative_humidity_2m+'% · Viento '+Math.round(c.wind_speed_10m)+' km/h</div>';
}).catch(function(){body.textContent='No se pudo cargar el clima.';});}
function revGeo(a,o){fetch('https://api.bigdatacloud.net/data/reverse-geocode-client?latitude='+a+'&longitude='+o+'&localityLanguage=es').then(function(r){return r.json();}).then(function(g){var cc=g.city||g.locality||g.principalSubdivision;if(cc){setName(cc);try{localStorage.setItem('w_name',cc);}catch(e){}}}).catch(function(){});}
loadW();
if(nm==='Tu ubicacion'||nm==='Mi ubicacion'||!nm){revGeo(la,lo);}
if(navigator.geolocation){navigator.geolocation.getCurrentPosition(function(p){la=''+p.coords.latitude;lo=''+p.coords.longitude;try{localStorage.setItem('w_lat',la);localStorage.setItem('w_lon',lo);}catch(e){}loadW();revGeo(la,lo);},function(){});}
}).catch(function(){body.textContent='No se pudo cargar el modulo de la pagina.';});
})();

// Orden de tarjetas (#home-cards): aplica card_order guardado y modo edicion
// (drag&drop en escritorio + flechas inyectadas, imprescindibles en movil/PWA)
(function(){var cont=document.getElementById('home-cards');if(!cont)return;var cfg=document.getElementById('cfg-btn');var cards=Array.prototype.slice.call(cont.querySelectorAll('.home-card'));
function order(){return Array.prototype.map.call(cont.children,function(c){return c.getAttribute('data-key');});}
function save(){try{localStorage.setItem('card_order',order().join(','));}catch(e){}}
try{var s=localStorage.getItem('card_order');if(s){s.split(',').forEach(function(k){var el=cont.querySelector('.home-card[data-key="'+k+'"]');if(el)cont.appendChild(el);});}}catch(e){}
cards.forEach(function(c){var a=c.querySelector('a');if(a)a.setAttribute('draggable','false');});
var BTN='width:36px;height:36px;border-radius:50%;border:1px solid #00247D;background:#fff;color:#00247D;font-size:.95rem;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;box-shadow:0 1px 5px rgba(0,0,0,.25);margin:0;padding:0;';
cards.forEach(function(c){c.style.position='relative';var ctl=document.createElement('div');ctl.className='card-move';ctl.style.cssText='display:none;position:absolute;top:8px;right:8px;z-index:6;flex-direction:column;gap:6px;';var up=document.createElement('button');up.type='button';up.className='cm-btn';up.setAttribute('aria-label','Subir tarjeta');up.innerHTML='&#9650;';up.style.cssText=BTN;var dn=document.createElement('button');dn.type='button';dn.className='cm-btn';dn.setAttribute('aria-label','Bajar tarjeta');dn.innerHTML='&#9660;';dn.style.cssText=BTN;up.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();var p=c.previousElementSibling;if(p){cont.insertBefore(c,p);save();}});dn.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();var n=c.nextElementSibling;if(n){cont.insertBefore(n,c);save();}});ctl.appendChild(up);ctl.appendChild(dn);c.appendChild(ctl);});
function setEdit(on){cont.classList.toggle('editing',on);if(cfg)cfg.classList.toggle('on',on);var mv=cont.querySelectorAll('.card-move');for(var i=0;i<mv.length;i++){mv[i].style.display=on?'flex':'none';}cards.forEach(function(c){if(on){c.setAttribute('draggable','true');}else{c.removeAttribute('draggable');}});}
if(cfg){cfg.addEventListener('click',function(){setEdit(!cont.classList.contains('editing'));});}
cont.addEventListener('click',function(e){if(cont.classList.contains('editing')){var a=e.target.closest&&e.target.closest('a');if(a)e.preventDefault();}});
var drag=null;
cont.addEventListener('dragstart',function(e){var c=e.target.closest&&e.target.closest('.home-card');if(!c||!cont.classList.contains('editing')){if(e.preventDefault)e.preventDefault();return;}drag=c;c.classList.add('dragging');if(e.dataTransfer){e.dataTransfer.effectAllowed='move';try{e.dataTransfer.setData('text/plain','');}catch(_){}}});
cont.addEventListener('dragend',function(){if(drag){drag.classList.remove('dragging');drag=null;save();}});
function afterEl(y){var els=Array.prototype.slice.call(cont.querySelectorAll('.home-card:not(.dragging)'));var res=null,off=-1e9;els.forEach(function(ch){var b=ch.getBoundingClientRect();var o=y-b.top-b.height/2;if(o<0&&o>off){off=o;res=ch;}});return res;}
cont.addEventListener('dragover',function(e){if(!drag)return;e.preventDefault();var a=afterEl(e.clientY);if(a==null){cont.appendChild(drag);}else{cont.insertBefore(drag,a);}});
})();
