// office-layout.js: геометрия офиса v11 (чистые данные и функции, без DOM). Единицы — «метры» плана; проекция изометрическая.
// Комнаты 8×6 с коридорами шириной 1,6 между ними; у каждой комнаты одна дверь в южной стенке, выходящая в горизонтальный коридор.
// Мебель, станции (рабочие места, доска, стол помощи, зона ревью, кресло разбора, кухня) и граф маршрутов лежат здесь;
// движение и столкновения проверяются тестами (office-layout.test.mjs). Подключается перед office2.js.
const OFFICE_WORLD={w:1500,h:1000};
const OL={sx:27,sy:14.5,zs:.8,roomW:8,roomD:6,gap:1.6,mx:.8,top:.8,bottom:.4,wall:30,curb:7,doorU:6.2,doorW:1.3,body:.3};
const OL_GRID=[['commons','sales','finance'],['product','hr','lab'],['kitchen','review','life']];
const OL_W=OL.mx*2+3*OL.roomW+2*OL.gap, OL_D=OL.top+3*OL.roomD+3*OL.gap+OL.bottom;
const OL_OX=OFFICE_WORLD.w/2-(OL_W-OL_D)*OL.sx/2, OL_OY=212;
const project=(x,y,z=0)=>[OL_OX+(x-y)*OL.sx, OL_OY+(x+y)*OL.sy-z*OL.zs];
const pp=arr=>arr.map(v=>project(...v).map(n=>n.toFixed(1)).join(',')).join(' ');

// ---- Комнаты, коридоры, двери ----
const officeRooms=OL_GRID.flatMap((row,r)=>row.map((id,c)=>({id,row:r,col:c,x:OL.mx+c*(OL.roomW+OL.gap),y:OL.top+r*(OL.roomD+OL.gap),w:OL.roomW,d:OL.roomD})));
const roomDefs=officeRooms.map(r=>[r.id,r.x,r.y]); // совместимость со старым интерфейсом
const officeRoom=id=>officeRooms.find(r=>r.id===id)||officeRooms[0];
const roomById=id=>{const r=officeRoom(id);return [r.id,r.x,r.y]};
const hCorr=r=>({id:'H'+r,x0:.4,x1:OL_W-.4,y0:OL.top+(r+1)*OL.roomD+r*OL.gap,y1:OL.top+(r+1)*OL.roomD+(r+1)*OL.gap,cy:OL.top+(r+1)*OL.roomD+r*OL.gap+OL.gap/2});
const vCorr=k=>({id:'V'+k,y0:.4,y1:OL_D-.4,x0:OL.mx+(k+1)*OL.roomW+k*OL.gap,x1:OL.mx+(k+1)*OL.roomW+(k+1)*OL.gap,cx:OL.mx+(k+1)*OL.roomW+k*OL.gap+OL.gap/2});
const officeHCorr=[0,1,2].map(hCorr), officeVCorr=[0,1].map(vCorr);
const roomDoor=room=>({x:room.x+OL.doorU,y:room.y+room.d,w:OL.doorW,out:{x:room.x+OL.doorU,y:hCorr(room.row).cy}});
const aisleYOf={commons:5,kitchen:5};
const aisleY=room=>room.y+(aisleYOf[room.id]||4.3);

// ---- Мебель по типам комнат (локальные координаты u,v от северо-западного угла комнаты) ----
const F=(room,kind,u,v,w,d,h)=>({room:room.id,kind,x:room.x+u,y:room.y+v,w,d,h});
function furnitureOf(room){
 const dept=['sales','finance','product','hr','lab','life'];
 if(dept.includes(room.id))return [F(room,'desk',1,1,2.6,1,26),F(room,'desk',4.4,1,2.6,1,26),F(room,'board',6.9,.25,1,.3,46),F(room,'plant',.4,5,.5,.5,17)];
 if(room.id==='commons')return [F(room,'desk',.8,1.2,2.6,1,26),F(room,'board',2,.25,3,.3,50),F(room,'table',4.6,2,2.2,1.4,24),F(room,'plant',7.2,.4,.5,.5,17)];
 if(room.id==='kitchen')return [F(room,'counter',.8,.3,5.2,.8,28),F(room,'table',2.2,2,2.8,1.4,24),F(room,'plant',7.2,5,.5,.5,17)];
 return [F(room,'desk',.8,1,2.4,1,26),F(room,'armchair',4.6,1.4,1.2,1,22),F(room,'armchair',6.4,1.4,1.2,1,22),F(room,'plant',.4,5,.5,.5,17)]; // review
}
const officeFurniture=officeRooms.flatMap(furnitureOf);
// ---- Станции: места на плане, где агент может быть. Слоты разведены, чтобы агенты не стояли друг в друге ----
const P=(room,u,v)=>({room:room.id,x:room.x+u,y:room.y+v});
function stationsOf(room){
 const s={visit:[P(room,1,aisleY(room)-room.y)]}; // гость: у левого края прохода, не у столов и не у двери
 if(['sales','finance','product','hr','lab','life'].includes(room.id)){s.home=[P(room,2.3,3),P(room,5.7,3)];s.board=[P(room,7.5,1.4),P(room,7.5,2.4)]}
 else if(room.id==='commons'){s.home=[P(room,2.1,3)];s.board=[P(room,3.9,1.2),P(room,3.9,2.4)];s.help=[P(room,5,4),P(room,5.9,4),P(room,6.8,4)]}
 else if(room.id==='kitchen'){s.break=[P(room,2.8,4),P(room,3.7,4),P(room,4.6,4)]}
 else if(room.id==='review'){s.review=[P(room,2,3),P(room,3,3)];s.reflection=[P(room,5.2,3),P(room,7,3)]}
 return s;
}
const officeStations=Object.fromEntries(officeRooms.map(r=>[r.id,stationsOf(r)]));
// Рабочее место человека/агента: комната и слот (по людям; без подтверждённого присутствия никто не «сидит за работой»).
const OFFICE_HOME={serge:{room:'commons',slot:0},dina:{room:'sales',slot:1},teia:{room:'sales',slot:0},mark:{room:'product',slot:0},nora:{room:'hr',slot:0},atlas:{room:'lab',slot:0}};
const stationPoint=(kind,roomId,slot=0)=>{const list=officeStations[roomId]?.[kind]||[];return list[Math.min(slot,list.length-1)]||null};
const homePoint=id=>{const h=OFFICE_HOME[id];return h?stationPoint('home',h.room,h.slot):null};

// ---- Проходимость и маршруты ----
const roomAt=(x,y)=>officeRooms.find(r=>x>=r.x-1e-9&&x<=r.x+r.w+1e-9&&y>=r.y-1e-9&&y<=r.y+r.d+1e-9)||null;
function corridorsAt(x,y){const hs=officeHCorr.filter(c=>x>=c.x0&&x<=c.x1&&y>=c.y0-1e-9&&y<=c.y1+1e-9),vs=officeVCorr.filter(c=>y>=c.y0&&y<=c.y1&&x>=c.x0-1e-9&&x<=c.x1+1e-9);return {hs,vs}}
// Узлы коридорной сети: перекрёстки и выходы дверей. Рёбра — прямые вдоль коридоров.
function buildNetwork(){
 const nodes=new Map(),edges=new Map(),key=(x,y)=>x.toFixed(2)+','+y.toFixed(2);
 const node=(x,y)=>{const k=key(x,y);if(!nodes.has(k)){nodes.set(k,{x,y,k});edges.set(k,new Map())}return nodes.get(k)};
 const link=(a,b)=>{const d=Math.hypot(a.x-b.x,a.y-b.y);edges.get(a.k).set(b.k,d);edges.get(b.k).set(a.k,d)};
 const lines=[];
 for(const h of officeHCorr){const xs=new Set(officeVCorr.map(v=>v.cx));for(const r of officeRooms.filter(r=>r.row===+h.id[1]))xs.add(roomDoor(r).out.x);const ns=[...xs].sort((a,b)=>a-b).map(x=>node(x,h.cy));ns.forEach((n,i)=>i&&link(ns[i-1],n));lines.push({axis:'x',fixed:h.cy,nodes:ns})}
 for(const v of officeVCorr){const ns=officeHCorr.map(h=>node(v.cx,h.cy));ns.forEach((n,i)=>i&&link(ns[i-1],n));lines.push({axis:'y',fixed:v.cx,nodes:ns})}
 return {nodes,edges,lines,node};
}
const officeNet=buildNetwork();
function dijkstra(net,starts,goalKey){ // starts: [{key,cost}]
 const dist=new Map(),prev=new Map(),open=new Set();for(const s of starts){dist.set(s.key,s.cost);open.add(s.key)}
 while(open.size){let u=null;for(const k of open)if(u===null||dist.get(k)<dist.get(u))u=k;open.delete(u);if(u===goalKey)break;for(const [v,w] of net.edges.get(u)){const nd=dist.get(u)+w;if(nd<(dist.get(v)??Infinity)){dist.set(v,nd);prev.set(v,u);open.add(v)}}}
 if(!dist.has(goalKey))return null;const path=[];for(let k=goalKey;k;k=prev.get(k))path.unshift(net.nodes.get(k));return {path,cost:dist.get(goalKey)};
}
// Путь внутри комнаты: от точки к выходу двери через проход вдоль южной части (мебель сюда не заходит).
function interiorToDoor(room,p){
 const d=roomDoor(room),ay=aisleY(room),pts=[{x:p.x,y:p.y}];
 if(p.y<ay-1e-9)pts.push({x:p.x,y:ay});
 pts.push({x:d.x,y:ay},{x:d.x,y:d.y},{x:d.out.x,y:d.out.y});
 return pts;
}
const clean=pts=>pts.filter((p,i)=>i===0||Math.hypot(p.x-pts[i-1].x,p.y-pts[i-1].y)>1e-6);
// Привязка точки в коридоре к ближайшей линии и её соседним узлам.
function attachCorridor(p){
 const c=corridorsAt(p.x,p.y);let best=null;
 for(const ln of officeNet.lines){const inside=ln.axis==='x'?c.hs.some(h=>Math.abs(h.cy-ln.fixed)<1e-6):c.vs.some(v=>Math.abs(v.cx-ln.fixed)<1e-6);if(!inside)continue;
  const t=ln.axis==='x'?p.x:p.y,off=ln.axis==='x'?Math.abs(p.y-ln.fixed):Math.abs(p.x-ln.fixed);if(!best||off<best.off)best={ln,t,off}}
 if(!best)return null;
 const {ln,t}=best,proj=ln.axis==='x'?{x:t,y:ln.fixed}:{x:ln.fixed,y:t};
 const ts=ln.nodes.map(n=>ln.axis==='x'?n.x:n.y);let lo=-1;for(let i=0;i<ts.length;i++)if(ts[i]<=t+1e-9)lo=i;
 const starts=[];if(lo>=0)starts.push({key:ln.nodes[lo].k,cost:Math.abs(t-ts[lo])});if(lo+1<ts.length)starts.push({key:ln.nodes[lo+1].k,cost:Math.abs(ts[lo+1]-t)});
 return {proj,starts};
}
// Полный маршрут между двумя точками плана (комната или коридор). Возвращает список точек без повторов или null.
function planRoute(from,to){
 const rf=roomAt(from.x,from.y),rt=roomAt(to.x,to.y);
 if(!rt)return planToCorridor(from,to,rf);
 // та же комната: по проходу
 if(rf&&rf.id===rt.id){const ay=aisleY(rf),pts=[{x:from.x,y:from.y}];if(from.y<ay-1e-9)pts.push({x:from.x,y:ay});if(Math.abs(from.x-to.x)>1e-9)pts.push({x:to.x,y:ay});pts.push({x:to.x,y:to.y});return clean(pts)}
 const goal=roomDoor(rt).out,goalNode=officeNet.node(goal.x,goal.y);
 let pre,starts;
 if(rf){pre=interiorToDoor(rf,from);const o=roomDoor(rf).out;starts=[{key:officeNet.node(o.x,o.y).k,cost:0}]}
 else{const a=attachCorridor(from);if(!a)return null;pre=[{x:from.x,y:from.y},a.proj];starts=a.starts}
 const sp=dijkstra(officeNet,starts,goalNode.k);if(!sp)return null;
 const mid=sp.path.map(n=>({x:n.x,y:n.y}));
 const post=interiorToDoor(rt,to).reverse();
 return clean([...pre,...mid,...post]);
}
// Шаги вдоль маршрута для проверок: точки через каждые `step` единиц.
function sampleRoute(pts,step=.25){const out=[];for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/step));for(let k=i===1?0:1;k<=n;k++)out.push({x:a.x+(b.x-a.x)*k/n,y:a.y+(b.y-a.y)*k/n})}return out}
const insideRect=(p,f,pad=0)=>p.x>f.x-pad&&p.x<f.x+f.w+pad&&p.y>f.y-pad&&p.y<f.y+f.d+pad;
// Точка проходима: в коридоре или в комнате вне мебели (с зазором на ширину тела).
function walkable(p){
 const pad=OL.body;
 if(officeFurniture.some(f=>insideRect(p,f,pad)))return false;
 const c=corridorsAt(p.x,p.y);if(c.hs.length||c.vs.length)return true;
 const r=roomAt(p.x,p.y);return !!r;
}
// Сегмент пересекает переднюю стенку комнаты только в проёме двери.
function crossesFrontOutsideDoor(a,b){
 for(const r of officeRooms){const fy=r.y+r.d,d=roomDoor(r);if((a.y-fy)*(b.y-fy)<0||(Math.abs(a.y-fy)<1e-9&&Math.abs(b.y-fy)<1e-9)){const t=(fy-a.y)/((b.y-a.y)||1e-9),x=a.x+(b.x-a.x)*(Number.isFinite(t)?t:0);if(x>=r.x&&x<=r.x+r.w&&Math.abs(x-d.x)>d.w/2-OL.body)return true}}
 return false;
}
const routeLength=pts=>pts.reduce((s,p,i)=>i?s+Math.hypot(p.x-pts[i-1].x,p.y-pts[i-1].y):0,0);
// Центр комнаты на экране (для камеры).
const roomScreenCenter=id=>{const r=officeRoom(id),p=project(r.x+r.w/2,r.y+r.d/2);return {x:p[0],y:p[1]}};

// Цель в коридоре (запасные места «очереди» у двери, когда в комнате тесно): сначала до узла сети, затем вдоль линии.
function planToCorridor(from,to,rf){
 const at=attachCorridor(to);if(!at)return null;
 let pre,starts;
 if(rf){pre=interiorToDoor(rf,from);const o=roomDoor(rf).out;starts=[{key:officeNet.node(o.x,o.y).k,cost:0}]}
 else{const a=attachCorridor(from);if(!a)return null;
  if(Math.abs(a.proj.y-at.proj.y)<1e-9||(Math.abs(a.proj.x-at.proj.x)<1e-9&&officeVCorr.some(v=>Math.abs(v.cx-a.proj.x)<1e-9)))return clean([{x:from.x,y:from.y},a.proj,at.proj,{x:to.x,y:to.y}]);
  pre=[{x:from.x,y:from.y},a.proj];starts=a.starts}
 let best=null;
 for(const g of at.starts){const sp=dijkstra(officeNet,starts,g.key);if(sp&&(!best||sp.cost+g.cost<best.cost))best={path:sp.path,cost:sp.cost+g.cost}}
 if(!best)return null;
 return clean([...pre,...best.path.map(n=>({x:n.x,y:n.y})),at.proj,{x:to.x,y:to.y}]);
}
