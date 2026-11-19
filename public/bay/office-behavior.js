// office-behavior.js: поведение персонажей v11 — чистые функции без DOM. Положение и движение выводятся только из реального состояния
// (/api/v2/state): ничего не изображает работу, переписку или присутствие, которых нет. Зависит от office-layout.js.
const BEHAVIOR_ICONS={work:'work',help:'help',reflection:'alert',review:'wait',break:'break',inspect:'inspect',inactive:'off',presence_unconfirmed:'dot',recent_activity:'dot',idle:''};
const HELP_LIVE=['open','waiting_connection','answered','escalated'];
const HELP_WAITING=['open','waiting_connection','escalated']; // «ответил коллега» — агент уже ничего не ждёт
const RECENT_MS=15*60*1000, INSPECT_MS=6000, WALK_SPEED=3.1, MAX_WALK_SECONDS=12;
const clipText=(s,n)=>{s=String(s??'').replace(/\s+/g,' ').trim();return s.length>n?s.slice(0,n-1)+'…':s};
const deptBoardRoom=dept=>officeStations[dept]?.board?dept:'commons';

// Поведение человека или агента из состояния. snap: {tasks,helps,reflections,activity,phase,now}; opts.inspect: {taskId,until}.
function deriveBehavior(person,snap,opts={}){
 const id=person.id,now=snap.now??Date.now(),home=OFFICE_HOME[id]||{room:'commons',slot:0};
 const mk=(kind,station,label,detail,extra={})=>({id,kind,station,icon:BEHAVIOR_ICONS[kind]??'',label,detail:detail||'',key:kind+':'+station.room+':'+station.kind+(extra.ref?':'+extra.ref:''),static:!!extra.static,...extra});
 const homeSt={kind:'home',room:home.room};
 const human=person.engine===tr('Человек');
 if(human){
  // Люди: присутствие не подтверждено, пока у них нет реального действия в журнале офиса (не старше 15 минут).
  const last=(snap.activity||[]).filter(a=>a.actor===id).sort((a,b)=>Date.parse(b.created)-Date.parse(a.created))[0];
  if(last&&now-Date.parse(last.created)<RECENT_MS&&officeStations[last.room]){
   const mins=Math.max(0,Math.round((now-Date.parse(last.created))/60000));
   return mk('recent_activity',{kind:'visit',room:last.room},tr('Недавнее действие: ')+clipText(last.title,48),tr`Журнал офиса: действие ${mins} мин назад. Это подтверждённая активность, а не присутствие.`,{ref:last.id});
  }
  return mk('presence_unconfirmed',homeSt,tr('Присутствие не подтверждено'),tr('Положение у рабочего места условное: офис не знает, на месте ли человек.'),{static:true});
 }
 if(!person.ready)return mk('inactive',homeSt,tr('Не подключён'),tr('Рабочее место пустует: исполнитель не подключён, работа не имитируется.'),{static:true});
 const mine=(snap.tasks||[]).filter(t=>t.owner===id&&t.status!=='accepted');
 const running=mine.find(t=>t.status==='running');
 if(running)return mk('work',homeSt,tr('Работает: ')+clipText(running.title,44),tr('Задача выполняется (запуск идёт, квитанция ещё не получена).'),{ref:running.id});
 const reflection=(snap.reflections||[]).find(r=>r.actor===id&&r.status==='open'),repeated=mine.find(t=>t.status==='blocked'&&t.attempts>=2);
 if(reflection||repeated)return mk('reflection',{kind:'reflection',room:'review'},tr('Разбор: повторный блок'),clipText(reflection?.reason||repeated?.blocked_reason||tr('Повторные неудачи по задаче: нужен разбор с владельцем'),160),{ref:reflection?.id||repeated?.id});
 // Ход владельца (результат на проверке или шаг цикла сопровождения) важнее старых вопросов коллегам: агент ждёт человека.
 const sup=snap.supervision||{},ownerTurn=t=>t.status==='review'||(sup[t.id]&&sup[t.id].enabled!==0&&sup[t.id].turn==='owner');
 const waiting=mine.find(ownerTurn);
 if(waiting){const d=snap.dispatch?.[waiting.id],next=d?.next?.label||d?.next_control;return mk('review',{kind:'review',room:'review'},tr('Ждёт решения владельца'),clipText(next||tr('Результат передан на проверку: следующий шаг за человеком.'),160),{ref:waiting.id})}
 const blocked=mine.find(t=>t.status==='blocked');
 const liveHelp=(snap.helps||[]).find(h=>{if(h.requester!==id||!HELP_WAITING.includes(h.status))return false;const t=mine.find(x=>x.id===h.task_id);return !!t&&!['running','review'].includes(t.status)&&!ownerTurn(t)});
 if(blocked||liveHelp){
  const t=blocked||mine.find(x=>x.id===liveHelp.task_id);
  return mk('help',{kind:'help',room:'commons'},blocked?tr('Не хватает информации: ')+clipText(blocked.blocked_reason||blocked.title,50):tr('Ждёт ответа коллеги'),clipText(liveHelp?.question||blocked?.blocked_reason||tr('Нужна помощь по задаче'),160),{ref:(blocked||liveHelp).id,taskId:t?.id});
 }
 if(snap.phase==='break')return mk('break',{kind:'break',room:'kitchen'},tr('Перерыв по расписанию'),tr('Фактическая кофейная пауза офиса: новые задачи не выдаются.'));
 if(opts.inspect&&opts.inspect.until>now){
  const t=(snap.tasks||[]).find(x=>x.id===opts.inspect.taskId);
  if(t&&t.status==='queued')return mk('inspect',{kind:'board',room:deptBoardRoom(t.department)},tr('Смотрит новую задачу на доске'),clipText(t.title,100),{ref:t.id});
 }
 return mk('idle',homeSt,tr('Свободен'),tr('Очередь агента пуста или ждёт условий запуска.'),{static:false});
}
// Целевые точки. Места распределяются между ВСЕМИ обитателями комнаты (дом, гость, помощь, доска): сначала те, кто стоит у своего стола,
// затем остальные по id. Каждому выбирается первое место (слот станции, затем запасные точки комнаты), чей прямоугольник на экране
// (голова…табличка имени) не пересекает уже занятые. Запасные точки лежат вне мебели, и путь к ним идёт по проходу.
const OCC_PAD=6;
const occRect=p=>{const [fx,fy]=project(p.x,p.y);return rectOf(fx-AV.nameHalf,fy-AV.headTop,fx+AV.nameHalf,fy+AV.nameBottom)};
function overflowPoints(roomId){
 const r=officeRoom(roomId),ay=aisleY(r),vs=[3,ay-r.y-.7,ay-r.y],pts=[];
 for(const v of vs)for(let u=1;u<=7.4;u+=.6){const p={room:roomId,x:r.x+u,y:r.y+v};
  const clear=sampleRoute([{x:p.x,y:p.y},{x:p.x,y:Math.max(p.y,ay)}],.2).every(walkable);if(walkable(p)&&clear&&p.y<=ay+1e-9)pts.push(p)}
 return pts;
}
const overflowCache={};
// Очередь в коридоре у двери своей комнаты: запасные места, когда в комнате не осталось свободных точек.
function queuePoints(roomId){const r=officeRoom(roomId),h=officeHCorr[r.row],d=roomDoor(r),pts=[];for(let k=0;k<=24;k++)for(const sgn of k?[1,-1]:[1]){const x=d.x+sgn*k*1.2;if(x>=h.x0+.6&&x<=h.x1-.6)pts.push({room:null,x,y:h.cy})}return pts}
function assignTargets(behaviors){
 const list=Object.values(behaviors),placed=[];
 const homeOf=b=>{const h=OFFICE_HOME[b.id]||{slot:0,room:'commons'};return stationPoint('home',b.station.room,b.station.room===h.room?h.slot:0)};
 const order=[...list.filter(b=>b.station.kind==='home').sort((a,b)=>a.id<b.id?-1:1),...list.filter(b=>b.station.kind!=='home').sort((a,b)=>a.id<b.id?-1:1)];
 for(const b of order){
  const room=b.station.room,slots=b.station.kind==='home'?[homeOf(b)]:(officeStations[room]?.[b.station.kind]||[]);
  const base=slots[0]||homeOf(b)||stationPoint('home',OFFICE_HOME[b.id]?.room||'commons',OFFICE_HOME[b.id]?.slot||0);
  const extra=(overflowCache[room]||(overflowCache[room]=overflowPoints(room))).slice().sort((p,q)=>Math.hypot(p.x-base.x,p.y-base.y)-Math.hypot(q.x-base.x,q.y-base.y));
  const cands=[...slots,...extra,...queuePoints(room)].filter(Boolean);
  const free=p=>!placed.some(q=>hit(occRect(p),occRect(q),OCC_PAD));
  b.target=cands.find(free)||cands[0]||base;
  placed.push(b.target);
 }
 return behaviors;
}
const allBehaviors=(people,snap,opts={})=>assignTargets(Object.fromEntries(people.map(p=>[p.id,deriveBehavior(p,snap,{inspect:opts.inspect?.[p.id]})])));

// ---- Трекер: идемпотентные переходы, плавное перепланирование, без повторов ----
function createTracker({storage=null,reduced=()=>false,speed=WALK_SPEED}={}){
 const cur={},seen=new Set(),KEY='bo-office-v11';
 try{const raw=storage?.getItem(KEY);if(raw){const o=JSON.parse(raw);for(const t of o.seen||[])seen.add(t)}}catch{}
 const save=()=>{try{storage?.setItem(KEY,JSON.stringify({seen:[...seen].slice(-300),pos:Object.fromEntries(Object.entries(cur).map(([k,v])=>[k,{key:v.key,x:v.x,y:v.y}]))}))}catch{}};
 const journeyPos=(j,now)=>{const d=Math.max(0,(now-j.t0)/1000*j.speed);if(d>=j.len)return {x:j.pts.at(-1).x,y:j.pts.at(-1).y,done:true,dist:j.len};let acc=0;for(let i=1;i<j.pts.length;i++){const a=j.pts[i-1],b=j.pts[i],l=Math.hypot(b.x-a.x,b.y-a.y);if(d<=acc+l){const k=l?(d-acc)/l:0;return {x:a.x+(b.x-a.x)*k,y:a.y+(b.y-a.y)*k,done:false,dist:d}}acc+=l}return {x:j.pts.at(-1).x,y:j.pts.at(-1).y,done:true,dist:j.len}};
 const position=(id,now)=>{const s=cur[id];if(!s)return null;if(!s.journey)return {x:s.x,y:s.y,moving:false,dist:0};const p=journeyPos(s.journey,now);if(p.done){s.x=p.x;s.y=p.y;s.journey=null;return {x:s.x,y:s.y,moving:false,dist:0,arrived:true}}return {x:p.x,y:p.y,moving:true,dist:p.dist}};
 return {
  // Приводит положения к поведению. Возвращает события: snap (первое появление, перезагрузка, reduced motion), walk, retarget, noop.
  sync(behaviors,now){
   const events=[];
   for(const b of Object.values(behaviors)){
    const s=cur[b.id];
    if(!s){cur[b.id]={key:b.key,x:b.target.x,y:b.target.y,journey:null,target:b.target};events.push({id:b.id,type:'snap'});continue}
    const moved=s.target&&(Math.abs(s.target.x-b.target.x)>.01||Math.abs(s.target.y-b.target.y)>.01);
    if(s.key===b.key&&!moved){s.label=b.label;events.push({id:b.id,type:'noop'});continue}
    const here=position(b.id,now),wasMoving=!!s.journey;
    const route=reduced()?null:planRoute(here,b.target);
    s.key=b.key;s.target=b.target;
    if(!route||routeLength(route)<.05){s.x=b.target.x;s.y=b.target.y;s.journey=null;events.push({id:b.id,type:'snap'});continue}
    const len=routeLength(route),sp=Math.max(speed,len/MAX_WALK_SECONDS);
    s.x=here.x;s.y=here.y;s.journey={pts:route,len,speed:sp,t0:now};events.push({id:b.id,type:wasMoving?'retarget':'walk',length:len});
   }
   save();return events;
  },
  position,
  // Reduced motion включили на ходу: все прогулки завершаются мгновенно.
  finishAll(){for(const s of Object.values(cur))if(s.journey){s.x=s.journey.pts.at(-1).x;s.y=s.journey.pts.at(-1).y;s.journey=null}save()},
  anyMoving(now){return Object.keys(cur).some(id=>position(id,now)?.moving)},
  ids(){return Object.keys(cur)},
  state(){return cur},
  // Новые задачи в очереди: каждая сообщается один раз за сессию; первый вызов (baseline) только запоминает существующие.
  newQueued(tasks,readyIds,baseline){
   const fresh=[];
   for(const t of tasks||[]){if(t.status!=='queued'||seen.has(t.id))continue;seen.add(t.id);if(!baseline&&readyIds.includes(t.owner))fresh.push(t)}
   if(baseline||fresh.length)save();return fresh;
  },
  hasSeen:id=>seen.has(id)
 };
}

// ---- Геометрия подписей: тело, голова, имя под ногами, значок состояния вне головы ----
const AV={w:115,h:118,bodyHalf:29,headHalf:27,headTop:116,headBottom:78,bodyBottom:2,nameHalf:38,nameTop:6,nameBottom:26,iconR:12,iconDx:44,iconDy:-103};
const rectOf=(x0,y0,x1,y1)=>({x0,y0,x1,y1});
function avatarRects(fx,fy){
 return {
  head:rectOf(fx-AV.headHalf,fy-AV.headTop,fx+AV.headHalf,fy-AV.headBottom),
  body:rectOf(fx-AV.bodyHalf,fy-AV.headBottom,fx+AV.bodyHalf,fy+AV.bodyBottom),
  name:rectOf(fx-AV.nameHalf,fy+AV.nameTop,fx+AV.nameHalf,fy+AV.nameBottom),
  icon:rectOf(fx+AV.iconDx-AV.iconR,fy+AV.iconDy-AV.iconR,fx+AV.iconDx+AV.iconR,fy+AV.iconDy+AV.iconR)
 };
}
const hit=(a,b,m=0)=>a.x0<b.x1+m&&a.x1>b.x0-m&&a.y0<b.y1+m&&a.y1>b.y0-m;
const avatarSolid=r=>[r.head,r.body,r.name]; // то, что нельзя перекрывать подписями комнат; значок — отдельный элемент персонажа

// ---- Раскладка плашек комнат: не перекрывают персонажей, при тесноте сжимаются и скрываются ----
const PILL_H=24,PILL_COMPACT=24;
const PILL_SLOTS=[['front-left',1.3,5.45,0],['front-mid',3.6,5.55,0],['back-left',1.6,.3,44],['back-mid',4.2,.3,48],['left-wall',.3,3.2,40],['back-right',6.8,.3,48],['front-right',7.3,5.45,0]];
const pillWidth=label=>Math.round(54+label.length*6.2); // значок слева, подпись, место под счётчик справа
function slotCenter(room,slot){const [,u,v,z]=PILL_SLOTS[slot],p=project(room.x+u,room.y+v,z);return {x:p[0],y:p[1]}}
const pillRect=(c,w,h=PILL_H)=>rectOf(c.x-w/2,c.y-h/2,c.x+w/2,c.y+h/2);
// pills: [{id,room,w,priority}] (меньше priority — важнее); avatars: [{id,fx,fy}]; prev: {pillId:{slot}} для гистерезиса.
function layoutPills(pills,avatars,prev={}){
 const solids=avatars.flatMap(a=>avatarSolid(avatarRects(a.fx,a.fy))),out={},placed=[];
 for(const p of [...pills].sort((a,b)=>a.priority-b.priority)){
  const room=officeRoom(p.room);let done=null;
  const order=[...PILL_SLOTS.keys()],pv=prev[p.id]?.slot;if(pv!=null){order.splice(order.indexOf(pv),1);order.unshift(pv)}
  for(const mode of ['full','compact']){
   const w=mode==='full'?p.w:PILL_COMPACT;
   for(const slot of order){const c=slotCenter(room,slot),r=pillRect(c,w,mode==='full'?PILL_H:PILL_COMPACT);if(solids.some(s=>hit(r,s,3))||placed.some(q=>hit(r,q,3)))continue;done={mode,slot,cx:c.x,cy:c.y,w,h:mode==='full'?PILL_H:PILL_COMPACT,rect:r};break}
   if(done)break;
  }
  if(!done)done={mode:'hidden',slot:pv??0,cx:0,cy:0,w:0,h:0,rect:null};
  else placed.push(done.rect);
  out[p.id]=done;
 }
 return out;
}
// Объяснение положения для панели: короткий текст и источник в данных офиса.
const behaviorSources={work:tr('задача агента в статусе «В работе»'),help:tr('заблокированная задача или открытый вопрос коллеге'),reflection:tr('открытая рефлексия или повторный блок'),review:tr('результат агента ждёт решения человека'),break:tr('фактическая пауза по расписанию офиса'),inspect:tr('новая задача в очереди (одноразово)'),inactive:tr('агент не подключён'),presence_unconfirmed:tr('нет подтверждённой активности'),recent_activity:tr('запись в журнале офиса'),idle:tr('нет активных условий')};
const describeBehavior=b=>b?{title:b.label,detail:b.detail,source:tr('Основание: ')+(behaviorSources[b.kind]||tr('состояние офиса'))}:null;
