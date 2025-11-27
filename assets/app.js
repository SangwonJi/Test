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
  const map = await fetch('sample_map.csv').then(r=>r.text());
  const [metrics] = await Promise.all([new Promise(res=>Papa.parse(m,{header:true,complete:r=>res(r.data)}))]);
  const [cmapRows] = await Promise.all([new Promise(res=>Papa.parse(map,{header:true,complete:r=>res(r.data)}))]);
  ingestMetrics(metrics);
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

function ingestNews(data){
  // API 응답 또는 배열 처리
  if(Array.isArray(data)){
    state.news = data.filter(r => (r.continent || r.Continent || r.CONtinent));
  } else if(data && Array.isArray(data.items || data.news || data.data)){
    state.news = (data.items || data.news || data.data).filter(r => (r.continent || r.Continent || r.CONtinent));
  } else {
    state.news = [];
  }
}

function ingestFacts(data){
  // API 응답 또는 배열 처리
  if(Array.isArray(data)){
    state.facts = data.filter(r => (r.country_code || r.code || r.Code || r.country || '').toString().trim() !== '');
  } else if(data && Array.isArray(data.items || data.facts || data.data)){
    state.facts = (data.items || data.facts || data.data).filter(r => (r.country_code || r.code || r.Code || r.country || '').toString().trim() !== '');
  } else {
    state.facts = [];
  }
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
  updateMeta();
}

function updateMeta(){
  $('#meta').textContent = `지표 행: ${state.metrics.length} · 뉴스: ${state.news.length}개 · 상세정보: ${state.facts.length}개 · 매핑 국가: ${Object.keys(state.cmap).length}`;
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

// --- Color functions (PUBGM_TRAFFIC style)
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

function rgbToHex(r, g, b) {
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function interpolateColor(color1, color2, factor) {
  const rgb1 = hexToRgb(color1);
  const rgb2 = hexToRgb(color2);
  if (!rgb1 || !rgb2) return color1;
  
  const r = Math.round(rgb1.r + (rgb2.r - rgb1.r) * factor);
  const g = Math.round(rgb1.g + (rgb2.g - rgb1.g) * factor);
  const b = Math.round(rgb1.b + (rgb2.b - rgb1.b) * factor);
  
  return rgbToHex(r, g, b);
}

function colorFromChange(change, intensity = 1) {
  // 색상 정의 (PUBGM_TRAFFIC 스타일)
  const colors = {
    pos3: '#30cc5a',  // +3%
    pos2: '#2f9e4f',  // +2%
    pos1: '#3e7c55',  // +1%
    zero: '#414554',  // 0%
    neg1: '#8b444e',  // -1%
    neg2: '#bf4045',  // -2%
    neg3: '#f63538'   // -3%
  };
  
  // 변화율에 따라 색상 보간
  if (change >= 3) {
    return colors.pos3;
  } else if (change >= 2) {
    const factor = (change - 2) / 1;
    return interpolateColor(colors.pos2, colors.pos3, factor);
  } else if (change >= 1) {
    const factor = (change - 1) / 1;
    return interpolateColor(colors.pos1, colors.pos2, factor);
  } else if (change > 0) {
    const factor = change / 1;
    return interpolateColor(colors.zero, colors.pos1, factor);
  } else if (change === 0 || (change > -0.5 && change < 0.5)) {
    return colors.zero;
  } else if (change > -1) {
    const factor = Math.abs(change) / 1;
    return interpolateColor(colors.zero, colors.neg1, factor);
  } else if (change > -2) {
    const factor = (Math.abs(change) - 1) / 1;
    return interpolateColor(colors.neg1, colors.neg2, factor);
  } else if (change > -3) {
    const factor = (Math.abs(change) - 2) / 1;
    return interpolateColor(colors.neg2, colors.neg3, factor);
  } else {
    return colors.neg3;
  }
}

// --- Convert current data format to PUBGM_TRAFFIC format
function convertToPubgmFormat(){
  // 모든 날짜 수집
  const dateCol = state.cols.date;
  const codeCol = state.cols.code;
  const valCol = state.cols.value;
  if(!dateCol || !codeCol || !valCol) return null;
  
  const allDatesSet = new Set();
  const countryDataMap = {}; // {country: {dates: {date: value}}}
  
  for(const r of state.metrics){
    const dateStr = r[dateCol] ? new Date(toTime(r[dateCol])).toISOString().slice(0,10) : null;
    if(!dateStr) continue;
    const country = state.cols.name ? String(r[state.cols.name]||'') : (state.cmap[String(r[codeCol]||'').toUpperCase()]?.name || String(r[codeCol]||''));
    if(!country) continue;
    const value = valueOf(r);
    if(isNaN(value)) continue;
    
    allDatesSet.add(dateStr);
    if(!countryDataMap[country]) countryDataMap[country] = {};
    countryDataMap[country][dateStr] = value;
  }
  
  const allDates = Array.from(allDatesSet).sort();
  if(allDates.length === 0) return null;
  
  const countries = Object.keys(countryDataMap);
  const trafficByDate = {};
  allDates.forEach(date => {
    trafficByDate[date] = countries.map(country => countryDataMap[country][date] || 0);
  });
  
  return {
    Country: countries,
    allDates: allDates,
    trafficByDate: trafficByDate,
    lastDate: allDates[allDates.length - 1]
  };
}

// --- PUBGM_TRAFFIC country to continent mapping
const countryToContinent = {
  'USA':'NORTH AMERICA','United States':'NORTH AMERICA','Canada':'NORTH AMERICA','Mexico':'NORTH AMERICA','Guatemala':'NORTH AMERICA','Honduras':'NORTH AMERICA','El Salvador':'NORTH AMERICA','Nicaragua':'NORTH AMERICA','Costa Rica':'NORTH AMERICA','Panama':'NORTH AMERICA','Cuba':'NORTH AMERICA','Jamaica':'NORTH AMERICA','Haiti':'NORTH AMERICA','Dominican Republic':'NORTH AMERICA','Trinidad':'NORTH AMERICA','Barbados':'NORTH AMERICA','Bahamas':'NORTH AMERICA','Belize':'NORTH AMERICA',
  'Brazil':'SOUTH AMERICA','Argentina':'SOUTH AMERICA','Chile':'SOUTH AMERICA','Colombia':'SOUTH AMERICA','Peru':'SOUTH AMERICA','Ecuador':'SOUTH AMERICA','Venezuela':'SOUTH AMERICA','Uruguay':'SOUTH AMERICA','Paraguay':'SOUTH AMERICA','Bolivia':'SOUTH AMERICA','Suriname':'SOUTH AMERICA','Guyana':'SOUTH AMERICA','French Guiana':'SOUTH AMERICA',
  'Germany':'EUROPE','UK':'EUROPE','United Kingdom':'EUROPE','France':'EUROPE','Italy':'EUROPE','Spain':'EUROPE','Netherlands':'EUROPE','Poland':'EUROPE','Belgium':'EUROPE','Sweden':'EUROPE','Switzerland':'EUROPE','Greece':'EUROPE','Portugal':'EUROPE','Czech Republic':'EUROPE','Romania':'EUROPE','Hungary':'EUROPE','Bulgaria':'EUROPE','Croatia':'EUROPE','Serbia':'EUROPE','Slovakia':'EUROPE','Slovenia':'EUROPE','Austria':'EUROPE','Denmark':'EUROPE','Norway':'EUROPE','Finland':'EUROPE','Ireland':'EUROPE','Cyprus':'EUROPE','Albania':'EUROPE','Bosnia':'EUROPE','Macedonia':'EUROPE','Montenegro':'EUROPE','Kosovo':'EUROPE','Iceland':'EUROPE','Luxembourg':'EUROPE','Malta':'EUROPE','Monaco':'EUROPE','Andorra':'EUROPE','Liechtenstein':'EUROPE','San Marino':'EUROPE','Vatican':'EUROPE','Jersey':'EUROPE','Guernsey':'EUROPE','Isle of Man':'EUROPE','Faroe Islands':'EUROPE','Greenland':'EUROPE','Svalbard':'EUROPE','Ukraine':'EUROPE','Lithuania':'EUROPE','Latvia':'EUROPE','Estonia':'EUROPE','Moldova':'EUROPE','Belarus':'EUROPE',
  'China':'ASIA','India':'ASIA','Japan':'ASIA','Korea':'ASIA','South Korea':'ASIA','Indonesia':'ASIA','Thailand':'ASIA','Vietnam':'ASIA','Philippines':'ASIA','Malaysia':'ASIA','Singapore':'ASIA','Pakistan':'ASIA','Bangladesh':'ASIA','Myanmar':'ASIA','Cambodia':'ASIA','Laos':'ASIA','Nepal':'ASIA','Sri Lanka':'ASIA','Afghanistan':'ASIA','Iraq':'ASIA','Iran':'ASIA','Israel':'ASIA','Jordan':'ASIA','Lebanon':'ASIA','Kuwait':'ASIA','Qatar':'ASIA','Oman':'ASIA','Bahrain':'ASIA','Yemen':'ASIA','Syria':'ASIA','Saudi Arabia':'ASIA','UAE':'ASIA','Turkey':'ASIA','Kazakhstan':'ASIA','Uzbekistan':'ASIA','Kyrgyzstan':'ASIA','Tajikistan':'ASIA','Turkmenistan':'ASIA','Azerbaijan':'ASIA','Armenia':'ASIA','Georgia':'ASIA','Mongolia':'ASIA','North Korea':'ASIA','Taiwan':'ASIA','Hong Kong':'ASIA','Macau':'ASIA','Brunei':'ASIA','East Timor':'ASIA','Bhutan':'ASIA','Maldives':'ASIA',
  'South Africa':'AFRICA','Egypt':'AFRICA','Nigeria':'AFRICA','Morocco':'AFRICA','Algeria':'AFRICA','Tunisia':'AFRICA','Libya':'AFRICA','Sudan':'AFRICA','Ethiopia':'AFRICA','Kenya':'AFRICA','Tanzania':'AFRICA','Uganda':'AFRICA','Ghana':'AFRICA','Ivory Coast':'AFRICA','Senegal':'AFRICA','Cameroon':'AFRICA','Angola':'AFRICA','Mozambique':'AFRICA','Madagascar':'AFRICA','Zimbabwe':'AFRICA','Zambia':'AFRICA','Malawi':'AFRICA','Rwanda':'AFRICA','Burundi':'AFRICA','Somalia':'AFRICA','Djibouti':'AFRICA','Eritrea':'AFRICA','Mauritania':'AFRICA','Mali':'AFRICA','Burkina Faso':'AFRICA','Niger':'AFRICA','Chad':'AFRICA','Central African Republic':'AFRICA','Congo':'AFRICA','DR Congo':'AFRICA','Gabon':'AFRICA','Equatorial Guinea':'AFRICA','Sao Tome':'AFRICA','Guinea':'AFRICA','Sierra Leone':'AFRICA','Liberia':'AFRICA','Togo':'AFRICA','Benin':'AFRICA','Mauritius':'AFRICA','Seychelles':'AFRICA','Comoros':'AFRICA','Cape Verde':'AFRICA','Guinea-Bissau':'AFRICA','Gambia':'AFRICA','Lesotho':'AFRICA','Swaziland':'AFRICA','Botswana':'AFRICA','Namibia':'AFRICA',
  'Australia':'OCEANIA','New Zealand':'OCEANIA','Papua New Guinea':'OCEANIA','Fiji':'OCEANIA','Solomon Islands':'OCEANIA','Vanuatu':'OCEANIA','Samoa':'OCEANIA','Tonga':'OCEANIA','Palau':'OCEANIA','Micronesia':'OCEANIA','Marshall Islands':'OCEANIA','Norfolk Island':'OCEANIA','Christmas Island':'OCEANIA','Cocos Islands':'OCEANIA',
  'Russia':'RUSSIA & CIS'
};

const getContinent = (c) => {
  // 먼저 countryToContinent에서 찾기
  if(countryToContinent[c]) return countryToContinent[c];
  // 현재 프로젝트의 ensureContinentForRow 로직 사용
  const codeCol = state.cols.code;
  const nameCol = state.cols.name;
  for(const r of state.metrics){
    const name = nameCol ? String(r[nameCol]||'') : '';
    if(name === c){
      return ensureContinentForRow(r);
    }
    const code = codeCol ? String(r[codeCol]||'').toUpperCase() : '';
    if(code && state.cmap[code]?.name === c){
      return state.cmap[code].continent || 'OTHER';
    }
  }
  return 'OTHER';
};

// --- PUBGM_TRAFFIC calculateStats (exact copy)
function calculateStats(data){
  const total=[], change=[], lastDayTraffic=[];
  const {Country, allDates, trafficByDate} = data;
  const comparisonType = 'DoD'; // 기본값
  
  const lastDate = allDates.length > 0 ? new Date(allDates[allDates.length - 1]) : null;
  
  for(let i=0;i<Country.length;i++){
    const lastDayValue = (lastDate && trafficByDate[allDates[allDates.length - 1]] && trafficByDate[allDates[allDates.length - 1]][i]) || 0;
    lastDayTraffic.push(lastDayValue);
    
    let compareValue = null;
    
    if(lastDate && !isNaN(lastDate)){
      // DoD: 첫 날과 마지막 날
      if(allDates.length > 0){
        const firstDate = new Date(allDates[0]);
        if(!isNaN(firstDate) && trafficByDate[allDates[0]] && trafficByDate[allDates[0]][i] !== undefined){
          compareValue = trafficByDate[allDates[0]][i];
        }
      }
    }
    
    if(compareValue !== null && compareValue > 0 && lastDayValue > 0){
      change.push(((lastDayValue - compareValue) / compareValue) * 100);
    } else {
      change.push(0);
    }
    
    total.push(lastDayValue);
  }
  
  const topN = 180;
  const sortBy = 'revenue';
  let idx;
  if(sortBy==='revenue'){
    idx=Array.from({length:data.Country.length},(_,i)=>i).sort((a,b)=> total[b]-total[a]).slice(0,topN);
  } else if(sortBy==='change_desc'){
    idx=Array.from({length:data.Country.length},(_,i)=>i)
      .sort((a,b)=> Math.abs(change[b])-Math.abs(change[a]))
      .slice(0,topN);
  } else if(sortBy==='change_asc'){
    idx=Array.from({length:data.Country.length},(_,i)=>i)
      .filter(i=> change[i] < 0)
      .sort((a,b)=> Math.abs(change[a])-Math.abs(change[b]))
      .slice(0,topN);
  }

  const topCountries=idx.map(i=>data.Country[i]);
  const topRevenue=idx.map(i=>total[i]);
  const topChange=idx.map(i=>change[i]);
  const totalSum=topRevenue.reduce((a,b)=>a+b,0);
  const avgChange=topChange.reduce((a,b)=>a+b,0)/topChange.length;
  
  const maxChangeIdx = topChange.indexOf(Math.max(...topChange));
  const minChangeIdx = topChange.indexOf(Math.min(...topChange));
  const maxChangeCountry = topCountries[maxChangeIdx] || '';
  const minChangeCountry = topCountries[minChangeIdx] || '';
  
  const allCountries = data.Country;
  const allLastDayTraffic = total;
  const trafficTop10 = Array.from({length:allCountries.length},(_,i)=>i)
    .sort((a,b)=> allLastDayTraffic[b]-allLastDayTraffic[a])
    .slice(0,10)
    .map(i=>({
      country: allCountries[i],
      traffic: allLastDayTraffic[i],
      change: change[i]
    }));
  
  return {topCountries, topRevenue, topChange, totalSum, avgChange,
          maxChange:Math.max(...topChange), minChange:Math.min(...topChange),
          maxChangeCountry, minChangeCountry, trafficTop10};
}

// --- PUBGM_TRAFFIC createTreemap (exact copy)
function renderHeatmap(){
  const heatmapDiv = document.getElementById('heatmap');
  
  // 데이터 변환
  const data = convertToPubgmFormat();
  if(!data || !data.Country.length){
    heatmapDiv.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--muted)">데이터가 없습니다. CSV 파일을 업로드하거나 샘플을 불러오세요.</div>';
    return;
  }
  
  const stats=calculateStats(data);
  const topN=180;
  const groupBy=true; // 항상 대륙별 그룹화

  // Build treemap arrays (PUBGM_TRAFFIC exact copy)
  let ids=[], labels=[], parents=[], values=[], colors=[], text=[], custom=[], codes=[];

  if(groupBy){
    const groups={};
    stats.topCountries.forEach((c,i)=>{ const G=getContinent(c); (groups[G]||(groups[G]={c:[],v:[],chg:[]})).c.push(c); groups[G].v.push(stats.topRevenue[i]); groups[G].chg.push(stats.topChange[i]); });
    const continents=Object.keys(groups).sort((a,b)=> groups[b].v.reduce((x,y)=>x+y,0)-groups[a].v.reduce((x,y)=>x+y,0));

    continents.forEach(cont=>{
      const g=groups[cont];
      const total=g.v.reduce((a,b)=>a+b,0);
      const contId=`continent:${cont}`;
      const continentTextShadow = 'text-shadow: 2px 2px 4px rgba(0,0,0,0.7), 0 0 6px rgba(0,0,0,0.6);';
      ids.push(contId); labels.push(cont); parents.push(''); values.push(total); colors.push('#262931'); text.push(`<b style="font-size:86.4px;font-weight:900;letter-spacing:2px;color:#FFFFFF;${continentTextShadow}">${cont}</b>`); custom.push([null,null,cont]);
      codes.push('');

      const small=0.010, medium=0.025;
      const maxAbsChange = g.chg.length > 0 ? Math.max(...g.chg.map(c => Math.abs(c))) : 1;
      const countryFontSize = 20;
      g.c.forEach((country,i)=>{
        const revenue=g.v[i];
        const change=g.chg[i];
        const share=revenue/total;
        const changeIntensity = maxAbsChange > 0 ? Math.abs(change) / maxAbsChange : 0;
        const col=colorFromChange(change, changeIntensity);
        ids.push(`country:${cont}:${country}`);
        labels.push(country);
        parents.push(contId);
        values.push(revenue);
        colors.push(col);
        codes.push(''); // 국가 코드는 나중에 매핑
        let t='';
        const textShadow = 'text-shadow: 1px 1px 3px rgba(0,0,0,0.7), 0 0 4px rgba(0,0,0,0.5);';
        if(share>=small){
          t = `<b style="font-size:${countryFontSize}px;font-weight:bold;color:#FFFFFF;${textShadow}">${country}</b><br><b style="font-size:${Math.max(12,countryFontSize*0.75)}px;font-weight:bold;color:#FFFFFF;${textShadow}">${change>=0?'+':''}${change.toFixed(1)}%</b>`;
        }else{
          t = `<b style="font-size:${countryFontSize}px;font-weight:bold;color:#FFFFFF;${textShadow}">${country}</b>`;
        }
        text.push(t);
        custom.push([change, revenue, cont]);
      });
    });
  } else {
    const total = stats.topRevenue.reduce((a,b)=>a+b,0);
    const small=0.006;
    const maxAbsChange = stats.topChange.length > 0 ? Math.max(...stats.topChange.map(c => Math.abs(c))) : 1;
    const countryFontSize = 20;
    stats.topCountries.forEach((country,i)=>{
      const rev=stats.topRevenue[i]; const ch=stats.topChange[i]; const share=rev/total; const cont=getContinent(country);
      const changeIntensity = maxAbsChange > 0 ? Math.abs(ch) / maxAbsChange : 0;
      const col = colorFromChange(ch, changeIntensity);
      ids.push(`country::${country}`); labels.push(country); parents.push(''); values.push(rev); colors.push(col);
      codes.push('');
      let t='';
      const textShadow = 'text-shadow: 1px 1px 3px rgba(0,0,0,0.9), 0 0 5px rgba(0,0,0,0.7);';
      if(share>=small) t = `<b style="font-size:${countryFontSize}px;font-weight:bold;color:#FFFFFF;${textShadow}">${country}</b><br><b style="font-size:${Math.max(12,countryFontSize*0.75)}px;font-weight:bold;color:#FFFFFF;${textShadow}">${ch>=0?'+':''}${ch.toFixed(1)}%</b>`;
      else t = `<b style="font-size:${countryFontSize}px;font-weight:bold;color:#FFFFFF;${textShadow}">${country}</b>`;
      text.push(t);
      custom.push([ch, rev, cont]);
    });
  }

  const height = 900;

  const trace={
    type:'treemap',
    ids, labels, parents, values,
    text, textinfo:'text', textposition:'middle center',
    marker:{ colors, line:{width:1, color:'#000000'}, depthfade:false },
    tiling:{ pad: 1 },
    branchvalues:'total', maxdepth: groupBy ? 2 : 1,
    hovertemplate:'<b>%{label}</b><br>Traffic: %{value:,.0f}<br>'+
                  'Change: %{customdata[0]:.2f}%<br>Sector: %{customdata[2]}<extra></extra>',
    customdata: custom,
    pathbar:{visible:false}
  };

  const layout={
    paper_bgcolor: '#262931',
    plot_bgcolor: '#262931',
    margin:{l:0,r:0,t:0,b:0}, height,
    font:{family:'Arial, Helvetica, sans-serif',size:11,color:'#FFFFFF'},
    hoverlabel:{bgcolor:'#161b22',bordercolor:'#30363d',font:{color:'#fff'}}
  };

  Plotly.newPlot('heatmap',[trace],layout,{responsive:true}).then(()=>{
    heatmapDiv.on('plotly_click', (ev) => {
      if(!ev || !ev.points || !ev.points.length) return;
      const p = ev.points[0];
      if(!p) return;
      const label = p.label;
      // 국가 이름으로 코드 찾기
      const codeCol = state.cols.code;
      const nameCol = state.cols.name;
      let code = null;
      for(const r of state.metrics){
        const name = nameCol ? String(r[nameCol]||'') : '';
        if(name === label){
          code = codeCol ? String(r[codeCol]||'').toUpperCase() : null;
          break;
        }
      }
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
  // 국가 선택 시 상세정보 자동 로딩
  fetchFacts(code);
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

// --- API calls
async function fetchNews(){
  const url = $('#apiNewsUrl').value?.trim();
  if(!url){
    alert('뉴스 API 엔드포인트를 입력하세요.');
    return;
  }
  try {
    $('#loadNews').disabled = true;
    $('#loadNews').textContent = '로딩 중...';
    const response = await fetch(url);
    if(!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    const data = await response.json();
    ingestNews(data);
    renderNews();
    updateMeta();
    $('#loadNews').textContent = '뉴스 불러오기';
  } catch(err){
    alert(`뉴스 로딩 실패: ${err.message}`);
    console.error('News API error:', err);
  } finally {
    $('#loadNews').disabled = false;
    $('#loadNews').textContent = '뉴스 불러오기';
  }
}

async function fetchFacts(countryCode = null){
  const url = $('#apiFactsUrl').value?.trim();
  if(!url){
    if(countryCode) return; // 국가 선택 시 자동 로딩이면 조용히 실패
    alert('상세정보 API 엔드포인트를 입력하세요.');
    return;
  }
  try {
    let fetchUrl = url;
    if(countryCode){
      // 국가 코드를 쿼리 파라미터로 추가
      fetchUrl = url + (url.includes('?') ? '&' : '?') + `country_code=${countryCode}`;
    }
    const response = await fetch(fetchUrl);
    if(!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    const data = await response.json();
    if(countryCode){
      // 특정 국가의 상세정보만 업데이트
      const newFacts = Array.isArray(data) ? data : (data.items || data.facts || data.data || []);
      state.facts = state.facts.filter(f => {
        const code = String(f.country_code||f.code||'').toUpperCase();
        return code !== countryCode.toUpperCase();
      });
      state.facts.push(...newFacts);
    } else {
      ingestFacts(data);
    }
    if(countryCode) renderCountryDetail();
    updateMeta();
  } catch(err){
    if(!countryCode) alert(`상세정보 로딩 실패: ${err.message}`);
    console.error('Facts API error:', err);
  }
}

function renderNews(){
  // Group by continent
  const wrap = $('#newsWrap'); wrap.innerHTML='';
  if(!state.news.length){ wrap.innerHTML='<div class="muted">뉴스가 없습니다. API 엔드포인트를 설정하고 "뉴스 불러오기" 버튼을 클릭하세요.</div>'; return; }
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
  $('#fileMap').addEventListener('change', async (e)=>{
    const f = e.target.files?.[0]; if(!f) return;
    const rows = await parseCSVFile(f);
    ingestMap(rows); renderAll();
  });

  $('#loadSample').addEventListener('click', loadSample);
  $('#reset').addEventListener('click', resetAll);
  
  // API 호출 버튼
  $('#loadNews').addEventListener('click', fetchNews);
  $('#loadFacts').addEventListener('click', ()=>fetchFacts());

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
  
  // 페이지 로드 시 자동으로 샘플 데이터 불러오기 (PUBGM_TRAFFIC 스타일)
  window.addEventListener('load', ()=>{
    loadSample();
  });
});
