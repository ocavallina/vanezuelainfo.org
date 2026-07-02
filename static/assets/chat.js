// chat.js — cliente del chat colectivo de venezuelainfo.org.
// Recepcion en vivo por WebSocket (wss:///ws/chat/<sala>); si el WS no
// conecta, respaldo de polling (4 s, pausado con la pestana oculta). El envio
// SIEMPRE va por POST /api/chat/send (el servidor valida/sanea/limita).
// Render incremental con textContent (anti-XSS): solo se anexan mensajes no
// vistos (clave t|n|m), sin reconstruir el log completo.
(function(){
var log=document.getElementById('chat-log');
var form=document.getElementById('chat-form');
var nick=document.getElementById('chat-nick');
var text=document.getElementById('chat-text');
var count=document.getElementById('chat-count');
var status=document.getElementById('chat-status');
var roomSel=document.getElementById('chat-room');
var live=document.getElementById('chat-live');
if(!log||!form)return;
try{var sn=localStorage.getItem('chat_nick');if(sn)nick.value=sn;}catch(e){}
var room='general';try{var sr=localStorage.getItem('chat_room');if(sr)room=sr;}catch(e){}
var seen={},empty=null,newBtn=null,newCount=0;
var ws=null,wsOk=false,wsTries=0,pollTimer=null,pingTimer=null,reTimer=null;

function two(n){return n<10?'0'+n:''+n;}
function fmt(t){var d=new Date(t*1000);var now=new Date();var hm=two(d.getHours())+':'+two(d.getMinutes());
if(d.toDateString()===now.toDateString())return hm;return two(d.getDate())+'/'+two(d.getMonth()+1)+' '+hm;}
function atBottom(){return log.scrollTop+log.clientHeight>=log.scrollHeight-40;}
function showEmpty(){if(empty)return;empty=document.createElement('div');empty.className='chat-empty';empty.textContent='Aun no hay mensajes. Se el primero.';log.appendChild(empty);}
function hideNew(){newCount=0;if(newBtn){newBtn.remove();newBtn=null;}}
function showNew(){if(!newBtn){newBtn=document.createElement('button');newBtn.type='button';newBtn.className='chat-new';
newBtn.addEventListener('click',function(){log.scrollTop=log.scrollHeight;hideNew();});
log.parentNode.insertBefore(newBtn,log.nextSibling);}
newBtn.textContent=newCount+(newCount===1?' mensaje nuevo':' mensajes nuevos')+' ↓';}
function clearLog(){log.innerHTML='';seen={};empty=null;hideNew();}
function add(it,fromWs){if(!it||typeof it.m!=='string')return;
var k=it.t+'|'+it.n+'|'+it.m;if(seen[k])return;seen[k]=1;
if(empty){empty.remove();empty=null;}
var stick=atBottom();
var row=document.createElement('div');row.className='chat-msg';
var head=document.createElement('div');head.className='chat-msg-head';
var nm=document.createElement('span');nm.className='chat-msg-nick';nm.textContent=it.n;head.appendChild(nm);
var tm=document.createElement('span');tm.className='chat-msg-time';tm.textContent=fmt(it.t);head.appendChild(tm);
var bd=document.createElement('div');bd.className='chat-msg-body';bd.textContent=it.m;
row.appendChild(head);row.appendChild(bd);log.appendChild(row);
if(stick){log.scrollTop=log.scrollHeight;}else if(fromWs){newCount++;showNew();}}
function render(items){for(var i=0;i<items.length;i++)add(items[i],false);
if(!log.childNodes.length)showEmpty();}
function load(){fetch('/api/chat/'+encodeURIComponent(room),{cache:'no-store'})
.then(function(r){return r.json();}).then(render).catch(function(){});}
log.addEventListener('scroll',function(){if(atBottom())hideNew();});

// ── WebSocket con respaldo de polling ───────────────────────────────────────
function setLive(on){wsOk=on;if(!live)return;
live.textContent=on?'● en vivo':'○ actualizando';
live.className='chat-live'+(on?' on':'');}
function stopPoll(){if(pollTimer){clearInterval(pollTimer);pollTimer=null;}}
function startPoll(){if(pollTimer)return;load();pollTimer=setInterval(load,4000);}
function stopPing(){if(pingTimer){clearInterval(pingTimer);pingTimer=null;}}
function closeWs(){if(ws){try{ws.onclose=null;ws.close();}catch(e){}ws=null;}stopPing();}
function wsDown(){setLive(false);stopPing();if(!document.hidden)startPoll();
if(reTimer)clearTimeout(reTimer);
wsTries++;var d=Math.min(30000,1000*Math.pow(2,Math.min(wsTries,5)));
reTimer=setTimeout(function(){if(!document.hidden)connect();},d);}
function connect(){
if(typeof WebSocket==='undefined'){setLive(false);startPoll();return;}
closeWs();
var url=(location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws/chat/'+encodeURIComponent(room);
var s;try{s=new WebSocket(url);}catch(e){wsDown();return;}
ws=s;
s.onopen=function(){if(s!==ws)return;wsTries=0;setLive(true);stopPoll();load();
stopPing();pingTimer=setInterval(function(){try{s.send('p');}catch(e){}},25000);};
s.onmessage=function(ev){var m;try{m=JSON.parse(ev.data);}catch(e){return;}add(m,true);};
s.onclose=function(){if(s!==ws)return;ws=null;wsDown();};
s.onerror=function(){};}

document.addEventListener('visibilitychange',function(){
if(document.hidden){stopPoll();}
else{if(wsOk){load();}else{startPoll();connect();}}});

// ── Salas ────────────────────────────────────────────────────────────────────
function loadRooms(){if(!roomSel)return;fetch('/api/rooms',{cache:'no-store'})
.then(function(r){return r.json();}).then(function(rs){
roomSel.innerHTML='';var ok=false;
for(var i=0;i<rs.length;i++){var o=document.createElement('option');o.value=rs[i].id;o.textContent=rs[i].n;if(rs[i].id===room)ok=true;roomSel.appendChild(o);}
if(!ok)room='general';roomSel.value=room;}).catch(function(){});}
if(roomSel){roomSel.addEventListener('change',function(){room=roomSel.value;
try{localStorage.setItem('chat_room',room);}catch(e){}
clearLog();load();connect();});}

// ── Envio ────────────────────────────────────────────────────────────────────
function upd(){count.textContent=text.value.length+'/280';}
text.addEventListener('input',upd);upd();
form.addEventListener('submit',function(ev){ev.preventDefault();var m=text.value.trim();if(!m)return;
try{localStorage.setItem('chat_nick',nick.value);}catch(e){}
status.textContent='Enviando...';
var body='room='+encodeURIComponent(room)+'&nick='+encodeURIComponent(nick.value)+'&texto='+encodeURIComponent(m);
fetch('/api/chat/send',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body})
.then(function(r){return r.json();}).then(function(j){
if(j.ok){text.value='';upd();status.textContent='';if(!wsOk)load();}
else{status.textContent=j.error||'No se pudo enviar';}})
.catch(function(){status.textContent='Error de red';});});

loadRooms();setInterval(loadRooms,60000);
load();startPoll();connect();
})();
