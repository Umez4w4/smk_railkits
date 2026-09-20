(function(){
'use strict';
const FRONTEND_VERSION='2026-09-20-v44-map-undo-redo-station-order',C=window.RailCore,$=id=>document.getElementById(id);
const RAIL_DEFAULT_COUNTRY='jp';

function railCountryCode(){
  try{
    const q=new URLSearchParams(window.location.search).get('country');
    if(q&&/^[a-z0-9_-]{2,12}$/i.test(q))return q.toLowerCase();
  }catch(e){}
  return String(window.RAIL_COUNTRY||RAIL_DEFAULT_COUNTRY).toLowerCase();
}

function railDataURL(name){
  const country=railCountryCode();
  const rel=`data/${country}/${name}`;
  return new URL(rel,document.baseURI).href;
}

async function fetchRailJSON(name){
  const url=railDataURL(name);
  let response;
  try{
    response=await fetch(url,{cache:'no-store'});
  }catch(e){
    throw new Error(`${name}: network request failed (${url})`);
  }

  if(!response.ok){
    throw new Error(`${name}: HTTP ${response.status} (${url})`);
  }

  try{
    return await response.json();
  }catch(e){
    throw new Error(`${name}: invalid JSON (${url})`);
  }
}
const els={search:$('search'),pref:$('pref'),railGroup:$('railGroup'),operator:$('operator'),kind:$('kind'),line:$('line'),lineCount:$('lineCount'),lineInfo:$('lineInfo'),manualComplete:$('manualComplete'),from:$('from'),to:$('to'),via:$('via'),preview:$('preview'),route:$('route'),routeInfo:$('routeInfo'),stops:$('stops'),stopNames:$('stopNames'),date:$('date'),note:$('note'),save:$('save'),mapSave:$('mapSave'),mapExport:$('mapExport'),mapSelectionInfo:$('mapSelectionInfo'),message:$('message'),fit:$('fit'),basemap:$('basemap'),statsView:$('statsView'),statsRows:$('statsRows'),overall:$('overall'),overallDistance:$('overallDistance'),history:$('history'),tripCount:$('tripCount'),selectAllRecords:$('selectAllRecords'),deleteSelected:$('deleteSelected'),undo:$('undo'),redo:$('redo'),mapUndo:$('mapUndo'),mapRedo:$('mapRedo'),export:$('export'),import:$('import'),importFile:$('importFile'),dataInfo:$('dataInfo'),banner:$('banner'),exportUserName:document.getElementById('exportUserName'),exportProgressMode:document.getElementById('exportProgressMode')};
let model=null,map=null,tile=null,displayGeo=null,displayLayer=null,geoLayer=null,lineHitLayer=null,stationLayer=null,layerByPiece=new Map(),storageKey='',trips=[],ridden=new Set(),previewRoute=null,stationPickPhase='from',hoverLineId='',hoverStationId='',hoverClearTimer=null,pieceLineMap=new Map(),mapClickIndex=[],mapHoverFrame=0,pendingHoverPoint=null,lineDeselected=false,selectedPieceIds=new Set(),manualCompleteLines=new Set(),manualCompleteStorageKey='',redoStack=[];
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
function stationIdsForLine(l){
  if(!l)return[];

  const validStation=id=>{
    id=String(id||'');
    return id && !id.startsWith('rn_') && model.stationById.has(id);
  };

  const explicit=C.uniq(
    (l.station_ids||[]).map(String).filter(validStation)
  );

  const sectionIds=(l.section_ids||[]).length
    ? l.section_ids
    : model.sections.filter(s=>s.line_id===l.id).map(s=>s.id);

  const sections=sectionIds
    .map(id=>model.sectionById.get(id))
    .filter(s=>s&&s.from&&s.to);

  if(!sections.length)return explicit;

  const adj=new Map();
  const add=(a,b)=>{
    a=String(a||'');b=String(b||'');
    if(!a||!b||a===b)return;
    if(!adj.has(a))adj.set(a,new Set());
    adj.get(a).add(b);
  };

  for(const s of sections){
    add(s.from,s.to);
    add(s.to,s.from);
  }

  if(!adj.size)return explicit;

  const nodes=[...adj.keys()];
  const endpoints=nodes.filter(id=>(adj.get(id)?.size||0)===1);
  const branched=nodes.some(id=>(adj.get(id)?.size||0)>2);

  // A branch cannot be represented by one unique dropdown order.
  // Preserve the backend order instead of inventing a misleading sequence.
  if(branched){
    return explicit.length
      ? explicit
      : C.uniq(nodes.filter(validStation));
  }

  // Circular lines also have no unique first station. Preserve the
  // exporter-provided order when it exists.
  if(endpoints.length!==2){
    return explicit.length
      ? explicit
      : C.uniq(nodes.filter(validStation));
  }

  // Linear line: reconstruct the physical sequence from section adjacency.
  // Pick the endpoint nearest to the first exporter-provided station so the
  // displayed direction stays as close as possible to the original data.
  const preferred=explicit[0]||'';

  const distance=(start,target)=>{
    if(!target)return Infinity;
    const q=[[start,0]],seen=new Set([start]);
    for(let i=0;i<q.length;i++){
      const [u,d]=q[i];
      if(u===target)return d;
      for(const v of adj.get(u)||[]){
        if(seen.has(v))continue;
        seen.add(v);
        q.push([v,d+1]);
      }
    }
    return Infinity;
  };

  let start=endpoints[0];
  if(preferred){
    const d0=distance(endpoints[0],preferred);
    const d1=distance(endpoints[1],preferred);
    if(d1<d0)start=endpoints[1];
  }

  const orderedNodes=[];
  const visited=new Set();
  let previous='';
  let current=start;

  while(current&&!visited.has(current)){
    orderedNodes.push(current);
    visited.add(current);

    const next=[...(adj.get(current)||[])]
      .find(id=>id!==previous&&!visited.has(id));

    previous=current;
    current=next||'';
  }

  const ordered=C.uniq(
    orderedNodes.filter(validStation)
  );

  if(explicit.length){
    const orderedSet=new Set(ordered);
    if(explicit.every(id=>orderedSet.has(id)))return ordered;
    return explicit;
  }

  return ordered;
}
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
  els.route.innerHTML=option('0',`${fmtKm(r.length_m)} · ${r.piece_ids.length} 線路片`,true);
  els.route.disabled=false;
  els.save.disabled=false;
  if(els.mapSave)els.mapSave.disabled=false;
  const stationNames=r.stations.filter(id=>!String(id).startsWith('rn_')).map(id=>model.stationById.get(id)?.name||id);
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

// RAIL_LOG_V34_COMPLETE_N02_DISPLAY
function rawDisplayStyle(f){
  const p=f?.properties||{},
        lid=String(p.line_id||''),
        selected=lid&&lid===els.line.value,
        base=opColor(String(p.operator||''));

  return{
    color:selected?base:mutedLineColor(base,.82),
    weight:selected?4.0:BASE_W,
    opacity:selected?.92:.30,
    lineCap:'round',
    lineJoin:'round'
  };
}

// RAIL_DEFERRED_DISPLAY_NETWORK
function installDeferredDisplayLayer(){
  if(!map || displayLayer || !displayGeo?.features?.length) return;

  displayLayer=L.geoJSON(displayGeo,{
    interactive:false,
    style:f=>rawDisplayStyle(f)
  }).addTo(map);

  // It is a passive safety/background layer.
  if(displayLayer.bringToBack) displayLayer.bringToBack();
}

function refreshMapStyle(){if(displayLayer)displayLayer.setStyle(f=>rawDisplayStyle(f));if(!geoLayer)return;const previewSet=new Set(previewRoute?.piece_ids||[]);geoLayer.setStyle(f=>visualStyleForFeature(f,previewSet));for(const id of ridden)for(const l of layerByPiece.get(id)||[])l.bringToFront?.();for(const id of previewSet)for(const l of layerByPiece.get(id)||[])l.bringToFront?.();if(stationLayer)stationLayer.eachLayer(l=>l.bringToFront?.())}
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

// RAIL_LOG_V40_EXPORT_PROFILE
const EXPORT_PROFILE_KEY='rail-log:v35:export-profile';


function exportUiIsChinese(){
  return (document.documentElement.lang||'')
    .toLowerCase()
    .startsWith('zh');
}

function refreshExportProfileLanguage(){
  const zh=exportUiIsChinese();

  const userLabel=document.getElementById('exportUserNameLabel');
  const progressLabel=document.getElementById('exportProgressLabel');

  if(userLabel){
    userLabel.textContent=zh?'用户名':'ユーザー名';
  }

  if(progressLabel){
    progressLabel.textContent=zh?'导出地图显示的进度':'PNGに表示する進捗';
  }

  const select=els.exportProgressMode;
  if(select){
    const labels=zh
      ?{
          overall:'总进度',
          jr6:'JR线：6家客运公司',
          jr_private:'JR线 / 私铁线'
        }
      :{
          overall:'総合達成率',
          jr6:'JR線：旅客6社別',
          jr_private:'JR線 / 私鉄線'
        };

    for(const option of select.options){
      option.textContent=labels[option.value]||option.textContent;
    }
  }
}

function loadExportProfile(){
  let saved={};
  try{
    saved=JSON.parse(localStorage.getItem(EXPORT_PROFILE_KEY)||'{}')||{};
  }catch{}

  if(els.exportUserName){
    els.exportUserName.value=String(saved.username||'username');
  }
  if(els.exportProgressMode){
    const mode=String(saved.progressMode||'overall');
    els.exportProgressMode.value=['overall','jr6','jr_private'].includes(mode)?mode:'overall';
  }

  refreshExportProfileLanguage();
}

function saveExportProfile(){
  const payload={
    username:String(els.exportUserName?.value||'username').trim().slice(0,40),
    progressMode:String(els.exportProgressMode?.value||'overall')
  };
  localStorage.setItem(
    EXPORT_PROFILE_KEY,
    JSON.stringify(payload)
  );
}


function exportPieceOperatorName(piece){
  // RailCore.normalize() already puts the canonical operator name here.
  return String(
    piece?.operator
    ||piece?.raw?.operator
    ||piece?.raw?.operator_name
    ||model?.lineById?.get?.(String(piece?.line_id||''))?.operator
    ||''
  );
}

function exportPieceJrCompany(piece){
  // Prefer the normalized canonical JR company directly.
  const direct=String(piece?.jr_company||'');
  if(direct)return direct;

  const operator=exportPieceOperatorName(piece);
  return C.jrCompany(operator);
}

function exportPieceGroup(piece){
  const direct=String(piece?.group||'').toLowerCase();

  if(direct==='jr')return 'jr';
  if(direct==='non_jr'||direct==='private')return 'private';

  const line=model?.lineById?.get?.(String(piece?.line_id||''));
  const lineGroup=String(line?.group||'').toLowerCase();

  if(lineGroup==='jr')return 'jr';
  if(lineGroup==='non_jr'||lineGroup==='private')return 'private';

  return exportPieceJrCompany(piece)?'jr':'private';
}

function aggregateExportItems(items){
  const valid=(items||[]).filter(p=>p&&p.eligible!==false);
  const stat=C.aggregatePieces(valid,ridden);
  const total=Number(stat.total||0);
  const done=Number(stat.done||0);

  return{
    total,
    done,
    rate:total>0?Math.max(0,Math.min(1,done/total)):0,
    piece_count:valid.length
  };
}

function progressMetricsForExport(){
  const mode=String(els.exportProgressMode?.value||'overall');
  const allPieces=model?.pieces||[];
  const zh=exportUiIsChinese();

  if(mode==='jr6'){
    const companies=[
      ['北海道旅客鉄道','JR北海道','JR北海道'],
      ['東日本旅客鉄道','JR東日本','JR东日本'],
      ['東海旅客鉄道','JR東海','JR东海'],
      ['西日本旅客鉄道','JR西日本','JR西日本'],
      ['四国旅客鉄道','JR四国','JR四国'],
      ['九州旅客鉄道','JR九州','JR九州']
    ];

    return{
      mode,
      title:zh?'JR线：6家客运公司':'JR線：旅客6社別',
      username:String(els.exportUserName?.value||'username').trim(),
      rows:companies.map(([official,ja,cn])=>{
        const items=allPieces.filter(
          p=>exportPieceJrCompany(p)===official
        );
        return{
          label:zh?cn:ja,
          color:opColor(official),
          ...aggregateExportItems(items)
        };
      })
    };
  }

  if(mode==='jr_private'){
    const jrItems=allPieces.filter(
      p=>exportPieceGroup(p)==='jr'
    );
    const privateItems=allPieces.filter(
      p=>exportPieceGroup(p)==='private'
    );

    return{
      mode,
      title:zh?'JR线 / 私铁线':'JR線 / 私鉄線',
      username:String(els.exportUserName?.value||'username').trim(),
      rows:[
        {
          label:zh?'JR线':'JR線',
          color:opColor('東日本旅客鉄道'),
          ...aggregateExportItems(jrItems)
        },
        {
          label:zh?'私铁线':'私鉄線',
          color:opColor('東急電鉄'),
          ...aggregateExportItems(privateItems)
        }
      ]
    };
  }

  return{
    mode:'overall',
    title:zh?'总进度':'総合達成率',
    username:String(els.exportUserName?.value||'username').trim(),
    rows:[
      {
        label:zh?'全国':'全国',
        color:'#4f5b62',
        ...aggregateExportItems(allPieces)
      }
    ]
  };
}


function drawLoggedRailFeatureToCanvas(ctx,f,scale){
  const p=f?.properties||{};
  const pid=String(f?.__piece_id||p.piece_id||'');
  const lineId=String(p.line_id||pieceLineMap.get(pid)||'');
  const operator=String(
    p.operator
    ||model?.lineById?.get?.(lineId)?.operator
    ||''
  );

  // IMPORTANT:
  // Export state is based only on actual/effective ridden state.
  // It intentionally ignores els.line.value / selected-line highlighting.
  const isRidden=Boolean(pid&&ridden.has(pid));

  const base=opColor(operator);
  const color=isRidden?base:mutedLineColor(base,.88);
  const widthPx=(isRidden?3.5:1.05)*scale;
  const alpha=isRidden?.96:.22;

  ctx.save();
  ctx.globalAlpha=alpha;
  ctx.strokeStyle=color;
  ctx.lineWidth=widthPx;
  ctx.lineCap='round';
  ctx.lineJoin='round';

  const parts=geometryLineParts(f.geometry);
  for(const coords of parts){
    if(!coords?.length)continue;
    ctx.beginPath();

    let started=false;
    for(const coord of coords){
      const pt=map.latLngToContainerPoint(
        L.latLng(Number(coord[1]),Number(coord[0]))
      );
      const x=pt.x*scale;
      const y=pt.y*scale;

      if(!started){
        ctx.moveTo(x,y);
        started=true;
      }else{
        ctx.lineTo(x,y);
      }
    }

    if(started)ctx.stroke();
  }

  ctx.restore();
}

function drawExportProgressOverlay(ctx,width,height,scale){
  const metric=progressMetricsForExport();

  console.debug(
    'PNG progress metric',
    metric.mode,
    metric.rows.map(r=>({
      label:r.label,
      pieces:r.piece_count,
      total_km:r.total/1000,
      done_km:r.done/1000
    }))
  );

  // Compact top-left card.
  const pad=10*scale;
  const rowH=25*scale;
  const headerH=37*scale;
  const footerPad=8*scale;
  const panelH=headerH + metric.rows.length*rowH + footerPad;
  const panelW=Math.min(width-pad*2,355*scale);
  const x=pad;
  const y=pad;

  ctx.save();

  // Compact translucent white card.
  ctx.globalAlpha=.88;
  ctx.fillStyle='#ffffff';
  ctx.fillRect(x,y,panelW,panelH);

  ctx.globalAlpha=1;
  ctx.strokeStyle='#c8d0d5';
  ctx.lineWidth=Math.max(.7,scale*.75);
  ctx.strokeRect(x,y,panelW,panelH);

  // Username.
  ctx.fillStyle='#263238';
  ctx.font=`600 ${10.5*scale}px sans-serif`;
  ctx.textBaseline='top';
  ctx.textAlign='left';
  ctx.fillText(
    metric.username||'username',
    x+8*scale,
    y+6*scale,
    panelW-16*scale
  );

  // Brand, small and unobtrusive.
  ctx.textAlign='right';
  ctx.fillStyle='#778188';
  ctx.font=`${7.3*scale}px sans-serif`;
  ctx.fillText(
    'Sing Man Goon Railway Toolkit',
    x+panelW-8*scale,
    y+7*scale
  );
  ctx.textAlign='left';

  // Mode title.
  ctx.fillStyle='#53626c';
  ctx.font=`600 ${8.6*scale}px sans-serif`;
  ctx.fillText(
    metric.title,
    x+8*scale,
    y+21*scale,
    panelW-16*scale
  );

  metric.rows.forEach((row,index)=>{
    const rowY=y+headerH+index*rowH;
    const pct=(row.rate*100).toFixed(1);
    const kmDone=(row.done/1000).toFixed(1);
    const kmTotal=(row.total/1000).toFixed(1);

    ctx.fillStyle='#425058';
    ctx.font=`${7.8*scale}px sans-serif`;
    ctx.fillText(
      `${row.label}  ${pct}%  (${kmDone} / ${kmTotal} km)`,
      x+8*scale,
      rowY,
      panelW-16*scale
    );

    const barX=x+8*scale;
    const barY=rowY+13*scale;
    const barW=panelW-16*scale;
    const barH=5.5*scale;

    // Unridden/background portion.
    ctx.fillStyle='#dbe2e6';
    ctx.fillRect(barX,barY,barW,barH);

    // Ridden/completed portion in the SAME color logic as live map.
    ctx.fillStyle=row.color||'#4f5b62';
    ctx.fillRect(
      barX,
      barY,
      barW*row.rate,
      barH
    );
  });

  ctx.restore();
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
  for(const f of model.geo.features)drawLoggedRailFeatureToCanvas(ctx,f,scale);
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

  drawExportProgressOverlay(ctx,canvas.width,canvas.height,scale);
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
  if(displayGeo?.features?.length){
    displayLayer=L.geoJSON(displayGeo,{
      interactive:false,
      style:f=>rawDisplayStyle(f)
    }).addTo(map);
  }

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

  const names=previewRoute.stations.filter(id=>!String(id).startsWith('rn_')).map(id=>model.stationById.get(id)?.name||id),
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

  clearRedoStack();
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
// RAIL_LOG_V34_DATE_EDITOR
function editableTripDateValue(t){
  const raw=String(t?.date||'').trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw;
  const m=String(t?.created_at||'').match(/^(\d{4}-\d{2}-\d{2})/);
  return m?m[1]:'';
}

function updateRecordDate(id,value){
  const t=trips.find(x=>String(x.id||'')===String(id||''));
  if(!t)return;
  const v=String(value||'').trim();
  if(v&&!/^\d{4}-\d{2}-\d{2}$/.test(v)){
    status('日付の形式が正しくありません。','error');
    renderHistory();
    return;
  }
  t.date=v;
  C.saveTrips(storageKey,trips);
  status(v?`乗車日を ${v} に更新しました。`:'乗車日の指定を解除しました。','ok');
}

function renderHistory(){
  updateUndoRedoButtons();
  els.tripCount.textContent=`(${trips.length})`;
  els.selectAllRecords.disabled=!trips.length;
  els.deleteSelected.disabled=!trips.length;

  if(!trips.length){
    els.history.innerHTML='<p class="muted">まだ乗車記録がありません。</p>';
    return;
  }

  els.history.innerHTML=[...trips].reverse().map(t=>{
    const names=t.station_names||[],
          route=names.length?`${names[0]} → ${names[names.length-1]}`:'',
          id=C.esc(t.id||''),
          d=editableTripDateValue(t);

    return `<div class="history-item">
      <div class="history-check">
        <input class="history-select" type="checkbox" value="${id}" aria-label="この記録を選択">
      </div>
      <div class="history-date">
        <input class="history-date-input" type="date"
          value="${C.esc(d)}" data-trip-id="${id}"
          aria-label="乗車日を編集 / 编辑乘车日期">
      </div>
      <div class="history-main">
        <strong><span class="op-dot" style="background:${C.esc(opColor(t.operator||''))}"></span>${C.esc(t.line_name||t.line_id||'路線')}</strong>
        <small>${C.esc([t.operator,route,t.note].filter(Boolean).join(' · '))}</small>
      </div>
      <div class="history-km">${C.esc(fmtKm(t.length_m||0))}</div>
    </div>`;
  }).join('');
}
function selectedRecordIds(){return new Set([...document.querySelectorAll('.history-select:checked')].map(x=>x.value).filter(Boolean))}
function toggleSelectAll(){const boxes=[...document.querySelectorAll('.history-select')];if(!boxes.length)return;const shouldCheck=boxes.some(b=>!b.checked);for(const b of boxes)b.checked=shouldCheck;els.selectAllRecords.textContent=shouldCheck?'全解除':'全選択'}
function batchDelete(){const ids=selectedRecordIds();if(!ids.size){status('削除する記録にチェックを付けてください。','error');return}if(!window.confirm(`${ids.size} 件の乗車記録を削除しますか？`))return;clearRedoStack();trips=trips.filter(t=>!ids.has(t.id));C.saveTrips(storageKey,trips);status(`${ids.size} 件を削除しました。`,'ok');recompute()}
function updateUndoRedoButtons(){
  const canUndo=trips.length>0;
  const canRedo=redoStack.length>0;
  if(els.undo)els.undo.disabled=!canUndo;
  if(els.redo)els.redo.disabled=!canRedo;
  if(els.mapUndo)els.mapUndo.disabled=!canUndo;
  if(els.mapRedo)els.mapRedo.disabled=!canRedo;
}
function clearRedoStack(){
  redoStack=[];
  updateUndoRedoButtons();
}
function undo(){
  if(!trips.length)return;
  const removed=trips.pop();
  if(removed)redoStack.push(removed);
  C.saveTrips(storageKey,trips);
  status('直前の記録を取り消しました。','ok');
  recompute();
  updateUndoRedoButtons();
}
function redo(){
  if(!redoStack.length)return;
  const restored=redoStack.pop();
  if(restored)trips.push(restored);
  C.saveTrips(storageKey,trips);
  status('取り消した記録を復元しました。','ok');
  recompute();
  updateUndoRedoButtons();
}
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

      clearRedoStack();
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
  els.statsView.addEventListener('change',renderStats);els.exportUserName?.addEventListener('change',saveExportProfile);els.exportUserName?.addEventListener('blur',saveExportProfile);els.exportProgressMode?.addEventListener('change',saveExportProfile);const exportLangObserver=new MutationObserver(()=>refreshExportProfileLanguage());exportLangObserver.observe(document.documentElement,{attributes:true,attributeFilter:['lang']});els.history.addEventListener('change',ev=>{const x=ev.target?.closest?.('.history-date-input');if(x)updateRecordDate(x.dataset.tripId,x.value)});els.selectAllRecords.addEventListener('click',toggleSelectAll);els.deleteSelected.addEventListener('click',batchDelete);els.undo.addEventListener('click',undo);els.redo?.addEventListener('click',redo);els.mapUndo?.addEventListener('click',undo);els.mapRedo?.addEventListener('click',redo);els.export.addEventListener('click',exportBackup);els.import.addEventListener('click',()=>els.importFile.click());els.importFile.addEventListener('change',()=>{if(els.importFile.files[0])importBackup(els.importFile.files[0]);els.importFile.value=''})
}
async function load(){
  try{
    if(!C){
      throw new Error('core.js was not loaded before app.js');
    }
    if(typeof L==='undefined'){
      throw new Error('Leaflet was not loaded');
    }

    const country=railCountryCode();
    window.RAIL_COUNTRY=country;
    window.RAIL_DATA_BASE=`data/${country}`;

    // Only the model and processed geometry block startup.
    const [networkData,geometryData]=await Promise.all([
      fetchRailJSON('network.json'),
      fetchRailJSON('geometry.geojson')
    ]);

    model=C.normalize(networkData,geometryData);
    rebuildPieceLineMap();

    const store=C.loadTrips(model);
    storageKey=store.key;
    trips=store.trips.map(t=>t.id?t:{...t,id:makeTripId()});
    C.saveTrips(storageKey,trips);

    loadManualCompleteLines();
    ridden=effectiveRiddenSet();
    populatePref();
    populateOperators();
    populateLines();
    bind();
    initMap();
    renderOverall();
    renderStats();
    renderHistory();
    renderDataInfo();

    els.banner.hidden=true;

    // Passive full-N02 display network loads later and never blocks the app.
    const loadPassiveDisplay=async()=>{
      try{
        displayGeo=await fetchRailJSON('display_network.geojson');
        installDeferredDisplayLayer();
      }catch(displayError){
        console.warn(
          'Optional display_network.geojson was not loaded:',
          displayError
        );
      }
    };

    if('requestIdleCallback' in window){
      requestIdleCallback(()=>loadPassiveDisplay(),{timeout:1200});
    }else{
      setTimeout(loadPassiveDisplay,0);
    }

  }catch(e){
    console.error('Rail Log startup failed:',e);

    if(els.banner){
      els.banner.hidden=false;
      els.banner.textContent=`データ読み込みエラー: ${e.message}`;
    }
    if(els.overall)els.overall.textContent='—';
    if(els.overallDistance){
      els.overallDistance.textContent=
        `公開データを確認してください: ${railDataURL('network.json')}`;
    }
  }
}
window.addEventListener('DOMContentLoaded',load);
})();
