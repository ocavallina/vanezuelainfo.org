// home.js — portada: SOLO orden/reorden de tarjetas (drag&drop + flechas).
// La tarjeta del clima la pinta veninfo.wasm (wcard_boot, via nyx-loader.js).
// El drag&drop sigue en JS porque el target wasm aun no expone el objeto
// Event (coordenadas/target) ni closures como handlers — ver
// NyxLang/HANDOFF-veninfo-front.md (tarea 3).

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
