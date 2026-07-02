// quake.js — pagina /sismos/{id}: mapa Leaflet (gesture-handling), fecha en
// hora local y distancia desde el usuario. Los datos del evento llegan por
// atributos data-* de #qmap. Requiere Leaflet cargado antes (script clasico).
(function(){
var el=document.getElementById('qmap');if(!el||typeof L==='undefined')return;
function n(k){return el.getAttribute(k)||'';}
(function(){var qf=document.getElementById('q-fecha');if(!qf)return;var dd=new Date(n('data-iso'));if(isNaN(dd.getTime()))return;function p2(x){return ('0'+x).slice(-2);}qf.textContent=dd.getFullYear()+'-'+p2(dd.getMonth()+1)+'-'+p2(dd.getDate())+' '+p2(dd.getHours())+':'+p2(dd.getMinutes());})();
var la=parseFloat(n('data-lat')),lo=parseFloat(n('data-lon'));if(isNaN(la)||isNaN(lo))return;
var opt={};if(L.GestureHandling){opt.gestureHandling=true;}
var map=L.map('qmap',opt).setView([la,lo],8);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'&copy; OpenStreetMap'}).addTo(map);
var mv=parseFloat(n('data-mag'))||0;
var mk=L.circleMarker([la,lo],{radius:8+mv*1.6,color:'#00247D',fillColor:'#CF142B',fillOpacity:0.85,weight:3}).addTo(map);
mk.bindPopup('<b>M '+n('data-mag')+' '+n('data-type')+'</b><br>'+n('data-place')).openPopup();
var uLayer=[];
function drawUser(ula,ulo){if(isNaN(ula)||isNaN(ulo))return;uLayer.forEach(function(l){map.removeLayer(l);});uLayer=[];
uLayer.push(L.marker([ula,ulo]).addTo(map).bindPopup('Tu ubicacion'));
uLayer.push(L.polyline([[ula,ulo],[la,lo]],{color:'#00247D',weight:2,dashArray:'6,6'}).addTo(map));
map.fitBounds([[ula,ulo],[la,lo]],{padding:[50,50],maxZoom:9});
var qd=document.getElementById('q-dist');
if(qd)window.nyxReady.then(function(nyx){qd.textContent=nyx.havKm(ula,ulo,la,lo)+' km';}).catch(function(){});}
var sla=parseFloat(localStorage.getItem('ulat')),slo=parseFloat(localStorage.getItem('ulon'));
if(!isNaN(sla)&&!isNaN(slo)){drawUser(sla,slo);}
if(navigator.geolocation){navigator.geolocation.getCurrentPosition(function(pos){var a2=pos.coords.latitude,o2=pos.coords.longitude;try{localStorage.setItem('ulat',a2);localStorage.setItem('ulon',o2);}catch(e){}drawUser(a2,o2);},function(){});}
})();
