// clima.js — pagina /clima: buscador de ciudad (geocoding), actual completo,
// proximas horas, 7 dias y calidad del aire. El computo (wdesc/compass/
// aqiLabel) vive en veninfo.wasm (Nyx). Requiere nyx-loader.js.
(function(){
var actEl0=document.getElementById('c-actual');if(!actEl0)return;
window.nyxReady.then(function(nyx){
function pad(n){return ('0'+n).slice(-2);}
function hm(iso){var d=new Date(iso);return isNaN(d.getTime())?'':pad(d.getHours())+':'+pad(d.getMinutes());}
var la=10.4806,lo=-66.9036,nm='Caracas';
try{var sla=parseFloat(localStorage.getItem('w_lat')),slo=parseFloat(localStorage.getItem('w_lon')),snm=localStorage.getItem('w_name');if(!isNaN(sla)&&!isNaN(slo)){la=sla;lo=slo;nm=snm||'Tu ciudad';}}catch(e){}
var titleEl=document.getElementById('c-title'),actEl=document.getElementById('c-actual'),horasEl=document.getElementById('c-horas'),diasEl=document.getElementById('c-dias'),aireEl=document.getElementById('c-aire');
if(!actEl)return;
function setCity(a,o,n){la=a;lo=o;nm=n;try{localStorage.setItem('w_lat',a);localStorage.setItem('w_lon',o);localStorage.setItem('w_name',n);}catch(e){}loadAll();}
function loadAll(){titleEl.textContent=nm;actEl.textContent='Cargando…';
fetch('https://api.open-meteo.com/v1/forecast?latitude='+la+'&longitude='+lo+'&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,cloud_cover,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation&hourly=temperature_2m,precipitation_probability,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,sunrise,sunset&forecast_days=7&timezone=auto')
.then(function(r){return r.json();}).then(function(d){renderForecast(d);}).catch(function(){actEl.textContent='No se pudo cargar el clima.';});
fetch('https://air-quality-api.open-meteo.com/v1/air-quality?latitude='+la+'&longitude='+lo+'&current=pm2_5,pm10,us_aqi&timezone=auto')
.then(function(r){return r.json();}).then(function(d){renderAire(d);}).catch(function(){aireEl.textContent='Sin datos de calidad del aire.';});
}
function renderForecast(d){var c=d.current||{};var w=nyx.wdesc(c.weather_code);var per=(c.is_day===0)?'Noche':'Dia';
var h='<div class="ca-main"><span class="ca-emoji">'+w[1]+'</span><span class="ca-temp">'+Math.round(c.temperature_2m)+'°C</span><span class="ca-desc">'+w[0]+'</span></div>';
h+='<div class="ca-grid">'
+'<div><span>Sensacion</span><b>'+Math.round(c.apparent_temperature)+'°</b></div>'
+'<div><span>Humedad</span><b>'+c.relative_humidity_2m+'%</b></div>'
+'<div><span>Viento</span><b>'+Math.round(c.wind_speed_10m)+' km/h '+nyx.compass(c.wind_direction_10m)+'</b></div>'
+'<div><span>Rafagas</span><b>'+Math.round(c.wind_gusts_10m)+' km/h</b></div>'
+'<div><span>Presion</span><b>'+Math.round(c.surface_pressure)+' hPa</b></div>'
+'<div><span>Nubosidad</span><b>'+c.cloud_cover+'%</b></div>'
+'<div><span>Precipitacion</span><b>'+(c.precipitation||0)+' mm</b></div>'
+'<div><span>Periodo</span><b>'+per+'</b></div></div>';
var dy=d.daily||{};if(dy.sunrise){h+='<div class="ca-sun">Amanece '+hm(dy.sunrise[0])+' · Anochece '+hm(dy.sunset[0])+' · UV max '+dy.uv_index_max[0]+'</div>';}
actEl.innerHTML=h;renderHoras(d.hourly);renderDias(dy);}
function renderHoras(hr){if(!hr||!hr.time){horasEl.textContent='';return;}var now=Date.now(),out='',cnt=0;
for(var i=0;i<hr.time.length&&cnt<12;i++){var t=new Date(hr.time[i]);if(t.getTime()<now-3600000)continue;var w=nyx.wdesc(hr.weather_code[i]);
out+='<div class="ch-item"><span class="ch-h">'+pad(t.getHours())+':00</span><span class="ch-e">'+w[1]+'</span><span class="ch-t">'+Math.round(hr.temperature_2m[i])+'°</span><span class="ch-p">'+(hr.precipitation_probability?hr.precipitation_probability[i]:0)+'%</span></div>';cnt++;}
horasEl.innerHTML=out;}
function renderDias(dy){if(!dy||!dy.time){diasEl.textContent='';return;}var dn=['Dom','Lun','Mar','Mie','Jue','Vie','Sab'],out='';
for(var i=0;i<dy.time.length;i++){var t=new Date(dy.time[i]+'T12:00:00');var w=nyx.wdesc(dy.weather_code[i]);
out+='<div class="cd-item"><span class="cd-d">'+dn[t.getDay()]+'</span><span class="cd-e">'+w[1]+'</span><span class="cd-mx">'+Math.round(dy.temperature_2m_max[i])+'°</span><span class="cd-mn">'+Math.round(dy.temperature_2m_min[i])+'°</span><span class="cd-p">'+dy.precipitation_probability_max[i]+'%</span></div>';}
diasEl.innerHTML=out;}
function renderAire(d){var c=d.current||{};if(c.us_aqi==null){aireEl.textContent='Sin datos.';return;}var l=nyx.aqiLabel(c.us_aqi);
aireEl.innerHTML='<div class="ca-aqi" style="border-color:'+l[1]+'"><span class="aqi-num" style="color:'+l[1]+'">'+c.us_aqi+'</span><span class="aqi-lab">AQI (US): '+l[0]+'</span><span class="aqi-pm">PM2.5 '+c.pm2_5+' · PM10 '+c.pm10+'</span></div>';}
var q=document.getElementById('c-q'),bBuscar=document.getElementById('c-buscar'),bGeo=document.getElementById('c-geo'),res=document.getElementById('c-results'),_res=[];
function buscar(){var term=(q.value||'').trim();if(!term)return;res.textContent='Buscando…';
fetch('https://geocoding-api.open-meteo.com/v1/search?name='+encodeURIComponent(term)+'&count=6&language=es')
.then(function(r){return r.json();}).then(function(d){_res=d.results||[];if(!_res.length){res.textContent='Sin resultados.';return;}
var out='';for(var i=0;i<_res.length;i++){var x=_res[i];var sub=(x.admin1?(', '+x.admin1):'')+(x.country_code?(' ('+x.country_code+')'):'');out+='<button type="button" class="c-res" data-i="'+i+'">'+x.name+'<small>'+sub+'</small></button>';}
res.innerHTML=out;var bs=res.querySelectorAll('.c-res');for(var j=0;j<bs.length;j++){bs[j].addEventListener('click',function(){var x=_res[parseInt(this.getAttribute('data-i'),10)];res.innerHTML='';q.value='';setCity(x.latitude,x.longitude,x.name+(x.admin1?(', '+x.admin1):''));});}
}).catch(function(){res.textContent='Error de busqueda.';});}
if(bBuscar)bBuscar.addEventListener('click',buscar);
if(q)q.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();buscar();}});
if(bGeo)bGeo.addEventListener('click',function(){if(!navigator.geolocation)return;res.textContent='Obteniendo ubicacion…';navigator.geolocation.getCurrentPosition(function(p){res.textContent='';setCity(p.coords.latitude,p.coords.longitude,'Mi ubicacion');},function(){res.textContent='No se pudo obtener la ubicacion.';});});
loadAll();
}).catch(function(){actEl0.textContent='No se pudo cargar el modulo de la pagina.';});
})();
