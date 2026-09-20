(function(global){
'use strict';
// GitHub shared frontend build: 2026-09-20-v44
const JR6=['北海道旅客鉄道','東日本旅客鉄道','東海旅客鉄道','西日本旅客鉄道','四国旅客鉄道','九州旅客鉄道'];
const JR6_LABELS={'北海道旅客鉄道':'JR北海道','東日本旅客鉄道':'JR東日本','東海旅客鉄道':'JR東海','西日本旅客鉄道':'JR西日本','四国旅客鉄道':'JR四国','九州旅客鉄道':'JR九州'};
const FALLBACK=['#446E9B','#9A5A46','#527D52','#7D5A9B','#A66E32','#3F7F7C','#8A5A6A','#6D6D9B','#5D7A3A','#8A6A3B'];
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const coord=v=>{const x=Number(v);return Number.isFinite(x)?x:NaN};
const arr=v=>Array.isArray(v)?v:(v==null?[]:[v]);
const first=(o,keys,def=null)=>{for(const k of keys){if(o&&o[k]!=null&&o[k]!=='' )return o[k]}return def};
const uniq=a=>[...new Set(a.filter(v=>v!=null&&v!==''))];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hash=s=>{let h=2166136261;for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0};
function cleanOperatorName(name){return String(name||'').replace(/[\s　]/g,'').replace(/株式会社|有限会社|\(株\)|（株）/g,'')}
function jrCompany(name){const s=cleanOperatorName(name);const pairs=[['北海道旅客鉄道',/(北海道旅客鉄道|JR北海道)/],['東日本旅客鉄道',/(東日本旅客鉄道|JR東日本)/],['東海旅客鉄道',/(東海旅客鉄道|JR東海)/],['西日本旅客鉄道',/(西日本旅客鉄道|JR西日本)/],['四国旅客鉄道',/(四国旅客鉄道|JR四国)/],['九州旅客鉄道',/(九州旅客鉄道|JR九州)/]];for(const [canon,re] of pairs)if(re.test(s))return canon;return ''}
function classify(name, explicit){if(jrCompany(name))return 'jr';if(explicit==='jr')return 'jr';return 'non_jr'}
function idOf(o){return String(first(o,['id','piece_id','section_id','line_id','station_id','operator_id','code','key'],'')||'')}
function lengthM(o){return n(first(o,['length_m','distance_m','length','meters','metres'],0))}
function operatorName(o){return String(first(o,['operator','operator_name','company','company_name','railway_operator'],'')||'')}
function lineName(o){return String(first(o,['name','line_name','display_name','label'],'')||'')}
function stationName(o){return String(first(o,['name','station_name','display_name','label'],'')||'')}
function colorFor(name, explicit){if(/^#[0-9a-f]{6}$/i.test(String(explicit||'')))return explicit;return FALLBACK[hash(name)%FALLBACK.length]}
function normPref(v){const out=[];if(v&&typeof v==='object'&&!Array.isArray(v)&&!first(v,['code','prefecture_code','id','name','prefecture_name'],null)){for(const [k,val] of Object.entries(v)){if(val&&typeof val==='object')out.push({code:String(k),name:String(first(val,['name','prefecture_name'],k)||k),fraction:n(first(val,['fraction','share','ratio'],0)),length_m:n(first(val,['length_m','distance_m','meters'],0))});else out.push({code:String(k),name:String(k),fraction:0,length_m:n(val)})}return out}for(const x of arr(v)){if(typeof x==='string')out.push({code:x,name:x,fraction:1,length_m:0});else if(x&&typeof x==='object')out.push({code:String(first(x,['code','prefecture_code','id'],'')||''),name:String(first(x,['name','prefecture_name','label'],'')||''),fraction:n(first(x,['fraction','share','ratio'],0)),length_m:n(first(x,['length_m','distance_m'],0))})}return out}
function normalize(raw,geo){
  raw=raw||{};geo=geo||{type:'FeatureCollection',features:[]};
  const operatorsRaw=arr(raw.operators||raw.operator_profiles||raw.companies),prefecturesRaw=arr(raw.prefectures||raw.prefecture_summary||raw.admin_units||[]),linesRaw=arr(raw.lines||raw.line_choices||raw.routes||[]),piecesRaw=arr(raw.pieces||raw.track_pieces||[]),stationsRaw=arr(raw.stations||raw.nodes||[]),sectionsRaw=arr(raw.sections||raw.connections||raw.edges||[]);
  const prefNameMap=new Map(prefecturesRaw.map(x=>[String(first(x,['code','prefecture_code','id'],'')||''),String(first(x,['name','prefecture_name','label'],'')||'')]).filter(x=>x[0]));
  const operatorMap=new Map();
  for(const o of operatorsRaw){const name=String(first(o,['name','operator_name','company_name'],'')||'');if(!name)continue;operatorMap.set(name,{name,group:classify(name,first(o,['group','operator_group'],'')),jr_company:jrCompany(name),length_m:lengthM(o),color:colorFor(name,first(o,['color','colour'],'')),color_status:String(first(o,['color_status','colour_status'],'')||''),source_url:String(first(o,['source_url','url'],'')||'')})}
  const lines=linesRaw.map((o,i)=>{const id=idOf(o)||`line_${i}`,operator=operatorName(o),group=classify(operator,first(o,['group','operator_group'],'')),kind=String(first(o,['kind','type','line_kind'],'formal')||'formal').toLowerCase();return{raw:o,id,name:lineName(o)||id,operator,group,jr_company:jrCompany(operator),kind,eligible:first(o,['eligible','recordable','usable'],true)!==false,length_m:lengthM(o),piece_ids:uniq(arr(first(o,['piece_ids','pieces','track_piece_ids'],[])).map(x=>typeof x==='object'?idOf(x):String(x))),section_ids:uniq(arr(first(o,['section_ids','sections','connection_ids'],[])).map(x=>typeof x==='object'?idOf(x):String(x))),station_ids:uniq(arr(first(o,['station_ids','stations','stop_ids'],[])).map(x=>typeof x==='object'?idOf(x):String(x))),prefectures:normPref(first(o,['prefectures','prefecture_allocations','prefecture_lengths','prefecture_m','prefecture_shares'],[])),search:String(first(o,['search','search_text'],'')||'')}});
  const lineById=new Map(lines.map(x=>[x.id,x]));
  const pieces=piecesRaw.map((o,i)=>{const id=idOf(o)||`piece_${i}`,line_id=String(first(o,['line_id','formal_line_id','route_id'],'')||''),line=lineById.get(line_id),operator=operatorName(o)||line?.operator||'',group=classify(operator,first(o,['group','operator_group'],line?.group)),op=operatorMap.get(operator);return{raw:o,id,line_id,operator,group,jr_company:jrCompany(operator),color:colorFor(operator,first(o,['color','operator_color'],op?.color)),length_m:lengthM(o),eligible:first(o,['eligible','recordable','usable'],true)!==false,prefectures:normPref(first(o,['prefectures','prefecture_allocations','allocation','prefecture_lengths','prefecture_m','prefecture_shares'],first(o,['prefecture_code'],null)?[{code:first(o,['prefecture_code'],''),name:first(o,['prefecture_name'],''),fraction:1}]:[]))}});
  for(const p of pieces)for(const a of p.prefectures)if((!a.name||a.name===a.code)&&prefNameMap.has(a.code))a.name=prefNameMap.get(a.code);for(const l of lines)for(const a of l.prefectures)if((!a.name||a.name===a.code)&&prefNameMap.has(a.code))a.name=prefNameMap.get(a.code);
  const pieceById=new Map(pieces.map(x=>[x.id,x]));
  const stations=stationsRaw.map((o,i)=>({raw:o,id:idOf(o)||`station_${i}`,name:stationName(o)||idOf(o)||`station_${i}`,line_id:String(first(o,['line_id','formal_line_id'],'')||''),lat:coord(first(o,['lat','latitude','y'],NaN)),lon:coord(first(o,['lon','lng','longitude','x'],NaN))}));
  const stationById=new Map(stations.map(x=>[x.id,x]));
  const sections=sectionsRaw.map((o,i)=>{const id=idOf(o)||`section_${i}`,from=String(first(o,['from_station','from_station_id','station_id1','from','u','a'],'')||''),to=String(first(o,['to_station','to_station_id','station_id2','to','v','b'],'')||''),line_id=String(first(o,['line_id','formal_line_id','route_id'],'')||'');return{raw:o,id,from,to,line_id,length_m:lengthM(o),piece_ids:uniq(arr(first(o,['piece_ids','pieces','track_piece_ids'],[])).map(x=>typeof x==='object'?idOf(x):String(x)))}});
  const sectionById=new Map(sections.map(x=>[x.id,x])),secByLine=new Map(),pieceByLine=new Map();
  for(const s of sections){if(s.line_id){if(!secByLine.has(s.line_id))secByLine.set(s.line_id,[]);secByLine.get(s.line_id).push(s.id)}}for(const p of pieces){if(p.line_id){if(!pieceByLine.has(p.line_id))pieceByLine.set(p.line_id,[]);pieceByLine.get(p.line_id).push(p.id)}}
  for(const l of lines){if(!l.section_ids.length&&secByLine.has(l.id))l.section_ids=secByLine.get(l.id);if(!l.piece_ids.length&&pieceByLine.has(l.id))l.piece_ids=pieceByLine.get(l.id);if(!l.station_ids.length&&l.section_ids.length)l.station_ids=uniq(l.section_ids.flatMap(id=>{const s=sectionById.get(id);return s?[s.from,s.to]:[]}))}
  const opPieces=new Map();for(const p of pieces){if(!p.operator||!p.eligible)continue;if(!opPieces.has(p.operator))opPieces.set(p.operator,new Map());opPieces.get(p.operator).set(p.id,p)}
  for(const [name,m] of opPieces){const derived=[...m.values()].reduce((a,p)=>a+p.length_m,0),existing=operatorMap.get(name);if(existing){if(!existing.length_m)existing.length_m=derived}else operatorMap.set(name,{name,group:classify(name,''),jr_company:jrCompany(name),length_m:derived,color:colorFor(name,''),color_status:'fallback',source_url:''})}
  for(const l of lines)if(l.operator&&!operatorMap.has(l.operator))operatorMap.set(l.operator,{name:l.operator,group:l.group,jr_company:jrCompany(l.operator),length_m:l.length_m,color:colorFor(l.operator,''),color_status:'fallback',source_url:''});
  const operators=[...operatorMap.values()].sort((a,b)=>b.length_m-a.length_m||a.name.localeCompare(b.name,'ja'));
  // Build a robust reverse lookup before normalizing GeoJSON.  Some exports put
  // a generic/sequential value in Feature.id while the real network key lives
  // in properties.piece_id / properties.line_id.
  const pieceToLine=new Map();
  for(const p of pieces)if(p.line_id&&lineById.has(p.line_id))pieceToLine.set(p.id,p.line_id);
  for(const l of lines)for(const pid of l.piece_ids||[])if(!pieceToLine.has(String(pid)))pieceToLine.set(String(pid),l.id);

  const features=arr(geo.features).map((f,i)=>{
    const props=f.properties||{};
    const pieceCandidates=[
      first(props,['piece_id','track_piece_id','segment_id'],null),
      first(props,['id'],null),
      f.id
    ].filter(v=>v!=null&&v!=='').map(String);
    const id=pieceCandidates.find(x=>pieceById.has(x))||pieceCandidates[0]||`feature_${i}`;
    const p=pieceById.get(id);

    const directLineCandidates=[
      first(props,['line_id','formal_line_id','route_id'],null),
      p?.line_id,
      pieceToLine.get(id),
      f.id
    ].filter(v=>v!=null&&v!=='').map(String);
    let line_id=directLineCandidates.find(x=>lineById.has(x))||'';

    const operator=String(first(props,['operator','operator_name','company'],p?.operator||'')||'');
    const featureLineName=String(first(props,['line_name','route_name','name'], '')||'');

    // Last-resort metadata match for geometry whose IDs were rewritten during export.
    if(!line_id&&(operator||featureLineName)){
      const cand=lines.filter(l=>
        (!operator||cleanOperatorName(l.operator)===cleanOperatorName(operator))&&
        (!featureLineName||normText(l.name)===normText(featureLineName))
      );
      if(cand.length===1)line_id=cand[0].id;
    }

    return{
      ...f,
      __piece_id:id,
      __line_id:line_id,
      __operator:operator,
      __color:colorFor(operator,first(props,['color','operator_color'],p?.color))
    };
  });
  const metadata=raw.metadata||{};return{raw,geo:{...geo,features},metadata,dataset_id:String(raw.dataset_id||metadata.dataset_id||'default'),operators,prefectures:prefecturesRaw,lines,pieces,stations,sections,operatorMap,lineById,pieceById,stationById,sectionById};
}
function km(m){return n(m)/1000}function pct(done,total){return total>0?100*done/total:0}
function allocations(piece){let a=piece.prefectures||[];if(!a.length)return[];return a.map(x=>({...x,length_m:x.length_m||(x.fraction?piece.length_m*x.fraction:(a.length===1?piece.length_m:0))}))}
function shortestPath(model,line,from,to,via=''){const allowed=new Set(line.section_ids.length?line.section_ids:model.sections.filter(s=>s.line_id===line.id).map(s=>s.id));if(!allowed.size)return null;const adj=new Map(),add=(u,v,s)=>{if(!u||!v)return;if(!adj.has(u))adj.set(u,[]);adj.get(u).push({to:v,section:s,weight:s.length_m||1})};for(const id of allowed){const s=model.sectionById.get(id);if(!s)continue;add(s.from,s.to,s);add(s.to,s.from,s)}const dijkstra=(start,end)=>{const dist=new Map([[start,0]]),prev=new Map(),seen=new Set();while(true){let u=null,best=Infinity;for(const [k,d] of dist)if(!seen.has(k)&&d<best){best=d;u=k}if(u==null)break;if(u===end)break;seen.add(u);for(const e of adj.get(u)||[]){const nd=best+e.weight;if(nd<(dist.get(e.to)??Infinity)){dist.set(e.to,nd);prev.set(e.to,{u,section:e.section})}}}if(!dist.has(end))return null;const secs=[],st=[end];let cur=end;while(cur!==start){const p=prev.get(cur);if(!p)return null;secs.push(p.section);cur=p.u;st.push(cur)}secs.reverse();st.reverse();return{sections:secs,stations:st,length_m:dist.get(end)}};if(via){const a=dijkstra(from,via),b=dijkstra(via,to);if(!a||!b)return null;return{sections:[...a.sections,...b.sections],stations:[...a.stations,...b.stations.slice(1)],length_m:a.length_m+b.length_m,piece_ids:uniq([...a.sections,...b.sections].flatMap(s=>s.piece_ids))}}const r=dijkstra(from,to);if(!r)return null;r.piece_ids=uniq(r.sections.flatMap(s=>s.piece_ids));return r}
function tripPieceIds(t,model){const direct=arr(first(t,['piece_ids','pieces','pieceIds'],[])).map(x=>typeof x==='object'?idOf(x):String(x)).filter(id=>model.pieceById.has(id));if(direct.length)return uniq(direct);const secIds=arr(first(t,['section_ids','sections','sectionIds'],[])).map(x=>typeof x==='object'?idOf(x):String(x));return uniq(secIds.flatMap(id=>model.sectionById.get(id)?.piece_ids||[]).filter(id=>model.pieceById.has(id)))}
function normText(s){return String(s||'').replace(/[\s　]/g,'').toLowerCase()}
function findLineForTrip(t,model){const direct=String(first(t,['line_id','lineId'],'')||'');if(direct&&model.lineById.has(direct))return model.lineById.get(direct);const name=String(first(t,['line_name','lineName'],'')||''),op=String(first(t,['operator','operator_name','company'],'')||'');let cand=model.lines.filter(l=>(!name||normText(l.name)===normText(name))&&(!op||normText(l.operator)===normText(op)));if(cand.length===1)return cand[0];if(!cand.length&&name)cand=model.lines.filter(l=>normText(l.name)===normText(name));if(cand.length===1)return cand[0];if(cand.length>1){const formal=cand.find(l=>l.kind==='formal');return formal||cand[0]}return null}
function findStationForTrip(value,name,line,model){const direct=String(value||'');if(direct&&model.stationById.has(direct))return direct;if(!line||!name)return'';const target=normText(name),ids=line.station_ids||[];const exact=ids.find(id=>normText(model.stationById.get(id)?.name)===target);return exact||''}
function rebindTrip(t,model){const out={...t};const line=findLineForTrip(out,model),names=arr(first(out,['station_names','stationNames'],[])).map(String);if(line){out.line_id=line.id;out.line_name=line.name;out.operator=line.operator;const fromName=String(first(out,['from_station_name','from_name'],names[0]||'')||''),toName=String(first(out,['to_station_name','to_name'],names[names.length-1]||'')||'');const from=findStationForTrip(first(out,['from_station_id','from_station','from'],''),fromName,line,model),to=findStationForTrip(first(out,['to_station_id','to_station','to'],''),toName,line,model);if(from&&to&&from!==to){const route=shortestPath(model,line,from,to,String(first(out,['via_station_id','via_station','via'],'')||''));if(route){out.from_station_id=from;out.to_station_id=to;out.station_names=route.stations.map(id=>model.stationById.get(id)?.name||id);out.length_m=route.length_m;out.piece_ids=route.piece_ids;out.section_ids=route.sections.map(s=>s.id);out.dataset_id=model.dataset_id;out.unresolved=false;return out}}}
const pieces=tripPieceIds(out,model);if(pieces.length){out.piece_ids=pieces;out.dataset_id=model.dataset_id;out.unresolved=false;return out}out.piece_ids=[];out.unresolved=true;return out}
function loadTrips(model){const key=`rail-log:v3:${model.dataset_id}`,master='rail-log:master:v1';let trips=[];const read=k=>{try{const v=JSON.parse(localStorage.getItem(k)||'null');return Array.isArray(v)?v:(Array.isArray(v?.trips)?v.trips:[])}catch{return[]}};trips=read(key);if(!trips.length)trips=read(master);if(!trips.length){for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(!k||k===key||k===master)continue;const cand=read(k);if(cand.length){trips=cand;break}}}trips=trips.map(t=>rebindTrip(t,model));return{key,trips}}
function saveTrips(key,trips){const clean=arr(trips);localStorage.setItem(key,JSON.stringify(clean));localStorage.setItem('rail-log:master:v1',JSON.stringify(clean))}
function stationNameKeyById(id,model){
  const s=model.stationById.get(String(id||''));
  return normText(s?.name||String(id||''));
}
function neighborPairKey(a,b,model){
  const x=stationNameKeyById(a,model),y=stationNameKeyById(b,model);
  if(!x||!y||x===y)return'';
  return x<y?`${x}↔${y}`:`${y}↔${x}`;
}
function requiredNeighborPairs(line,model){
  const ids=arr(line?.station_ids).map(String).filter(Boolean);
  const out=new Set();
  for(let i=0;i+1<ids.length;i++){
    const key=neighborPairKey(ids[i],ids[i+1],model);
    if(key)out.add(key);
  }
  return out;
}
function tripNeighborPairs(t,line,model){
  const out=new Set();
  if(!line)return out;

  const names=arr(first(t,['station_names','stationNames'],[]))
    .map(v=>normText(v))
    .filter(Boolean);

  if(names.length>=2){
    for(let i=0;i+1<names.length;i++){
      const a=names[i],b=names[i+1];
      if(a&&b&&a!==b)out.add(a<b?`${a}↔${b}`:`${b}↔${a}`);
    }
    if(out.size)return out;
  }

  const ids=arr(line.station_ids).map(String).filter(Boolean);
  if(ids.length<2)return out;

  const rawNames=arr(first(t,['station_names','stationNames'],[])).map(String);
  const from=findStationForTrip(
    first(t,['from_station_id','from_station','from'],''),
    String(first(t,['from_station_name','from_name'],rawNames[0]||'')||''),
    line,model
  );
  const to=findStationForTrip(
    first(t,['to_station_id','to_station','to'],''),
    String(first(t,['to_station_name','to_name'],rawNames[rawNames.length-1]||'')||''),
    line,model
  );

  if(!from||!to||from===to)return out;

  const i=ids.indexOf(String(from)),j=ids.indexOf(String(to));
  if(i<0||j<0||i===j)return out;

  const lo=Math.min(i,j),hi=Math.max(i,j);
  for(let k=lo;k<hi;k++){
    const key=neighborPairKey(ids[k],ids[k+1],model);
    if(key)out.add(key);
  }
  return out;
}
function completedLineIds(trips,model){
  const doneByLine=new Map();

  for(const t of arr(trips)){
    const line=findLineForTrip(t,model);
    if(!line)continue;

    const pairs=tripNeighborPairs(t,line,model);
    if(!pairs.size)continue;

    if(!doneByLine.has(line.id))doneByLine.set(line.id,new Set());
    const done=doneByLine.get(line.id);
    for(const key of pairs)done.add(key);
  }

  const complete=new Set();

  for(const line of model.lines){
    if(line.eligible===false)continue;

    const required=requiredNeighborPairs(line,model);
    if(!required.size)continue;

    const done=doneByLine.get(line.id)||new Set();
    let all=true;
    for(const key of required){
      if(!done.has(key)){all=false;break}
    }
    if(all)complete.add(line.id);
  }

  return complete;
}
function riddenSet(trips,model){
  const ridden=new Set(trips.flatMap(t=>tripPieceIds(t,model)));
  const complete=completedLineIds(trips,model);
  for(const lid of complete){
    const line=model.lineById.get(lid);
    if(!line)continue;
    for(const pid of line.piece_ids||[])if(model.pieceById.has(pid))ridden.add(pid);
  }
  return ridden;
}
function aggregatePieces(items,ridden){let total=0,done=0;const seen=new Set();for(const p of items){if(!p||!p.eligible||seen.has(p.id))continue;seen.add(p.id);total+=p.length_m;if(ridden.has(p.id))done+=p.length_m}return{total,done,rate:pct(done,total)}}
const RailCore={JR6,JR6_LABELS,n,arr,first,uniq,esc,hash,cleanOperatorName,jrCompany,classify,idOf,lengthM,operatorName,lineName,stationName,colorFor,normalize,km,pct,allocations,shortestPath,tripPieceIds,rebindTrip,loadTrips,saveTrips,stationNameKeyById,neighborPairKey,requiredNeighborPairs,tripNeighborPairs,completedLineIds,riddenSet,aggregatePieces};global.RailCore=RailCore;
})(window);
