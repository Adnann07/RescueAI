/**
 * RescueAI — Socket.io Server
 *
 * Setup:   npm install && node server.js
 *
 * Pages:
 *   /               → Reporter map
 *   /disasters      → Crowd-sourced live feed
 *   /live-disasters → GDACS real-world data
 *   /risk-map       → Automated risk assessment pipeline
 *
 * Pipeline endpoints:
 *   GET /api/gdacs              → Raw GDACS XML (cached 3h)
 *   GET /api/risk-pipeline      → Latest computed district risk boosts (JSON)
 *   POST /api/risk-pipeline/run → Trigger a manual pipeline run
 */

const express    = require('express');
const http       = require('http');
const https      = require('https');
const { Server } = require('socket.io');
const path       = require('path');

const app    = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: false,
  },
  transports: ['polling', 'websocket'],
  allowEIO3: true,          // accept engine.io v3 AND v4 clients
  pingTimeout: 60000,
  pingInterval: 25000,
  upgradeTimeout: 30000,
  allowUpgrades: true,
  cookie: false,
});
app.use(express.json());

// Allow requests from Flutter app and any browser
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── Rescuer state ────────────────────────────────────────────────
// Open registration — no team code required
// Rescuers persist for 24h after going offline (for disaster tracking)
const rescuers = {};
const RESCUER_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

function broadcastRescuers() {
  io.emit('rescuers:list', Object.values(rescuers));
}

// Mark rescuer as offline but keep them visible
function markRescuerOffline(id) {
  if (!rescuers[id]) return;
  rescuers[id].online   = false;
  rescuers[id].status   = 'unreachable';
  rescuers[id].offlineSince = new Date().toISOString();
  broadcastRescuers();
  console.log(`[Rescuer] Offline (kept 24h): ${rescuers[id].name}`);
}

// Purge rescuers offline for more than 24h
function purgeExpiredRescuers() {
  const now = Date.now();
  let purged = 0;
  Object.keys(rescuers).forEach(id => {
    const r = rescuers[id];
    if (!r.online && r.offlineSince) {
      const offlineMs = now - new Date(r.offlineSince).getTime();
      if (offlineMs > RESCUER_EXPIRY_MS) {
        delete rescuers[id];
        purged++;
        console.log(`[Rescuer] Purged after 24h: ${r.name}`);
      }
    }
  });
  if (purged > 0) broadcastRescuers();
}

// Run purge every 30 minutes
setInterval(purgeExpiredRescuers, 30 * 60 * 1000);

// ── Page routes (must come BEFORE static middleware so / is not
//    intercepted by index.html being served as the default file) ──
app.get('/',               (_, res) => res.sendFile(path.join(__dirname, 'risk-map.html')));
app.get('/reporter', (_, res) => {
  const fs = require('fs');
  let html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const groqKey = process.env.GROQ_API_KEY || '';

  // Inject override script just before </body>
  // This replaces generateBriefing entirely — works even if index.html is old
  const injectScript = `
<script>
window.GROQ_KEY = ${JSON.stringify(groqKey)};
// Override generateBriefing to call Groq directly from browser
generateBriefing = function() {
  document.getElementById('bp-loading').style.display = 'flex';
  document.getElementById('bp-content').style.display = 'none';
  document.getElementById('bp-footer').style.display  = 'none';
  document.getElementById('bp-sub').textContent = 'Analysing...';
  var key = window.GROQ_KEY || '';
  if (!key) {
    document.getElementById('bp-loading').style.display = 'none';
    document.getElementById('bp-content').style.display = 'block';
    document.getElementById('bp-content').innerHTML = '<div style="text-align:center;padding:32px;color:#c8192b"><div style="font-size:32px">!</div><div style="font-weight:700;margin-top:8px">GROQ_KEY not set in Railway</div></div>';
    return;
  }
  var rpts = (typeof reports !== 'undefined' ? reports : []).slice(0,6).map(function(r){
    return (r.severity||'med').toUpperCase()+' '+(r.type||'other')+' in '+(r.district||'BD')+': '+(r.title||'').slice(0,40);
  }).join(' | ') || 'No reports.';
  fetch('https://api.groq.com/openai/v1/chat/completions', {
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},
    body: JSON.stringify({
      model:'llama-3.3-70b-versatile',
      max_tokens:150,
      response_format:{type:'json_object'},
      messages:[
        {role:'system',content:'Return ONLY a JSON object. No markdown. Max 8 words per value.'},
        {role:'user',content:'Reports: '+rpts+'\\nReturn: {"level":"HIGH","summary":"8 words max","situation":"8 words max","areas":"8 words max","actions":["5 words","5 words","5 words"]}'}
      ]
    })
  })
  .then(function(r){return r.json();})
  .then(function(d){
    if(d.error) throw new Error(d.error.message);
    var b = JSON.parse((d.choices[0].message.content||'{}').replace(/\`\`\`json|\`\`\`/g,'').trim());
    renderBriefing({
      alert_level:(b.level||'MODERATE').toUpperCase(),
      title:'পরিস্থিতি বিবরণী',
      summary:b.summary||'',
      paragraph_1:{heading:'বর্তমান পরিস্থিতি',body:b.situation||''},
      paragraph_2:{heading:'ঝুঁকিপূর্ণ এলাকা',body:b.areas||''},
      paragraph_3:{heading:'করণীয়',body:(b.actions||[]).join(' | ')},
      key_actions:b.actions||[],
      priority_districts:[],
      generated_at:new Date().toLocaleString('en-BD',{timeZone:'Asia/Dhaka'}),
      data_summary:{crowd_reports:(typeof reports!=='undefined'?reports.length:0),gdacs_events:0}
    });
  })
  .catch(function(e){
    document.getElementById('bp-loading').style.display='none';
    document.getElementById('bp-content').style.display='block';
    document.getElementById('bp-content').innerHTML='<div style="text-align:center;padding:32px;color:#c8192b"><div style="font-size:32px">!</div><div style="font-weight:700;margin-top:8px">'+e.message+'</div></div>';
  });
};
</script>`;

  html = html.replace('</body>', injectScript + '\n</body>');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});
app.get('/disasters',      (_, res) => res.sendFile(path.join(__dirname, 'disasters.html')));
app.get('/live-disasters', (_, res) => res.sendFile(path.join(__dirname, 'live-disasters.html')));
app.get('/risk-map',       (_, res) => res.sendFile(path.join(__dirname, 'risk-map.html')));
app.get('/volunteer',      (_, res) => res.sendFile(path.join(__dirname, 'volunteer.html')));
app.get('/methodology',    (_, res) => res.sendFile(path.join(__dirname, 'methodology.html')));
app.get('/dashboard',      (_, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/simulation',     (_, res) => res.sendFile(path.join(__dirname, 'simulation.html')));

// ── Static files (CSS, JS, images, etc.) ─────────────────────────
app.use(express.static(__dirname));

// ════════════════════════════════════════════════════════════════════
//  RISK ASSESSMENT PIPELINE
//  Fetches GDACS → parses events → scores against BD districts →
//  stores results → broadcasts to connected clients via Socket.io
// ════════════════════════════════════════════════════════════════════

// Bangladesh district bounding boxes  [minLng, minLat, maxLng, maxLat]
const DISTRICT_BOUNDS = {
  'Sunamganj':         [90.8, 24.7, 92.3, 25.4],
  'Sylhet':            [91.6, 24.5, 92.6, 25.2],
  'Moulvibazar':       [91.5, 24.1, 92.4, 24.8],
  'Habiganj':          [91.0, 24.0, 91.8, 24.8],
  'Netrokona':         [90.4, 24.5, 91.2, 25.2],
  'Mymensingh':        [89.9, 24.4, 90.8, 25.1],
  'Sherpur':           [89.6, 24.8, 90.4, 25.4],
  'Jamalpur':          [89.3, 24.6, 90.1, 25.4],
  'Kishoreganj':       [90.3, 24.1, 91.2, 24.8],
  'Brahmanbaria':      [90.9, 23.6, 91.7, 24.4],
  'Narsingdi':         [90.4, 23.7, 91.0, 24.2],
  'Narayanganj':       [90.3, 23.4, 90.8, 23.9],
  'Dhaka':             [90.1, 23.6, 90.8, 24.1],
  'Gazipur':           [90.1, 23.9, 90.7, 24.4],
  'Manikganj':         [89.7, 23.6, 90.3, 24.1],
  'Munshiganj':        [90.3, 23.2, 90.8, 23.7],
  'Tangail':           [89.6, 24.0, 90.4, 24.6],
  'Rajbari':           [89.3, 23.4, 89.9, 23.9],
  'Faridpur':          [89.5, 23.1, 90.2, 23.7],
  'Madaripur':         [89.9, 22.8, 90.5, 23.4],
  'Shariatpur':        [90.2, 23.0, 90.8, 23.5],
  'Gopalganj':         [89.7, 22.7, 90.2, 23.2],
  'Chandpur':          [90.6, 23.0, 91.1, 23.6],
  'Lakshmipur':        [90.7, 22.7, 91.2, 23.3],
  'Cumilla':           [90.9, 23.3, 91.6, 24.0],
  'Feni':              [91.2, 22.9, 91.7, 23.3],
  'Noakhali':          [90.9, 22.5, 91.5, 23.2],
  'Chattogram':        [91.5, 22.1, 92.1, 22.8],
  "Cox's Bazar":       [91.7, 21.1, 92.4, 22.1],
  'Rangamati':         [91.8, 22.3, 92.7, 23.4],
  'Khagrachhari':      [91.6, 22.9, 92.5, 23.8],
  'Bandarban':         [92.0, 21.4, 92.7, 22.5],
  'Bogura':            [88.9, 24.5, 89.6, 25.2],
  'Sirajganj':         [89.3, 24.0, 89.9, 24.7],
  'Natore':            [88.7, 24.1, 89.4, 24.7],
  'Pabna':             [89.0, 23.7, 89.7, 24.2],
  'Naogaon':           [88.4, 24.4, 89.2, 25.1],
  'Rajshahi':          [88.1, 24.1, 88.9, 24.6],
  'Chapai Nawabganj':  [87.9, 24.4, 88.6, 24.9],
  'Joypurhat':         [88.9, 24.9, 89.5, 25.4],
  'Kushtia':           [88.7, 23.5, 89.3, 24.0],
  'Chuadanga':         [88.5, 23.4, 89.1, 23.9],
  'Meherpur':          [88.4, 23.5, 88.8, 23.9],
  'Jhenaidah':         [88.8, 23.0, 89.4, 23.6],
  'Magura':            [89.3, 23.1, 89.7, 23.5],
  'Jashore':           [88.9, 22.8, 89.5, 23.4],
  'Narail':            [89.3, 22.8, 89.7, 23.2],
  'Khulna':            [89.2, 22.3, 89.7, 22.9],
  'Satkhira':          [88.8, 22.1, 89.3, 22.8],
  'Bagerhat':          [89.4, 22.3, 89.9, 22.9],
  'Kurigram':          [89.3, 25.5, 89.9, 26.0],
  'Lalmonirhat':       [89.1, 25.6, 89.6, 26.1],
  'Nilphamari':        [88.6, 25.7, 89.2, 26.2],
  'Rangpur':           [88.9, 25.4, 89.6, 25.9],
  'Gaibandha':         [89.3, 25.1, 89.8, 25.6],
  'Dinajpur':          [88.3, 25.5, 89.0, 26.2],
  'Panchagarh':        [88.3, 26.1, 88.8, 26.6],
  'Thakurgaon':        [88.2, 25.9, 88.7, 26.3],
  'Bhola':             [90.5, 22.2, 91.2, 22.9],
  'Patuakhali':        [90.1, 21.9, 90.8, 22.5],
  'Barguna':           [89.8, 21.8, 90.4, 22.3],
  'Pirojpur':          [89.8, 22.3, 90.2, 22.8],
  'Barisal':           [90.1, 22.4, 90.6, 22.9],
  'Jhalokathi':        [90.0, 22.4, 90.4, 22.7],
};

// South Asia bounding box for filtering GDACS events
const SA_BOUNDS = { minLng: 60, maxLng: 100, minLat: 4, maxLat: 38 };

// How much each GDACS alert level boosts a district score (0–10 scale)
const ALERT_BOOST = { Red: 3.5, Orange: 2.0, Green: 0.8 };

// How each event type maps to a hazard
const EVENT_HAZARD = {
  FL: 'flood', TC: 'flood', TS: 'flood',  // flood-type
  DR: 'drought',                            // drought
  EQ: 'overall', VO: 'overall',            // other → overall
  WF: 'overall', LS: 'flood',
};

// Pipeline state
let pipelineState = {
  lastRun:       null,          // ISO timestamp
  lastRunStatus: 'never',       // 'never' | 'running' | 'ok' | 'error'
  lastRunMsg:    '',
  runCount:      0,
  activeEvents:  [],            // GDACS events near Bangladesh
  districtBoosts: {},           // { districtName: { flood, drought, overall, events: [] } }
  crowdBoosts:    {},           // from user-submitted reports
};

// ── DEMO: Seed active seasonal advisories for presentation ──────────
// Reflects real dry-season hazards for Bangladesh (Dec–Mar).
// The pipeline will overwrite these with real data when it next runs.
const DEMO_SEASONAL_BOOSTS = {
  'Rajshahi':  { flood:0, drought:1.8, overall:1.5, events:[{ title:'Heat Wave Advisory — Rajshahi Division, temperatures 38–41°C', source:'gdacs', type:'DR', alertLevel:'Red' }] },
  'Dhaka':     { flood:0, drought:0,   overall:1.5, events:[{ title:'Severe Air Quality Alert — Dhaka metro AQI Unhealthy (155+)', source:'gdacs', type:'DR', alertLevel:'Orange' }] },
  'Rangpur':   { flood:0, drought:1.0, overall:1.0, events:[{ title:'Cold Wave Advisory — Rangpur Division, temperatures below 9°C', source:'gdacs', type:'DR', alertLevel:'Orange' }] },
  'Naogaon':   { flood:0, drought:1.5, overall:1.0, events:[{ title:'Drought Watch — Barind Tract, below-normal rainfall, crop stress', source:'gdacs', type:'DR', alertLevel:'Orange' }] },
  'Dinajpur':  { flood:0, drought:0.8, overall:0.8, events:[{ title:'Dense Fog Advisory — Northern corridors, visibility below 200m', source:'gdacs', type:'DR', alertLevel:'Green' }] },
};
Object.keys(DEMO_SEASONAL_BOOSTS).forEach(d => {
  pipelineState.crowdBoosts[d] = DEMO_SEASONAL_BOOSTS[d];
});
console.log('[Demo] Seeded seasonal advisories for', Object.keys(DEMO_SEASONAL_BOOSTS).length, 'districts');

const PIPELINE_INTERVAL = 3 * 60 * 60 * 1000; // 3 hours

// ── GDACS Fetch (shared with /api/gdacs route) ────────────────────
let gdacsCache    = null;
let gdacsLastFetch = 0;
const GDACS_TTL   = 3 * 60 * 60 * 1000;

function fetchGDACSXML() {
  return new Promise((resolve, reject) => {
    const now = Date.now();
    if (gdacsCache && (now - gdacsLastFetch) < GDACS_TTL) {
      return resolve(gdacsCache);
    }
    const options = {
      hostname: 'www.gdacs.org',
      path:     '/xml/rss.xml',
      method:   'GET',
      headers:  {
        'User-Agent': 'RescueAI/1.0 (risk pipeline)',
        'Accept':     'application/rss+xml, application/xml, text/xml, */*',
      },
      timeout: 15000,
    };
    const req = https.request(options, upstream => {
      if (upstream.statusCode !== 200) return reject(new Error('GDACS HTTP ' + upstream.statusCode));
      let xml = '';
      upstream.setEncoding('utf8');
      upstream.on('data', c => { xml += c; });
      upstream.on('end', () => {
        if (!xml.includes('<rss') && !xml.includes('<feed'))
          return reject(new Error('Not valid RSS'));
        gdacsCache    = xml;
        gdacsLastFetch = Date.now();
        console.log('[GDACS] Fetched — ' + (xml.match(/<item>/g)||[]).length + ' items');
        resolve(xml);
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    req.end();
  });
}

// ── XML Parser (same as live-disasters.html but server-side) ─────
function parseGDACSEvents(xmlText) {
  // Simple regex-based parser — no DOM in Node.js
  const events = [];
  const itemRx = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRx.exec(xmlText)) !== null) {
    const block = m[1];
    const g = (tag) => {
      const patterns = [
        new RegExp('<gdacs:' + tag + '[^>]*>([^<]*)<\/gdacs:' + tag + '>', 'i'),
        new RegExp('<' + tag + '[^>]*>([^<]*)<\/' + tag + '>', 'i'),
      ];
      for (const p of patterns) {
        const r = p.exec(block);
        if (r) return r[1].trim();
      }
      return '';
    };

    // Coordinates from geo:lat / geo:long
    const latM = /<geo:lat[^>]*>([^<]+)<\/geo:lat>/i.exec(block) ||
                 /<lat[^>]*>([^<]+)<\/lat>/i.exec(block);
    const lngM = /<geo:long[^>]*>([^<]+)<\/geo:long>/i.exec(block) ||
                 /<geo:lon[^>]*>([^<]+)<\/geo:lon>/i.exec(block)  ||
                 /<long[^>]*>([^<]+)<\/long>/i.exec(block);

    // Try georss:point fallback
    let lat = latM ? parseFloat(latM[1]) : NaN;
    let lng = lngM ? parseFloat(lngM[1]) : NaN;
    if (isNaN(lat) || isNaN(lng)) {
      const pt = /<georss:point[^>]*>([^<]+)<\/georss:point>/i.exec(block);
      if (pt) { const p = pt[1].trim().split(/\s+/); lat = parseFloat(p[0]); lng = parseFloat(p[1]); }
    }
    if (isNaN(lat) || isNaN(lng)) continue;

    // Filter to South Asia
    if (lng < SA_BOUNDS.minLng || lng > SA_BOUNDS.maxLng ||
        lat < SA_BOUNDS.minLat || lat > SA_BOUNDS.maxLat) continue;

    const alertLevel = g('alertlevel') || 'Green';
    const evType     = (g('eventtype') || 'UN').toUpperCase().slice(0,2);
    const title      = /<title[^>]*>([^<]*)<\/title>/i.exec(block)?.[1]?.trim() || 'Event';
    const country    = g('country');
    const link       = /<link[^>]*>([^<]*)<\/link>/i.exec(block)?.[1]?.trim() || '';
    const pubDate    = /<pubDate[^>]*>([^<]*)<\/pubDate>/i.exec(block)?.[1]?.trim() || '';

    events.push({ lat, lng, alertLevel, evType, title, country, link, pubDate });
  }
  return events;
}

// ── District Matching ─────────────────────────────────────────────
// Returns list of district names whose bbox contains or is within
// a radius of the event. We use bbox overlap + 1° buffer for nearby events.
function matchDistricts(eventLat, eventLng, bufferDeg = 0.8) {
  const matched = [];
  for (const [name, bbox] of Object.entries(DISTRICT_BOUNDS)) {
    const [x0, y0, x1, y1] = bbox;
    // Check if event point (with buffer) overlaps district bbox
    if (eventLng >= x0 - bufferDeg && eventLng <= x1 + bufferDeg &&
        eventLat >= y0 - bufferDeg && eventLat <= y1 + bufferDeg) {
      matched.push(name);
    }
  }
  return matched;
}

// ── Crowd Report → District Boost ────────────────────────────────
// Called whenever a new report is submitted via the reporter map
function applyReportBoost(report) {
  if (!report.district) return;
  const hazard = {
    flood: 'flood', cyclone: 'flood', riverbank: 'flood',
    drought: 'drought', heatwave: 'drought',
    fire: 'overall', landslide: 'overall', storm: 'overall', other: 'overall',
  }[report.type] || 'overall';

  const boost = { critical: 2.5, high: 1.5, medium: 0.8, low: 0.3 }[report.severity] || 0.5;

  if (!pipelineState.crowdBoosts[report.district]) {
    pipelineState.crowdBoosts[report.district] = { flood:0, drought:0, overall:0, events:[] };
  }
  const cb = pipelineState.crowdBoosts[report.district];
  // Boost decays — cap at 3.0 per hazard from crowd reports
  cb[hazard] = Math.min(3.0, cb[hazard] + boost);
  cb.events.push({
    source: 'crowd',
    title:  report.title,
    type:   report.type,
    severity: report.severity,
    time:   report.time,
  });

  // Emit updated boosts to risk-map clients
  emitPipelineUpdate();
  console.log(`[Pipeline] Crowd boost: ${report.district} +${boost} ${hazard}`);
}

// ── Core Pipeline ─────────────────────────────────────────────────
async function runPipeline(triggeredBy = 'scheduler') {
  pipelineState.lastRunStatus = 'running';
  pipelineState.lastRunMsg    = 'Fetching GDACS data…';
  emitPipelineStatus();
  console.log(`[Pipeline] Running — triggered by ${triggeredBy}`);

  try {
    const xml    = await fetchGDACSXML();
    const events = parseGDACSEvents(xml);

    pipelineState.lastRunMsg = `Parsed ${events.length} SA events — scoring districts…`;
    emitPipelineStatus();

    // Reset GDACS boosts (crowd boosts persist until server restart)
    const newBoosts = {};

    for (const ev of events) {
      const districts = matchDistricts(ev.lat, ev.lng);
      const boostAmt  = ALERT_BOOST[ev.alertLevel] || 0.5;
      const hazard    = EVENT_HAZARD[ev.evType] || 'overall';

      for (const dist of districts) {
        if (!newBoosts[dist]) newBoosts[dist] = { flood:0, drought:0, overall:0, events:[] };
        newBoosts[dist][hazard] = Math.min(4.0, newBoosts[dist][hazard] + boostAmt);
        newBoosts[dist].events.push({
          source:     'gdacs',
          title:      ev.title,
          alertLevel: ev.alertLevel,
          evType:     ev.evType,
          country:    ev.country,
          link:       ev.link,
          time:       ev.pubDate,
        });
      }
    }

    pipelineState.activeEvents  = events;
    pipelineState.districtBoosts = newBoosts;
    pipelineState.lastRun       = new Date().toISOString();
    pipelineState.lastRunStatus = 'ok';
    pipelineState.lastRunMsg    = `OK — ${events.length} events, ${Object.keys(newBoosts).length} districts boosted`;
    pipelineState.runCount++;

    console.log(`[Pipeline] Done — ${events.length} events → ${Object.keys(newBoosts).length} districts boosted`);
    emitPipelineUpdate();

  } catch (err) {
    pipelineState.lastRunStatus = 'error';
    pipelineState.lastRunMsg    = err.message;
    console.error('[Pipeline] Error:', err.message);
    emitPipelineStatus();
  }
}

// ── Emit helpers ──────────────────────────────────────────────────
function emitPipelineStatus() {
  io.emit('pipeline:status', {
    status:    pipelineState.lastRunStatus,
    msg:       pipelineState.lastRunMsg,
    lastRun:   pipelineState.lastRun,
    runCount:  pipelineState.runCount,
  });
}

function emitPipelineUpdate() {
  // Merge GDACS boosts + crowd boosts into one object
  const merged = {};
  const allDistricts = new Set([
    ...Object.keys(pipelineState.districtBoosts),
    ...Object.keys(pipelineState.crowdBoosts),
  ]);
  for (const d of allDistricts) {
    const gb = pipelineState.districtBoosts[d] || { flood:0, drought:0, overall:0, events:[] };
    const cb = pipelineState.crowdBoosts[d]    || { flood:0, drought:0, overall:0, events:[] };
    merged[d] = {
      flood:   +(gb.flood   + cb.flood).toFixed(2),
      drought: +(gb.drought + cb.drought).toFixed(2),
      overall: +(gb.overall + cb.overall).toFixed(2),
      events:  [...(gb.events||[]), ...(cb.events||[])],
    };
  }

  // Run early warning check with latest merged boosts
  runEarlyWarningCheck(merged);

  io.emit('pipeline:update', {
    boosts:    merged,
    lastRun:   pipelineState.lastRun,
    status:    pipelineState.lastRunStatus,
    runCount:  pipelineState.runCount,
    eventCount: pipelineState.activeEvents.length,
    earlyWarnings: Object.values(earlyWarnings),
  });
}

// ── Pipeline API Routes ───────────────────────────────────────────

// GET /api/risk-pipeline — return latest computed results as JSON
app.get('/api/risk-pipeline', (req, res) => {
  const merged = {};
  const allDistricts = new Set([
    ...Object.keys(pipelineState.districtBoosts),
    ...Object.keys(pipelineState.crowdBoosts),
  ]);
  for (const d of allDistricts) {
    const gb = pipelineState.districtBoosts[d] || { flood:0, drought:0, overall:0, events:[] };
    const cb = pipelineState.crowdBoosts[d]    || { flood:0, drought:0, overall:0, events:[] };
    merged[d] = {
      flood:   +(gb.flood   + cb.flood).toFixed(2),
      drought: +(gb.drought + cb.drought).toFixed(2),
      overall: +(gb.overall + cb.overall).toFixed(2),
      events:  [...(gb.events||[]), ...(cb.events||[])],
    };
  }
  res.json({
    ok:         true,
    lastRun:    pipelineState.lastRun,
    status:     pipelineState.lastRunStatus,
    runCount:   pipelineState.runCount,
    eventCount: pipelineState.activeEvents.length,
    boosts:     merged,
  });
});

// POST /api/risk-pipeline/run — manually trigger a pipeline run
app.post('/api/risk-pipeline/run', (req, res) => {
  res.json({ ok: true, msg: 'Pipeline run triggered' });
  runPipeline('manual-api');
});

// POST /api/rescuer/join — HTTP join endpoint (more reliable than socket for initial handshake)
app.post('/api/rescuer/join', (req, res) => {
  const { name, team, code, lat, lng, socketId } = req.body;
  if (!name || !team) return res.status(400).json({ ok:false, error:'Missing fields' });
  // Open registration — no team code required
  const id = 'http_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
  const area = req.body.area || '';
  rescuers[id] = {
    id, name: name.slice(0,60), team: team.slice(0,60),
    area: area.slice(0,60),
    status: 'available',
    online: true,
    lat: parseFloat(lat)||23.7, lng: parseFloat(lng)||90.35,
    firstSeen: new Date().toISOString(),
    lastSeen:  new Date().toISOString(),
    offlineSince: null,
    trail: [],
  };
  broadcastRescuers();
  console.log(`[Rescuer] HTTP join: ${name} / ${team} → ${area||'no area'}`);
  res.json({ ok:true, id, name, team, area });
});

// POST /api/rescuer/move — HTTP GPS update
app.post('/api/rescuer/move', (req, res) => {
  const { id, lat, lng } = req.body;
  if (!id || !rescuers[id]) return res.status(404).json({ ok:false, error:'Rescuer not found' });
  rescuers[id].trail.push({ lat: rescuers[id].lat, lng: rescuers[id].lng });
  if (rescuers[id].trail.length > 15) rescuers[id].trail.shift();
  rescuers[id].lat          = parseFloat(lat);
  rescuers[id].lng          = parseFloat(lng);
  rescuers[id].lastSeen     = new Date().toISOString();
  rescuers[id].online       = true;
  rescuers[id].offlineSince = null;
  rescuers[id].status       = rescuers[id].status === 'unreachable' ? 'available' : rescuers[id].status;
  io.emit('rescuer:moved', { id, lat: rescuers[id].lat, lng: rescuers[id].lng, trail: rescuers[id].trail });
  res.json({ ok:true });
});

// POST /api/rescuer/status — HTTP status update
app.post('/api/rescuer/status', (req, res) => {
  const { id, status } = req.body;
  if (!id || !rescuers[id]) return res.status(404).json({ ok:false, error:'Rescuer not found' });
  const valid = ['available','on_mission','unreachable'];
  if (!valid.includes(status)) return res.status(400).json({ ok:false, error:'Invalid status' });
  rescuers[id].status = status;
  rescuers[id].lastSeen = new Date().toISOString();
  broadcastRescuers();
  res.json({ ok:true });
});

// DELETE /api/rescuer/leave — HTTP leave
app.delete('/api/rescuer/leave', (req, res) => {
  const { id } = req.body;
  if (id && rescuers[id]) {
    markRescuerOffline(id);
    console.log(`[Rescuer] HTTP leave (kept 24h): ${rescuers[id]?.name}`);
  }
  res.json({ ok:true });
});

// GET /api/rescuers — current rescuer positions (for external dashboards)
app.get('/api/rescuers', (req, res) => {
  res.json({ ok: true, count: Object.keys(rescuers).length, rescuers: Object.values(rescuers) });
});

// GET /api/rescuer-code — for testing (dev only)
// app.get('/api/rescuer-code', (_, res) => res.json({ code: RESCUER_CODE }));

// GET /api/gdacs — raw XML proxy (unchanged behaviour)
app.get('/api/gdacs', (req, res) => {
  fetchGDACSXML()
    .then(xml => {
      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('X-Cache', gdacsLastFetch ? 'HIT' : 'MISS');
      res.send(xml);
    })
    .catch(err => {
      if (gdacsCache) {
        res.setHeader('Content-Type', 'application/xml');
        res.setHeader('X-Cache', 'STALE');
        return res.send(gdacsCache);
      }
      res.status(502).json({ error: err.message });
    });
});


// ════════════════════════════════════════════════════════════════════
//  INFRASTRUCTURE LAYER — OpenStreetMap via Overpass API
//  Fetches hospitals, cyclone shelters, schools in Bangladesh
//  Cached for 24 hours (infrastructure rarely changes)
// ════════════════════════════════════════════════════════════════════

let infraCache    = null;
let infraCachedAt = 0;
const INFRA_TTL   = 24 * 60 * 60 * 1000; // 24 hours

// Overpass QL query — fetch hospitals, clinics, shelters, schools in BD
const OVERPASS_QUERY = `
[out:json][timeout:40];
area["name:en"="Bangladesh"]->.bd;
(
  node["amenity"~"^(hospital|clinic|doctors|health_post)$"](area.bd);
  way["amenity"~"^(hospital|clinic|doctors)$"](area.bd);
  node["healthcare"~"^(hospital|clinic|centre|center)$"](area.bd);
  node["amenity"="shelter"](area.bd);
  node["shelter_type"~"(cyclone|disaster|public)"](area.bd);
  node["cyclone_shelter"~"(yes|true)"](area.bd);
  way["cyclone_shelter"~"(yes|true)"](area.bd);
  node["emergency"~"(disaster_response|assembly_point)"](area.bd);
  node["amenity"="school"](area.bd);
  way["amenity"="school"](area.bd);
  node["amenity"="college"](area.bd);
);
out center 1200;
`.trim();

function fetchInfrastructure() {
  return new Promise((resolve, reject) => {
    const now = Date.now();
    if (infraCache && (now - infraCachedAt) < INFRA_TTL) {
      return resolve(infraCache);
    }

    console.log('[Infra] Fetching OSM infrastructure from Overpass…');
    const body = 'data=' + encodeURIComponent(OVERPASS_QUERY);

    const options = {
      hostname: 'overpass-api.de',
      path:     '/api/interpreter',
      method:   'POST',
      headers:  {
        'Content-Type':  'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent':    'RescueAI/1.0',
      },
      timeout: 35000,
    };

    const req = https.request(options, upstream => {
      if (upstream.statusCode !== 200)
        return reject(new Error('Overpass HTTP ' + upstream.statusCode));
      let data = '';
      upstream.setEncoding('utf8');
      upstream.on('data', c => { data += c; });
      upstream.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const features = processOverpassResult(parsed);
          infraCache    = features;
          infraCachedAt = Date.now();
          console.log('[Infra] Fetched ' + features.length + ' infrastructure points');
          resolve(features);
        } catch(e) {
          reject(new Error('Overpass parse error: ' + e.message));
        }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Overpass timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function processOverpassResult(json) {
  const features = [];
  for (const el of (json.elements || [])) {
    const tags = el.tags || {};
    const lat  = el.lat || (el.center && el.center.lat);
    const lng  = el.lon || (el.center && el.center.lon);
    if (!lat || !lng) continue;

    let type, icon, label;
    const amenity    = (tags.amenity    || '').toLowerCase();
    const healthcare = (tags.healthcare || '').toLowerCase();
    const shelter_t  = (tags.shelter_type || '').toLowerCase();
    const cyclone_s  = (tags.cyclone_shelter || '').toLowerCase();
    const emergency  = (tags.emergency  || '').toLowerCase();

    // Hospitals & clinics
    if (amenity === 'hospital' || healthcare === 'hospital') {
      type = 'hospital'; icon = '🏥'; label = tags.name || 'Hospital';
    } else if (['clinic','doctors','health_post','centre','center'].includes(amenity) ||
               ['clinic','centre','center'].includes(healthcare)) {
      type = 'hospital'; icon = '🏥'; label = tags.name || 'Clinic / Health Centre';
    }
    // Cyclone shelters — many tagging styles used in Bangladesh OSM
    else if (cyclone_s === 'yes' || cyclone_s === 'true' ||
             shelter_t.includes('cyclone') || shelter_t.includes('disaster') ||
             amenity === 'shelter' ||
             emergency === 'disaster_response' || emergency === 'assembly_point') {
      type = 'shelter'; icon = '🏠'; label = tags.name || 'Cyclone Shelter';
    }
    // Schools and colleges
    else if (amenity === 'school' || amenity === 'college') {
      type = 'school'; icon = '🏫'; label = tags.name || (amenity === 'college' ? 'College' : 'School');
    }
    else { continue; }

    features.push({
      id:    el.id,
      type,  icon,
      lat:   parseFloat(lat),
      lng:   parseFloat(lng),
      name:  label,
      addr:  tags['addr:full'] || tags['addr:city'] || tags['addr:street'] || '',
      phone: tags.phone || tags['contact:phone'] || tags['contact:mobile'] || '',
    });
  }
  return features;
}

// GET /api/infrastructure — return cached OSM features
// POST /api/infrastructure/refresh — force re-fetch from Overpass
app.post('/api/infrastructure/refresh', (req, res) => {
  infraCache    = null;
  infraCachedAt = 0;
  res.json({ ok:true, msg:'Infrastructure cache cleared — will re-fetch on next request' });
});

app.get('/api/infrastructure', (req, res) => {
  fetchInfrastructure()
    .then(features => {
      res.setHeader('X-Cache', infraCachedAt ? 'HIT' : 'MISS');
      res.json({ ok:true, count:features.length, features, cachedAt:new Date(infraCachedAt).toISOString() });
    })
    .catch(err => {
      console.error('[Infra] Error:', err.message);
      if (infraCache) {
        return res.json({ ok:true, count:infraCache.length, features:infraCache, stale:true });
      }
      res.status(502).json({ ok:false, error:err.message });
    });
});


// ════════════════════════════════════════════════════════════════════
//  PDF REPORT — /api/report  (POST) + /api/report/test  (GET)
//  Uses pdfkit (pure Node.js) — no Python required
//  npm install pdfkit
// ════════════════════════════════════════════════════════════════════

const PDFDocument = require('pdfkit');

// Colour helpers
const SEV_COLOR = (s) => s>=8?'#c8192b':s>=6?'#c96a00':s>=4?'#a16207':'#15803d';
const SEV_LABEL = (s) => s>=8?'VERY HIGH':s>=6?'HIGH':s>=4?'MEDIUM':s>=2?'LOW':'VERY LOW';

const TIPS = {
  flood: [
    ['Move to higher ground immediately',   'Do not wait for official orders. Go upstairs or to the roof if needed.'],
    ['Never walk through floodwater',        '15 cm of fast-moving water can knock you off your feet.'],
    ['Switch off electricity at the mains',  'Avoid contact with water near submerged electrical equipment.'],
    ['Clean wounds from floodwater',         'Floodwater carries sewage. Clean all cuts immediately with clean water and soap.'],
    ['Oral Rehydration Therapy for diarrhoea','1L water + 6 tsp sugar + 0.5 tsp salt. Seek care for children under 5.'],
    ['Emergency contacts',                   'Bangladesh Emergency: 999  |  BDRCS: 01713-038989  |  BWDB: 16122'],
  ],
  drought: [
    ['Drink water every 20 minutes',         'Do not wait until thirsty. Aim for 3+ litres per day.'],
    ['Boil or treat all drinking water',     'Boil for 1 full minute or use 1 chlorine tablet per 20L, wait 30 min.'],
    ['Identify severe dehydration',          'Signs: sunken eyes, dark urine, dizziness. Give ORS immediately.'],
    ['Screen children for malnutrition',     'MUAC below 11.5 cm = emergency. Seek hospital care immediately.'],
    ['Contact relief services',              'DGHS Nutrition: 16000  |  Dept. of Agriculture Extension: 16123'],
  ],
  overall: [
    ['Stay tuned to official alerts',        'Follow Bangladesh Meteorological Dept and DDM for updates.'],
    ['Prepare your emergency kit',           'Documents, medicine, 3-day water supply, food, torch, phone charger.'],
    ['Know your cyclone shelter',            'Locate the nearest shelter or multi-storey building now.'],
    ['Emergency contacts',                   'Police/Fire/Ambulance: 999  |  DDM: 01938-524500  |  BDRCS: 01713-038989'],
  ],
};

function buildPDF(data, res) {
  const district = data.district || 'Unknown';
  const division = data.division || '';
  const scores   = data.scores   || {};
  const boosts   = data.boosts   || {};
  const events   = data.events   || [];
  const infra    = data.infraNearby || [];
  const genTime  = new Date().toLocaleString('en-BD');

  const fl = Math.min(10, (scores.fl||0) + (boosts.flood||0));
  const dr = Math.min(10, (scores.dr||0) + (boosts.drought||0));
  const ov = Math.min(10, (scores.ov||0) + (boosts.overall||0));

  const doc = new PDFDocument({ size:'A4', margin:45, info:{
    Title: `RescueAI — ${district} Risk Report`,
    Author: 'RescueAI',
    Subject: 'District Disaster Risk Assessment',
  }});

  doc.pipe(res);

  const W = 595 - 90; // page width minus margins
  const M = 45;       // left margin

  // ── Header banner ──────────────────────────────────────
  doc.rect(M-45, 0, 595, 52).fill('#006a4e');
  doc.fontSize(18).font('Helvetica-Bold').fillColor('#ffffff')
     .text('RescueAI', M, 16, { continued: true })
     .fontSize(10).font('Helvetica').text('  ·  District Risk Assessment Report', { continued: false });
  doc.fontSize(8).fillColor('#ccffcc').text(genTime, M, 36);

  let y = 70;

  // ── District title ─────────────────────────────────────
  doc.fontSize(26).font('Helvetica-Bold').fillColor('#17160e').text(district, M, y);
  y += 34;
  const subLine = (division ? division + ' Division  ·  ' : '') + 'INFORM 2022 + GDACS Live + Crowd Reports';
  doc.fontSize(8).font('Helvetica').fillColor('#64615a').text(subLine, M, y);
  y += 14;
  doc.moveTo(M,y).lineTo(M+W,y).lineWidth(1.5).strokeColor('#d42638').stroke();
  y += 12;

  // ── Overall risk badge ─────────────────────────────────
  const ovColor = SEV_COLOR(ov);
  doc.rect(M, y, W, 44).fill('#f2f0eb');
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#64615a').text('OVERALL INFORM RISK SCORE', M+10, y+6);
  doc.fontSize(28).font('Helvetica-Bold').fillColor(ovColor).text(ov.toFixed(1)+' / 10', M+10, y+14, {continued:true});
  doc.fontSize(12).text('   '+SEV_LABEL(ov), {continued:false});
  y += 56;

  // ── Score bars ─────────────────────────────────────────
  doc.fontSize(12).font('Helvetica-Bold').fillColor('#17160e').text('Hazard & Vulnerability Scores', M, y);
  y += 16;

  const scoreRows = [
    ['Flood Hazard',        Math.min(10,scores.fl||0), boosts.flood||0],
    ['Drought Hazard',      Math.min(10,scores.dr||0), boosts.drought||0],
    ['Overall INFORM Risk', Math.min(10,scores.ov||0), boosts.overall||0],
    ['Vulnerability',       Math.min(10,scores.vu||0), 0],
    ['Lack of Coping',      Math.min(10,scores.cp||0), 0],
  ];

  const BAR_W = W - 130;
  for (const [label, base, boost] of scoreRows) {
    const total = Math.min(10, base + boost);
    const col   = SEV_COLOR(total);
    // Label
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#17160e').text(label, M, y+3, {width:110});
    // Bar background
    doc.rect(M+115, y, BAR_W, 12).fill('#e0ddd6');
    // Baseline fill
    doc.rect(M+115, y, (base/10)*BAR_W, 12).fill(col);
    // Boost fill (slightly darker)
    if (boost > 0) {
      doc.rect(M+115+(base/10)*BAR_W, y, Math.min((boost/10)*BAR_W, BAR_W-(base/10)*BAR_W), 12).fill('#c8192b');
    }
    // Score text
    let sc = total.toFixed(1);
    if (boost > 0.1) sc += ' (+'+boost.toFixed(1)+')';
    doc.fontSize(9).font('Helvetica-Bold').fillColor(col).text(sc, M+115+BAR_W+6, y+2, {width:60});
    doc.fontSize(7).font('Helvetica').fillColor(col).text(SEV_LABEL(total), M+115+BAR_W+6, y+11, {width:60});
    y += 20;
  }
  if ((boosts.flood||0)+(boosts.drought||0)+(boosts.overall||0) > 0) {
    doc.fontSize(7).font('Helvetica').fillColor('#9a9690')
       .text('* Red bar extension = live boost from active GDACS events or crowd reports.', M, y);
    y += 12;
  }
  y += 6;
  doc.moveTo(M,y).lineTo(M+W,y).lineWidth(0.5).strokeColor('#dedad2').stroke();
  y += 10;

  // ── Active events ──────────────────────────────────────
  if (events.length > 0) {
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#17160e').text('Active Events Affecting This District', M, y);
    y += 16;
    // Table header
    doc.rect(M, y, W, 16).fill('#006a4e');
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#ffffff');
    doc.text('Source', M+4, y+4, {width:50});
    doc.text('Event', M+58, y+4, {width:280});
    doc.text('Level', M+342, y+4, {width:60});
    doc.text('Date', M+406, y+4, {width:80});
    y += 16;
    events.slice(0,6).forEach((ev, i) => {
      doc.rect(M, y, W, 14).fill(i%2===0?'#ffffff':'#f2f0eb');
      doc.fontSize(8).font('Helvetica').fillColor('#17160e');
      doc.text(ev.source==='gdacs'?'GDACS':'Crowd', M+4, y+3, {width:50});
      doc.text((ev.title||'').slice(0,55), M+58, y+3, {width:280});
      doc.text(ev.alertLevel||ev.severity||'—', M+342, y+3, {width:60});
      doc.text((ev.time||'').slice(0,10), M+406, y+3, {width:80});
      y += 14;
    });
    y += 8;
    doc.moveTo(M,y).lineTo(M+W,y).lineWidth(0.5).strokeColor('#dedad2').stroke();
    y += 10;
  }

  // ── Infrastructure ─────────────────────────────────────
  if (infra.length > 0) {
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#17160e').text('Critical Infrastructure in District', M, y);
    y += 16;
    doc.rect(M, y, W, 16).fill('#1d4ed8');
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#ffffff');
    doc.text('Facility', M+4, y+4, {width:200});
    doc.text('Type', M+208, y+4, {width:70});
    doc.text('Address', M+282, y+4, {width:160});
    doc.text('Phone', M+446, y+4, {width:90});
    y += 16;
    infra.slice(0,8).forEach((f, i) => {
      doc.rect(M, y, W, 14).fill(i%2===0?'#ffffff':'#f2f0eb');
      doc.fontSize(8).font('Helvetica').fillColor('#17160e');
      doc.text((f.name||'Unnamed').slice(0,38), M+4, y+3, {width:200});
      doc.text((f.type||'').slice(0,12), M+208, y+3, {width:70});
      doc.text((f.addr||'—').slice(0,28), M+282, y+3, {width:160});
      doc.text(f.phone||'—', M+446, y+3, {width:90});
      y += 14;
    });
    y += 8;
    doc.moveTo(M,y).lineTo(M+W,y).lineWidth(0.5).strokeColor('#dedad2').stroke();
    y += 10;
  }

  // ── First aid tips ─────────────────────────────────────
  const hazard  = fl >= dr ? 'flood' : 'drought';
  const tips    = TIPS[hazard] || TIPS.overall;
  doc.fontSize(12).font('Helvetica-Bold').fillColor('#17160e')
     .text('First Aid & Safety — '+hazard.charAt(0).toUpperCase()+hazard.slice(1)+' (Primary Hazard)', M, y);
  y += 16;
  tips.forEach((tip, i) => {
    const rowH = 28;
    doc.rect(M, y, W, rowH).fill(i%2===0?'#ffffff':'#f2f0eb');
    // Number
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#d42638').text(String(i+1), M+4, y+8, {width:16});
    // Title + body
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#17160e').text(tip[0], M+22, y+4, {width:W-26, continued:false});
    doc.fontSize(8).font('Helvetica').fillColor('#64615a').text(tip[1], M+22, y+15, {width:W-26});
    y += rowH;
  });
  y += 10;

  // ── Footer ─────────────────────────────────────────────
  doc.moveTo(M,y).lineTo(M+W,y).lineWidth(0.5).strokeColor('#dedad2').stroke();
  y += 6;
  doc.fontSize(7).font('Helvetica').fillColor('#9a9690')
     .text('RescueAI  |  INFORM Subnational Risk Index 2022 (EU JRC / UN OCHA / MoDMR Bangladesh) + GDACS Live Feed  |  '+genTime,
           M, y, {align:'center', width:W});
  doc.fontSize(7).text('Auto-generated for field use. Verify with local authorities before deployment. Emergency: 999',
           M, y+10, {align:'center', width:W});

  doc.end();
}

// GET /api/report/test
app.get('/api/report/test', (req, res) => {
  const testData = {
    district:'Sylhet', division:'Sylhet',
    scores:{fl:7.6,dr:2.3,ov:6.3,vu:6.5,cp:6.8},
    boosts:{flood:1.5,drought:0,overall:0.8},
    events:[{source:'gdacs',title:'Flood - Bangladesh',alertLevel:'Orange',time:'2025-03-18'}],
    infraNearby:[{name:'Sylhet MAG Osmani Medical Hospital',type:'hospital',addr:'Sylhet Sadar',phone:'0821-714964'}],
  };
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment; filename="test_report.pdf"');
  buildPDF(testData, res);
});

// POST /api/report
app.post('/api/report', (req, res) => {
  const data = req.body;
  if (!data || !data.district) return res.status(400).json({ error:'No district provided' });
  const safeName = data.district.replace(/[^a-zA-Z0-9_-]/g,'_');
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="RescueAI_${safeName}_Risk_Report.pdf"`);
  try {
    buildPDF(data, res);
    console.log('[PDF] Generated report for', data.district);
  } catch(err) {
    console.error('[PDF] Error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});


// ════════════════════════════════════════════════════════════════════
//  RESCUER TRACKING
//  Flutter app connects via Socket.io, sends GPS + name/team/status
//  Rescuers shown on reporter map with distinct helmet markers
//  Team code: process.env.RESCUER_CODE or 'RESCUE2025'
// ════════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════════
//  AI SITUATION BRIEFING — POST /api/briefing
//  Collects all active reports + GDACS events + district boosts
//  Sends to Groq (llama-3.3-70b) → returns structured situation report
//  POST /api/briefing/pdf → same but streams as PDF
// ════════════════════════════════════════════════════════════════════

const GROQ_API_KEY = process.env.GROQ_API_KEY;

function buildBriefingPrompt(data) {
  const now = new Date().toLocaleString('en-BD', { timeZone: 'Asia/Dhaka' });

  // Summarise crowd reports
  const rptLines = (data.reports || []).slice(0, 30).map(r =>
    `- [${r.severity?.toUpperCase()}] ${r.type} in ${r.district || r.location}: "${r.title}" (reported by ${r.reporter}, ${new Date(r.time).toLocaleTimeString('en-BD')})`
  ).join('\n') || 'No crowd reports.';

  // Summarise GDACS events
  const gdacsLines = (data.gdacsEvents || []).slice(0, 15).map(e =>
    `- ${e.alertLevel} alert: ${e.title} (${e.country}, ${e.evType})`
  ).join('\n') || 'No active GDACS events.';

  // Summarise boosted districts
  const boostLines = Object.entries(data.boosts || {})
    .filter(([,b]) => (b.flood + b.drought + b.overall) > 1)
    .sort(([,a],[,b2]) => (b2.flood+b2.drought+b2.overall) - (a.flood+a.drought+a.overall))
    .slice(0, 10)
    .map(([d, b]) => `- ${d}: flood+${b.flood.toFixed(1)} drought+${b.drought.toFixed(1)} overall+${b.overall.toFixed(1)}`)
    .join('\n') || 'No significantly boosted districts.';

  // Active volunteers/rescuers
  const rescuerLines = (data.rescuers || []).map(r =>
    `- ${r.name} (${r.team}) → ${r.area || 'unassigned area'}, status: ${r.status}`
  ).join('\n') || 'No active rescue teams.';

  return `আপনি বাংলাদেশের একজন দুর্যোগ সমন্বয় AI সহকারী। জরুরি সমন্বয়কারীদের জন্য একটি সংক্ষিপ্ত পরিচালনামূলক পরিস্থিতি বিবরণী তৈরি করুন। সমস্ত উত্তর অবশ্যই বাংলায় হতে হবে।

গুরুত্বপূর্ণ অগ্রাধিকার: মাঠ থেকে জমা দেওয়া ক্রাউড-সোর্সড ফিল্ড রিপোর্টের উপর ভিত্তি করে আপনার বিশ্লেষণ করুন। এগুলো সবচেয়ে গুরুত্বপূর্ণ। GDACS ডেটা শুধুমাত্র গৌণ প্রেক্ষাপট।

বর্তমান সময়: ${now} (বাংলাদেশ মান সময়)

=== ক্রাউড-সোর্সড ফিল্ড রিপোর্ট (প্রধান — প্রথমে এগুলো বিশ্লেষণ করুন) ===
${rptLines}

=== মানচিত্রে সক্রিয় উদ্ধার দল ===
${rescuerLines}

=== জেলা ঝুঁকি বৃদ্ধি (ক্রাউড রিপোর্ট + GDACS মিলিত) ===
${boostLines}

=== GDACS লাইভ ইভেন্ট (গৌণ প্রেক্ষাপট) ===
${gdacsLines}

উপরের ক্রাউড-সোর্সড রিপোর্টের উপর ভিত্তি করে, নিচের JSON কাঠামোতে উত্তর দিন (শুধুমাত্র JSON, কোনো markdown নয়)। সমস্ত টেক্সট ফিল্ড অবশ্যই বাংলায় হতে হবে:
{
  "title": "পরিস্থিতি বিবরণী — [তারিখ/সময়]",
  "alert_level": "CRITICAL|HIGH|MODERATE|LOW",
  "summary": "সামগ্রিক পরিস্থিতির ২-৩ বাক্যের সারসংক্ষেপ বাংলায়",
  "paragraph_1": {
    "heading": "বর্তমান পরিস্থিতি",
    "body": "বর্তমানে কী ঘটছে, কোন এলাকা আক্রান্ত, ফিল্ড রিপোর্ট ও GDACS ডেটায় তীব্রতার মাত্রা — বিস্তারিত বাংলায়।"
  },
  "paragraph_2": {
    "heading": "ভৌগোলিক কেন্দ্রীভবন",
    "body": "সবচেয়ে বেশি ঘটনার কেন্দ্র কোথায়, কোন জেলা সবচেয়ে ঝুঁকিতে, ডেটার প্যাটার্ন — বিস্তারিত বাংলায়।"
  },
  "paragraph_3": {
    "heading": "প্রয়োজনীয় সম্পদ",
    "body": "কী ধরনের সম্পদ প্রয়োজন — উদ্ধার দল, চিকিৎসা, সরিয়ে নেওয়া, পানি/খাদ্য — এবং অগ্রাধিকারমূলক মোতায়েনের সুপারিশ বাংলায়।"
  },
  "key_actions": ["পদক্ষেপ ১ বাংলায়", "পদক্ষেপ ২", "পদক্ষেপ ৩", "পদক্ষেপ ৪"],
  "priority_districts": ["জেলা১", "জেলা২", "জেলা৩"],
  "generated_at": "${now}"
}`;
}

async function callGroq(prompt) {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY not set in environment variables');

  const body = JSON.stringify({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 1200,
    messages: [{ role: 'user', content: prompt }],
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.groq.com',
      path:     '/openai/v1/chat/completions',
      method:   'POST',
      headers:  {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + GROQ_API_KEY,
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 30000,
    }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) return reject(new Error(json.error.message || 'Groq API error'));
          const text = json.choices?.[0]?.message?.content || '';
          // Strip markdown fences if present
          const clean = text.replace(/```json|```/g, '').trim();
          resolve(JSON.parse(clean));
        } catch(e) {
          reject(new Error('Failed to parse Groq response: ' + e.message));
        }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Groq API timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function buildBriefingPDF(briefing, res) {
  const doc = new PDFDocument({ size:'A4', margin:45, info:{
    Title: briefing.title || 'RescueAI Situation Briefing',
    Author: 'RescueAI',
  }});
  doc.pipe(res);

  const W = 595 - 90, M = 45;
  const ALERT_COLORS = { CRITICAL:'#c8192b', HIGH:'#d97706', MODERATE:'#2563eb', LOW:'#16a34a' };
  const alertCol = ALERT_COLORS[briefing.alert_level] || '#2563eb';

  // Header banner
  doc.rect(M-45, 0, 595, 52).fill('#1e3a5f');
  doc.fontSize(16).font('Helvetica-Bold').fillColor('#fff')
     .text('RescueAI', M, 14, { continued:true })
     .fontSize(10).font('Helvetica').text('  ·  AI Situation Briefing', { continued:false });
  doc.fontSize(8).fillColor('#a0c4ff').text(briefing.generated_at || new Date().toLocaleString(), M, 36);

  let y = 70;

  // Title + alert level
  doc.fontSize(20).font('Helvetica-Bold').fillColor('#0f172a')
     .text(briefing.title || 'Situation Briefing', M, y);
  y += 30;

  // Alert badge
  doc.rect(M, y, 120, 24).fill(alertCol);
  doc.fontSize(11).font('Helvetica-Bold').fillColor('#fff')
     .text((briefing.alert_level || 'MODERATE') + ' ALERT', M+6, y+6, {width:108, align:'center'});
  y += 36;

  // Summary box
  doc.rect(M, y, W, 52).fill('#f1f5f9');
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#475569')
     .text('EXECUTIVE SUMMARY', M+10, y+8);
  doc.fontSize(10).font('Helvetica').fillColor('#0f172a')
     .text(briefing.summary || '', M+10, y+20, {width:W-20});
  y += 62;

  // Three paragraphs
  const paras = [briefing.paragraph_1, briefing.paragraph_2, briefing.paragraph_3];
  paras.forEach(function(p, i) {
    if (!p) return;
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#1e3a5f').text(p.heading || '', M, y);
    y += 16;
    doc.moveTo(M, y).lineTo(M+40, y).lineWidth(2).strokeColor(alertCol).stroke();
    y += 8;
    doc.fontSize(10).font('Helvetica').fillColor('#334155')
       .text(p.body || '', M, y, {width:W, lineGap:2});
    y += doc.heightOfString(p.body || '', {width:W, lineGap:2}) + 16;
  });

  // Key actions
  if (briefing.key_actions && briefing.key_actions.length) {
    doc.moveTo(M,y).lineTo(M+W,y).lineWidth(0.5).strokeColor('#e2e8f0').stroke();
    y += 10;
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#1e3a5f').text('Immediate Actions', M, y);
    y += 16;
    briefing.key_actions.forEach(function(action, i) {
      doc.rect(M, y, 20, 14).fill(alertCol);
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#fff').text(String(i+1), M, y+3, {width:20, align:'center'});
      doc.fontSize(10).font('Helvetica').fillColor('#0f172a').text(action, M+26, y+2, {width:W-26});
      y += 18;
    });
    y += 6;
  }

  // Priority districts
  if (briefing.priority_districts && briefing.priority_districts.length) {
    doc.moveTo(M,y).lineTo(M+W,y).lineWidth(0.5).strokeColor('#e2e8f0').stroke();
    y += 10;
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#1e3a5f').text('Priority Districts', M, y);
    y += 16;
    let x = M;
    briefing.priority_districts.forEach(function(d) {
      const w = doc.widthOfString(d) + 16;
      if (x + w > M + W) { x = M; y += 22; }
      doc.rect(x, y, w, 18).fill(alertCol + '22');
      doc.rect(x, y, w, 18).lineWidth(1).strokeColor(alertCol).stroke();
      doc.fontSize(9).font('Helvetica-Bold').fillColor(alertCol).text(d, x+8, y+5);
      x += w + 6;
    });
    y += 28;
  }

  // Footer
  doc.moveTo(M, y+6).lineTo(M+W, y+6).lineWidth(0.5).strokeColor('#e2e8f0').stroke();
  doc.fontSize(7).font('Helvetica').fillColor('#94a3b8')
     .text('RescueAI · Situation Briefing · Powered by Groq llama-3.3-70b · ' + (briefing.generated_at || ''),
           M, y+12, {align:'center', width:W});
  doc.fontSize(7).text('Auto-generated for operational use. Verify with field teams before major resource deployment. Emergency: 999',
           M, y+22, {align:'center', width:W});

  doc.end();
}

// POST /api/briefing — returns JSON briefing
app.post('/api/briefing', async (req, res) => {
  try {
    const data = {
      reports:     reports.slice(0, 30), // includes all reports including seeds
      gdacsEvents: pipelineState.activeEvents.slice(0, 20),
      boosts:      (() => {
        const merged = {};
        const all = new Set([...Object.keys(pipelineState.districtBoosts), ...Object.keys(pipelineState.crowdBoosts)]);
        for (const d of all) {
          const gb = pipelineState.districtBoosts[d] || {flood:0,drought:0,overall:0};
          const cb = pipelineState.crowdBoosts[d]    || {flood:0,drought:0,overall:0};
          merged[d] = { flood:gb.flood+cb.flood, drought:gb.drought+cb.drought, overall:gb.overall+cb.overall };
        }
        return merged;
      })(),
      rescuers: Object.values(rescuers),
    };

    console.log('[Briefing] Generating AI situation briefing...');
    const briefing = await callGroq(buildBriefingPrompt(data));
    briefing.generated_at = new Date().toLocaleString('en-BD', { timeZone:'Asia/Dhaka' });
    briefing.data_summary = {
      crowd_reports:  data.reports.length,
      gdacs_events:   data.gdacsEvents.length,
      active_rescuers: data.rescuers.length,
    };
    console.log('[Briefing] Generated — alert level:', briefing.alert_level);
    res.json({ ok:true, briefing });
  } catch(err) {
    console.error('[Briefing] Error:', err.message);
    res.status(500).json({ ok:false, error: err.message });
  }
});

// POST /api/briefing/pdf — returns PDF briefing
app.post('/api/briefing/pdf', async (req, res) => {
  try {
    // Accept pre-generated briefing from body, or generate fresh
    let briefing = req.body.briefing;
    if (!briefing) {
      const data = {
        reports:     reports.slice(0, 30), // includes all reports including seeds
        gdacsEvents: pipelineState.activeEvents.slice(0, 20),
        boosts:      (() => {
          const merged = {};
          const all = new Set([...Object.keys(pipelineState.districtBoosts), ...Object.keys(pipelineState.crowdBoosts)]);
          for (const d of all) {
            const gb = pipelineState.districtBoosts[d] || {flood:0,drought:0,overall:0};
            const cb = pipelineState.crowdBoosts[d]    || {flood:0,drought:0,overall:0};
            merged[d] = { flood:gb.flood+cb.flood, drought:gb.drought+cb.drought, overall:gb.overall+cb.overall };
          }
          return merged;
        })(),
        rescuers: Object.values(rescuers),
      };
      briefing = await callGroq(buildBriefingPrompt(data));
      briefing.generated_at = new Date().toLocaleString('en-BD', { timeZone:'Asia/Dhaka' });
    }
    const ts = new Date().toISOString().slice(0,10);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="RescueAI_Briefing_${ts}.pdf"`);
    buildBriefingPDF(briefing, res);
    console.log('[Briefing] PDF generated');
  } catch(err) {
    console.error('[Briefing] PDF error:', err.message);
    if (!res.headersSent) res.status(500).json({ ok:false, error: err.message });
  }
});


// ════════════════════════════════════════════════════════════════════
//  VOICE REPORT EXTRACTION — POST /api/voice-extract
//  Receives transcribed text, uses Groq to extract structured
//  disaster report fields (type, severity, district, title, desc)
// ════════════════════════════════════════════════════════════════════

app.post('/api/voice-extract', async (req, res) => {
  const { text, lang } = req.body;
  if (!text || text.trim().length < 3) {
    return res.status(400).json({ ok:false, error:'No transcript provided' });
  }
  if (!GROQ_API_KEY) {
    return res.status(500).json({ ok:false, error:'GROQ_API_KEY not set' });
  }

  const districtList = Object.keys(require('./server.js').DISTRICT_BOUNDS || {}).join(', ') ||
    'Dhaka, Sylhet, Chattogram, Rajshahi, Khulna, Barisal, Rangpur, Mymensingh, Sunamganj, Cox\'s Bazar, Cumilla, Gazipur, Narayanganj, Bogura, Rangamati';

  const prompt = `You are a disaster report extraction AI for Bangladesh. Extract structured information from this voice report transcript.

Transcript (may be in English or Bangla): "${text}"

Extract the following and respond with JSON only (no markdown, no explanation):
{
  "type": one of: flood|cyclone|fire|landslide|storm|drought|erosion|heatwave|other,
  "severity": one of: critical|high|medium|low,
  "district": the Bangladesh district name mentioned or inferred (e.g. Sylhet, Dhaka, Cox's Bazar),
  "location": specific location within the district (neighbourhood, upazila, landmark),
  "title": short 5-10 word title summarising the incident,
  "description": 1-2 sentence description of the situation,
  "confidence": number 0-100 indicating how confident you are in the extraction
}

If the transcript mentions Bangla place names, translate them to their English equivalents.
If a field cannot be determined, use sensible defaults (type: other, severity: medium, district: unknown).`;

  try {
    const body = JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    const result = await new Promise((resolve, reject) => {
      const req2 = https.request({
        hostname: 'api.groq.com',
        path:     '/openai/v1/chat/completions',
        method:   'POST',
        headers:  {
          'Content-Type':  'application/json',
          'Authorization': 'Bearer ' + GROQ_API_KEY,
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 15000,
      }, upstream => {
        let data = '';
        upstream.setEncoding('utf8');
        upstream.on('data', c => { data += c; });
        upstream.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) return reject(new Error(json.error.message));
            const text2 = json.choices?.[0]?.message?.content || '{}';
            resolve(JSON.parse(text2.replace(/```json|```/g, '').trim()));
          } catch(e) { reject(new Error('Parse error: ' + e.message)); }
        });
      });
      req2.on('timeout', () => { req2.destroy(); reject(new Error('Timeout')); });
      req2.on('error', reject);
      req2.write(body);
      req2.end();
    });

    console.log(`[Voice] Extracted: ${result.type} / ${result.severity} / ${result.district}`);
    res.json({ ok:true, extracted: result, transcript: text });
  } catch(err) {
    console.error('[Voice] Error:', err.message);
    res.status(500).json({ ok:false, error: err.message });
  }
});


// ════════════════════════════════════════════════════════════════════
//  EARLY WARNING SYSTEM
//  Monitors district live scores after each pipeline run.
//  When a district crosses the threshold (8.5), an early warning
//  is issued with timestamp, hazard type, and recommended action.
//  Warnings clear automatically when score drops below 7.5.
// ════════════════════════════════════════════════════════════════════

const EW_THRESHOLD_ISSUE = 8.5;   // score to trigger warning
const EW_THRESHOLD_CLEAR = 7.5;   // score to auto-clear warning

// INFORM 2022 baseline scores (mirrors risk-map.html DIST_DATA)
const BASELINE = {
  'Sunamganj':{fl:8.8,dr:2.0},'Sylhet':{fl:7.6,dr:2.3},'Moulvibazar':{fl:7.1,dr:2.6},
  'Habiganj':{fl:7.4,dr:2.4},'Netrokona':{fl:7.6,dr:2.8},'Mymensingh':{fl:7.2,dr:3.0},
  'Sherpur':{fl:7.4,dr:3.1},'Jamalpur':{fl:7.8,dr:3.2},'Kishoreganj':{fl:7.9,dr:2.9},
  'Brahmanbaria':{fl:7.2,dr:2.5},'Narsingdi':{fl:7.1,dr:2.6},'Narayanganj':{fl:6.8,dr:2.7},
  'Dhaka':{fl:6.5,dr:2.8},'Gazipur':{fl:6.4,dr:2.9},'Manikganj':{fl:7.8,dr:2.5},
  'Munshiganj':{fl:7.6,dr:2.4},'Tangail':{fl:7.8,dr:3.0},'Rajbari':{fl:7.9,dr:2.8},
  'Faridpur':{fl:7.8,dr:2.6},'Madaripur':{fl:7.5,dr:2.7},'Shariatpur':{fl:8.0,dr:2.5},
  'Gopalganj':{fl:7.2,dr:2.8},'Chandpur':{fl:7.8,dr:2.4},'Lakshmipur':{fl:7.4,dr:2.6},
  'Cumilla':{fl:7.0,dr:2.7},'Feni':{fl:6.8,dr:2.8},'Noakhali':{fl:7.3,dr:2.6},
  'Chattogram':{fl:6.5,dr:2.9},"Cox's Bazar":{fl:6.8,dr:3.0},'Rangamati':{fl:6.2,dr:3.2},
  'Khagrachhari':{fl:5.8,dr:3.4},'Bandarban':{fl:5.5,dr:3.6},'Bogura':{fl:7.4,dr:4.2},
  'Sirajganj':{fl:8.8,dr:3.8},'Natore':{fl:7.0,dr:4.5},'Pabna':{fl:7.2,dr:4.8},
  'Naogaon':{fl:6.5,dr:5.8},'Rajshahi':{fl:6.2,dr:6.2},'Chapai Nawabganj':{fl:6.0,dr:5.5},
  'Joypurhat':{fl:6.3,dr:5.0},'Kushtia':{fl:7.0,dr:5.2},'Chuadanga':{fl:6.5,dr:5.8},
  'Meherpur':{fl:6.2,dr:5.5},'Jhenaidah':{fl:6.4,dr:5.3},'Magura':{fl:6.6,dr:4.8},
  'Jashore':{fl:6.3,dr:5.0},'Narail':{fl:6.5,dr:4.6},'Khulna':{fl:7.0,dr:4.2},
  'Satkhira':{fl:7.2,dr:4.5},'Bagerhat':{fl:7.0,dr:4.0},'Kurigram':{fl:8.5,dr:3.2},
  'Lalmonirhat':{fl:7.8,dr:3.5},'Nilphamari':{fl:7.2,dr:3.8},'Rangpur':{fl:7.0,dr:4.0},
  'Gaibandha':{fl:8.0,dr:3.6},'Dinajpur':{fl:6.8,dr:4.5},'Panchagarh':{fl:6.5,dr:4.2},
  'Thakurgaon':{fl:6.6,dr:4.4},'Bhola':{fl:8.2,dr:2.8},'Patuakhali':{fl:8.0,dr:2.9},
  'Barguna':{fl:7.8,dr:3.0},'Pirojpur':{fl:7.5,dr:3.2},'Barisal':{fl:7.2,dr:3.0},
  'Jhalokathi':{fl:7.0,dr:3.1},
};

// Active early warnings: { districtName: { score, hazard, issuedAt, triggeredBy } }
let earlyWarnings = {};

// Recommended actions per hazard type
const EW_ACTIONS = {
  flood:   'Pre-position boats and rescue teams. Alert low-lying communities to evacuate.',
  drought: 'Activate water rationing protocols. Deploy tankers to affected areas.',
  overall: 'Multi-hazard alert. Coordinate across flood and drought response teams.',
};

function computeLiveScore(districtName, boosts) {
  const base   = BASELINE[districtName] || { fl:5.0, dr:3.0 };
  const boost  = boosts[districtName]   || { flood:0, drought:0 };
  return {
    flood:   Math.min(10, base.fl + boost.flood),
    drought: Math.min(10, base.dr + boost.drought),
  };
}

function runEarlyWarningCheck(boosts) {
  const newWarnings = {};
  const issued  = [];
  const cleared = [];

  for (const [name, base] of Object.entries(BASELINE)) {
    const live  = computeLiveScore(name, boosts);
    const maxScore = Math.max(live.flood, live.drought);
    const hazard   = live.flood >= live.drought ? 'flood' : 'drought';

    if (maxScore >= EW_THRESHOLD_ISSUE) {
      if (!earlyWarnings[name]) {
        // New warning
        newWarnings[name] = {
          district:    name,
          score:       +maxScore.toFixed(2),
          hazard,
          issuedAt:    new Date().toISOString(),
          triggeredBy: boosts[name]?.events?.map(e => e.title).slice(0,2) || ['GDACS live event'],
          action:      EW_ACTIONS[hazard],
          floodScore:  +live.flood.toFixed(2),
          droughtScore:+live.drought.toFixed(2),
          baseFlood:   base.fl,
          baseDrought: base.dr,
          boost:       +(maxScore - (hazard==='flood' ? base.fl : base.dr)).toFixed(2),
        };
        issued.push(name);
      } else {
        // Keep existing warning, update score
        newWarnings[name] = { ...earlyWarnings[name], score: +maxScore.toFixed(2) };
      }
    } else if (earlyWarnings[name] && maxScore < EW_THRESHOLD_CLEAR) {
      // Warning clears
      cleared.push(name);
    } else if (earlyWarnings[name]) {
      // In hysteresis band — keep warning
      newWarnings[name] = earlyWarnings[name];
    }
  }

  earlyWarnings = newWarnings;

  if (issued.length)  console.log(`[EarlyWarning] Issued: ${issued.join(', ')}`);
  if (cleared.length) console.log(`[EarlyWarning] Cleared: ${cleared.join(', ')}`);

  // Broadcast
  io.emit('earlywarning:update', {
    warnings:  Object.values(earlyWarnings),
    count:     Object.keys(earlyWarnings).length,
    issuedAt:  new Date().toISOString(),
  });
}

// GET /api/early-warnings — current active warnings
app.get('/api/early-warnings', (req, res) => {
  res.json({
    ok: true,
    count: Object.keys(earlyWarnings).length,
    warnings: Object.values(earlyWarnings),
    threshold: EW_THRESHOLD_ISSUE,
    checkedAt: new Date().toISOString(),
  });
});

// ── In-memory state ──────────────────────────────────────────────
const reports   = [];
const liveUsers = {};
const MAX_RPT   = 200;

function broadcastUsers() { io.emit('users:list', Object.values(liveUsers)); }

// ── Seed data ────────────────────────────────────────────────────
const SEED = [
  { type:'heatwave', severity:'medium', title:'Heatwave — Dhaka New Market Area', desc:'Elevated heat in the New Market area. Temp reaching 35°C with high humidity. Discomfort reported among vendors and pedestrians.', district:'Dhaka',    location:'New Market',    lat:23.73, lng:90.38, reporter:'DMB Dhaka' },
  { type:'heatwave', severity:'medium', title:'Heatwave — Rajshahi Division',     desc:'Temp 36°C for 3 consecutive days. Residents advised to stay hydrated and avoid midday sun.',                          district:'Rajshahi', location:'Rajshahi City', lat:24.37, lng:88.60, reporter:'DMB'       },
  { type:'drought',  severity:'low',    title:'Drought — Barind Tract, Rajshahi', desc:'Second consecutive failed pre-monsoon season. Paddy yield down 35%.',                                               district:'Naogaon',  location:'Barind Tract',  lat:24.79, lng:88.94, reporter:'DAE'       },
];
SEED.forEach((s, i) => {
  const r = { id:'seed'+i, ...s, time: new Date(Date.now()-i*25*60000).toISOString() };
  reports.push(r);
  applyReportBoost(r); // seed reports also feed the pipeline
});

// ── Socket.io ────────────────────────────────────────────────────
io.on('connection', socket => {
  const id = socket.id;
  console.log(`[+] ${id}  (total: ${io.engine.clientsCount})`);

  socket.emit('init', { reports, users: Object.values(liveUsers), yourId: id, rescuers: Object.values(rescuers) });

  // Send current pipeline state immediately on connect
  socket.emit('pipeline:update', {
    boosts:     (() => {
      const merged = {};
      const all = new Set([...Object.keys(pipelineState.districtBoosts),...Object.keys(pipelineState.crowdBoosts)]);
      for (const d of all) {
        const gb = pipelineState.districtBoosts[d]||{flood:0,drought:0,overall:0,events:[]};
        const cb = pipelineState.crowdBoosts[d]   ||{flood:0,drought:0,overall:0,events:[]};
        merged[d]={flood:+(gb.flood+cb.flood).toFixed(2),drought:+(gb.drought+cb.drought).toFixed(2),overall:+(gb.overall+cb.overall).toFixed(2),events:[...(gb.events||[]),...(cb.events||[])]};
      }
      return merged;
    })(),
    lastRun:    pipelineState.lastRun,
    status:     pipelineState.lastRunStatus,
    runCount:   pipelineState.runCount,
    eventCount: pipelineState.activeEvents.length,
  });

  socket.on('user:join', data => {
    liveUsers[id] = { id, name:data.name||'Anonymous', lat:data.lat||23.7, lng:data.lng||90.35, color:data.color||'#2563eb' };
    console.log(`[~] joined  ${liveUsers[id].name}`);
    broadcastUsers();
  });

  socket.on('user:move', data => {
    if (liveUsers[id]) {
      liveUsers[id].lat = data.lat; liveUsers[id].lng = data.lng;
      io.emit('user:moved', { id, lat:data.lat, lng:data.lng });
    }
  });

  socket.on('report:new', data => {
    const r = {
      id:       id+'_'+Date.now().toString(36),
      type:     data.type     ||'other',
      severity: data.severity ||'medium',
      title:   (data.title    ||'Untitled').slice(0,120),
      desc:    (data.desc     ||'').slice(0,500),
      location:(data.location ||'Bangladesh').slice(0,80),
      district:(data.district ||'').slice(0,60),
      lat:     parseFloat(data.lat)||23.7,
      lng:     parseFloat(data.lng)||90.35,
      reporter:(liveUsers[id]?.name||'Anonymous').slice(0,60),
      time:    new Date().toISOString(),
    };
    reports.unshift(r);
    if (reports.length > MAX_RPT) reports.length = MAX_RPT;
    console.log(`[!] ${r.severity.toUpperCase()} — ${r.title}`);
    io.emit('report:new', r);
    // Feed new crowd report into pipeline
    applyReportBoost(r);
  });

  // Risk map — pipeline manual trigger from client
  socket.on('pipeline:run', () => {
    console.log(`[Pipeline] Manual trigger from socket ${id}`);
    runPipeline('manual-socket');
  });

  // Risk map search sync
  socket.on('risk:search', data => { socket.broadcast.emit('risk:search', data); });


  // ── Rescuer events (Flutter app) ────────────────────────────────
  socket.on('rescuer:join', data => {
    console.log(`[Rescuer] Join attempt from ${id} — name: "${data.name}"`);
    // Open registration — no code required
    rescuers[id] = {
      id,
      name:     (data.name  || 'Rescuer').slice(0, 60),
      team:     (data.team  || 'Field Team').slice(0, 60),
      status:   data.status || 'available',
      online:   true,
      lat:      parseFloat(data.lat) || 23.7,
      lng:      parseFloat(data.lng) || 90.35,
      firstSeen: new Date().toISOString(),
      lastSeen:  new Date().toISOString(),
      offlineSince: null,
      trail:    [],
    };
    socket.emit('rescuer:accepted', { id, code: RESCUER_CODE });
    broadcastRescuers();
    console.log(`[Rescuer] Joined: ${rescuers[id].name} / ${rescuers[id].team}`);
  });

  socket.on('rescuer:move', data => {
    if (!rescuers[id]) return;
    const lat = parseFloat(data.lat);
    const lng = parseFloat(data.lng);
    if (isNaN(lat) || isNaN(lng)) return;
    // Keep trail of last 15 positions
    rescuers[id].trail.push({ lat: rescuers[id].lat, lng: rescuers[id].lng });
    if (rescuers[id].trail.length > 15) rescuers[id].trail.shift();
    rescuers[id].lat          = lat;
    rescuers[id].lng          = lng;
    rescuers[id].lastSeen     = new Date().toISOString();
    rescuers[id].online       = true;
    rescuers[id].offlineSince = null;
    io.emit('rescuer:moved', { id, lat, lng, trail: rescuers[id].trail });
  });

  socket.on('rescuer:status', data => {
    if (!rescuers[id]) return;
    const valid = ['available', 'on_mission', 'unreachable'];
    if (!valid.includes(data.status)) return;
    rescuers[id].status   = data.status;
    rescuers[id].lastSeen = new Date().toISOString();
    broadcastRescuers();
    console.log(`[Rescuer] ${rescuers[id].name} → ${data.status}`);
  });

  socket.on('disconnect', () => {

    console.log(`[-] ${liveUsers[id]?.name||rescuers[id]?.name||id}`);
    delete liveUsers[id];
    if (rescuers[id]) {
      markRescuerOffline(id);
    }
    io.emit('user:left', { id });
    broadcastUsers();
  });
});

// ── Start + Schedule Pipeline ─────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚨 RescueAI running at http://localhost:${PORT}`);
  console.log(`   /               → Reporter map`);
  console.log(`   /disasters      → Crowd-sourced feed`);
  console.log(`   /live-disasters → GDACS real-world data`);
  console.log(`   /risk-map       → Automated risk pipeline map`);
  console.log(`   /api/risk-pipeline → Pipeline results (JSON)`);
  console.log(`   /api/rescuers      → Live rescuer positions (JSON)`);
  console.log(`   /api/infrastructure→ OSM hospitals (JSON)`);
  console.log(`   POST /api/risk-pipeline/run → Trigger manually`);
  console.log(`\n✅ Open volunteer registration — no team code required\n`);

  // Run pipeline immediately on start, then every 3 hours
  runPipeline('startup');
  setInterval(() => runPipeline('scheduler'), PIPELINE_INTERVAL);
});
