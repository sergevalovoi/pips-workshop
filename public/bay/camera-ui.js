// camera-ui.js: управление камерой офиса: колесо под курсором, перетаскивание, щипок, двойной клик по комнате, «Весь офис».
// Математика — в camera.js. Выбор комнаты/персонажа кликом сохраняется: после перетаскивания клик подавляется.
let cam=camFit(OFFICE_WORLD),camAnimFrame=0;
const camReduced=()=>matchMedia('(prefers-reduced-motion:reduce)').matches;
const camBox=()=>{const r=$('#world').getBoundingClientRect();return {w:Math.max(1,r.width),h:Math.max(1,r.height)}};
function applyCamera(){
 const v=camView(cam,camBox(),OFFICE_WORLD);cam=v.cam;
 $('#world').setAttribute('viewBox',`${v.x.toFixed(2)} ${v.y.toFixed(2)} ${v.w.toFixed(2)} ${v.h.toFixed(2)}`);
 $('.world-wrap').classList.toggle('zoomed',cam.zoom>1.001);
 $('#resetView').textContent=cam.zoom>1.001?tr`Весь офис · ${Math.round(cam.zoom*100)}%`:tr('Весь офис');
 $('#zoomIn').disabled=cam.zoom>=CAM_MAX-0.001;$('#zoomOut').disabled=cam.zoom<=CAM_MIN+0.001;
}
function setZoom(){applyCamera()} // вызывается при перерисовке сцены
// Плавный переход; при prefers-reduced-motion — мгновенно.
let camGoal=null; // цель текущего перехода: быстрые нажатия «+» накапливаются, а не стартуют каждый раз от середины пути
function moveCamera(target,ms=240){
 cancelAnimationFrame(camAnimFrame);
 const to=camClamp(target,camBox(),OFFICE_WORLD);camGoal=to;
 if(camReduced()||ms<=0){cam=to;camGoal=null;applyCamera();return}
 const from=cam,start=performance.now(),ease=t=>1-Math.pow(1-t,3);
 const step=now=>{const k=Math.min(1,(now-start)/ms);cam=camLerp(from,to,ease(k));applyCamera();if(k<1)camAnimFrame=requestAnimationFrame(step);else camGoal=null};
 camAnimFrame=requestAnimationFrame(step);
}
const roomCenter=id=>roomScreenCenter(id);
// Одиночный клик по комнате: при увеличении центрируем её, масштаб не меняем. Двойной клик: приближаем (zoom задаётся).
function focusRoom(id,zoomTo=null){
 if(zoomTo==null&&cam.zoom<=1.001)return;
 const c=roomCenter(id);moveCamera(camFocus(cam,c.x,c.y,zoomTo,camBox(),OFFICE_WORLD));
}
const zoomBy=factor=>{const b=camBox();moveCamera(camZoomAt(camGoal||cam,factor,b.w/2,b.h/2,b,OFFICE_WORLD),160)};
$('#zoomIn').onclick=()=>zoomBy(1.4);$('#zoomOut').onclick=()=>zoomBy(1/1.4);
$('#resetView').onclick=()=>moveCamera(camFit(OFFICE_WORLD));
(()=>{
 const world=$('#world'),wrap=$('.world-wrap'),pts=new Map();let drag=null,pinch=null,suppress=false;
 const local=e=>{const r=world.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top}};
 world.addEventListener('wheel',e=>{e.preventDefault();cancelAnimationFrame(camAnimFrame);camGoal=null;const p=local(e);cam=camZoomAt(cam,camWheelFactor(e.deltaY,e.deltaMode,e.ctrlKey),p.x,p.y,camBox(),OFFICE_WORLD);applyCamera()},{passive:false});
 world.addEventListener('pointerdown',e=>{
  if(e.pointerType==='mouse'&&e.button!==0)return;
  pts.set(e.pointerId,local(e));cancelAnimationFrame(camAnimFrame);camGoal=null;
  if(pts.size===1)drag={id:e.pointerId,sx:e.clientX,sy:e.clientY,moved:false,cam0:cam};
  else if(pts.size===2){const [a,b]=[...pts.values()];pinch={dist:Math.hypot(a.x-b.x,a.y-b.y)||1,mid:{x:(a.x+b.x)/2,y:(a.y+b.y)/2}};drag=null;suppress=true}
 });
 world.addEventListener('pointermove',e=>{
  if(!pts.has(e.pointerId))return;pts.set(e.pointerId,local(e));
  if(pinch&&pts.size>=2){const [a,b]=[...pts.values()],dist=Math.hypot(a.x-b.x,a.y-b.y)||1,mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};cam=camPinch(cam,dist/pinch.dist,mid,pinch.mid,camBox(),OFFICE_WORLD);pinch={dist,mid};applyCamera();return}
  if(drag&&drag.id===e.pointerId){
   const dx=e.clientX-drag.sx,dy=e.clientY-drag.sy;
   if(!drag.moved&&Math.hypot(dx,dy)>6){drag.moved=true;try{world.setPointerCapture(e.pointerId)}catch{}wrap.classList.add('dragging')}
   if(drag.moved){cam=camPan(drag.cam0,dx,dy,camBox(),OFFICE_WORLD);applyCamera()}
  }
 });
 const end=e=>{
  if(drag&&drag.id===e.pointerId&&drag.moved)suppress=true;
  pts.delete(e.pointerId);if(pts.size<2)pinch=null;if(!pts.size){drag=null;wrap.classList.remove('dragging');if(suppress)setTimeout(()=>{suppress=false},60)}
 };
 world.addEventListener('pointerup',end);world.addEventListener('pointercancel',end);
 // Клик после перетаскивания или щипка не должен выбирать комнату под курсором.
 world.addEventListener('click',e=>{if(suppress){e.stopImmediatePropagation();e.preventDefault();suppress=false}},true);
 // Двойной клик по комнате приближает её. Сцена перерисовывается после первого клика, поэтому двойной клик определяем и по времени.
 let lastRoomClick={id:'',t:0};
 const roomFromEvent=e=>{const r=e.target.closest('[data-room]:not([data-hot])');return r&&!e.target.closest('[data-person]')?r.dataset.room:''};
 const zoomToRoom=id=>{select('room',id);focusRoom(id,Math.max(cam.zoom,2.6))};
 world.addEventListener('click',e=>{const id=roomFromEvent(e),now=Date.now();if(id&&lastRoomClick.id===id&&now-lastRoomClick.t<400){lastRoomClick={id:'',t:0};zoomToRoom(id)}else lastRoomClick={id,t:now}});
 world.addEventListener('dblclick',e=>{const id=roomFromEvent(e);if(!id)return;e.preventDefault();lastRoomClick={id:'',t:0};zoomToRoom(id)});
 world.addEventListener('keydown',e=>{if(e.key==='+'||e.key==='='){zoomBy(1.4)}else if(e.key==='-'){zoomBy(1/1.4)}else if(e.key==='0'){moveCamera(camFit(OFFICE_WORLD))}});
 if(typeof ResizeObserver!=='undefined')new ResizeObserver(()=>applyCamera()).observe(wrap);
 addEventListener('resize',applyCamera);
})();
applyCamera();
