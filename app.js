'use strict';
/* =====================================================================
   VertiBalance VR v4 — Solo · Historique cumulatif · JSONBin
   
   Structure de données (jamais écrasée, toujours empilée) :
   {
     patientName,
     binId,            ← ID JSONBin du bin principal
     sessions: [       ← tableau cumulatif, une entrée par séance
       {
         sessionNumber,
         date,
         exercises: [ { id, blind, post, delta } ],
         dhiScore,
         postureStability
       }
     ]
   }
   
   À chaque séance terminée : on PUSH dans sessions[], on sauvegarde.
   Rien n'est jamais écrasé.
   ===================================================================== */

/* ─────────────── EXERCICES ─────────────── */
const EXERCISES = [
  { id:'gaze-fixed',    name:'Stabilisation du regard',        sub:'Réflexe vestibulo-oculaire (VOR) • Environnement calme',      duration:60, difficulty:1, type:'gaze'      },
  { id:'gaze-moving',   name:'Poursuite oculaire',             sub:'Coordination oculo-motrice dynamique',                        duration:60, difficulty:2, type:'pursuit'   },
  { id:'optic-flow',    name:'Flux optique — désensibilisation',sub:'Conflit visuo-vestibulaire • Environnement immersif',         duration:90, difficulty:2, type:'opticflow' },
  { id:'head-rotation', name:'Rotations de tête guidées',      sub:'Adaptation vestibulaire • Cibles directionnelles',            duration:60, difficulty:2, type:'rotation'  },
  { id:'balance-scene', name:'Équilibre dynamique',            sub:'Intégration sensorielle multimodale • Scène 360°',            duration:90, difficulty:3, type:'balance'   }
];

/* ─────────────── CONSTANTES ─────────────── */
const LOCAL_KEY  = 'vb_solo_v4';
const CFG_KEY    = 'vb_solo_cfg_v4';
const JBIN_BASE  = 'https://api.jsonbin.io/v3';
const BLIND_DUR  = 5; // secondes de mesure à l'insu avant chaque exercice

/* ─────────────── CONFIG ─────────────── */
let cfg = {};
try { cfg = JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch(e) {}
function saveCfg() { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }

/* ─────────────── STRUCTURE DE DONNÉES ─────────────── */
function emptyStore() {
  return {
    patientName: cfg.patientName || 'Moi',
    binId: cfg.binId || null,
    sessions: []   // cumulatif — ne jamais écraser
  };
}

// Séance courante (en mémoire uniquement, poussée dans store.sessions à la fin)
function emptyCurrentSession(number) {
  return {
    sessionNumber: number,
    date: new Date().toISOString(),
    exercises: [],    // { id, blind:{osc,angVel}, post:{osc,angVel,nausea,duration}, delta:{osc,angVel} }
    dhiScore: null,
    postureStability: null
  };
}

let store          = emptyStore();   // données persistées
let currentSession = null;           // séance en cours (non encore sauvegardée)
let exerciseStatus = EXERCISES.map(() => 'pending');
let currentExIdx   = -1;
let sessionStarted = false;

/* ─────────────── JSONBIN ─────────────── */
const jbin = {
  h(extra={}) {
    return { 'Content-Type':'application/json', 'X-Master-Key': cfg.apiKey||'', ...extra };
  },
  async create(data) {
    const r = await fetch(`${JBIN_BASE}/b`, {
      method:'POST', headers:this.h({'X-Bin-Name':'vertibalance-solo','X-Bin-Private':'true'}),
      body: JSON.stringify(data)
    });
    if (!r.ok) throw new Error(`create ${r.status}`);
    return (await r.json()).metadata.id;
  },
  async read(binId) {
    const r = await fetch(`${JBIN_BASE}/b/${binId}/latest`, {
      headers: this.h({'X-Bin-Meta':'false'})
    });
    if (!r.ok) throw new Error(`read ${r.status}`);
    return r.json();
  },
  async update(binId, data) {
    const r = await fetch(`${JBIN_BASE}/b/${binId}`, {
      method:'PUT', headers:this.h(), body:JSON.stringify(data)
    });
    if (!r.ok) throw new Error(`update ${r.status}`);
  }
};

/* ─────────────── PERSISTANCE ─────────────── */

// Charge les données : cloud d'abord, fallback local
async function loadStore() {
  // Local immédiat
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) store = JSON.parse(raw);
  } catch(e) {}

  // Cloud si clé dispo
  if (cfg.apiKey && cfg.binId) {
    try {
      const cloud = await jbin.read(cfg.binId);
      // Fusionner : garder le plus de sessions
      if (cloud.sessions && cloud.sessions.length >= store.sessions.length) {
        store = cloud;
        store.binId = cfg.binId;
        localStorage.setItem(LOCAL_KEY, JSON.stringify(store)); // resync local
      }
      setSyncStatus('online');
    } catch(e) { setSyncStatus('offline'); }
  }
}

// Sauvegarde atomique : local d'abord, cloud ensuite
async function saveStore() {
  // 1. Local immédiat (jamais perdu)
  localStorage.setItem(LOCAL_KEY, JSON.stringify(store));

  // 2. Cloud
  if (!cfg.apiKey) return;
  try {
    if (cfg.binId) {
      await jbin.update(cfg.binId, store);
    } else {
      const id = await jbin.create(store);
      cfg.binId = id;
      store.binId = id;
      saveCfg();
      localStorage.setItem(LOCAL_KEY, JSON.stringify(store));
    }
    setSyncStatus('online');
  } catch(e) {
    setSyncStatus('offline');
    console.warn('Cloud save failed, local OK:', e);
  }
}

/* ─────────────── CALCUL SCORES ─────────────── */
function calcScores(session) {
  const done = session.exercises.filter(e => e.post);
  if (!done.length) return;
  let osc = 0, nausea = 0;
  done.forEach(e => { osc += e.post.osc; nausea += e.post.nausea; });
  osc /= done.length; nausea /= done.length;
  session.postureStability = Math.max(0, Math.min(100, 100 - osc * 8));
  session.dhiScore = Math.max(0, Math.min(100, nausea * 6 + (100 - session.postureStability) * 0.3));
}

/* ─────────────── EXPORT JSON ─────────────── */
function exportJSON() {
  const report = {
    appVersion: '4.0',
    exportedAt: new Date().toISOString(),
    patient: store.patientName,
    totalSessions: store.sessions.length,
    sessions: store.sessions,
    globalTrend: store.sessions.map(s => ({
      session: s.sessionNumber,
      date: s.date,
      postureStability: s.postureStability,
      dhiScore: s.dhiScore
    }))
  };
  const blob = new Blob([JSON.stringify(report, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `vertibalance_bilan_complet_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
}

/* ─────────────── HELPERS DOM ─────────────── */
const $ = id => document.getElementById(id);
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}
function setSyncStatus(state) {
  document.querySelectorAll('.sync-dot').forEach(d => {
    d.className = 'sync-dot ' + state;
    d.title = state === 'online' ? 'Synchronisé JSONBin' : 'Hors ligne — données locales sécurisées';
  });
  const lbl = $('sync-label');
  if (lbl) lbl.textContent = state === 'online' ? 'Cloud sync' : 'Local';
  const lbl2 = $('sync-label-dash');
  if (lbl2) lbl2.textContent = state === 'online' ? 'Cloud sync' : 'Local';
}

/* ─────────────── ÉCRAN CONFIG ─────────────── */
function renderConfig() {
  $('cfg-name').value   = cfg.patientName || '';
  $('cfg-api-key').value = cfg.apiKey     || '';
  $('cfg-bin-id').value  = cfg.binId      || '';
  const hasKey = !!cfg.apiKey;
  $('cfg-status').textContent  = hasKey ? '✓ Clé enregistrée — synchronisation cloud active' : 'Aucune clé — toutes les données sont sauvegardées localement sur cet appareil';
  $('cfg-status').className = 'cfg-status ' + (hasKey ? 'ok' : 'neutral');
}

$('cfg-save-btn').addEventListener('click', async () => {
  const name = $('cfg-name').value.trim();
  const key  = $('cfg-api-key').value.trim();
  const binId = $('cfg-bin-id').value.trim();
  if (!name) { $('cfg-name').focus(); return; }
  cfg.patientName = name;
  if (key) cfg.apiKey = key;
  if (binId) cfg.binId = binId;
  saveCfg();
  $('cfg-status').textContent = '⏳ Chargement des données…';
  await loadStore();
  store.patientName = name;
  renderDashboard();
  renderConfig();
  showScreen('dashboard');
});

$('cfg-skip-btn').addEventListener('click', () => {
  if (!cfg.patientName) cfg.patientName = 'Moi';
  saveCfg();
  store.patientName = cfg.patientName;
  renderDashboard();
  showScreen('dashboard');
});

$('cfg-reset-btn').addEventListener('click', () => {
  if (!confirm('Réinitialiser la configuration ? Les données locales et les liens cloud sont conservés — seule la config est effacée.')) return;
  cfg = {};
  saveCfg();
  renderConfig();
});

/* ─────────────── DASHBOARD ─────────────── */
function renderDashboard() {
  const nextNum = store.sessions.length + 1;
  if (!currentSession) currentSession = emptyCurrentSession(nextNum);

  $('patient-name-label').textContent = store.patientName || 'Moi';
  $('session-badge').textContent = `Séance ${currentSession.sessionNumber}`;
  $('total-sessions-label').textContent = `${store.sessions.length} séance${store.sessions.length > 1 ? 's' : ''} complétée${store.sessions.length > 1 ? 's' : ''}`;

  // Scores de la séance EN COURS
  const done = exerciseStatus.filter(s => s === 'done').length;
  $('stat-completed').textContent = `${done} / ${EXERCISES.length}`;
  const pct = Math.round((done / EXERCISES.length) * 100);
  $('progress-fill').style.width = pct + '%';
  $('progress-pct').textContent  = pct + '%';

  calcScores(currentSession);
  $('stat-stability').textContent = currentSession.postureStability !== null ? Math.round(currentSession.postureStability) + '%' : '—';
  $('stat-dhi').textContent       = currentSession.dhiScore !== null ? Math.round(currentSession.dhiScore) + '/100' : '—';

  // Meilleure stabilité historique
  const bestStab = store.sessions.length
    ? Math.max(...store.sessions.filter(s=>s.postureStability).map(s=>s.postureStability))
    : null;
  $('stat-best').textContent = bestStab !== null ? Math.round(bestStab) + '%' : '—';

  // Boutons export
  const hasDone = done > 0 || store.sessions.length > 0;
  ['export-btn','export-btn-bottom'].forEach(id => { const b=$(id); if(b) b.disabled = !hasDone; });

  renderExerciseList();
  renderBlindReport();
  renderHistory();
}

function renderExerciseList() {
  const list = $('exercises-list');
  list.innerHTML = '';
  EXERCISES.forEach((ex, i) => {
    const st = exerciseStatus[i];
    const item = document.createElement('div');
    item.className = 'exercise-item' + (st==='active'?' active':'') + (st==='done'?' done':'');
    item.innerHTML = `
      <div class="ex-number ${st}">${st==='done'?'✓':i+1}</div>
      <div class="ex-info">
        <div class="ex-name">${ex.name}</div>
        <div class="ex-sub">${ex.sub}</div>
      </div>
      <div class="ex-meta">
        <div class="ex-duration">${ex.duration}s</div>
        <div class="ex-diff">${'●'.repeat(ex.difficulty)}${'○'.repeat(3-ex.difficulty)}</div>
        <div class="ex-badge ${st==='done'?'termine':st==='active'?'encours':'attente'}">
          ${st==='done'?'Terminé':st==='active'?'En cours':'À venir'}
        </div>
      </div>`;
    item.addEventListener('click', () => { if(st!=='done') launchExercise(i); });
    list.appendChild(item);
  });
}

function renderBlindReport() {
  const c = $('blind-report');
  if (!c) return;
  const exDone = currentSession.exercises.filter(e => e.blind && e.post);
  if (!exDone.length) { c.style.display='none'; return; }
  c.style.display = 'block';
  let rows = '';
  exDone.forEach(e => {
    const d = e.delta.osc;
    const trend = d < -0.005 ? '↓ Amélioration' : d > 0.005 ? '↑ Augmentation' : '→ Stable';
    const tc = d < -0.005 ? 'trend-good' : d > 0.005 ? 'trend-bad' : 'trend-neutral';
    const exDef = EXERCISES.find(x => x.id === e.id);
    rows += `<tr><td>${exDef?exDef.name:e.id}</td><td>${e.blind.osc.toFixed(3)} cm</td><td>${e.post.osc.toFixed(3)} cm</td><td class="${tc}">${trend}</td></tr>`;
  });
  c.innerHTML = `
    <div class="section-title">Bilan à l'insu — séance en cours</div>
    <div class="blind-info">Mesure pré-exercice (aveugle, 5 s) vs post-exercice. Delta négatif = amélioration de la stabilité.</div>
    <table class="blind-table">
      <thead><tr><th>Exercice</th><th>Pré (aveugle)</th><th>Post</th><th>Tendance</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderHistory() {
  const c = $('history-section');
  if (!c) return;
  if (store.sessions.length === 0) { c.style.display='none'; return; }
  c.style.display = 'block';

  // Mini-graphique sparkline SVG de l'évolution de la stabilité
  const sessions = store.sessions;
  const stabVals = sessions.map(s => s.postureStability || 0);
  const dhiVals  = sessions.map(s => s.dhiScore || 0);
  const n = sessions.length;
  const W = 320, H = 80, pad = 10;

  function polyline(vals, color) {
    if (vals.length < 2) return '';
    const max = Math.max(...vals, 1);
    const pts = vals.map((v,i) => {
      const x = pad + (i/(n-1||1))*(W-pad*2);
      const y = H - pad - (v/100)*(H-pad*2);
      return `${x},${y}`;
    }).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" opacity="0.85"/>
            <circle cx="${pad+(W-pad*2)}" cy="${H-pad-(vals[n-1]/100)*(H-pad*2)}" r="4" fill="${color}"/>`;
  }

  const svgStab = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
    ${sessions.map((_,i)=>`<line x1="${pad+(i/(n-1||1))*(W-pad*2)}" y1="${pad}" x2="${pad+(i/(n-1||1))*(W-pad*2)}" y2="${H-pad}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>`).join('')}
    ${polyline(stabVals,'#00C9A7')}
    ${sessions.map((s,i)=>`<text x="${pad+(i/(n-1||1))*(W-pad*2)}" y="${H+2}" fill="#6B8FA8" font-size="9" text-anchor="middle">${i+1}</text>`).join('')}
  </svg>`;

  // Tableau des séances passées
  const rows = [...sessions].reverse().map(s => `
    <tr>
      <td>${s.sessionNumber}</td>
      <td>${new Date(s.date).toLocaleDateString('fr-FR')}</td>
      <td style="color:var(--teal);font-weight:600">${s.postureStability!==null?Math.round(s.postureStability)+'%':'—'}</td>
      <td style="color:var(--violet);font-weight:600">${s.dhiScore!==null?Math.round(s.dhiScore):'—'}</td>
      <td>${s.exercises.filter(e=>e.post).length} / ${EXERCISES.length}</td>
    </tr>`).join('');

  c.innerHTML = `
    <div class="section-title">Historique des séances (${n} au total)</div>
    <div class="history-card">
      <div class="chart-label">Évolution stabilité posturale (%)</div>
      <div class="sparkline-big">${svgStab}</div>
      <table class="history-table">
        <thead><tr><th>Séance</th><th>Date</th><th>Stabilité</th><th>DHI</th><th>Exercices</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/* ─────────────── NOUVELLE SÉANCE ─────────────── */
$('new-session-btn').addEventListener('click', () => {
  if (sessionStarted && exerciseStatus.some(s => s==='done')) {
    if (!confirm('Démarrer une nouvelle séance ? La séance actuelle incomplète sera enregistrée telle quelle.')) return;
    finalizeSession();
  }
  startNewSession();
});

function startNewSession() {
  const nextNum = store.sessions.length + 1;
  currentSession = emptyCurrentSession(nextNum);
  exerciseStatus = EXERCISES.map(() => 'pending');
  sessionStarted = true;
  renderDashboard();
}

// Pousse la séance courante dans l'historique et sauvegarde
async function finalizeSession() {
  if (!currentSession || !currentSession.exercises.some(e => e.post)) return;
  calcScores(currentSession);
  store.sessions.push(currentSession);
  await saveStore();
}

/* ─────────────── NAVIGATION ─────────────── */
$('open-config-from-dash').addEventListener('click', () => { renderConfig(); showScreen('config'); });
$('back-to-dashboard').addEventListener('click', () => showScreen('dashboard'));
$('enter-vr-btn').addEventListener('click', () => {
  const idx = exerciseStatus.findIndex(s => s==='pending');
  if (idx===-1) { alert('Tous les exercices de cette séance sont terminés !'); return; }
  launchExercise(idx);
});

function launchExercise(index) {
  currentExIdx = index;
  const ex = EXERCISES[index];
  $('vr-exercise-name').textContent = ex.name;
  $('vr-exercise-desc').textContent = ({
    gaze:      'Gardez le regard fixé sur la sphère turquoise pendant que vous tournez doucement la tête.',
    pursuit:   'Suivez la cible des yeux, d\'abord sans bouger la tête, puis avec de légers mouvements.',
    opticflow: 'Restez stable pendant que l\'environnement défile. Respirez calmement.',
    rotation:  'Tournez la tête vers chaque cible lumineuse qui s\'allume, corps stable.',
    balance:   'Maintenez votre équilibre dans un environnement qui change autour de vous.'
  })[ex.type] || '';
  showScreen('vr-screen');
  checkXRSupport();
}

/* ─────────────── WEBXR ─────────────── */
let renderer, scene, camera, xrSession=null, clock;
let activeRuntime=null, xrPhase='idle';

/* ── Nausée via gamepad (Gamepad API exposée par WebXR) ── */
let currentNausea   = 5;   // score courant 0-10
let nauseaDebounce  = 0;   // anti-répétition bouton (secondes)
const NAUSEA_DELAY  = 0.4; // délai minimum entre deux pressions

/* ── HUD 3D flottant dans la scène VR ── */
let hudGroup = null;

function buildHUD(scene) {
  // Le HUD est un groupe d'objets Three.js placé devant la caméra en world-space.
  // Il affiche : nom exercice, timer, score nausée, instructions boutons.
  // Construit avec des sprites texte via CanvasTexture — fonctionne sans librairie externe.

  hudGroup = new THREE.Group();

  function makeTextSprite(text, opts={}) {
    const fontSize  = opts.fontSize  || 28;
    const color     = opts.color     || '#E8F4F8';
    const bgAlpha   = opts.bgAlpha   !== undefined ? opts.bgAlpha : 0;
    const cvs = document.createElement('canvas');
    cvs.width  = opts.w || 512;
    cvs.height = opts.h || 64;
    const ctx = cvs.getContext('2d');
    if (bgAlpha > 0) {
      ctx.fillStyle = `rgba(10,22,40,${bgAlpha})`;
      ctx.roundRect(0, 0, cvs.width, cvs.height, 12);
      ctx.fill();
    }
    ctx.font = `${opts.bold?'600 ':''}${fontSize}px Inter, sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign  = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cvs.width/2, cvs.height/2);
    const tex = new THREE.CanvasTexture(cvs);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    const aspect = cvs.width / cvs.height;
    sprite.scale.set(opts.scale || 0.5, (opts.scale||0.5)/aspect, 1);
    sprite.renderOrder = 999;
    return { sprite, canvas: cvs, ctx, tex };
  }

  // Panneau fond semi-transparent
  const bgCvs = document.createElement('canvas');
  bgCvs.width=512; bgCvs.height=180;
  const bgCtx = bgCvs.getContext('2d');
  bgCtx.fillStyle='rgba(10,22,40,0.78)';
  bgCtx.roundRect(0,0,512,180,18); bgCtx.fill();
  bgCtx.strokeStyle='rgba(0,201,167,0.35)'; bgCtx.lineWidth=2;
  bgCtx.roundRect(1,1,510,178,17); bgCtx.stroke();
  const bgTex = new THREE.CanvasTexture(bgCvs);
  const bgMat = new THREE.SpriteMaterial({map:bgTex,transparent:true,depthTest:false});
  const bgSprite = new THREE.Sprite(bgMat);
  bgSprite.scale.set(0.72,0.26,1); bgSprite.position.set(0,0,0); bgSprite.renderOrder=998;
  hudGroup.add(bgSprite);

  // Ligne 1 : nom exercice
  const exLine  = makeTextSprite('', {fontSize:22,color:'#00C9A7',bold:true,w:460,h:44,scale:0.55});
  exLine.sprite.position.set(0, 0.085, 0.01);
  hudGroup.add(exLine.sprite);

  // Ligne 2 : timer
  const timerLine = makeTextSprite('', {fontSize:20,color:'#E8F4F8',w:320,h:40,scale:0.42});
  timerLine.sprite.position.set(-0.08, 0.03, 0.01);
  hudGroup.add(timerLine.sprite);

  // Ligne 3 : nausée
  const nauseaLine = makeTextSprite('', {fontSize:20,color:'#FFB347',bold:true,w:320,h:40,scale:0.42});
  nauseaLine.sprite.position.set(0.08, 0.03, 0.01);
  hudGroup.add(nauseaLine.sprite);

  // Ligne 4 : instructions boutons
  const instrLine = makeTextSprite('A+/B−  •  Menu = STOP', {fontSize:17,color:'#6B8FA8',w:400,h:36,scale:0.38});
  instrLine.sprite.position.set(0, -0.03, 0.01);
  hudGroup.add(instrLine.sprite);

  // Ligne 5 : phase (aveugle / exercice)
  const phaseLine = makeTextSprite('', {fontSize:16,color:'#7B61FF',w:300,h:32,scale:0.32});
  phaseLine.sprite.position.set(0, -0.075, 0.01);
  hudGroup.add(phaseLine.sprite);

  hudGroup._exLine    = exLine;
  hudGroup._timerLine = timerLine;
  hudGroup._nauseaLine= nauseaLine;
  hudGroup._phaseLine = phaseLine;

  hudGroup.position.set(0, 1.55, -1.2);
  scene.add(hudGroup);
}

function updateHUD(exName, elapsed, duration, nausea, phase) {
  if (!hudGroup) return;

  function refresh(entry, text, color) {
    const {canvas:cvs, ctx, tex} = entry;
    ctx.clearRect(0,0,cvs.width,cvs.height);
    ctx.fillStyle = color || '#E8F4F8';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(text, cvs.width/2, cvs.height/2);
    tex.needsUpdate=true;
  }

  const remaining = Math.max(0, Math.ceil(duration - elapsed));
  const mm = String(Math.floor(remaining/60)).padStart(2,'0');
  const ss = String(remaining%60).padStart(2,'0');
  const nauseaColor = nausea<=3?'#00C9A7':nausea<=6?'#FFB347':'#FF6B6B';

  hudGroup._exLine.ctx.font    = '600 22px Inter,sans-serif';
  hudGroup._timerLine.ctx.font = '20px Inter,sans-serif';
  hudGroup._nauseaLine.ctx.font= '600 20px Inter,sans-serif';
  hudGroup._phaseLine.ctx.font = '16px Inter,sans-serif';

  refresh(hudGroup._exLine,     exName,                      '#00C9A7');
  refresh(hudGroup._timerLine,  `⏱ ${mm}:${ss}`,            '#E8F4F8');
  refresh(hudGroup._nauseaLine, `Nausée ${nausea}/10`,       nauseaColor);
  refresh(hudGroup._phaseLine,  phase==='blind'?'Mesure référence (5s)':'Exercice en cours','#7B61FF');

  // Coller le HUD devant la caméra, légèrement en bas du champ de vision
  if (camera) {
    const dir = new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion);
    const up  = new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion);
    const pos = camera.position.clone()
      .addScaledVector(dir, 1.2)
      .addScaledVector(up, -0.18);
    hudGroup.position.copy(pos);
    hudGroup.quaternion.copy(camera.quaternion);
  }
}

function removeHUD() {
  if (!hudGroup) return;
  scene.remove(hudGroup);
  hudGroup = null;
}

/* ── Lecture gamepad WebXR ── */
function pollGamepad(dt) {
  if (!xrSession || nauseaDebounce > 0) { nauseaDebounce = Math.max(0, nauseaDebounce-dt); return; }
  const sources = xrSession.inputSources;
  for (const src of sources) {
    if (!src.gamepad) continue;
    const gp = src.gamepad;
    const hand = src.handedness; // 'left' | 'right'

    // Manette DROITE — bouton A (index 4) = nausée +1 / bouton B (index 5) = nausée -1
    if (hand === 'right') {
      if (gp.buttons[4]?.pressed) { currentNausea = Math.min(10, currentNausea+1); nauseaDebounce=NAUSEA_DELAY; break; }
      if (gp.buttons[5]?.pressed) { currentNausea = Math.max(0,  currentNausea-1); nauseaDebounce=NAUSEA_DELAY; break; }
    }
    // Manette GAUCHE — bouton Menu (index 6) = arrêt d'urgence
    if (hand === 'left') {
      if (gp.buttons[6]?.pressed) { emergencyStop(); break; }
    }
  }
}

function emergencyStop() {
  // Sauvegarde ce qui a été fait dans la séance courante, puis quitte la VR
  if (activeRuntime && xrPhase === 'exercise') {
    const r = activeRuntime.getResult();
    let exEntry = currentSession.exercises.find(e=>e.id===EXERCISES[currentExIdx].id);
    if (!exEntry) { exEntry={id:EXERCISES[currentExIdx].id,blind:null,post:null,delta:null}; currentSession.exercises.push(exEntry); }
    exEntry.post = { osc:r.avgOscillation, angVel:r.maxAngularVelocity, nausea:currentNausea, duration:r.durationSeconds, aborted:true };
    if (exEntry.blind) exEntry.delta={osc:r.avgOscillation-exEntry.blind.osc,angVel:r.maxAngularVelocity-exEntry.blind.angVel};
    calcScores(currentSession);
    const snap=JSON.parse(JSON.stringify(store)); snap.currentSessionSnapshot=currentSession;
    localStorage.setItem(LOCAL_KEY,JSON.stringify(snap));
  }
  if (xrSession) xrSession.end();
}

function initThree() {
  const canvas = $('xr-canvas');
  renderer = new THREE.WebGLRenderer({canvas, antialias:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a1628);
  camera = new THREE.PerspectiveCamera(70, window.innerWidth/window.innerHeight, 0.05, 100);
  scene.add(camera);
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const d = new THREE.DirectionalLight(0xffffff,0.6); d.position.set(1,2,1); scene.add(d);
  for (let r=0.5; r<=3; r+=0.5) {
    const m = new THREE.Mesh(new THREE.RingGeometry(r-.006,r,64),
      new THREE.MeshBasicMaterial({color:0x00c9a7,side:THREE.DoubleSide,transparent:true,opacity:0.08}));
    m.rotation.x=-Math.PI/2; scene.add(m);
  }
  clock = new THREE.Clock();
  window.addEventListener('resize',()=>{
    if(!camera||!renderer)return;
    camera.aspect=window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth,window.innerHeight);
  });
}

function checkXRSupport() {
  const btn=$('start-xr-session-btn'), eBtn=$('enter-vr-btn'), msg=$('xr-unsupported-msg'), st=$('xr-status');
  if (!navigator.xr) {
    if(msg)msg.style.display='block'; if(btn)btn.disabled=true; if(eBtn)eBtn.disabled=true;
    if(st){st.textContent='WebXR non disponible';st.classList.remove('ready');} return;
  }
  navigator.xr.isSessionSupported('immersive-vr').then(ok=>{
    if(msg)msg.style.display=ok?'none':'block';
    if(btn)btn.disabled=!ok; if(eBtn)eBtn.disabled=!ok;
    if(st){st.textContent=ok?'Casque prêt':'Non supporté sur cet appareil'; if(ok)st.classList.add('ready'); else st.classList.remove('ready');}
  }).catch(()=>{if(msg)msg.style.display='block';if(btn)btn.disabled=true;});
}

$('start-xr-session-btn').addEventListener('click', startXRSession);

async function startXRSession() {
  if (!renderer) initThree();
  try {
    xrSession = await navigator.xr.requestSession('immersive-vr',{optionalFeatures:['local-floor','bounded-floor']});
  } catch(e) { alert('Impossible de démarrer la session VR : '+e.message); return; }
  renderer.xr.setReferenceSpaceType('local-floor');
  await renderer.xr.setSession(xrSession);
  $('exit-banner').style.display='block';
  xrSession.addEventListener('end', onXRSessionEnd);
  // Init nausée et HUD pour ce nouvel exercice
  currentNausea  = 5;
  nauseaDebounce = 0;
  buildHUD(scene);
  xrPhase='blind';
  activeRuntime = new BlindRuntime(EXERCISES[currentExIdx], scene);
  exerciseStatus[currentExIdx]='active';
  renderer.setAnimationLoop(renderLoop);
}

function renderLoop() {
  const dt = clock.getDelta();
  if (!activeRuntime) return;
  activeRuntime.update(dt, camera);

  // Lecture manettes + mise à jour HUD chaque frame
  pollGamepad(dt);
  updateHUD(
    EXERCISES[currentExIdx]?.name || '',
    activeRuntime.elapsed,
    activeRuntime.ex.duration,
    currentNausea,
    xrPhase
  );

  // Transition blind → exercice réel
  if (xrPhase==='blind' && activeRuntime.finished && !activeRuntime.resultRecorded) {
    activeRuntime.resultRecorded=true;
    const blindResult = activeRuntime.getResult();
    // Stocker la mesure aveugle dans la séance courante
    let exEntry = currentSession.exercises.find(e=>e.id===EXERCISES[currentExIdx].id);
    if (!exEntry) { exEntry={id:EXERCISES[currentExIdx].id,blind:null,post:null,delta:null}; currentSession.exercises.push(exEntry); }
    exEntry.blind = { osc: blindResult.avgOscillation, angVel: blindResult.maxAngularVelocity };
    activeRuntime.dispose();
    xrPhase='exercise';
    currentNausea = 5; // reset nausée pour la phase exercice
    activeRuntime = createRuntime(EXERCISES[currentExIdx], scene);
  }

  // Fin exercice → enregistrement + sauvegarde
  if (xrPhase==='exercise' && activeRuntime.finished && !activeRuntime.resultRecorded) {
    activeRuntime.resultRecorded=true;
    const postResult = activeRuntime.getResult();
    let exEntry = currentSession.exercises.find(e=>e.id===EXERCISES[currentExIdx].id);
    if (!exEntry) { exEntry={id:EXERCISES[currentExIdx].id,blind:null,post:null,delta:null}; currentSession.exercises.push(exEntry); }
    exEntry.post = { osc:postResult.avgOscillation, angVel:postResult.maxAngularVelocity, nausea:currentNausea, duration:postResult.durationSeconds };
    if (exEntry.blind) {
      exEntry.delta = { osc: postResult.avgOscillation - exEntry.blind.osc, angVel: postResult.maxAngularVelocity - exEntry.blind.angVel };
    }
    exerciseStatus[currentExIdx]='done';

    // Sauvegarde intermédiaire après chaque exercice (anti-perte)
    calcScores(currentSession);
    const snapStore = JSON.parse(JSON.stringify(store)); // copie profonde
    snapStore.currentSessionSnapshot = currentSession;   // snapshot en cours
    localStorage.setItem(LOCAL_KEY, JSON.stringify(snapStore));

    // Si tous les exercices sont faits, finaliser la séance
    const allDone = exerciseStatus.every(s=>s==='done');
    if (allDone) {
      store.sessions.push(currentSession);
      saveStore(); // async, on ne bloque pas
      currentSession = emptyCurrentSession(store.sessions.length + 1);
      exerciseStatus = EXERCISES.map(()=>'pending');
      sessionStarted = false;
    }

    setTimeout(()=>{ if(xrSession) xrSession.end(); }, 1800);
  }

  renderer.render(scene, camera);
}

function onXRSessionEnd() {
  renderer.setAnimationLoop(null);
  $('exit-banner').style.display='none';
  if (activeRuntime){activeRuntime.dispose();activeRuntime=null;}
  removeHUD();
  xrPhase='idle'; xrSession=null;
  renderDashboard();
  showScreen('dashboard');
}

/* ─────────────── RUNTIMES ─────────────── */
class BaseRuntime {
  constructor(ex,scene){
    this.ex=ex;this.scene=scene;this.objects=[];this.elapsed=0;
    this.finished=false;this.completed=false;this.resultRecorded=false;
    this._oA=0;this._oS=0;this._mA=0;
    this._lP=new THREE.Vector3();this._lQ=new THREE.Quaternion();this._ti=false;
  }
  _th(cam,dt){
    if(!this._ti){this._lP.copy(cam.position);this._lQ.copy(cam.quaternion);this._ti=true;return;}
    this._oA+=cam.position.distanceTo(this._lP)*100;this._oS++;
    const av=THREE.MathUtils.radToDeg(cam.quaternion.angleTo(this._lQ))/Math.max(dt,0.0001);
    if(av>this._mA)this._mA=av;
    this._lP.copy(cam.position);this._lQ.copy(cam.quaternion);
  }
  update(dt,cam){this.elapsed+=dt;this._th(cam,dt);this.onUpdate(dt,cam);if(this.elapsed>=this.ex.duration){this.finished=true;this.completed=true;}}
  onUpdate(dt,cam){}
  getResult(){return{avgOscillation:this._oS>0?this._oA/this._oS:0,maxAngularVelocity:this._mA,nausea:2,durationSeconds:this.elapsed};}
  dispose(){this.objects.forEach(o=>this.scene.remove(o));this.objects=[];}
  _add(m){this.scene.add(m);this.objects.push(m);return m;}
  _sph(r,c){return new THREE.Mesh(new THREE.SphereGeometry(r,24,24),new THREE.MeshStandardMaterial({color:c,emissive:c,emissiveIntensity:0.45}));}
}
class BlindRuntime extends BaseRuntime{constructor(ex,sc){super({...ex,duration:BLIND_DUR},sc);}}
class GazeFixedRuntime extends BaseRuntime{
  constructor(ex,sc){super(ex,sc);this.t=this._add(this._sph(0.08,0x00c9a7));this.t.position.set(0,1.6,-2);}
  onUpdate(dt,cam){
    const to=this.t.position.clone().sub(cam.position).normalize();
    const fw=new THREE.Vector3(0,0,-1).applyQuaternion(cam.quaternion);
    const col=THREE.MathUtils.radToDeg(fw.angleTo(to))<=10?0x00c9a7:0xffb347;
    this.t.material.color.set(col);this.t.material.emissive.set(col);
  }
}
class GazePursuitRuntime extends BaseRuntime{
  constructor(ex,sc){super(ex,sc);this.t=this._add(this._sph(0.08,0x7b61ff));}
  onUpdate(){this.t.position.set(Math.sin(this.elapsed*.6)*1.2,1.6+Math.sin(this.elapsed*.4)*.35,-2);}
}
class OpticFlowRuntime extends BaseRuntime{
  constructor(ex,sc){
    super(ex,sc);
    const cv=document.createElement('canvas');cv.width=512;cv.height=256;
    const cx=cv.getContext('2d');cx.fillStyle='#0f1e38';cx.fillRect(0,0,512,256);
    cx.strokeStyle='rgba(0,201,167,0.35)';cx.lineWidth=2;
    for(let i=0;i<512;i+=32){cx.beginPath();cx.moveTo(i,0);cx.lineTo(i,256);cx.stroke();}
    for(let j=0;j<256;j+=32){cx.beginPath();cx.moveTo(0,j);cx.lineTo(512,j);cx.stroke();}
    this.tex=new THREE.CanvasTexture(cv);this.tex.wrapS=this.tex.wrapT=THREE.RepeatWrapping;this.tex.repeat.set(4,2);
    this._add(new THREE.Mesh(new THREE.SphereGeometry(8,32,32),new THREE.MeshBasicMaterial({map:this.tex,side:THREE.BackSide})));
    this._add(this._sph(0.06,0x00c9a7)).position.set(0,1.6,-1.5);
  }
  onUpdate(dt){this.tex.offset.x+=dt*Math.min(this.elapsed/10,1)*.045;this.tex.needsUpdate=true;}
}
class HeadRotationRuntime extends BaseRuntime{
  constructor(ex,sc){
    super(ex,sc);this.tgts=[];
    [[-1.5,1.6,-1.8],[1.5,1.6,-1.8],[0,2.1,-1.8],[0,1.2,-1.8]].forEach(p=>{
      const m=this._add(this._sph(0.07,0x162440));m.material.emissiveIntensity=0;m.position.set(...p);this.tgts.push(m);
    });
    this.ai=-1;this.ct=ex.duration/this.tgts.length;this._act(0);
  }
  _act(i){if(i===this.ai)return;this.tgts.forEach((t,j)=>{const on=j===i;t.material.color.set(on?0x3b82f6:0x162440);t.material.emissive.set(on?0x3b82f6:0x000000);t.material.emissiveIntensity=on?.7:0;});this.ai=i;}
  onUpdate(){this._act(Math.min(Math.floor(this.elapsed/this.ct),this.tgts.length-1));}
}
class BalanceRuntime extends BaseRuntime{
  constructor(ex,sc){
    super(ex,sc);this.sh=[];
    for(let i=0;i<6;i++){
      const m=this._add(new THREE.Mesh(new THREE.IcosahedronGeometry(.15,0),new THREE.MeshStandardMaterial({color:0x7b61ff,transparent:true,opacity:.45,wireframe:true})));
      const a=(i/6)*Math.PI*2;m.position.set(Math.cos(a)*2.2,1.4+Math.sin(i)*.3,Math.sin(a)*2.2-1);
      this.sh.push({mesh:m,bY:m.position.y,ph:i});
    }
    this._add(this._sph(.08,0x00c9a7)).position.set(0,1.6,-1.8);
  }
  onUpdate(dt){this.sh.forEach(s=>{s.mesh.position.y=s.bY+Math.sin(this.elapsed*.8+s.ph)*.15;s.mesh.rotation.y+=dt*.3;});}
}
function createRuntime(ex,scene){
  return new ({gaze:GazeFixedRuntime,pursuit:GazePursuitRuntime,opticflow:OpticFlowRuntime,rotation:HeadRotationRuntime,balance:BalanceRuntime}[ex.type]||GazeFixedRuntime)(ex,scene);
}

/* ─────────────── RÉCUPÉRATION SNAPSHOT ─────────────── */
// Si l'app a été fermée en pleine séance, récupère le snapshot intermédiaire
function recoverSnapshot() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved.currentSessionSnapshot) {
      const snap = saved.currentSessionSnapshot;
      // Reprendre la séance si elle a des exercices faits mais n'est pas dans sessions[]
      const alreadySaved = saved.sessions.some(s => s.sessionNumber === snap.sessionNumber);
      if (!alreadySaved && snap.exercises.some(e=>e.post)) {
        currentSession = snap;
        snap.exercises.forEach(e=>{
          const idx = EXERCISES.findIndex(x=>x.id===e.id);
          if(idx>=0 && e.post) exerciseStatus[idx]='done';
        });
        sessionStarted=true;
        showNotice('Séance interrompue récupérée — vos exercices précédents sont restaurés.');
      }
    }
    store = saved;
    delete store.currentSessionSnapshot; // nettoyer
  } catch(e) {}
}

function showNotice(msg) {
  const n = document.createElement('div');
  n.className='notice'; n.textContent=msg;
  document.body.appendChild(n);
  setTimeout(()=>n.remove(),5000);
}

/* ─────────────── INIT ─────────────── */
async function init() {
  // Décider quel écran montrer au démarrage
  if (!cfg.patientName) {
    // Premier lancement : écran config
    renderConfig();
    showScreen('config');
  } else {
    await loadStore();
    recoverSnapshot();
    if (!currentSession) currentSession = emptyCurrentSession(store.sessions.length+1);
    renderDashboard();
    checkXRSupport();
    showScreen('dashboard');
  }
  setSyncStatus(cfg.apiKey ? 'online' : 'offline');
}

init();
