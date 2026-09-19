(function(){
'use strict';
const I18N_VERSION='2026-09-18-v20.1';
const KEY='rail-log:ui-language:v1', JA='ja', ZH='zh-CN';
const lang=(()=>{const s=localStorage.getItem(KEY);if(s===JA||s===ZH)return s;return (navigator.language||'').toLowerCase().startsWith('zh')?ZH:JA})();

const E={
'データを読み込み中':'正在读取数据','すべて':'全部','JR線 + 私鉄線':'JR线 + 私铁线','JR線':'JR线','私鉄線':'私铁线',
'正式路線 + 照合済み運行系統':'正式线路 + 已匹配运行系统','正式路線（N02）':'正式线路（N02）','運行系統（Ekidata）':'运行系统（Ekidata）',
'路線を選択':'选择线路','該当する路線なし':'没有符合条件的线路','指定なし':'不指定','この路線を100%にする':'将此线路设为100%',
'✓ 100%指定を解除':'✓ 取消100%指定','隣接駅間走破済み（100%）':'相邻站区间已全部乘坐（100%）',
'駅を選ぶと、地図で経路を確認できます。':'选择车站后，可在地图上确认路径。','路線をクリックして選択':'点击线路进行选择',
'集計対象なし':'无统计对象','データなし':'无数据','まだ乗車記録がありません。':'暂无乘车记录。','路線を選択してください。':'请选择线路。',
'この路線には入力可能な駅間接続がありません。':'该线路没有可输入的站间连接。','保存しました。次の区間を選択できます。':'已保存。可以继续选择下一个区间。',
'読み込みをキャンセルしました。':'已取消导入。','直前の記録を削除しました。':'已删除上一条记录。','地図PNGを書き出しました。':'已导出地图PNG。',
'地図PNGを書き出しました（ブラウザーの制限によりOSM背景は省略）。':'已导出地图PNG（由于浏览器限制，未包含OSM底图）。'
};

function tr(s){
  s=String(s??''); if(E[s])return E[s]; let m;
  if((m=s.match(/^(.+) を手動で100%に指定しました。$/)))return `${m[1]} 已手动设为100%。`;
  if((m=s.match(/^(.+) の手動100%指定を解除しました。$/)))return `已取消 ${m[1]} 的手动100%设置。`;
  if((m=s.match(/^(\d+) 件を削除しました。$/)))return `已删除 ${m[1]} 条记录。`;
  if((m=s.match(/^地図書き出し失敗: (.+)$/)))return `地图导出失败：${m[1]}`;
  if((m=s.match(/^読み込み失敗: (.+)$/)))return `导入失败：${m[1]}`;
  if((m=s.match(/^データ読み込みエラー: (.+)$/)))return `数据读取错误：${m[1]}`;
  const F={
    '乗車駅を選択しました。次に降車駅をクリックしてください。':'已选择上车站。接下来请点击下车站。',
    '降車駅は乗車駅と異なる駅を選んでください。':'请选择与上车站不同的下车站。',
    '異なる乗車駅と降車駅を選んでください。':'请选择不同的上车站与下车站。',
    '接続データを確認してください。':'请检查连接数据。',
    '確認中の区間を灰色の太線で表示しています。地図上の「この区間を記録」から直接保存できます。':'正在用灰色粗线显示待确认区间。可点击地图上的“记录此区间”直接保存。',
    'この地図区間に対応する路線情報がありません。':'该地图区间没有对应的线路信息。',
    '乗車記録を保存しました。乗車済み区間は太線のまま残ります。':'乘车记录已保存。已乘坐区间会继续以粗线显示。',
    '削除する記録にチェックを付けてください。':'请勾选要删除的记录。',
    '現在の地図表示をPNGに書き出しています…':'正在将当前地图导出为PNG…',
    '路線選択を解除しました。':'已取消线路选择。',
    '05Bの出力とローカルサーバーを確認してください。':'请检查05B输出和本地服务器。'
  }; return F[s]||s;
}
function setText(id,t){const e=document.getElementById(id);if(e)e.textContent=t}
function label(id,t){const e=document.querySelector(`label[for="${id}"]`);if(e)e.textContent=t}
function opt(id,v,t){const s=document.getElementById(id);if(!s)return;const o=[...s.options].find(x=>x.value===v);if(o)o.textContent=t}
function translateOptions(root=document){root.querySelectorAll?.('option').forEach(o=>{const x=tr(o.textContent.trim());if(x!==o.textContent.trim())o.textContent=x})}
function special(el){
  if(!el)return; const id=el.id||'';
  if(['message','routeInfo','banner','mapSelectionInfo','overallDistance','manualComplete'].includes(id)){const x=tr(el.textContent.trim());if(x!==el.textContent.trim())el.textContent=x}
  if(id==='lineInfo')for(const n of el.childNodes)if(n.nodeType===Node.TEXT_NODE){const v=n.nodeValue.replace(/JR線/g,'JR线').replace(/私鉄線/g,'私铁线').replace(/事業者不明/g,'运营商未知');if(v!==n.nodeValue)n.nodeValue=v;}
  if(id==='history')el.querySelectorAll('.muted').forEach(x=>{const y=tr(x.textContent.trim());if(y!==x.textContent.trim())x.textContent=y});
  if(id==='dataInfo'){
    const P=[['路線候補','候选线路'],['駅 ','车站 '],['区間 ','区间 '],['地図ピース','地图片段'],['地図クリック対応','地图点击支持'],
    ['対象外判定された非表示線形','判定为对象外的隐藏线形'],['隣接駅間を全て走破して100%判定された路線','相邻站间全部乘坐并判定为100%的线路'],
    ['手動100%指定','手动100%设置'],['現在のエクスポートは部分データです。','当前导出为部分数据。']];
    el.querySelectorAll('p').forEach(p=>{let h=p.innerHTML;for(const [a,b] of P)h=h.split(a).join(b);if(h!==p.innerHTML)p.innerHTML=h});
  }
  translateOptions(el);
}
function staticZh(){
  document.documentElement.lang='zh-CN'; document.title='Rail Log · 日本铁路乘车地图';
  const meta=document.querySelector('meta[name="description"]');if(meta)meta.content='按站间区间记录日本铁路乘车进度的互动地图。';
  const sub=document.querySelector('.brand div span');if(sub)sub.textContent='日本铁路乘车地图';
  const aside=document.querySelector('aside');if(aside)aside.setAttribute('aria-label','乘车记录');
  const tt=document.querySelectorAll('.section-title h1,.section-title h2');if(tt[0])tt[0].textContent='选择线路';if(tt[1])tt[1].textContent='已乘坐区间';

  label('search','搜索线路 / 车站');label('pref','都道府县');label('railGroup','铁路类别');
  const ol=document.querySelector('label[for="operator"]');if(ol)ol.innerHTML='铁路公司 <span class="hint">按里程排序</span>';
  label('kind','线路显示');label('line','线路');label('from','上车站');label('to','下车站');label('via','经由站（可选）');
  label('route','确认路径');label('date','乘车日期（可选）');label('note','备注（可选）');

  const s=document.getElementById('search');if(s)s.placeholder='山手线、新宿、东海道…';
  const n=document.getElementById('note');if(n)n.placeholder='旅行名、列车名等';

  [['manualComplete','将此线路设为100%'],['preview','显示路径'],['save','记录为已乘坐'],['mapSave','记录此区间'],['mapExport','导出地图'],
   ['fit','定位到所选线路'],['selectAllRecords','全选'],['deleteSelected','删除选中记录'],['undo','删除上一条记录'],['export','备份'],['import','导入']]
   .forEach(([id,t])=>setText(id,t));

  const map=document.getElementById('map');if(map)map.setAttribute('aria-label','铁路地图');
  const sv=document.getElementById('statsView');if(sv)sv.setAttribute('aria-label','统计显示');
  const bl=document.querySelector('.map-controls label');if(bl){const input=bl.querySelector('input');bl.innerHTML='';if(input){bl.appendChild(input);bl.append(' OSM底图')}}

  const lg=document.querySelector('.legend');if(lg){const names=['未乘坐','已乘坐','确认中','车站','上车站','下车站'];
    lg.querySelectorAll('span').forEach((x,i)=>{if(names[i]===undefined)return;const icon=x.querySelector('i');x.innerHTML='';if(icon)x.appendChild(icon);x.append(names[i])});
    const sm=lg.querySelector('small');if(sm)sm.textContent='颜色 = 铁路公司 / 线宽 = 状态';}

  const sh=document.querySelector('.statistics .stats-heading h2');if(sh)sh.textContent='乘车完成情况';
  const sp=document.querySelector('.statistics > p.muted');if(sp)sp.textContent='分类参考“乗りつぶしオンライン”：JR旅客6社作为JR线，其余客运铁路及轨道运营商作为私铁线。当前输出数据没有对支线、短络线设置独立分类，因此不单独统计。';
  const th=document.querySelectorAll('.stats-table thead th');if(th[0])th[0].textContent='名称';if(th[1])th[1].textContent='已乘坐 / 总计 km';if(th[2])th[2].textContent='完成率';

  const hh=document.querySelector('.history .stats-heading h2');if(hh){const c=document.getElementById('tripCount');hh.innerHTML='乘车记录 ';if(c)hh.appendChild(c)}
  const hp=document.querySelector('.history > p.muted');if(hp)hp.textContent='勾选后的记录可批量删除。备份会保存当前全部乘车记录，并可通过“导入”恢复。';

  const sum=document.querySelector('.data-info summary');if(sum)sum.textContent='数据范围、精度与来源';
  const ps=document.querySelectorAll('.data-info > p');
  if(ps[0])ps[0].innerHTML='<a href="https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html" target="_blank" rel="noopener">国土数值信息（铁路）</a>及<a href="https://nlftp.mlit.go.jp/ksj/" target="_blank" rel="noopener">国土数值信息（行政区）</a>经加工使用，并以<a href="https://ekidata.jp/" target="_blank" rel="noopener">駅データ.jp</a>辅助核对车站和连接关系。';
  if(ps[1])ps[1].innerHTML='底图 © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>。由于按线路名和公司分别管理，当不同正式线路共用同一轨道时可能会分别计入；距离并非营业里程。';

  opt('pref','','全部');opt('railGroup','','JR线 + 私铁线');opt('railGroup','jr','JR线');opt('railGroup','non_jr','私铁线');
  opt('kind','','正式线路 + 已匹配运行系统');opt('kind','formal','正式线路（N02）');opt('kind','service','运行系统（Ekidata）');opt('via','','不指定');
  opt('statsView','prefecture_all','按都道府县（全部线路）');opt('statsView','jr6','JR线：按6家客运公司');opt('statsView','private_operators','私铁线：按运营商');
  opt('statsView','jr_lines','JR线：按线路');opt('statsView','private_lines','私铁线：按线路');opt('statsView','jr_private','JR线 / 私铁线');

  translateOptions(document);
  ['message','routeInfo','banner','mapSelectionInfo','overallDistance','manualComplete','lineInfo','history','dataInfo'].forEach(id=>special(document.getElementById(id)));
}
function switches(){
  document.querySelectorAll('[data-lang]').forEach(b=>{const a=b.dataset.lang===lang;b.classList.toggle('active',a);b.setAttribute('aria-pressed',a?'true':'false');
    b.addEventListener('click',()=>{localStorage.setItem(KEY,b.dataset.lang);location.reload()})});
}
function badge(){const b=document.querySelector('.local');if(b)b.textContent=['localhost','127.0.0.1',''].includes(location.hostname)?'LOCAL':'DEMO'}
function confirmZh(){
  if(lang!==ZH)return;const native=window.confirm.bind(window);
  window.confirm=s=>{let t=String(s??'')
    .replace(/^(.+) の手動100%指定を解除しますか？$/,'要取消 $1 的手动100%设置吗？')
    .replace(/^(.+) を100%として記録しますか？\nこの指定はバックアップにも保存されます。$/,'要将 $1 记录为100%吗？\n此设置也会写入备份。')
    .replace(/^(\d+) 件の乗車記録を削除しますか？$/,'要删除 $1 条乘车记录吗？')
    .replace(/^(.+) の通常達成率が ([\d.]+)% になりました。\n残りがデータ上の微小な重複・誤差であれば、この路線を100%として記録しますか？$/,'$1 的常规完成率已达到 $2%。\n如果剩余部分只是数据中的微小重叠或误差，是否将此线路记录为100%？')
    .replace(/^現在の (\d+) 件の乗車記録と手動100%指定 (\d+) 路線を、バックアップ内容で置き換えます。よろしいですか？$/,'要用备份内容替换当前 $1 条乘车记录和 $2 条手动100%线路吗？');
    return native(t)};
}
window.addEventListener('DOMContentLoaded',()=>{switches();badge();confirmZh();if(lang!==ZH){document.documentElement.lang='ja';return}staticZh();
  const OBS={subtree:true,childList:true};
  let translating=false;
  const mo=new MutationObserver(ms=>{
    if(translating)return;
    translating=true;
    mo.disconnect();
    try{
      for(const m of ms){
        const e=m.target.nodeType===Node.ELEMENT_NODE?m.target:m.target.parentElement;
        if(e)special(e);
        m.addedNodes.forEach(n=>{if(n.nodeType===Node.ELEMENT_NODE)special(n)});
      }
    }finally{
      translating=false;
      mo.observe(document.body,OBS);
    }
  });
  mo.observe(document.body,OBS);
});
})();