// veninfo.js — helpers compartidos entre paginas. Cada bloque se activa solo
// si su DOM esta presente. El computo (wdesc, fechas relativas) vive en
// veninfo.wasm (Nyx); esto es solo el pegamento DOM. Requiere nyx-loader.js.

// <time class="news-date" data-ts="RFC822"> -> "hace X" en hora local (Nyx)
(function(){var els=document.querySelectorAll('.news-date[data-ts]');if(!els.length)return;
window.nyxReady.then(function(nyx){var now=Date.now();
for(var i=0;i<els.length;i++){var d=Date.parse(els[i].getAttribute('data-ts'));if(isNaN(d))continue;
els[i].textContent=nyx.relTime(Math.max(0,(now-d)/1000));}}).catch(function(){});})();

// Rotador de titulares (.rot-stage). Respeta prefers-reduced-motion.
(function(){var st=document.querySelectorAll('.rot-stage');if(!st.length)return;
var rm=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
for(var x=0;x<st.length;x++){(function(stage){
var s=stage.querySelectorAll('.rot-slide');if(!s.length)return;var i=0;
for(var k=0;k<s.length;k++){s[k].style.display='none';}s[0].style.display='flex';
if(s.length>1&&!rm){setInterval(function(){s[i].style.display='none';i=(i+1)%s.length;s[i].style.display='flex';},4500);}})(st[x]);}})();

// Despliegue/colapso del detalle de cada noticia (uno a la vez)
(function(){var it=document.querySelectorAll('.news-list .news-item');
for(var i=0;i<it.length;i++){it[i].addEventListener('click',function(e){if(e.target.closest&&e.target.closest('a'))return;
var op=this.classList.contains('open');for(var j=0;j<it.length;j++){it[j].classList.remove('open');}if(!op)this.classList.add('open');});}})();
