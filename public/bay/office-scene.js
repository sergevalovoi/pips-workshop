// office-scene.js: отрисовка офиса v11 и движение персонажей. Геометрия — office-layout.js, поведение — office-behavior.js.
// Статичная сцена строится один раз; персонажи и плашки обновляются на месте (без перерисовки SVG), поэтому выбор объекта и опрос
// состояния не перезапускают прогулки. Анимируются только transform-атрибуты; цикл кадров работает лишь пока кто-то идёт.
const SC={built:false,tracker:null,baselined:false,agents:{},pills:{},layout:{},inspect:{},timers:new Set(),raf:0,steps:[],stepSeq:0,calloutKey:'',behaviors:{},reduced:matchMedia('(prefers-reduced-motion:reduce)')};
const PILL_DEFS={commons:['queue','control'],kitchen:['messages'],review:['control','growth'],hr:['queue','growth']};
const FLOOR_TONE={commons:'#dddddd',sales:'#d5d5d5',finance:'#e0e0e0',product:'#d4d4d4',hr:'#dbdbdb',lab:'#dcdcdc',kitchen:'#d8d8d8',review:'#d5d5d5',life:'#dcdcdc'};
const f1=n=>(+n).toFixed(1);

// ---- Статичная сцена ----
function sBox(x,y,w,d,h,top,front,side){return `<polygon points="${pp([[x+w,y,0],[x+w,y+d,0],[x+w,y+d,h],[x+w,y,h]])}" fill="${side||front}"/><polygon points="${pp([[x,y+d,0],[x+w,y+d,0],[x+w,y+d,h],[x,y+d,h]])}" fill="${front}"/><polygon points="${pp([[x,y,h],[x+w,y,h],[x+w,y+d,h],[x,y+d,h]])}" fill="${top}"/>`}
const sFloor=(x,y,w,d,c,cls='',extra='')=>`<polygon class="${cls}" ${extra} points="${pp([[x,y,0],[x+w,y,0],[x+w,y+d,0],[x,y+d,0]])}" fill="${c}"/>`;
function furnitureSvg(f){
 const c=project(f.x+f.w/2,f.y+f.d/2,f.h);
 if(f.kind==='desk'){const m=project(f.x+f.w*.45,f.y+f.d*.35,f.h+10);return sBox(f.x,f.y,f.w,f.d,f.h,'#fbfbfb','#c0c0c0','#d0d0d0')+`<path d="M${f1(m[0])},${f1(m[1]+3)}v10" stroke="#7f7f7f" stroke-width="3"/><rect x="${f1(m[0]-13)}" y="${f1(m[1]-17)}" width="29" height="22" rx="3" fill="#434343"/><rect x="${f1(m[0]-10)}" y="${f1(m[1]-14)}" width="23" height="16" rx="1" fill="#777"/><path d="M${f1(m[0]-6)},${f1(m[1]-9)}h14m-14 5h8" stroke="#fff" opacity=".8" stroke-width="2"/>`}
 if(f.kind==='board')return sBox(f.x,f.y,f.w,f.d,f.h,'#efefef','#cfcfcf','#dcdcdc')+tiles(f);
 if(f.kind==='table')return sBox(f.x,f.y,f.w,f.d,f.h,'#f6f6f6','#bdbdbd','#cdcdcd');
 if(f.kind==='counter'){const m=project(f.x+1.2,f.y+.4,f.h+8);return sBox(f.x,f.y,f.w,f.d,f.h,'#f1f1f1','#b7b7b7','#c7c7c7')+sBox(f.x+.9,f.y+.1,.8,.5,18,'#474747','#353535','#3d3d3d')+`<rect x="${f1(m[0]+8)}" y="${f1(m[1]+6)}" width="8" height="11" rx="2" fill="#eee"/>`}
 if(f.kind==='armchair')return sBox(f.x,f.y,f.w,f.d,f.h*.6,'#aaaaaa','#909090','#9a9a9a')+sBox(f.x,f.y,f.w,.3,f.h,'#c5c5c5','#989898','#a8a8a8');
 if(f.kind==='plant'){const p=project(f.x+.2,f.y+.2,17);return sBox(f.x,f.y,.5,.5,17,'#f7f7f7','#bcbcbc')+`<path d="M${f1(p[0])},${f1(p[1])}v-26" stroke="#676767" stroke-width="3"/><ellipse cx="${f1(p[0]-7)}" cy="${f1(p[1]-15)}" rx="7" ry="12" fill="#888" transform="rotate(-30 ${f1(p[0]-7)} ${f1(p[1]-15)})"/><ellipse cx="${f1(p[0]+7)}" cy="${f1(p[1]-25)}" rx="8" ry="14" fill="#a2a2a2" transform="rotate(25 ${f1(p[0]+7)} ${f1(p[1]-25)})"/>`}
 return '';
}
function tiles(f){const p=project(f.x+f.w/2,f.y+f.d+.02,f.h*.62),n=Math.max(3,Math.round(f.w*2)),w=f.w*OL.sx*.9/n;return Array.from({length:n},(_,i)=>`<rect x="${f1(p[0]-f.w*OL.sx*.45+i*w+w*.12)}" y="${f1(p[1]-14+i*0)}" width="${f1(w*.76)}" height="12" rx="1" fill="${i%2?'#777':'#d4d4d4'}" opacity=".9"/>`).join('')}
function roomSvg(room){
 const d=roomDoor(room),g0=d.x-d.w/2,g1=d.x+d.w/2,fy=room.y+room.d,rx=room.x+room.w,tone=FLOOR_TONE[room.id]||'#dcdcdc';
 const label=dept(room.id).name,p=project(room.x+.5,room.y+.14,12);
 return `<g class="room" data-room-group="${room.id}">`
  +sFloor(room.x+.1,room.y+.1,room.w-.2,room.d-.2,tone,'room-floor room-hit',tr`data-room="${room.id}" tabindex="0" role="button" aria-label="Открыть ${esc(label)}"`)
  +sBox(room.x,room.y,room.w,.12,OL.wall,'#f8f8f8','#bfbfbf','#d3d3d3')+sBox(room.x,room.y,.12,room.d,OL.wall,'#fff','#c8c8c8')
  +room.furniture.map(furnitureSvg).join('')
  // низкие стенки спереди и справа; проём двери виден порогом и опорами
  +sBox(room.x,fy-.06,g0-room.x,.12,OL.curb,'#f4f4f4','#c6c6c6')+sBox(g1,fy-.06,rx-g1,.12,OL.curb,'#f4f4f4','#c6c6c6')+sBox(rx-.06,room.y,.12,room.d,OL.curb,'#f4f4f4','#c6c6c6')
  +sFloor(g0,fy-.14,d.w,.28,'#f2f2f2','door-sill')+sBox(g0-.1,fy-.08,.1,.16,20,'#fff','#b9b9b9')+sBox(g1,fy-.08,.1,.16,20,'#fff','#b9b9b9')
  +`<text class="room-tag" transform="translate(${f1(p[0])},${f1(p[1])}) matrix(1,.537,0,1,0,0)" font-size="11" font-weight="700" fill="#6a6a6a">${esc(label)}</text></g>`;
}
function buildStatic(){
 const W=OL_W,D=OL_D,c=project(W/2,D/2);
 const corr=officeHCorr.map(h=>sFloor(h.x0,h.y0,h.x1-h.x0,h.y1-h.y0,'#ececec','corridor')+`<path d="M${pp([[h.x0+.3,h.cy,0]])}L${pp([[h.x1-.3,h.cy,0]])}" stroke="#00000014" stroke-dasharray="6 7" fill="none"/>`).join('')+officeVCorr.map(v=>sFloor(v.x0,v.y0,v.x1-v.x0,v.y1-v.y0,'#ececec','corridor')+`<path d="M${pp([[v.cx,v.y0+.3,0]])}L${pp([[v.cx,v.y1-.3,0]])}" stroke="#00000014" stroke-dasharray="6 7" fill="none"/>`).join('');
 const rooms=officeRooms.map(r=>{r.furniture=officeFurniture.filter(f=>f.room===r.id);return roomSvg(r)}).join('');
 return `<g class="golden-gate" transform="translate(${f1(OFFICE_WORLD.w/2-725)},0)">${bridge()}</g><ellipse cx="${f1(c[0])}" cy="${f1(c[1]+40)}" rx="${f1((W+D)*OL.sx*.46)}" ry="${f1((W+D)*OL.sy*.38)}" fill="#616161" opacity=".13" filter="url(#shadow)"/>`+sBox(0,0,W,D,10,'#c8c8c8','#acacac','#bbbbbb')+corr+rooms;
}
function buildScene(){
 const svg=$('#world');
 // окно с Golden Gate нарисовано под прежние координаты (центр 725): сдвигаем его в центр мира, офис — в собственной проекции
 const stat=buildStatic();svg.innerHTML=`<rect width="${OFFICE_WORLD.w}" height="${OFFICE_WORLD.h}" fill="#e4e4e4"/><g id="scene-static">${stat}</g><g id="selection"><polygon id="selRoom" fill="none" stroke="#757575" stroke-width="3" stroke-dasharray="7 5" display="none"/></g><g id="steps" pointer-events="none"></g><g id="hotspots"></g><g id="agents"></g><g id="callout" pointer-events="none"></g>`;
 SC.built=true;SC.agents={};SC.pills={};SC.layout={};SC.steps=[];SC.calloutKey='';
}

// ---- Персонажи ----
function iconGlyph(kind){
 const s='stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"';
 return {work:`<circle class="dot d1" cx="-5" r="1.8" fill="#fff"/><circle class="dot d2" cx="0" r="1.8" fill="#fff"/><circle class="dot d3" cx="5" r="1.8" fill="#fff"/>`,
  help:'<text y="4.5" text-anchor="middle" font-size="14" font-weight="800" fill="#fff">?</text>',alert:'<text y="4.5" text-anchor="middle" font-size="14" font-weight="800" fill="#fff">!</text>',
  wait:`<path d="M-4,-5h8l-4,5l4,5h-8l4,-5z" ${s}/>`,break:`<path d="M-5,-3h8v6a3,3 0 0 1-3,3h-2a3,3 0 0 1-3-3z M3,-1h2a2,2 0 0 1 0,4h-2" ${s}/>`,
  inspect:`<rect x="-5" y="-5" width="10" height="9" rx="1" ${s}/><path d="M-2.5,-2h5M-2.5,1h3" ${s}/>`,off:`<circle r="5" ${s}/><path d="M-3.5,3.5L3.5,-3.5" ${s}/>`,dot:'<circle r="3.2" fill="none" stroke="#fff" stroke-width="1.6"/>'}[kind]||'';
}
function ensureAgent(p){
 let a=SC.agents[p.id];if(a)return a;
 const g=document.createElementNS('http://www.w3.org/2000/svg','g');g.setAttribute('class','agent-hit');g.dataset.person=p.id;g.setAttribute('tabindex','0');g.setAttribute('role','button');
 g.innerHTML=`<ellipse class="halo" cx="0" cy="3" rx="26" ry="11" fill="none" stroke="#444" stroke-width="3"/><ellipse class="agent-ground" cx="0" cy="2" rx="22" ry="7" fill="#000" opacity=".1"/><g class="agent-bob"><g class="agent-breath"><image href="${esc(p.img)}" x="${-AV.w/2}" y="${-(AV.h-4)}" width="${AV.w}" height="${AV.h}" preserveAspectRatio="xMidYMax meet"/></g></g><g class="agent-name"><rect x="${-AV.nameHalf}" y="${AV.nameTop}" width="${AV.nameHalf*2}" height="${AV.nameBottom-AV.nameTop}" rx="7" fill="#fcfcfc" stroke="#00000018"/><circle class="presence" cx="${-AV.nameHalf+10}" cy="${(AV.nameTop+AV.nameBottom)/2}" r="2.6"/><text x="4" y="${AV.nameBottom-6}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#3c3c3c">${esc(p.name)}</text></g><g class="agent-icon" display="none" transform="translate(${AV.iconDx},${AV.iconDy})"><circle r="${AV.iconR}" fill="#202020"/><g class="glyph"></g><title></title></g><rect class="agent-hitbox" x="-34" y="${-AV.headTop-2}" width="68" height="${AV.headTop+AV.nameBottom+4}" fill="transparent"/>`;
 $('#agents').appendChild(g);
 a={g,bob:g.querySelector('.agent-bob'),icon:g.querySelector('.agent-icon'),glyph:g.querySelector('.glyph'),title:g.querySelector('.agent-icon title'),fx:NaN,fy:NaN,depth:0,moving:false,step:0,kind:''};
 SC.agents[p.id]=a;return a;
}
function paintAgent(p,b){
 const a=ensureAgent(p);
 if(a.kind!==b.kind){a.kind=b.kind;a.g.dataset.state=b.kind;a.g.classList.toggle('inactive',b.kind==='inactive');a.g.classList.toggle('static',!!b.static);a.glyph.innerHTML=iconGlyph(b.icon);a.icon.setAttribute('display',b.icon?'':'none');a.icon.dataset.icon=b.icon}
 a.title.textContent=b.label+(b.detail?'. '+b.detail:'');
 a.g.setAttribute('aria-label',`${p.name}: ${b.label}`);
 a.g.classList.toggle('selected',selection.type==='person'&&selection.id===p.id);
}
// ---- Плашки комнат ----
function pillDefs(){const defs=[];for(const r of officeRooms){const kinds=PILL_DEFS[r.id]||['queue'];kinds.forEach((k,i)=>defs.push({id:r.id+':'+k,room:r.id,kind:k,priority:i,w:pillWidth(hotMeta[k][1])}))}return defs}
function ensurePills(){
 if(Object.keys(SC.pills).length)return;
 const layer=$('#hotspots');
 for(const d of pillDefs()){
  const g=document.createElementNS('http://www.w3.org/2000/svg','g'),[ic,label]=hotMeta[d.kind],w=d.w;
  g.setAttribute('class','hotspot');g.dataset.hot=d.kind;g.dataset.room=d.room;g.setAttribute('tabindex','0');g.setAttribute('role','button');
  g.innerHTML=`<title></title><rect class="pill-bg" x="${-w/2}" y="${-PILL_H/2}" width="${w}" height="${PILL_H}" rx="12"/><text class="hot-ico" x="${-w/2+13}" y="4">${ic}</text><text class="hot-label" x="${-w/2+26}" y="4">${label}</text><circle class="hot-badge" cx="${w/2-12}" cy="0" r="9"/><text class="hot-n" x="${w/2-12}" y="3.5" text-anchor="middle"></text>`;
  layer.appendChild(g);SC.pills[d.id]={g,def:d,bg:g.querySelector('.pill-bg'),label:g.querySelector('.hot-label'),ico:g.querySelector('.hot-ico'),badge:g.querySelector('.hot-badge'),n:g.querySelector('.hot-n'),title:g.querySelector('title'),mode:'',slot:-1,count:-1};
 }
}
function updatePillCounts(){
 for(const [id,p] of Object.entries(SC.pills)){const n=hotCount(p.def.kind,p.def.room);const [,label]=hotMeta[p.def.kind];if(p.count!==n){p.count=n;p.n.textContent=n||'';p.badge.setAttribute('display',n?'':'none');p.n.setAttribute('display',n?'':'none');p.title.textContent=`${label}: ${dept(p.def.room).name}${n?' · '+n:''}`;p.g.setAttribute('aria-label',p.title.textContent)}}
}
function avatarFeet(){return Object.entries(SC.agents).filter(([,a])=>Number.isFinite(a.fx)).map(([id,a])=>({id,fx:a.fx,fy:a.fy}))}
// Раскладка плашек с учётом положения всех персонажей; DOM трогаем только при изменениях.
function relayoutPills(){
 const lay=layoutPills(Object.values(SC.pills).map(p=>p.def),avatarFeet(),SC.layout);SC.layout=lay;
 for(const [id,p] of Object.entries(SC.pills)){
  const l=lay[id];if(p.mode===l.mode&&p.slot===l.slot&&p.cx===l.cx&&p.cy===l.cy)continue;
  p.mode=l.mode;p.slot=l.slot;p.cx=l.cx;p.cy=l.cy;
  if(l.mode==='hidden'){p.g.setAttribute('display','none');p.g.setAttribute('aria-hidden','true');p.g.dataset.collapsed='hidden';continue}
  p.g.removeAttribute('display');p.g.removeAttribute('aria-hidden');p.g.setAttribute('transform',`translate(${f1(l.cx)},${f1(l.cy)})`);p.g.dataset.collapsed=l.mode==='compact'?'compact':'';
  const full=l.mode==='full',w=full?p.def.w:PILL_COMPACT;p.bg.setAttribute('x',-w/2);p.bg.setAttribute('width',w);p.label.setAttribute('display',full?'':'none');p.ico.setAttribute('x',full?-w/2+13:0);p.ico.setAttribute('text-anchor',full?'start':'middle');
  p.badge.setAttribute('cx',full?w/2-12:w/2-3);p.badge.setAttribute('cy',full?0:-w/2+3);p.badge.setAttribute('r',full?9:6);p.n.setAttribute('x',full?w/2-12:w/2-3);p.n.setAttribute('y',full?3.5:-w/2+6);p.n.setAttribute('font-size',full?9:7);
 }
}
// ---- Подсказка у выбранного персонажа: короткое объяснение, не перекрывающее ни одного персонажа ----
function updateCallout(){
 const layer=$('#callout');if(!layer)return;
 const sel=selection.type==='person'?SC.agents[selection.id]:null,b=sel&&SC.behaviors[selection.id];
 if(!sel||!b||sel.moving||!Number.isFinite(sel.fx)||!b.label){if(SC.calloutKey){layer.innerHTML='';SC.calloutKey=''}return}
 const lines=wrapLines(b.detail&&b.kind!=='idle'?b.detail:'',34).slice(0,2),title=clipText(b.label,38),w=Math.min(250,Math.max(title.length*6.4,...lines.map(l=>l.length*5.8))+24),h=22+lines.length*14;
 // подсказка не закрывает ни персонажей, ни видимые плашки комнат: если места нет, объяснение остаётся в панели
 const solids=[...avatarFeet().flatMap(a=>avatarSolid(avatarRects(a.fx,a.fy))),...Object.values(SC.layout).filter(l=>l.mode!=='hidden'&&l.rect).map(l=>l.rect)];
 const cands=[{x:sel.fx+AV.iconDx+16,y:sel.fy+AV.iconDy-12},{x:sel.fx-AV.iconDx-16-w,y:sel.fy+AV.iconDy-12},{x:sel.fx+AV.iconDx+16,y:sel.fy-60},{x:sel.fx-AV.iconDx-16-w,y:sel.fy-60},{x:sel.fx-w/2,y:sel.fy-AV.headTop-h-12},{x:sel.fx-w/2,y:sel.fy+AV.nameBottom+10}];
 const pos=cands.find(c=>{const r={x0:c.x,y0:c.y,x1:c.x+w,y1:c.y+h};return r.x0>=4&&r.x1<=OFFICE_WORLD.w-4&&r.y0>=4&&!solids.some(s=>hit(r,s,4))});
 const key=selection.id+'|'+b.key+'|'+(pos?f1(pos.x)+','+f1(pos.y):'-');if(key===SC.calloutKey)return;SC.calloutKey=key;
 layer.innerHTML=pos?`<g class="callout-box" transform="translate(${f1(pos.x)},${f1(pos.y)})"><rect width="${f1(w)}" height="${h}" rx="9"/><text x="12" y="16" class="callout-title">${esc(title)}</text>${lines.map((l,i)=>`<text x="12" y="${30+i*14}" class="callout-line">${esc(l)}</text>`).join('')}</g>`:'';
}
function wrapLines(text,max){const words=String(text||'').split(/\s+/).filter(Boolean),out=[];let cur='';for(const w of words){if((cur+' '+w).trim().length>max&&cur){out.push(cur);cur=w}else cur=(cur+' '+w).trim()}if(cur)out.push(cur);return out}

// ---- Кадр: положение, шаги, глубина, плашки ----
function frame(){
 SC.raf=0;const now=performance.now();let moving=false,moved=false;
 for(const id of SC.tracker.ids()){
  const a=SC.agents[id];if(!a)continue;
  const p=SC.tracker.position(id,now),[fx,fy]=project(p.x,p.y);
  if(a.fx!==fx||a.fy!==fy){a.fx=fx;a.fy=fy;a.depth=p.x+p.y;a.g.setAttribute('transform',`translate(${f1(fx)},${f1(fy)})`);moved=true}
  a.moving=p.moving;
  if(p.moving&&!SC.reduced.matches){moving=true;a.bob.setAttribute('transform',`translate(0,${f1(-Math.abs(Math.sin(p.dist*2.5))*3.2)})`);a.bobbing=true;const k=Math.floor(p.dist/.9);if(k!==a.step){a.step=k;addStep(p,k)}}
  else if(a.bobbing){a.bob.removeAttribute('transform');a.bobbing=false}
 }
 if(moved){sortDepth();relayoutPills()}
 pruneSteps(now);updateCallout();
 if(moving||SC.steps.length)startLoop();
}
function startLoop(){if(!SC.raf&&!document.hidden)SC.raf=requestAnimationFrame(frame)}
function sortDepth(){
 const order=Object.entries(SC.agents).sort((a,b)=>a[1].depth-b[1].depth||(a[0]<b[0]?-1:1)).map(([id])=>id),key=order.join();
 if(key===SC.depthKey)return;SC.depthKey=key;const layer=$('#agents');for(const id of order)layer.appendChild(SC.agents[id].g); // перестановка только при смене порядка
}
function addStep(p,k){
 const layer=$('#steps');if(!layer)return;const side=k%2?.18:-.18,q=project(p.x+side,p.y-side),e=document.createElementNS('http://www.w3.org/2000/svg','ellipse');
 e.setAttribute('class','step');e.setAttribute('cx',f1(q[0]));e.setAttribute('cy',f1(q[1]+2));e.setAttribute('rx','4');e.setAttribute('ry','1.8');layer.appendChild(e);SC.steps.push({e,t:performance.now()});
 while(SC.steps.length>14)SC.steps.shift().e.remove();
}
function pruneSteps(now){while(SC.steps.length&&now-SC.steps[0].t>1100)SC.steps.shift().e.remove()}
function clearSteps(){for(const s of SC.steps)s.e.remove();SC.steps=[]}

// ---- Синхронизация с состоянием ----
function sceneSnapshot(){return {now:Date.now(),tasks:state.tasks,helps:state.helps||[],reflections:state.reflections||[],activity:state.activity||[],phase:state.phase,dispatch:state.dispatch||{},supervision:state.supervision||{}}}
function syncBehaviors(){
 if(!SC.tracker)SC.tracker=createTracker({storage:(()=>{try{return sessionStorage}catch{return null}})(),reduced:()=>SC.reduced.matches});
 const snap=sceneSnapshot(),readyIds=state.people.filter(p=>p.ready&&p.engine!==tr('Человек')).map(p=>p.id);
 // одноразовое событие: новая задача в очереди. Первая синхронизация только запоминает уже существующие задачи.
 const fresh=SC.tracker.newQueued(state.tasks,readyIds,!SC.baselined);
 for(const t of fresh){SC.inspect[t.owner]={taskId:t.id,until:Date.now()+INSPECT_MS};const id=setTimeout(()=>{SC.timers.delete(id);if(state)drawWorld()},INSPECT_MS+80);SC.timers.add(id)}
 for(const [id,i] of Object.entries(SC.inspect))if(i.until<=Date.now())delete SC.inspect[id];
 const behaviors=allBehaviors(state.people,snap,{inspect:SC.inspect});SC.behaviors=behaviors;
 SC.tracker.sync(behaviors,performance.now());SC.baselined=true;
 for(const p of state.people)paintAgent(p,behaviors[p.id]);
 for(const [id] of Object.entries(SC.agents))if(!state.people.some(p=>p.id===id)){SC.agents[id].g.remove();delete SC.agents[id]}
}
function renderSelection(){
 const poly=$('#selRoom');if(!poly)return;
 if(selection.type==='room'){const r=officeRoom(selection.id);poly.setAttribute('points',pp([[r.x+.2,r.y+.2,0],[r.x+r.w-.2,r.y+.2,0],[r.x+r.w-.2,r.y+r.d-.2,0],[r.x+.2,r.y+r.d-.2,0]]));poly.removeAttribute('display')}else poly.setAttribute('display','none');
 for(const [id,a] of Object.entries(SC.agents))a.g.classList.toggle('selected',selection.type==='person'&&selection.id===id);
 for(const g of document.querySelectorAll('#world .room-floor'))g.classList.toggle('active',selection.type==='room'&&g.dataset.room===selection.id);
 SC.calloutKey='';
}
// Вызывается при каждом обновлении состояния и при выборе объекта. Идемпотентна: перерисовка не запускает прогулки заново.
function drawWorld(){
 if(!state)return;
 if(!SC.built)buildScene();
 ensurePills();syncBehaviors();updatePillCounts();renderSelection();setZoom();
 frame();
}
function behaviorOf(id){return SC.behaviors?.[id]||null}
// Жизненный цикл: скрытая вкладка не крутит кадры; при возврате положение берётся по времени (прогулка не «проигрывается» заново).
document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(SC.raf);SC.raf=0}else if(SC.built&&SC.tracker)frame()});
SC.reduced.addEventListener?.('change',()=>{if(SC.reduced.matches){cancelAnimationFrame(SC.raf);SC.raf=0;clearSteps();SC.tracker?.finishAll();if(SC.built)frame()}});
addEventListener('pagehide',()=>{cancelAnimationFrame(SC.raf);SC.raf=0;for(const t of SC.timers)clearTimeout(t);SC.timers.clear();clearSteps()});
// Только для локальной проверки (localhost): доступ к состоянию сцены без изменения поведения.
if(isLocalPreview())window.__bo={get SC(){return SC},project};
