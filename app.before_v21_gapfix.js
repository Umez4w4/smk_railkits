(function(){
'use strict';
const FRONTEND_VERSION='2026-09-18-v19',C=window.RailCore,$=id=>document.getElementById(id);
const els={search:$('search'),pref:$('pref'),railGroup:$('railGroup'),operator:$('operator'),kind:$('kind'),line:$('line'),lineCount:$('lineCount'),lineInfo:$('lineInfo'),manualComplete:$('manualComplete'),from:$('from'),to:$('to'),via:$('via'),preview:$('preview'),route:$('route'),routeInfo:$('routeInfo'),stops:$('stops'),stopNames:$('stopNames'),date:$('date'),note:$('note'),save:$('save'),mapSave:$('mapSave'),mapExport:$('mapExport'),mapSelectionInfo:$('mapSelectionInfo'),message:$('message'),fit:$('fit'),basemap:$('basemap'),statsView:$('statsView'),statsRows:$('statsRows'),overall:$('overall'),overallDistance:$('overallDistance'),history:$('history'),tripCount:$('tripCount'),selectAllRecords:$('selectAllRecords'),deleteSelected:$('deleteSelected'),undo:$('undo'),export:$('export'),import:$('import'),importFile:$('importFile'),dataInfo:$('dataInfo'),banner:$('banner')};
let model=null,map=null,tile=null,geoLayer=null,lineHitLayer=null,stationLayer=null,layerByPiece=new Map(),storageKey='',trips=[],ridden=new Set(),previewRoute=null,stationPickPhase='from',hoverLineId='',hoverStationId='',hoverClearTimer=null,pieceLineMap=new Map(),mapClickIndex=[],mapHoverFrame=0,pendingHoverPoint=null,lineDeselected=false,selectedPieceIds=new Set(),manualCompleteLines=new Set(),manualCompleteStorageKey='';
const BASE_W=1.55,RIDDEN_W=6.0,PREVIEW_W=8.5,PREVIEW_COLOR='#6b7280';
const status=(text,kind='')=>{els.message.textContent=text||'';els.message.className=kind};
const fmtKm=m=>`${C.km(m).toLocaleString('ja-JP',{minimumFractionDigits:C.km(m)<10?1:0,maximumFractionDigits:1})} km`;
const option=(value,label,selected=false)=>`<option value="${C.esc(value)}"${selected?' selected':''}>${C.esc(label)}</option>`;
function opColor(name){return model?.operatorMap.get(name)?.color||C.colorFor(name,'')}
function mutedLineColor(color,amount=.58){
  const m=String(color||'').trim().match(/^#([0-9a-f]{6})$/i);if(!m)return color||'#7f878d';
  const n=parseInt(m[1],16),r=(n>>16)&255,g=(n>>8)&255,b=n&255;
  const gray=Math.round(.299*r+.587*g+.114*b),mix=v=>Math.round(v*(1-amount)+gray*amount);
  return `#${[mix(r),mix(g),mix(b)].map(v=>v.toString(16).padStart(2,'0')).join('')}`;
}
function setStationValue(el,id){
  if(!el||![...el.options].some(o=>o.value===id))return false;
  el.value=id;return true;
}
function chooseStationFromMap(id){
  if(stationPickPhase==='from'){
    if(!setStationValue(els.from,id))return;
    stationPickPhase='to';
    resetPreview();renderStationMarkers();
    status('乗車駅を選択しました。次に降車駅をクリックしてください。','ok');
    return;
  }
  if(id===els.from.value){
    status('降車駅は乗車駅と異なる駅を選んでください。','error');
    return;
  }
  if(!setStationValue(els.to,id))return;
  stationPickPhase='from';
  renderStationMarkers();
  autoPreview(false);
}

function linePieces(line){return(line?.piece_ids||[]).map(id=>model.pieceById.get(id)).filter(Boolean)}

function manualLineRecord(line){
  return line?{line_id:line.id,line_name:line.name,operator:line.operator}:null;
}
function manualLineNorm(v){
  return String(v||'').replace(/[\s　]/g,'').toLowerCase();
}
function resolveManualLineRecord(rec){
  if(!rec)return'';
  if(typeof rec==='string'&&model.lineById.has(rec))return rec;
  const rid=String(rec.line_id||rec.id||'');
  if(rid&&model.lineById.has(rid))return rid;
  const name=manualLineNorm(rec.line_name||rec.name||''),
        operator=manualLineNorm(rec.operator||rec.operator_name||'');
  if(!name)return'';
  const matches=model.lines.filter(l=>
    manualLineNorm(l.name)===name &&
    (!operator||manualLineNorm(l.operator)===operator)
  );
  return matches.length===1?matches[0].id:'';
}
function manualCompleteRecords(){
  return [...manualCompleteLines]
    .map(id=>manualLineRecord(model.lineById.get(id)))
    .filter(Boolean);
}
function saveManualCompleteLines(){
  const records=manualCompleteRecords();
  try{
    localStorage.setItem(manualCompleteStorageKey,JSON.stringify(records));
    localStorage.setItem('rail-log:manual-complete:master:v1',JSON.stringify(records));
  }catch(e){console.warn('manual completion save failed',e)}
}
function loadManualCompleteLines(){
  manualCompleteStorageKey=`rail-log:manual-complete:v1:${model.dataset_id}`;
  const read=key=>{
    try{
      const v=JSON.parse(localStorage.getItem(key)||'[]');
      return Array.isArray(v)?v:[];
    }catch{return[]}
  };
  let records=read(manualCompleteStorageKey);
  if(!records.length)records=read('rail-log:manual-complete:master:v1');
  const ids=new Set();
  for(const rec of records){
    const id=resolveManualLineRecord(rec);
    if(id)ids.add(id);
  }
  manualCompleteLines=ids;
  saveManualCompleteLines();
}
function ordinaryRiddenSet(tripList){
  return new Set((tripList||[]).flatMap(t=>C.tripPieceIds(t,model)));
}
function ordinaryLineRate(line,tripList=trips){
  if(!line)return 0;
  const base=ordinaryRiddenSet(tripList);
  return C.aggregatePieces(linePieces(line).filter(p=>p.eligible),base).rate;
}
function effectiveRiddenSet(){
  const set=C.riddenSet(trips,model);
  for(const id of manualCompleteLines){
    const line=model.lineById.get(id);
    if(!line)continue;
    for(const pid of line.piece_ids||[])if(model.pieceById.has(pid))set.add(pid);
  }
  return set;
}
function updateManualCompleteButton(){
  if(!els.manualComplete)return;
  const line=selectedLine();
  if(!line){
    els.manualComplete.disabled=true;
    els.manualComplete.textContent='この路線を100%にする';
    els.manualComplete.classList.remove('manual-active');
    return;
  }
  const manual=manualCompleteLines.has(line.id);
  const automatic=C.completedLineIds(trips,model).has(line.id);
  if(manual){
    els.manualComplete.disabled=false;
    els.manualComplete.textContent='✓ 100%指定を解除';
    els.manualComplete.classList.add('manual-active');
  }else if(automatic){
    els.manualComplete.disabled=true;
    els.manualComplete.textContent='隣接駅間走破済み（100%）';
    els.manualComplete.classList.remove('manual-active');
  }else{
    els.manualComplete.disabled=false;
    els.manualComplete.textContent='この路線を100%にする';
    els.manualComplete.classList.remove('manual-active');
  }
}
function setManualComplete(line,enabled,announce=true){
  if(!line)return;
  if(enabled)manualCompleteLines.add(line.id);
  else manualCompleteLines.delete(line.id);
  saveManualCompleteLines();
  recompute();
  updateManualCompleteButton();
  if(announce){
    status(
      enabled
        ? `${line.name} を手動で100%に指定しました。`
        : `${line.name} の手動100%指定を解除しました。`,
      'ok'
    );
  }
}
function toggleManualComplete(){
  const line=selectedLine();
  if(!line)return;
  if(manualCompleteLines.has(line.id)){
    if(window.confirm(`${line.name} の手動100%指定を解除しますか？`))
      setManualComplete(line,false,true);
    return;
  }
  if(window.confirm(`${line.name} を100%として記録しますか？\nこの指定はバックアップにも保存されます。`))
    setManualComplete(line,true,true);
}
function resolveLineIdForPiece(id){const key=String(id||''),p=model?.pieceById.get(key);if(p?.line_id&&model.lineById.has(p.line_id))return p.line_id;return pieceLineMap.get(key)||''}
function resolveLineIdForFeature(f){
  const direct=String(f?.__line_id||'');
  if(direct&&model.lineById.has(direct))return direct;
  const props=f?.properties||{};
  for(const v of[props.line_id,props.formal_line_id,props.route_id]){
    const id=String(v||'');if(id&&model.lineById.has(id))return id;
  }
  const byPiece=resolveLineIdForPiece(f?.__piece_id);
  if(byPiece)return byPiece;
  const fid=String(f?.id||'');
  if(fid&&model.lineById.has(fid))return fid;
  const op=String(f?.__operator||props.operator||props.operator_name||props.company||'');
  const nm=String(props.line_name||props.route_name||'');
  if(op||nm){
    const norm=s=>String(s||'').replace(/[\s　]/g,'').toLowerCase();
    const cand=model.lines.filter(l=>(!op||norm(l.operator)===norm(op))&&(!nm||norm(l.name)===norm(nm)));
    if(cand.length===1)return cand[0].id;
  }
  return'';
}
function rebuildPieceLineMap(){pieceLineMap=new Map();for(const p of model.pieces)if(p.line_id&&model.lineById.has(p.line_id))pieceLineMap.set(p.id,p.line_id);for(const l of model.lines)for(const id of l.piece_ids||[])if(!pieceLineMap.has(String(id)))pieceLineMap.set(String(id),l.id)}
function linePrefCodes(line){const s=new Set((line.prefectures||[]).map(x=>x.code||x.name));for(const p of linePieces(line))for(const a of C.allocations(p))s.add(a.code||a.name);return s}
function populatePref(){const m=new Map();for(const p of model.pieces)for(const a of C.allocations(p)){const key=a.code||a.name;if(key)m.set(key,a.name||a.code)}els.pref.innerHTML=option('','すべて')+[...m].sort((a,b)=>String(a[0]).localeCompare(String(b[0]),'ja')).map(([k,v])=>option(k,v)).join('')}
function populateOperators(){const old=els.operator.value,group=els.railGroup.value,ops=model.operators.filter(o=>!group||o.group===group).sort((a,b)=>b.length_m-a.length_m||a.name.localeCompare(b.name,'ja'));els.operator.innerHTML=option('','すべて')+ops.map(o=>option(o.name,`${o.group==='jr'?'JR':'私鉄'} · ${o.name} — ${fmtKm(o.length_m)}`,o.name===old)).join('');if(old&&!ops.some(o=>o.name===old))els.operator.value=''}
function searchable(line){if(line.search)return`${line.name} ${line.operator} ${line.search}`.toLowerCase();const names=line.station_ids.slice(0,500).map(id=>model.stationById.get(id)?.name||'');return`${line.name} ${line.operator} ${names.join(' ')}`.toLowerCase()}
function filteredLines(){const q=els.search.value.trim().toLowerCase(),pref=els.pref.value,group=els.railGroup.value,op=els.operator.value,kind=els.kind.value;return model.lines.filter(l=>l.eligible!==false&&(!q||searchable(l).includes(q))&&(!pref||linePrefCodes(l).has(pref))&&(!group||l.group===group)&&(!op||l.operator===op)&&(!kind||l.kind===kind)).sort((a,b)=>{const oa=model.operatorMap.get(a.operator)?.length_m||0,ob=model.operatorMap.get(b.operator)?.length_m||0;return ob-oa||a.operator.localeCompare(b.operator,'ja')||a.name.localeCompare(b.name,'ja')})}
function populateLines(){const old=els.line.value,lines=filteredLines();els.line.innerHTML=option('','路線を選択')+lines.map(l=>option(l.id,`${l.operator?l.operator+' · ':''}${l.name}`,l.id===old)).join('');els.lineCount.textContent=`(${lines.length})`;if(!lines.length){els.line.innerHTML=option('','該当する路線なし');els.lineInfo.textContent='';clearStations();updateManualCompleteButton();return}if(old&&lines.some(l=>l.id===old))els.line.value=old;else if(lineDeselected)els.line.value='';else els.line.value=lines[0].id;if(els.line.value)selectLine();else deselectLine(false)}
function clearStations(){for(const e of[els.from,els.to])e.innerHTML='';els.via.innerHTML=option('','指定なし');previewRoute=null;stationPickPhase='from';els.save.disabled=true;if(els.mapSave)els.mapSave.disabled=true;renderStationMarkers();refreshMapStyle()}
function deselectLine(announce=true){
  lineDeselected=true;
  selectedPieceIds.clear();
  els.line.value='';
  els.lineInfo.textContent='';
  previewRoute=null;
  stationPickPhase='from';
  els.route.innerHTML='';
  els.route.disabled=true;
  els.save.disabled=true;
  if(els.mapSave)els.mapSave.disabled=true;
  els.routeInfo.textContent='路線を選択してください。';
  els.stopNames.textContent='';
  if(els.mapSelectionInfo)els.mapSelectionInfo.textContent='路線をクリックして選択';
  if(stationLayer){stationLayer.remove();stationLayer=null}
  hoverStationId='';
  hoverLineId='';
  refreshMapStyle();
  updateMapCursor();
  updateManualCompleteButton();
  if(announce)status('路線選択を解除しました。','ok');
}
function selectedLine(){return model.lineById.get(els.line.value)}
function stationIdsForLine(l){if(!l)return[];if(l.station_ids.length)return l.station_ids;return C.uniq(l.section_ids.flatMap(id=>{const s=model.sectionById.get(id);return s?[s.from,s.to]:[]}))}
function selectLine(){const l=selectedLine();if(l){lineDeselected=false;selectedPieceIds=new Set(l.piece_ids||[])}if(!l){if(els.mapSelectionInfo)els.mapSelectionInfo.textContent='路線をクリックして選択';clearStations();return}
  if(els.mapSelectionInfo)els.mapSelectionInfo.textContent=[l.operator,l.name].filter(Boolean).join(' · ');const group=l.group==='jr'?'JR線':'私鉄線';els.lineInfo.innerHTML=`<span class="op-dot" style="background:${C.esc(opColor(l.operator))}"></span>${C.esc(l.operator||'事業者不明')} · ${group}${l.length_m?` · ${C.esc(fmtKm(l.length_m))}`:''}`;const ids=stationIdsForLine(l),opts=ids.map(id=>{const s=model.stationById.get(id);return option(id,s?.name||id)}).join('');els.from.innerHTML=opts;els.to.innerHTML=opts;els.via.innerHTML=option('','指定なし')+opts;if(ids.length>1)els.to.selectedIndex=ids.length-1;stationPickPhase='from';previewRoute=null;els.route.innerHTML='';els.route.disabled=true;els.save.disabled=true;if(els.mapSave)els.mapSave.disabled=true;els.routeInfo.textContent=ids.length?'乗車駅・降車駅を選び「経路を表示」してください。':'この路線には入力可能な駅間接続がありません。';els.stopNames.textContent='';renderStationMarkers();refreshMapStyle();updateManualCompleteButton()}
function resetPreview(){previewRoute=null;els.route.innerHTML='';els.route.disabled=true;els.save.disabled=true;if(els.mapSave)els.mapSave.disabled=true;els.stopNames.textContent='';refreshMapStyle()}
function stationVisual(id,l,hover=false){
  const isFrom=id===els.from.value,isTo=id===els.to.value,baseRadius=isFrom?8.5:(isTo?5.8:4.0),operatorColor=opColor(l.operator);
  return{radius:baseRadius+(hover?2.8:0),color:'#ffffff',weight:(isFrom?2.4:(isTo?1.8:1.1))+(hover?.8:0),fillColor:isFrom?operatorColor:(isTo?'#ffffff':(hover?operatorColor:'#273746')),fillOpacity:hover?.98:(isFrom?.99:(isTo?.94:.72)),opacity:1};
}
function applyStationVisual(marker,id,l,hover=false){const v=stationVisual(id,l,hover);marker.setRadius(v.radius);marker.setStyle({color:v.color,weight:v.weight,fillColor:v.fillColor,fillOpacity:v.fillOpacity,opacity:v.opacity});if(hover)marker.bringToFront?.()}
function updateMapCursor(){if(!map)return;map.getContainer().classList.toggle('rail-interactive-hover',Boolean(hoverLineId||hoverStationId))}
function renderStationMarkers(){if(!map)return;if(stationLayer){stationLayer.remove();stationLayer=null}const l=selectedLine();if(!l)return;stationLayer=L.layerGroup().addTo(map);const fromId=els.from.value,toId=els.to.value;for(const id of stationIdsForLine(l)){const s=model.stationById.get(id);if(!s||!Number.isFinite(s.lat)||!Number.isFinite(s.lon)||Math.abs(s.lat)>90||Math.abs(s.lon)>180)continue;const v=stationVisual(id,l,false);const marker=L.circleMarker([s.lat,s.lon],{...v,pane:'markerPane',interactive:true}).bindTooltip(C.esc(s.name),{direction:'top',offset:[0,-4]});marker.on('mouseover',()=>{hoverStationId=id;applyStationVisual(marker,id,l,true);updateMapCursor()});marker.on('mouseout',()=>{if(hoverStationId===id)hoverStationId='';applyStationVisual(marker,id,l,false);updateMapCursor()});marker.on('click',ev=>{L.DomEvent.stopPropagation(ev);chooseStationFromMap(id)});marker.addTo(stationLayer);if(id===fromId||id===toId)marker.bringToFront?.()}}
function buildPreview({fit=true,announce=true}={}){
  const l=selectedLine();
  if(!l||!els.from.value||!els.to.value||els.from.value===els.to.value){
    resetPreview();
    if(announce)status('異なる乗車駅と降車駅を選んでください。','error');
    return false;
  }
  const r=C.shortestPath(model,l,els.from.value,els.to.value,els.via.value);
  if(!r){
    resetPreview();
    els.routeInfo.textContent='この駅間の接続経路を作れませんでした。';
    if(announce)status('接続データを確認してください。','error');
    return false;
  }
  previewRoute=r;
  els.route.innerHTML=option('0',`${fmtKm(r.length_m)} · ${r.sections.length} 区間`,true);
  els.route.disabled=false;
  els.save.disabled=false;
  if(els.mapSave)els.mapSave.disabled=false;
  const stationNames=r.stations.map(id=>model.stationById.get(id)?.name||id);
  els.routeInfo.textContent=`${stationNames[0]} → ${stationNames[stationNames.length-1]} / ${fmtKm(r.length_m)}`;
  els.stopNames.textContent=stationNames.join(' → ');
  if(announce)status('確認中の区間を灰色の太線で表示しています。地図上の「この区間を記録」から直接保存できます。','ok');
  refreshMapStyle();
  if(fit)fitPieces(r.piece_ids);
  return true;
}
function autoPreview(fit=false){
  const ok=buildPreview({fit,announce:false});
  if(ok)status('確認中の区間を灰色の太線で表示しています。地図上の「この区間を記録」から直接保存できます。','ok');
  return ok;
}
function doPreview(){buildPreview({fit:true,announce:true})}
function visualStyleForFeature(f,previewSet){
  const id=f.__piece_id,p=model.pieceById.get(id),baseColor=p?.color||f.__color||'#6f7a82',isRidden=ridden.has(id),isPreview=previewSet.has(id),lineId=resolveLineIdForFeature(f),isSelected=selectedPieceIds.has(id)||(lineId&&lineId===els.line.value),isHover=lineId&&lineId===hoverLineId;
  let weight=BASE_W,opacity=.27,color=mutedLineColor(baseColor,.80);
  if(isSelected){weight=3.8;opacity=.92;color=baseColor}
  if(isRidden){weight=RIDDEN_W+(isSelected?.8:0);opacity=.95;color=baseColor}
  if(isPreview){weight=Math.max(weight,PREVIEW_W);opacity=.98;color=PREVIEW_COLOR}
  if(isHover){weight=Math.max(weight,isPreview?10.5:(isRidden?8.4:5.6));opacity=1;color=isPreview?PREVIEW_COLOR:baseColor}
  return{color,weight,opacity,lineCap:'round',lineJoin:'round'};
}
function refreshMapStyle(){if(!geoLayer)return;const previewSet=new Set(previewRoute?.piece_ids||[]);geoLayer.setStyle(f=>visualStyleForFeature(f,previewSet));for(const id of ridden)for(const l of layerByPiece.get(id)||[])l.bringToFront?.();for(const id of previewSet)for(const l of layerByPiece.get(id)||[])l.bringToFront?.();if(stationLayer)stationLayer.eachLayer(l=>l.bringToFront?.())}
function fitPieces(ids){const layers=ids.flatMap(id=>layerByPiece.get(id)||[]);if(!layers.length)return;const g=L.featureGroup(layers),b=g.getBounds();if(b.isValid())map.fitBounds(b.pad(.12),{maxZoom:13})}
function fitLine(){const l=selectedLine();if(l)fitPieces(l.piece_ids)}
function setHoveredLine(lineId){if(hoverClearTimer){clearTimeout(hoverClearTimer);hoverClearTimer=null}const next=String(lineId||'');if(hoverLineId!==next){hoverLineId=next;refreshMapStyle()}updateMapCursor()}
function clearHoveredLineSoon(lineId){if(hoverClearTimer)clearTimeout(hoverClearTimer);const expected=String(lineId||'');hoverClearTimer=setTimeout(()=>{if(hoverLineId===expected){hoverLineId='';refreshMapStyle();updateMapCursor()}hoverClearTimer=null},35)}
function selectLineFromMap(lineId){
  const target=model.lineById.get(String(lineId||''));
  lineDeselected=false;
  if(!target){status('この地図区間に対応する路線情報がありません。','error');return false}
  if(target.eligible===false){status(`「${target.name}」は現在の入力対象外です。`,'error');return false}

  // Synchronize the left-side filters with the clicked line so it is guaranteed
  // to be present in the route dropdown.  The map itself remains unfiltered.
  els.search.value='';
  els.pref.value='';
  els.railGroup.value=target.group||'';
  populateOperators();
  if([...els.operator.options].some(o=>o.value===target.operator))els.operator.value=target.operator||'';
  else els.operator.value='';
  if([...els.kind.options].some(o=>o.value===target.kind))els.kind.value=target.kind||'';
  else els.kind.value='';

  populateLines();
  if(![...els.line.options].some(o=>o.value===target.id)){
    // Fallback for unusual records whose kind/operator labels do not match the
    // frontend filter vocabulary exactly.
    els.railGroup.value='';
    populateOperators();
    els.operator.value='';
    els.kind.value='';
    populateLines();
  }
  if(![...els.line.options].some(o=>o.value===target.id)){
    status(`「${target.name}」を路線一覧に見つけられませんでした。`,'error');
    return false;
  }

  els.line.value=target.id;
  selectLine();
  status(`地図から「${target.name}」を選択しました。乗車駅と降車駅を選んでください。`,'ok');
  return true;
}
function handleMapLineClick(feature){
  const pieceId=feature?.__piece_id,lineId=resolveLineIdForFeature(feature);
  if(!lineId){status('この区間には選択可能な路線IDがありません。','error');return}
  selectLineFromMap(lineId);
}
function applyGrayOSM(){const c=tile?.getContainer?.();if(c)c.style.filter='grayscale(100%) saturate(0%) contrast(88%) brightness(108%)'}



function featureEligibleForMap(f){
  const pid=String(f?.__piece_id||f?.properties?.piece_id||'');
  const piece=pid?model.pieceById.get(pid):null;
  if(piece)return piece.eligible!==false;
  return f?.properties?.eligible!==false;
}
function lineGeometryOnly(geometry){
  if(!geometry)return null;
  if(geometry.type==='LineString')return geometry;
  if(geometry.type==='MultiLineString')return geometry;
  if(geometry.type==='GeometryCollection'&&Array.isArray(geometry.geometries)){
    const lines=[];
    for(const g of geometry.geometries){
      const lg=lineGeometryOnly(g);
      if(!lg)continue;
      if(lg.type==='LineString')lines.push(lg.coordinates);
      else if(lg.type==='MultiLineString')lines.push(...lg.coordinates);
    }
    if(!lines.length)return null;
    return lines.length===1
      ? {type:'LineString',coordinates:lines[0]}
      : {type:'MultiLineString',coordinates:lines};
  }
  return null;
}
function railLineFeatureCollection(){
  const features=[];
  for(const f of model.geo.features||[]){
    if(!featureEligibleForMap(f))continue;
    const geometry=lineGeometryOnly(f.geometry);
    if(!geometry)continue;
    features.push({...f,geometry});
  }
  return {...model.geo,features};
}
function geometryLineParts(geometry){
  if(!geometry)return[];
  const t=geometry.type,c=geometry.coordinates;
  if(t==='LineString'&&Array.isArray(c))return[c];
  if(t==='MultiLineString'&&Array.isArray(c))return c;
  if(t==='GeometryCollection'&&Array.isArray(geometry.geometries)){
    return geometry.geometries.flatMap(geometryLineParts);
  }
  return[];
}
function buildMapClickIndex(){
  mapClickIndex=[];
  for(const f of model.geo.features){
    if(!featureEligibleForMap(f))continue;
    const lineId=resolveLineIdForFeature(f);
    if(!lineId)continue;
    const parts=geometryLineParts(f.geometry)
      .map(part=>part.map(c=>[Number(c?.[1]),Number(c?.[0])])
      .filter(c=>Number.isFinite(c[0])&&Number.isFinite(c[1])))
      .filter(part=>part.length>=2);
    if(!parts.length)continue;
    let minLat=Infinity,maxLat=-Infinity,minLon=Infinity,maxLon=-Infinity;
    for(const part of parts)for(const [lat,lon] of part){
      if(lat<minLat)minLat=lat;if(lat>maxLat)maxLat=lat;
      if(lon<minLon)minLon=lon;if(lon>maxLon)maxLon=lon;
    }
    mapClickIndex.push({feature:f,lineId,parts,bbox:{minLat,maxLat,minLon,maxLon}});
  }
}
function pointSegmentDistanceSq(p,a,b){
  const dx=b.x-a.x,dy=b.y-a.y;
  if(dx===0&&dy===0){const x=p.x-a.x,y=p.y-a.y;return x*x+y*y}
  let t=((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy);
  t=Math.max(0,Math.min(1,t));
  const x=p.x-(a.x+t*dx),y=p.y-(a.y+t*dy);
  return x*x+y*y;
}
function nearestRailFeature(containerPoint,tolerancePx=18){
  if(!map||!mapClickIndex.length)return null;
  const p=L.point(containerPoint.x,containerPoint.y);
  const nw=map.containerPointToLatLng(L.point(p.x-tolerancePx,p.y-tolerancePx));
  const se=map.containerPointToLatLng(L.point(p.x+tolerancePx,p.y+tolerancePx));
  const minLat=Math.min(nw.lat,se.lat),maxLat=Math.max(nw.lat,se.lat);
  const minLon=Math.min(nw.lng,se.lng),maxLon=Math.max(nw.lng,se.lng);
  const limit=tolerancePx*tolerancePx;
  let best=null,bestD=limit;
  for(const item of mapClickIndex){
    const b=item.bbox;
    if(b.maxLat<minLat||b.minLat>maxLat||b.maxLon<minLon||b.minLon>maxLon)continue;
    for(const part of item.parts){
      let a=map.latLngToContainerPoint(part[0]);
      for(let i=1;i<part.length;i++){
        const c=map.latLngToContainerPoint(part[i]);
        const d=pointSegmentDistanceSq(p,a,c);
        if(d<=bestD){bestD=d;best=item}
        a=c;
      }
    }
  }
  return best;
}
function clearMapHover(){
  if(hoverLineId){
    hoverLineId='';
    refreshMapStyle();
  }
  updateMapCursor();
}
function processMapHover(){
  mapHoverFrame=0;
  if(!pendingHoverPoint)return;
  const hit=nearestRailFeature(pendingHoverPoint,16);
  pendingHoverPoint=null;
  if(hit){
    setHoveredLine(hit.lineId);
  }else{
    clearMapHover();
  }
}
function scheduleMapHover(containerPoint){
  pendingHoverPoint=L.point(containerPoint.x,containerPoint.y);
  if(!mapHoverFrame)mapHoverFrame=requestAnimationFrame(processMapHover);
}

function canvasBlob(canvas){
  return new Promise((resolve,reject)=>{
    try{
      canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('PNGを作成できませんでした。')),'image/png');
    }catch(e){reject(e)}
  });
}
function waitForTile(img){
  if(img.complete&&img.naturalWidth)return Promise.resolve();
  return new Promise(resolve=>{
    const done=()=>resolve();
    img.addEventListener('load',done,{once:true});
    img.addEventListener('error',done,{once:true});
    setTimeout(done,1800);
  });
}
function drawRailFeatureToCanvas(ctx,f,previewSet,scale){
  if(!featureEligibleForMap(f))return;
  const style=visualStyleForFeature(f,previewSet);
  ctx.save();
  ctx.strokeStyle=style.color||'#6f7a82';
  ctx.globalAlpha=Number.isFinite(style.opacity)?style.opacity:1;
  ctx.lineWidth=Math.max(.5,(style.weight||1)*scale);
  ctx.lineCap='round';
  ctx.lineJoin='round';
  for(const part of geometryLineParts(f.geometry)){
    let started=false;
    ctx.beginPath();
    for(const coord of part){
      if(!Array.isArray(coord)||coord.length<2)continue;
      const lon=Number(coord[0]),lat=Number(coord[1]);
      if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
      const p=map.latLngToContainerPoint([lat,lon]);
      const x=p.x*scale,y=p.y*scale;
      if(!started){ctx.moveTo(x,y);started=true}else ctx.lineTo(x,y);
    }
    if(started)ctx.stroke();
  }
  ctx.restore();
}
function drawSelectedStationsToCanvas(ctx,scale){
  const l=selectedLine();
  if(!l)return;
  for(const id of stationIdsForLine(l)){
    const s=model.stationById.get(id);
    if(!s||!Number.isFinite(s.lat)||!Number.isFinite(s.lon))continue;
    const p=map.latLngToContainerPoint([s.lat,s.lon]);
    const x=p.x*scale,y=p.y*scale;
    const isFrom=id===els.from.value,isTo=id===els.to.value;
    const radius=(isFrom?8.5:(isTo?5.8:4.0))*scale;
    if(x<-radius||y<-radius||x>map.getSize().x*scale+radius||y>map.getSize().y*scale+radius)continue;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x,y,radius,0,Math.PI*2);
    ctx.fillStyle=isFrom?opColor(l.operator):(isTo?'#ffffff':'#273746');
    ctx.globalAlpha=isFrom?.99:(isTo?.94:.72);
    ctx.fill();
    ctx.globalAlpha=1;
    ctx.strokeStyle='#ffffff';
    ctx.lineWidth=(isFrom?2.4:(isTo?1.8:1.1))*scale;
    ctx.stroke();
    ctx.restore();
  }
}
async function renderMapCanvas(includeTiles=true){
  const container=map.getContainer(),rect=container.getBoundingClientRect();
  const width=Math.max(1,Math.round(container.clientWidth)),height=Math.max(1,Math.round(container.clientHeight));
  const scale=Math.max(1,Math.min(2,window.devicePixelRatio||1));
  const canvas=document.createElement('canvas');
  canvas.width=Math.round(width*scale);
  canvas.height=Math.round(height*scale);
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#eef1f3';
  ctx.fillRect(0,0,canvas.width,canvas.height);

  if(includeTiles&&els.basemap.checked&&map.hasLayer(tile)){
    const imgs=[...container.querySelectorAll('.leaflet-tile-pane img.leaflet-tile')];
    await Promise.all(imgs.map(waitForTile));
    ctx.save();
    ctx.filter='grayscale(100%) saturate(0%) contrast(88%) brightness(108%)';
    for(const img of imgs){
      if(!img.complete||!img.naturalWidth)continue;
      const r=img.getBoundingClientRect();
      const x=(r.left-rect.left)*scale,y=(r.top-rect.top)*scale,w=r.width*scale,h=r.height*scale;
      ctx.drawImage(img,x,y,w,h);
    }
    ctx.restore();
  }

  const previewSet=new Set(previewRoute?.piece_ids||[]);
  for(const f of model.geo.features)drawRailFeatureToCanvas(ctx,f,previewSet,scale);
  drawSelectedStationsToCanvas(ctx,scale);

  // Selected line label.
  const l=selectedLine();
  if(l){
    const label=[l.operator,l.name].filter(Boolean).join(' · ');
    ctx.save();
    ctx.font=`${12*scale}px sans-serif`;
    const pad=8*scale,h=28*scale,textW=ctx.measureText(label).width;
    const x=Math.max(10*scale,(canvas.width-textW-2*pad)/2),y=10*scale;
    ctx.globalAlpha=.93;ctx.fillStyle='#ffffff';
    ctx.fillRect(x,y,textW+2*pad,h);
    ctx.globalAlpha=1;ctx.fillStyle='#344554';
    ctx.fillText(label,x+pad,y+18*scale);
    ctx.restore();
  }

  // Attribution is retained in exported maps.
  const credit='© OpenStreetMap contributors · Rail Log';
  ctx.save();
  ctx.font=`${10*scale}px sans-serif`;
  const pad=5*scale,textW=ctx.measureText(credit).width;
  const x=canvas.width-textW-pad*3,y=canvas.height-18*scale;
  ctx.globalAlpha=.82;ctx.fillStyle='#ffffff';
  ctx.fillRect(x-pad,y-12*scale,textW+2*pad,17*scale);
  ctx.globalAlpha=1;ctx.fillStyle='#4b5563';
  ctx.fillText(credit,x,y);
  ctx.restore();

  return canvas;
}
async function exportMapPNG(){
  if(!map||!model)return;
  if(els.mapExport)els.mapExport.disabled=true;
  status('現在の地図表示をPNGに書き出しています…','');
  let usedTiles=true;
  try{
    let canvas;
    try{
      canvas=await renderMapCanvas(true);
      await canvasBlob(canvas); // detect tainted canvas before final download
    }catch(tileError){
      console.warn('Basemap export failed; retrying without raster tiles.',tileError);
      usedTiles=false;
      canvas=await renderMapCanvas(false);
    }
    const blob=await canvasBlob(canvas);
    const now=new Date(),stamp=[
      now.getFullYear(),
      String(now.getMonth()+1).padStart(2,'0'),
      String(now.getDate()).padStart(2,'0'),
      '-',
      String(now.getHours()).padStart(2,'0'),
      String(now.getMinutes()).padStart(2,'0')
    ].join('');
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=`rail-map-${stamp}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href),1500);
    status(usedTiles?'地図PNGを書き出しました。':'地図PNGを書き出しました（ブラウザーの制限によりOSM背景は省略）。','ok');
  }catch(e){
    console.error(e);
    status(`地図書き出し失敗: ${e.message}`,'error');
  }finally{
    if(els.mapExport)els.mapExport.disabled=false;
  }
}
function initMap(){
  map=L.map('map',{preferCanvas:true,zoomControl:true}).setView([36.4,138.2],5);

  tile=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:19,
    attribution:'&copy; OpenStreetMap contributors',
    className:'osm-gray',
    crossOrigin:true
  }).addTo(map);
  tile.on('load',applyGrayOSM);
  applyGrayOSM();

  // Visible railway geometry. Point features are deliberately excluded:
  // Leaflet otherwise renders GeoJSON Points as default blue pin markers.
  // Only rail line geometry is displayed here; selectable stations are drawn
  // separately as small circle markers by renderStationMarkers().
  const railGeo=railLineFeatureCollection();
  geoLayer=L.geoJSON(railGeo,{
    interactive:false,
    style:f=>({
      color:mutedLineColor(f.__color||'#6f7a82',.80),
      weight:BASE_W,
      opacity:.27,
      lineCap:'round',
      lineJoin:'round'
    }),
    onEachFeature:(f,l)=>{
      const id=f.__piece_id;
      if(!layerByPiece.has(id))layerByPiece.set(id,[]);
      layerByPiece.get(id).push(l);
    }
  }).addTo(map);

  buildMapClickIndex();

  // Robust map-level selection: does not depend on Leaflet SVG/canvas hit tests.
  map.on('click',e=>{
    const hit=nearestRailFeature(e.containerPoint,20);
    if(!hit){
      deselectLine(true);
      return;
    }
    setHoveredLine(hit.lineId);
    selectLineFromMap(hit.lineId);
  });
  map.on('mousemove',e=>scheduleMapHover(e.containerPoint));
  map.on('mouseout',()=>{
    pendingHoverPoint=null;
    if(mapHoverFrame){cancelAnimationFrame(mapHoverFrame);mapHoverFrame=0}
    clearMapHover();
  });
  map.on('zoomend moveend',()=>{
    if(hoverLineId)clearMapHover();
  });

  map.getContainer().dataset.selectableFeatures=String(mapClickIndex.length);
  map.getContainer().dataset.totalFeatures=String(railGeo.features.length);

  renderStationMarkers();
  refreshMapStyle();
  setTimeout(()=>map.invalidateSize(),0);
}
function makeTripId(){return`trip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,9)}`}
function saveRide(){
  const l=selectedLine();
  if(!l||!previewRoute)return;

  // The popup is based on the ordinary distance percentage, BEFORE any
  // automatic/manual 100% override.
  const beforeRate=ordinaryLineRate(l,trips);

  const names=previewRoute.stations.map(id=>model.stationById.get(id)?.name||id),
        t={
          id:makeTripId(),
          dataset_id:model.dataset_id,
          date:els.date.value||'',
          note:els.note.value.trim(),
          line_id:l.id,
          line_name:l.name,
          operator:l.operator,
          from_station_id:els.from.value,
          to_station_id:els.to.value,
          station_names:names,
          length_m:previewRoute.length_m,
          piece_ids:previewRoute.piece_ids,
          section_ids:previewRoute.sections.map(s=>s.id),
          created_at:new Date().toISOString()
        };

  trips.push(t);
  C.saveTrips(storageKey,trips);

  const afterRate=ordinaryLineRate(l,trips);

  previewRoute=null;
  els.save.disabled=true;
  if(els.mapSave)els.mapSave.disabled=true;
  els.note.value='';
  els.route.innerHTML='';
  els.route.disabled=true;
  els.stopNames.textContent='';
  els.routeInfo.textContent='保存しました。次の区間を選択できます。';

  recompute();
  status('乗車記録を保存しました。乗車済み区間は太線のまま残ります。','ok');

  const automatic=C.completedLineIds(trips,model).has(l.id);
  const crossed95=beforeRate<95&&afterRate>=95&&afterRate<100;

  if(
    crossed95 &&
    !automatic &&
    !manualCompleteLines.has(l.id) &&
    window.confirm(
      `${l.name} の通常達成率が ${afterRate.toFixed(1)}% になりました。
`+
      `残りがデータ上の微小な重複・誤差であれば、この路線を100%として記録しますか？`
    )
  ){
    setManualComplete(l,true,true);
  }
}
function recompute(){ridden=effectiveRiddenSet();refreshMapStyle();renderOverall();renderStats();renderHistory();updateManualCompleteButton();renderDataInfo()}
function renderOverall(){const a=C.aggregatePieces(model.pieces.filter(p=>p.eligible),ridden);els.overall.textContent=a.total?`${a.rate.toFixed(1)}%`:'—';els.overallDistance.textContent=a.total?`${fmtKm(a.done)} / ${fmtKm(a.total)}`:'集計対象なし'}
function statRow(name,done,total,color=''){const rate=C.pct(done,total),barColor=color||'var(--accent)';return`<tr><td>${color?`<span class="op-dot" style="background:${C.esc(color)}"></span>`:''}${C.esc(name)}</td><td>${total?`${C.esc(fmtKm(done))} / ${C.esc(fmtKm(total))}`:'データなし'}</td><td><div class="rate-cell"><div class="progress" aria-label="${rate.toFixed(1)}%"><span style="width:${Math.max(0,Math.min(100,rate))}%;background:${C.esc(barColor)}"></span></div><span class="rate-label">${total?rate.toFixed(1)+'%':'—'}</span></div></td></tr>`}
function renderStats(){const view=els.statsView.value;let html='';
  if(view==='jr6'){const rows=C.JR6.map(canon=>{const ps=model.pieces.filter(p=>p.eligible&&C.jrCompany(p.operator)===canon),x=C.aggregatePieces(ps,ridden),ops=model.operators.filter(o=>C.jrCompany(o.name)===canon),color=ops[0]?.color||'#5f6b73';return{name:C.JR6_LABELS[canon]||canon,...x,color}});html=rows.map(r=>statRow(r.name,r.done,r.total,r.color)).join('')}
  else if(view==='private_operators'){const names=C.uniq(model.pieces.filter(p=>p.eligible&&p.group==='non_jr').map(p=>p.operator).filter(Boolean)),rows=names.map(name=>{const x=C.aggregatePieces(model.pieces.filter(p=>p.eligible&&p.group==='non_jr'&&p.operator===name),ridden);return{name,...x,color:opColor(name)}}).sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name,'ja'));html=rows.map(r=>statRow(r.name,r.done,r.total,r.color)).join('')}
  else if(view==='jr_lines'||view==='private_lines'){const g=view==='jr_lines'?'jr':'non_jr';let lines=model.lines.filter(l=>l.eligible!==false&&l.group===g&&l.kind==='formal');if(!lines.length)lines=model.lines.filter(l=>l.eligible!==false&&l.group===g);const rows=lines.map(l=>{const x=C.aggregatePieces(linePieces(l).filter(p=>p.eligible),ridden);return{name:l.name,operator:l.operator,...x,color:opColor(l.operator)}}).filter(r=>r.total>0).sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name,'ja'));html=rows.map(r=>statRow(`${r.name}${r.operator?' · '+r.operator:''}`,r.done,r.total,r.color)).join('')}
  else if(view==='jr_private'){const cats=[['JR線','jr'],['私鉄線','non_jr']];html=cats.map(([name,g])=>{const x=C.aggregatePieces(model.pieces.filter(p=>p.eligible&&p.group===g),ridden);return statRow(name,x.done,x.total,g==='jr'?'#398849':'#66727c')}).join('')}
  else{const groups=new Map();for(const p of model.pieces.filter(p=>p.eligible))for(const a of C.allocations(p)){const key=a.code||a.name||'00',name=a.name||a.code||'未配分';if(!groups.has(key))groups.set(key,{name,total:0,done:0});const g=groups.get(key);g.total+=a.length_m;if(ridden.has(p.id))g.done+=a.length_m}const rows=[...groups.values()].sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name,'ja'));html=rows.map(r=>statRow(r.name,r.done,r.total)).join('')}
  els.statsRows.innerHTML=html||'<tr><td colspan="3" class="muted">集計対象データがありません。</td></tr>'
}
function renderHistory(){els.tripCount.textContent=`(${trips.length})`;els.selectAllRecords.disabled=!trips.length;els.deleteSelected.disabled=!trips.length;if(!trips.length){els.history.innerHTML='<p class="muted">まだ乗車記録がありません。</p>';return}els.history.innerHTML=[...trips].reverse().map(t=>{const names=t.station_names||[],route=names.length?`${names[0]} → ${names[names.length-1]}`:'';return`<div class="history-item"><div class="history-check"><input class="history-select" type="checkbox" value="${C.esc(t.id||'')}" aria-label="この記録を選択"></div><div class="history-date">${C.esc(t.date||new Date(t.created_at||Date.now()).toLocaleDateString('ja-JP'))}</div><div class="history-main"><strong><span class="op-dot" style="background:${C.esc(opColor(t.operator||''))}"></span>${C.esc(t.line_name||t.line_id||'路線')}</strong><small>${C.esc([t.operator,route,t.note].filter(Boolean).join(' · '))}</small></div><div class="history-km">${C.esc(fmtKm(t.length_m||0))}</div></div>`}).join('')}
function selectedRecordIds(){return new Set([...document.querySelectorAll('.history-select:checked')].map(x=>x.value).filter(Boolean))}
function toggleSelectAll(){const boxes=[...document.querySelectorAll('.history-select')];if(!boxes.length)return;const shouldCheck=boxes.some(b=>!b.checked);for(const b of boxes)b.checked=shouldCheck;els.selectAllRecords.textContent=shouldCheck?'全解除':'全選択'}
function batchDelete(){const ids=selectedRecordIds();if(!ids.size){status('削除する記録にチェックを付けてください。','error');return}if(!window.confirm(`${ids.size} 件の乗車記録を削除しますか？`))return;trips=trips.filter(t=>!ids.has(t.id));C.saveTrips(storageKey,trips);status(`${ids.size} 件を削除しました。`,'ok');recompute()}
function undo(){if(!trips.length)return;trips.pop();C.saveTrips(storageKey,trips);status('直前の記録を削除しました。','ok');recompute()}
function exportBackup(){
  const portable=trips.map(t=>({...t,dataset_id:model.dataset_id,piece_ids:C.tripPieceIds(t,model)})),
        manual=manualCompleteRecords(),
        payload={
          version:6,
          format:'rail-log-portable',
          dataset_id:model.dataset_id,
          frontend_version:FRONTEND_VERSION,
          exported_at:new Date().toISOString(),
          trip_count:portable.length,
          manual_complete_count:manual.length,
          manual_complete_lines:manual,
          trips:portable
        };
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),
        a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`rail-log-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  status(`${portable.length} 件と手動100%指定 ${manual.length} 路線をバックアップしました。`,'ok')
}
function importBackup(file){
  const r=new FileReader();
  r.onload=()=>{
    try{
      const v=JSON.parse(r.result),
            incoming=Array.isArray(v)?v:(Array.isArray(v?.trips)?v.trips:null);
      if(!incoming)throw new Error('乗車記録 trips が見つかりません。');

      const restored=incoming.map(t0=>C.rebindTrip({...t0,id:t0.id||makeTripId()},model)),
            resolved=restored.filter(t=>!t.unresolved&&C.tripPieceIds(t,model).length).length,
            unresolved=restored.length-resolved,
            manualIncoming=Array.isArray(v?.manual_complete_lines)?v.manual_complete_lines:[];

      if(
        (trips.length||manualCompleteLines.size) &&
        !window.confirm(
          `現在の ${trips.length} 件の乗車記録と手動100%指定 ${manualCompleteLines.size} 路線を、`+
          `バックアップ内容で置き換えます。よろしいですか？`
        )
      ){
        status('読み込みをキャンセルしました。','error');
        return;
      }

      trips=restored;
      C.saveTrips(storageKey,trips);

      manualCompleteLines=new Set(
        manualIncoming.map(resolveManualLineRecord).filter(Boolean)
      );
      saveManualCompleteLines();

      previewRoute=null;
      els.save.disabled=true;
      if(els.mapSave)els.mapSave.disabled=true;

      recompute();

      const msg=`${restored.length} 件を復元しました。手動100%指定 ${manualCompleteLines.size} 路線。`;
      status(
        unresolved
          ? `${msg} ${unresolved} 件は現在の路線データに再接続できませんでした。`
          : `${msg} 地図・履歴・達成率を更新しました。`,
        'ok'
      );
    }catch(e){
      status(`読み込み失敗: ${e.message}`,'error')
    }
  };
  r.readAsText(file)
}
function renderDataInfo(){
  const audit=model.metadata?.network_audit||{},
        allLineFeatures=(model.geo.features||[]).filter(f=>Boolean(lineGeometryOnly(f.geometry))),
        eligibleLineFeatures=allLineFeatures.filter(featureEligibleForMap),
        hiddenIneligible=allLineFeatures.length-eligibleLineFeatures.length,
        mapped=mapClickIndex.length,
        completed=C.completedLineIds(trips,model).size,
        nonLine=(model.geo.features||[]).length-allLineFeatures.length;
  els.dataInfo.innerHTML=
    `<p>Frontend: <code>${FRONTEND_VERSION}</code> / Dataset ID: <code>${C.esc(model.dataset_id)}</code></p>`+
    `<p>路線候補 ${model.lines.length.toLocaleString()} / 駅 ${model.stations.length.toLocaleString()} / 区間 ${model.sections.length.toLocaleString()} / 地図ピース ${model.pieces.length.toLocaleString()}</p>`+
    `<p>地図クリック対応: <strong>${mapped.toLocaleString()} / ${eligibleLineFeatures.length.toLocaleString()}</strong> eligible rail geometries</p>`+
    `<p>03で対象外判定された非表示線形: <strong>${hiddenIneligible.toLocaleString()}</strong></p>`+
    `<p>隣接駅間を全て走破して100%判定された路線: <strong>${completed.toLocaleString()}</strong></p>`+
    `<p>手動100%指定: <strong>${manualCompleteLines.size.toLocaleString()}</strong> 路線</p>`+
    (nonLine?`<p>GeoJSON の非線形形状 ${nonLine.toLocaleString()} 件は地図表示から除外しています。</p>`:'')+
    (mapped<eligibleLineFeatures.length?`<p><strong>注意:</strong> ${eligibleLineFeatures.length-mapped} 個のeligible線形は路線IDへ対応付けできていません。</p>`:'')+
    (audit.subset?'<p><strong>注意:</strong> 現在のエクスポートは部分データです。</p>':'');
}
function bind(){
  els.search.addEventListener('input',populateLines);els.pref.addEventListener('change',populateLines);els.railGroup.addEventListener('change',()=>{populateOperators();populateLines()});els.operator.addEventListener('change',populateLines);els.kind.addEventListener('change',populateLines);els.line.addEventListener('change',()=>{if(els.line.value){lineDeselected=false;selectLine()}else deselectLine(false)});
  els.from.addEventListener('change',()=>{stationPickPhase='to';renderStationMarkers();autoPreview(false)});els.to.addEventListener('change',()=>{stationPickPhase='from';renderStationMarkers();autoPreview(false)});els.via.addEventListener('change',()=>autoPreview(false));
  els.preview.addEventListener('click',doPreview);els.save.addEventListener('click',saveRide);if(els.manualComplete)els.manualComplete.addEventListener('click',toggleManualComplete);if(els.mapSave)els.mapSave.addEventListener('click',saveRide);if(els.mapExport)els.mapExport.addEventListener('click',exportMapPNG);els.fit.addEventListener('click',fitLine);els.basemap.addEventListener('change',()=>{if(els.basemap.checked){if(!map.hasLayer(tile))tile.addTo(map);applyGrayOSM()}else if(map.hasLayer(tile))map.removeLayer(tile)});
  els.statsView.addEventListener('change',renderStats);els.selectAllRecords.addEventListener('click',toggleSelectAll);els.deleteSelected.addEventListener('click',batchDelete);els.undo.addEventListener('click',undo);els.export.addEventListener('click',exportBackup);els.import.addEventListener('click',()=>els.importFile.click());els.importFile.addEventListener('change',()=>{if(els.importFile.files[0])importBackup(els.importFile.files[0]);els.importFile.value=''})
}
async function load(){try{const[nr,gr]=await Promise.all([fetch('data/network.json',{cache:'no-store'}),fetch('data/geometry.geojson',{cache:'no-store'})]);if(!nr.ok||!gr.ok)throw new Error(`data/network.json ${nr.status}; geometry.geojson ${gr.status}`);model=C.normalize(await nr.json(),await gr.json());rebuildPieceLineMap();const store=C.loadTrips(model);storageKey=store.key;trips=store.trips.map(t=>t.id?t:{...t,id:makeTripId()});C.saveTrips(storageKey,trips);loadManualCompleteLines();ridden=effectiveRiddenSet();populatePref();populateOperators();populateLines();bind();initMap();renderOverall();renderStats();renderHistory();renderDataInfo();els.banner.hidden=true}catch(e){console.error(e);els.banner.hidden=false;els.banner.textContent=`データ読み込みエラー: ${e.message}`;els.overall.textContent='—';els.overallDistance.textContent='05Bの出力とローカルサーバーを確認してください。'}}
window.addEventListener('DOMContentLoaded',load);
})();
