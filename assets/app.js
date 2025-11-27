// geo-dashboard app.js (client-only)
const $ = (sel, parent=document) => parent.querySelector(sel);
const $$ = (sel, parent=document) => Array.from(parent.querySelectorAll(sel));

const state = {
  metrics: [],   // rows of metrics
  news: [],      // rows of news (continent,title,url,summary)
  facts: [],     // rows of facts (country_code, section, title, detail, url)
  cmap: {},      // country_code -> { continent, name }
  cols: { date:null, code:null, name:null, continent:null, value:null, change:null },
  inferred: {},  // type inference results
  latestDate: null,
  thrUp: 5,
  thrDown: -5,
  topN: 30,
  selectedContinents: new Set(),
  selectedCountryCode: null,
  seriesByCountry: new Map(), // code -> [{t, v}]
  chart: null,
};

// --- Theme
function applySavedTheme(){ const saved=localStorage.getItem('geo:theme'); if(saved==='light') document.documentElement.classList.add('light'); }
function toggleTheme(){ document.documentElement.classList.toggle('light'); localStorage.setItem('geo:theme', document.documentElement.classList.contains('light')?'light':'dark'); }

// --- File loading
function parseCSVFile(file){
  return new Promise((resolve,reject)=>{
    Papa.parse(file,{header:true,skipEmptyLines:'greedy',complete:res=>resolve(res.data),error:err=>reject(err)});
  });
}

async function loadSample(){
  const m = await fetch('sample_metrics.csv').then(r=>r.text());
  const n = await fetch('sample_news.csv').then(r=>r.text());
  const map = await fetch('sample_map.csv').then(r=>r.text());
  const [metrics] = await Promise.all([new Promise(res=>Papa.parse(m,{header:true,complete:r=>res(r.data)}))]);
  const [news] = await Promise.all([new Promise(res=>Papa.parse(n,{header:true,complete:r=>res(r.data)}))]);
  const [cmapRows] = await Promise.all([new Promise(res=>Papa.parse(map,{header:true,complete:r=>res(r.data)}))]);
  ingestMetrics(metrics);
  ingestNews(news);
  ingestMap(cmapRows);
  postLoad();
}

function resetAll(){
  state.metrics = []; state.news = []; state.cmap = {}; state.cols = {date:null,code:null,name:null,continent:null,value:null,change:null};
  state.inferred={}; state.latestDate=null; state.thrUp=5; state.thrDown=-5; state.topN=30; state.selectedContinents.clear(); state.selectedCountryCode=null;
  state.seriesByCountry.clear();
  $('#meta').textContent='';
  $('#colDate').innerHTML=''; $('#colCode').innerHTML=''; $('#colName').innerHTML=''; $('#colContinent').innerHTML=''; $('#colValue').innerHTML=''; $('#colChange').innerHTML='';
  $('#latestDate').value=''; $('#thrUp').value=5; $('#thrDown').value=-5; $('#topN').value=30;
  $('#continentChips').innerHTML='';
  $('#heatmap').innerHTML='';
  $('#listUp').innerHTML=''; $('#listDown').innerHTML='';
  $('#countryTitle').textContent='국가 상세';
  const c = $('#countryChart').getContext('2d'); c.clearRect(0,0,600,300); if(state.chart){state.chart.destroy(); state.chart=null;}
  $('#countryTable thead').innerHTML=''; $('#countryTable tbody').innerHTML='';
  $('#newsWrap').innerHTML='';
}

function ingestMetrics(rows){
  // Clean rows (drop empty), trim, normalize keys
  const cleaned = rows.filter(r => Object.values(r).some(v => String(v||'').trim()!==''));
  state.metrics = cleaned;
}

function ingestNews(rows){
  state.news = rows.filter(r => (r.continent || r.Continent || r.CONtinent));
}


function ingestFacts(rows){
  state.facts = rows.filter(r => (r.country_code || r.code || r.Code || r.country || '').toString().trim() !== '');
}

function ingestMap(rows){
  for(const r of rows){
    const code = (r.country_code||r.code||r.iso||'').trim();
    if(!code) continue;
    state.cmap[code.toUpperCase()] = {
      continent: (r.continent||r.Continent||'').trim(),
      name: (r.country_name||r.name||'').trim()
    };
  }
}

function inferTypesAndColumns(){
  const rows = state.metrics;
  const fields = Object.keys(rows[0]||{});
  const guess = (cands) => fields.find(f => cands.some(k => f.toLowerCase().includes(k)));
  state.cols.date = guess(['date','dt','day']);
  state.cols.code = guess(['code','iso','cc','country_code']);
  state.cols.name = guess(['name','country','nation']);
  state.cols.continent = guess(['continent','region']);
  state.cols.value = guess(['value','val','traffic','volume','score','count']);
  state.cols.change = guess(['change','dod','delta','pct','mom','wow','growth']);
  // rudimentary inference
  state.inferred.fields = fields;
  state.inferred.size = rows.length;
}

function populateMappingControls(){
  const fields = state.inferred.fields||[];
  const opts = f => `<option value="${f}">${f}</option>`;
  const mk = (id, sel) => { const el=$(id); el.innerHTML = ['<option value="">(없음)</option>'].concat(fields.map(opts)).join(''); if(sel) el.value=sel; };
  mk('#colDate', state.cols.date); mk('#colCode', state.cols.code); mk('#colName', state.cols.name);
  mk('#colContinent', state.cols.continent); mk('#colValue', state.cols.value); mk('#colChange', state.cols.change);

  // type info
  $('#typeInfo').innerHTML = `<div>컬럼 수: ${fields.length}개, 행 수: ${state.inferred.size}개</div><div class="small">${fields.join(', ')}</div>`;
}

function postLoad(){
  inferTypesAndColumns();
  populateMappingControls();
  buildContinentsChips();
  computeLatestDate();
  renderAll();
  $('#meta').textContent = `지표 행: ${state.metrics.length} · 뉴스 행: ${state.news.length} · 매핑 국가: ${Object.keys(state.cmap).length}`;
}

function computeLatestDate(){
  const col = state.cols.date; if(!col) return;
  let maxT = null;
  for(const r of state.metrics){
    const t = toTime(r[col]);
    if(t!=null){ maxT = (maxT==null || t>maxT) ? t : maxT; }
  }
  if(maxT!=null){
    const d = new Date(maxT);
    state.latestDate = d.toISOString().slice(0,10);
    $('#latestDate').value = state.latestDate;
  }
}

function toTime(v){
  if(v==null) return null;
  if (v instanceof Date) return v.getTime();
  const s = String(v).trim();
  if(!s) return null;
  if(/^\d{13}$/.test(s)) return parseInt(s,10);
  if(/^\d{10}$/.test(s)) return parseInt(s,10)*1000;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.getTime();
}

// --- Data transforms
function ensureContinentForRow(r){
  // Try from explicit column
  const ccol = state.cols.continent;
  let cont = ccol ? r[ccol] : '';
  if(cont) return String(cont);
  // Try from map by code
  const codeCol = state.cols.code;
  const code = codeCol ? String(r[codeCol]||'').toUpperCase() : '';
  if(code && state.cmap[code]?.continent) return state.cmap[code].continent;
  // Try internal fallback mapping (minimal a few)
  const fallback = { US:'North America', CA:'North America', MX:'North America', BR:'South America', AR:'South America',
    GB:'Europe', DE:'Europe', FR:'Europe', IT:'Europe', ES:'Europe', NL:'Europe', SE:'Europe', NO:'Europe', PL:'Europe', RU:'Europe',
    CN:'Asia', JP:'Asia', KR:'Asia', IN:'Asia', SG:'Asia', HK:'Asia', ID:'Asia', TH:'Asia', VN:'Asia', MY:'Asia', PH:'Asia',
    AU:'Oceania', NZ:'Oceania', ZA:'Africa', NG:'Africa', EG:'Africa', KE:'Africa', MA:'Africa', AE:'Middle East', SA:'Middle East', TR:'Middle East' };
  if(code && fallback[code]) return fallback[code];
  return 'Unknown';
}

function valueOf(r){ const c=state.cols.value; if(!c) return NaN; const v = parseFloat(String(r[c]).replace(/[,\s%]/g,'')); return isNaN(v)?NaN:v; }
function changeOf(r){
  const c=state.cols.change;
  if(c){
    const s = String(r[c]).trim();
    if(!s) return NaN;
    const v = parseFloat(s.replace(/%/g,''));
    return isNaN(v)?NaN:v;
  }
  return NaN;
}

function computeChangeFromHistory(latestDateStr){
  // If change column missing, derive DoD by country: (latest - prev)/prev*100
  const codeCol = state.cols.code, dateCol=state.cols.date, valCol=state.cols.value;
  if(!codeCol || !dateCol || !valCol) return new Map();
  const byCode = new Map();
  for(const r of state.metrics){
    const code = String(r[codeCol]||'').toUpperCase();
    const t = toTime(r[dateCol]);
    const v = valueOf(r);
    if(!code || isNaN(v) || t==null) continue;
    if(!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push({t,v,row:r});
  }
  const changes = new Map();
  const latestT = toTime(latestDateStr);
  for(const [code, arr] of byCode.entries()){
    arr.sort((a,b)=>a.t-b.t);
    // find latest entry with date==latest
    const latest = arr.filter(d=>new Date(d.t).toISOString().slice(0,10)===latestDateStr).pop();
    if(!latest) continue;
    // previous by date
    const prevCandidates = arr.filter(d=>d.t < latest.t);
    const prev = prevCandidates.length ? prevCandidates[prevCandidates.length-1] : null;
    if(prev && prev.v !== 0){
      const pct = (latest.v - prev.v) / Math.abs(prev.v) * 100;
      changes.set(code, pct);
    }
  }
  return changes;
}

function normalizeLatestSnapshot(){
  const dateStr = $('#latestDate').value || state.latestDate;
  if(!dateStr) return {rows:[], index:new Map()};
  const dateCol = state.cols.date;
  const rows = state.metrics.filter(r => {
    const t = toTime(r[dateCol]);
    return t!=null && new Date(t).toISOString().slice(0,10)===dateStr;
  });

  // Choose row per country (if multiple, take max value)
  const idx = new Map();
  for(const r of rows){
    const code = String((state.cols.code ? r[state.cols.code] : '')||'').toUpperCase();
    if(!code) continue;
    const val = valueOf(r);
    const cont = ensureContinentForRow(r);
    const name = state.cols.name ? String(r[state.cols.name]||'') : (state.cmap[code]?.name || code);
    const ch = changeOf(r); // may be NaN
    const prev = idx.get(code);
    if(!prev || (val>prev.value)){
      idx.set(code, { code, name, continent: cont, value: val, change: ch, row:r });
    }
  }

  // Fill change if missing
  const missingChange = Array.from(idx.values()).some(v => isNaN(v.change));
  if(missingChange){
    const histChg = computeChangeFromHistory(dateStr);
    for(const v of idx.values()){
      if(isNaN(v.change)){
        const pct = histChg.get(v.code);
        if(pct!=null) v.change = pct;
      }
    }
  }

  return { rows: Array.from(idx.values()), index: idx, dateStr };
}

// --- UI Builders
function buildContinentsChips(){
  // Collect continents from data (or standard set)
  const conts = new Set();
  for(const r of state.metrics){ conts.add(ensureContinentForRow(r)); }
  const chips = $('#continentChips'); chips.innerHTML='';
  const all = document.createElement('span'); all.className='chip'; all.textContent='전체'; all.addEventListener('click', ()=>{ state.selectedContinents.clear(); buildContinentsChips(); renderAll(); }); chips.appendChild(all);
  for(const c of Array.from(conts).sort()){
    const s = document.createElement('span'); s.className='chip'; s.textContent=c;
    if(state.selectedContinents.has(c)) s.style.outline='2px solid var(--accent)';
    s.addEventListener('click', ()=>{ if(state.selectedContinents.has(c)) state.selectedContinents.delete(c); else state.selectedContinents.add(c); buildContinentsChips(); renderAll(); });
    chips.appendChild(s);
  }
}

function renderHeatmap(){
  const {rows,dateStr} = normalizeLatestSnapshot();
  const thrUp = parseFloat($('#thrUp').value)||state.thrUp;
  const thrDown = parseFloat($('#thrDown').value)||state.thrDown;
  const contFilter = state.selectedContinents.size ? (c=>state.selectedContinents.has(c)) : (_=>true);
  const filtered = rows.filter(r => contFilter(r.continent));

  const heatmapDiv = document.getElementById('heatmap');
  
  // 데이터가 없을 때 처리
  if(!filtered.length || !rows.length){
    heatmapDiv.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--muted)">데이터가 없습니다. CSV 파일을 업로드하거나 샘플을 불러오세요.</div>';
    return;
  }

  // Build treemap vectors
  const labels=[], parents=[], values=[], texts=[], colors=[], codes=[];
  
  // 대륙별 값 합계 계산
  const contValues = new Map();
  for(const r of filtered){
    const cont = r.continent;
    const val = Math.max(0.0001, isNaN(r.value)?0.0001:r.value);
    contValues.set(cont, (contValues.get(cont)||0) + val);
  }
  
  // Add continent nodes (부모 노드)
  const conts = Array.from(new Set(filtered.map(r=>r.continent)));
  for(const c of conts){
    labels.push(c); 
    parents.push(''); 
    values.push(contValues.get(c) || 0.001); 
    texts.push(c); 
    colors.push('rgba(100,100,120,0.3)'); 
    codes.push('');
  }
  
  function colorForChange(ch){
    if(ch==null || isNaN(ch)) return 'rgba(128,128,128,0.5)';
    // diverging red->grey->green
    const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));
    const t = clamp((ch+10)/20, 0, 1); // -10% .. +10%
    const r = Math.round(255*(1-t));
    const g = Math.round(255*(t));
    const b = 80;
    return `rgba(${r},${g},${b},0.85)`;
  }

  // 국가 노드 추가
  for(const r of filtered){
    labels.push(r.name);
    parents.push(r.continent);
    const val = Math.max(0.0001, isNaN(r.value)?0.0001:r.value);
    values.push(val);
    const ch = r.change;
    texts.push(`${r.name}<br>값: ${fmt(r.value)}<br>변화: ${ch!=null && !isNaN(ch)? ch.toFixed(2)+'%':'N/A'}`);
    colors.push(colorForChange(ch));
    codes.push(r.code);
  }

  const data = [{
    type:'treemap',
    labels, 
    parents, 
    values, 
    text:texts, 
    textinfo:'label+text', 
    hoverinfo:'text',
    marker:{ 
      colors,
      line: { width: 1, color: 'rgba(0,0,0,0.1)' }
    },
    branchvalues:'total',
    tiling: {
      packing: 'squarify',
      squarifyratio: 1
    }
  }];

  const layout = {
    paper_bgcolor:'rgba(0,0,0,0)',
    plot_bgcolor:'rgba(0,0,0,0)',
    margin:{t:40,l:10,r:10,b:10},
    title: {text: dateStr ? `기준일: ${dateStr}` : '', font: {size: 14}},
    font: {color: 'var(--text)'}
  };

  Plotly.newPlot('heatmap', data, layout, {
    displayModeBar:false, 
    responsive:true,
    staticPlot: false
  }).then(() => {
    // Plotly 이벤트 핸들러 올바르게 설정
    heatmapDiv.on('plotly_click', (ev) => {
      if(!ev || !ev.points || !ev.points.length) return;
      const p = ev.points[0];
      if(!p) return;
      const label = p.label;
      const idx = p.pointNumber !== undefined ? p.pointNumber : p.pointIndex;
      const code = codes[idx];
      if(code){ 
        selectCountry(code); 
        switchTab('tab-country'); 
      }
    });
  });
}

function fmt(n){ if(n==null || isNaN(n)) return '—'; return new Intl.NumberFormat().format(n); }

function renderMovers(){
  const {rows} = normalizeLatestSnapshot();
  const thrUp = parseFloat($('#thrUp').value)||state.thrUp;
  const thrDown = parseFloat($('#thrDown').value)||state.thrDown;
  const contFilter = state.selectedContinents.size ? (c=>state.selectedContinents.has(c)) : (_=>true);
  const filtered = rows.filter(r => contFilter(r.continent));

  const ups = filtered.filter(r => r.change!=null && !isNaN(r.change) && r.change >= thrUp).sort((a,b)=>b.change-a.change);
  const downs = filtered.filter(r => r.change!=null && !isNaN(r.change) && r.change <= thrDown).sort((a,b)=>a.change-b.change);
  const topN = Math.max(1, parseInt($('#topN').value)||state.topN);

  buildList('#listUp', ups.slice(0, topN));
  buildList('#listDown', downs.slice(0, topN));
}

function buildList(sel, arr){
  const el = $(sel); el.innerHTML='';
  for(const r of arr){
    const li = document.createElement('li');
    li.innerHTML = `<span class="linklike">${r.name}</span> — 값 ${fmt(r.value)}, 변화 ${r.change.toFixed(2)}% <span class="muted">(${r.continent})</span>`;
    li.querySelector('span.linklike').addEventListener('click', ()=>{ selectCountry(r.code); switchTab('tab-country'); });
    el.appendChild(li);
  }
}

function selectCountry(code){
  state.selectedCountryCode = code;
  renderCountryDetail();
}

function renderCountryDetail(){
  const code = state.selectedCountryCode; if(!code) return;
  // Build time series for the country
  const codeCol = state.cols.code, dateCol=state.cols.date, valCol=state.cols.value;
  const nameCol = state.cols.name;
  const arr = [];
  for(const r of state.metrics){
    const c = (r[codeCol]||'').toUpperCase();
    if(c!==code) continue;
    const t = toTime(r[dateCol]); const v = valueOf(r);
    if(t!=null && !isNaN(v)) arr.push({t, v, row:r});
  }
  arr.sort((a,b)=>a.t-b.t);
  const name = arr.length ? (nameCol? String(arr[arr.length-1].row[nameCol]||''): (state.cmap[code]?.name||code)) : code;
  $('#countryTitle').textContent = `국가 상세 — ${name} (${code})`;

  // Chart
  const ctx = $('#countryChart').getContext('2d');
  if(state.chart){ state.chart.destroy(); state.chart=null; }
  state.chart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        label: '값',
        data: arr.map(d=>({x:new Date(d.t), y:d.v})),
        borderWidth:2, pointRadius:0, tension:0.1
      }]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      scales: { x: {type:'time'}, y: {type:'linear', beginAtZero:false} },
      plugins: { legend:{position:'top'} }
    }
  });


  // Facts
  const factsWrap = $('#countryFacts'); factsWrap.innerHTML='';
  const codeU = code.toUpperCase();
  const facts = state.facts.filter(r => (String(r.country_code||r.code||r.Code||r.country||'').toUpperCase()===codeU));
  if(facts.length){
    for(const f of facts.slice(0,12)){
      const card = document.createElement('div'); card.className='fact-card';
      const sec = (f.section||f.Section||'').toString(); const title=(f.title||f.Title||''); const det=(f.detail||f.Detail||''); const url=(f.url||f.URL||'');
      card.innerHTML = `<div class="k">${sec ? '🛈 '+sec : ''} ${title}</div><div class="v">${det}${url?` — <a href="${url}" target="_blank" rel="noopener">자세히</a>`:''}</div>`;
      factsWrap.appendChild(card);
    }
  }

  // Table (latest N rows)
  const thead = $('#countryTable thead'); const tbody = $('#countryTable tbody');
  thead.innerHTML = '<tr><th>날짜</th><th>값</th><th>변화(%)</th></tr>'; tbody.innerHTML='';
  const changeCol = state.cols.change;
  for(const d of arr.slice(-50)){ // last 50
    const tr = document.createElement('tr');
    const dateStr = new Date(d.t).toISOString().slice(0,10);
    const ch = changeCol ? parseFloat(String(d.row[changeCol]||'').replace(/%/g,'')) : NaN;
    tr.innerHTML = `<td>${dateStr}</td><td>${fmt(d.v)}</td><td>${isNaN(ch)?'—':ch.toFixed(2)+'%'}</td>`;
    tbody.appendChild(tr);
  }
}

function renderNews(){
  // Group by continent
  const wrap = $('#newsWrap'); wrap.innerHTML='';
  if(!state.news.length){ wrap.innerHTML='<div class="muted">뉴스 CSV가 업로드되지 않았습니다.</div>'; return; }
  const byC = new Map();
  for(const r of state.news){
    const c = (r.continent||r.Continent||'Unknown')||'Unknown';
    if(!byC.has(c)) byC.set(c, []);
    byC.get(c).push(r);
  }
  for(const [c, arr] of Array.from(byC.entries()).sort((a,b)=>a[0].localeCompare(b[0]))){
    const sec = document.createElement('section');
    sec.className = 'card'; sec.style.marginBottom = '.6rem';
    sec.innerHTML = `<h3>${c}</h3>`;
    const ul = document.createElement('ul'); ul.className='list-compact';
    arr.slice(0,30).forEach(r=>{
      const li = document.createElement('li');
      const title = r.title || r.Title || '(제목 없음)';
      const url = r.url || r.link || '#';
      const summary = r.summary || r.Summary || '';
      li.innerHTML = `<a href="${url}" target="_blank" rel="noopener">${title}</a>${summary?` — <span class="muted">${summary}</span>`:''}`;
      ul.appendChild(li);
    });
    sec.appendChild(ul);
    wrap.appendChild(sec);
  }
}

// --- Tab logic
function switchTab(id){
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab===id));
  $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id===id));
}

// --- Render orchestrator
function renderAll(){
  renderHeatmap();
  renderMovers();
  renderCountryDetail();
  renderNews();
}

// --- Events
document.addEventListener('DOMContentLoaded', ()=>{
  applySavedTheme();
  $('#themeToggle').addEventListener('click', toggleTheme);

  $('#fileMetrics').addEventListener('change', async (e)=>{
    const f = e.target.files?.[0]; if(!f) return;
    const rows = await parseCSVFile(f);
    ingestMetrics(rows); postLoad();
  });
  $('#fileNews').addEventListener('change', async (e)=>{
    const f = e.target.files?.[0]; if(!f) return;
    const rows = await parseCSVFile(f);
    ingestNews(rows); renderNews();
  });
  $('#fileFacts').addEventListener('change', async (e)=>{
    const f = e.target.files?.[0]; if(!f) return;
    const rows = await parseCSVFile(f); ingestFacts(rows); renderCountryDetail();
  });
  $('#fileMap').addEventListener('change', async (e)=>{
    const f = e.target.files?.[0]; if(!f) return;
    const rows = await parseCSVFile(f);
    ingestMap(rows); renderAll();
  });

  $('#loadSample').addEventListener('click', loadSample);
  $('#reset').addEventListener('click', resetAll);

  // Mapping selectors
  const mapSel = ['colDate','colCode','colName','colContinent','colValue','colChange'];
  mapSel.forEach(id => { $('#'+id).addEventListener('change', ()=>{ const v=$('#'+id).value||null; const key=id.replace('col','').toLowerCase(); state.cols[key]=v; computeLatestDate(); renderAll(); }); });

  // Options
  $('#latestDate').addEventListener('change', ()=>{ state.latestDate=$('#latestDate').value; renderAll(); });
  $('#thrUp').addEventListener('change', ()=>{ state.thrUp=parseFloat($('#thrUp').value)||5; renderAll(); });
  $('#thrDown').addEventListener('change', ()=>{ state.thrDown=parseFloat($('#thrDown').value)||-5; renderAll(); });
  $('#topN').addEventListener('change', ()=>{ state.topN=parseInt($('#topN').value)||30; renderAll(); });

  // Tabs
  $$('.tab').forEach(b => b.addEventListener('click', ()=> switchTab(b.dataset.tab)));

  // Keyboard hint: g+h to heatmap, g+m to movers, g+c to country, g+n to news
  document.addEventListener('keydown', (e)=>{
    if(e.key.toLowerCase()==='h' && (e.ctrlKey||e.metaKey)){ e.preventDefault(); switchTab('tab-heatmap'); }
    if(e.key.toLowerCase()==='m' && (e.ctrlKey||e.metaKey)){ e.preventDefault(); switchTab('tab-movers'); }
    if(e.key.toLowerCase()==='c' && (e.ctrlKey||e.metaKey)){ e.preventDefault(); switchTab('tab-country'); }
    if(e.key.toLowerCase()==='n' && (e.ctrlKey||e.metaKey)){ e.preventDefault(); switchTab('tab-news'); }
  });
});
