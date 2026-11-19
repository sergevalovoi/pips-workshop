// camera.js: чистая математика камеры офиса (без DOM). Мир — viewBox 1250×840; камера = {zoom, cx, cy} (центр в координатах мира).
// Подключается перед camera-ui.js и тестируется в Node (camera.test.mjs).
const CAM_WORLD={w:1250,h:840},CAM_MIN=1,CAM_MAX=4;
const camClampZoom=z=>Math.min(CAM_MAX,Math.max(CAM_MIN,Number.isFinite(z)?z:1));
const camFitScale=(box,world=CAM_WORLD)=>Math.min(box.w/world.w,box.h/world.h);
const camFit=(world=CAM_WORLD)=>({zoom:1,cx:world.w/2,cy:world.h/2});
// Центр не выходит за пределы мира: при показе целого мира по оси камера центрируется.
function camClamp(cam,box,world=CAM_WORLD){
 const zoom=camClampZoom(cam.zoom),s=camFitScale(box,world)*zoom,vw=box.w/s,vh=box.h/s;
 const axis=(c,v,size)=>v>=size?size/2:Math.min(size-v/2,Math.max(v/2,Number.isFinite(c)?c:size/2));
 return {zoom,cx:axis(cam.cx,vw,world.w),cy:axis(cam.cy,vh,world.h)};
}
// Прямоугольник viewBox для рамки box (пиксели): пропорции viewBox совпадают с рамкой, поэтому масштаб одинаков по осям.
function camView(cam,box,world=CAM_WORLD){
 const c=camClamp(cam,box,world),s=camFitScale(box,world)*c.zoom,w=box.w/s,h=box.h/s;
 return {x:c.cx-w/2,y:c.cy-h/2,w,h,scale:s,cam:c};
}
// Масштабирование колесом/кнопкой: точка мира под курсором (px,py в пикселях рамки) остаётся под курсором, пока границы не мешают.
function camZoomAt(cam,factor,px,py,box,world=CAM_WORLD){
 const v=camView(cam,box,world),wx=v.x+px/v.scale,wy=v.y+py/v.scale;
 const zoom=camClampZoom(v.cam.zoom*factor),s=camFitScale(box,world)*zoom,w=box.w/s,h=box.h/s;
 return camClamp({zoom,cx:wx-px/s+w/2,cy:wy-py/s+h/2},box,world);
}
// Сдвиг перетаскиванием на (dx,dy) пикселей.
function camPan(cam,dx,dy,box,world=CAM_WORLD){
 const v=camView(cam,box,world);
 return camClamp({zoom:v.cam.zoom,cx:v.cam.cx-dx/v.scale,cy:v.cam.cy-dy/v.scale},box,world);
}
// Фокус на точке мира (например, комната): zoom — целевой масштаб или null, чтобы сохранить текущий.
function camFocus(cam,wx,wy,zoom,box,world=CAM_WORLD){
 return camClamp({zoom:zoom==null?cam.zoom:zoom,cx:wx,cy:wy},box,world);
}
// Щипок двумя пальцами: ratio = новое расстояние / прежнее, mid — текущая середина, prevMid — прежняя (пиксели рамки).
function camPinch(cam,ratio,mid,prevMid,box,world=CAM_WORLD){
 const zoomed=camZoomAt(cam,ratio,prevMid.x,prevMid.y,box,world);
 return camPan(zoomed,mid.x-prevMid.x,mid.y-prevMid.y,box,world);
}
// Интерполяция для плавного перехода (зум — в логарифмической шкале).
function camLerp(a,b,t){const k=Math.min(1,Math.max(0,t));return {zoom:Math.exp(Math.log(a.zoom)*(1-k)+Math.log(b.zoom)*k),cx:a.cx+(b.cx-a.cx)*k,cy:a.cy+(b.cy-a.cy)*k}}
// Множитель масштаба из события колеса (deltaMode: 0 — пиксели, 1 — строки, 2 — страницы).
function camWheelFactor(deltaY,deltaMode=0,ctrl=false){
 const px=deltaY*(deltaMode===1?16:deltaMode===2?400:1);
 return Math.exp(-Math.max(-300,Math.min(300,px))*(ctrl?0.01:0.0016));
}
