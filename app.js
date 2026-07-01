'use strict';
/* =====================================================================
   VertiBalance VR v3 — Multi-utilisateurs + sauvegarde JSONBin en ligne
   Architecture :
   - 1 bin "registry"  : { patients: { [id]: { name, binId, sessionCount } } }
   - 1 bin par patient : { ...sessionData }
   Fallback automatique sur localStorage si hors ligne.
   ===================================================================== */

/* ──────────────────────────────────────────────────────────────────────
   EXERCICES
   ────────────────────────────────────────────────────────────────────── */
const EXERCISES = [
  { id:'gaze-fixed',    name:'Stabilisation du regard',      sub:'Réflexe vestibulo-oculaire (VOR) • Environnement calme',           duration:60, difficulty:1, type:'gaze'      },
  { id:'gaze-moving',   name:'Poursuite oculaire',           sub:'Coordination oculo-motrice dynamique',                              duration:60, difficulty:2, type:'pursuit'   },
  { id:'optic-flow',    name:'Flux optique — désensibilisation', sub:'Conflit visuo-vestibulaire • Environnement immersif',           duration:90, difficulty:2, type:'opticflow' },
  { id:'head-rotation', name:'Rotations de tête guidées',    sub:'Adaptation vestibulaire • Cibles directionnelles',                  duration:60, difficulty:2, type:'rotation'  },
  { id:'balance-scene', name:'Équilibre dynamique',          sub:'Intégration sensorielle multimodale • Scène 360°',                  duration:90, difficulty:3, type:'balance'   }
];

/* ──────────────────────────────────────────────────────────────────────
   CONFIG / CLÉ API
   ────────────────────────────────────────────────────────────────────── */
const CFG_KEY    = 'vb_config_v3';
const LOCAL_KEY  = 'vb_local_v3';
const JBIN_BASE  = 'https://api.jsonbin.io/v3';

let cfg = (() => {
  try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch(e) { return {}; }
})();

function saveCfg() {
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
}

/* ──────────────────────────────────────────────────────────────────────
   COUCHE JSONBIN
   ────────────────────────────────────────────────────────────────────── */
const jbin = {
  headers(extra = {}) {
    return {
      'Content-Type': 'application/json',
      'X-Master-Key': cfg.apiKey || '',
      ...extra
    };
  },

  async createBin(name, data) {
    const r = await fetch(`${JBIN_BASE}/b`, {
      method: 'POST',
      headers: this.headers({ 'X-Bin-Name': name, 'X-Bin-Private': 'true' }),
      body: JSON.stringify(data)
    });
    if (!r.ok) throw new Error(`JSONBin create: ${r.status}`);
    const j = await r.json();
    return j.metadata.id;
  },

  async readBin(binId) {
    const r = await fetch(`${JBIN_BASE}/b/${binId}/latest`, {
      headers: this.headers({ 'X-Bin-Meta': 'false' })
    });
    if (!r.ok) throw new Error(`JSONBin read: ${r.status}`);
    return r.json();
  },

  async updateBin(binId, data) {
    const r = await fetch(`${JBIN_BASE}/b/${binId}`, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify(data)
    });
    if (!r.ok) throw new Error(`JSONBin update: ${r.status}`);
  }
};

/* ──────────────────────────────────────────────────────────────────────
   REGISTRY (liste des patients en ligne)
   ────────────────────────────────────────────────────────────────────── */
let registry = null; // { patients: { [patientId]: { name, binId, sessionCount, lastSession } } }

function emptyRegistry() { return { patients: {} }; }

async function loadRegistry() {
  if (!cfg.apiKey) { registry = emptyRegistry(); return; }
  try {
    if (cfg.registryBinId) {
      registry = await jbin.readBin(cfg.registryBinId);
    } else {
      registry = emptyRegistry();
      cfg.registryBinId = await jbin.createBin('vb-registry', registry);
      saveCfg();
    }
    showSyncStatus('online');
  } catch(e) {
    console.warn('Registry offline:', e);
    registry = emptyRegistry();
    showSyncStatus('offline');
  }
}

async function saveRegistry() {
  if (!cfg.apiKey || !cfg.registryBinId) return;
  try {
    await jbin.updateBin(cfg.registryBinId, registry);
    showSyncStatus('online');
  } catch(e) { showSyncStatus('offline'); }
}

/* ──────────────────────────────────────────────────────────────────────
   DONNÉES PATIENT
   ────────────────────────────────────────────────────────────────────── */
function emptyPatient(name) {
  return {
    patientName: name,
    sessionNumber: 1,
    totalSessions: 12,
    createdAt: new Date().toISOString(),
    entries: [],
    blindAssessments: [],
    dhiScore: null,
    postureStability: null,
    stabilityHistory: []   // [{ session, stability, dhi, date }] pour les sparklines
  };
}

let currentPatient   = null; // { id, name, binId }
let sessionData      = null;
let exerciseStatus   = EXERCISES.map(() => 'pending');
let currentExIdx     = -1;

function syncExerciseStatus() {
  if (!sessionData) return;
  const doneIds = new Set(sessionData.entries.map(e => e.exerciseId));
  exerciseStatus = EXERCISES.map(ex => doneIds.has(ex.id) ? 'done' : 'pending');
}

function recalcScores() {
  const e = sessionData.entries;
  if (!e.length) return;
  let osc = 0, nausea = 0;
  e.forEach(r => { osc += r.avgOscillation; nausea += r.nausea; });
  osc /= e.length; nausea /= e.length;
  sessionData.postureStability = Math.max(0, Math.min(100, 100 - osc * 8));
  sessionData.dhiScore = Math.max(0, Math.min(100, nausea * 6 + (100 - sessionData.postureStability) * 0.3));
}

async function loadPatientData(patient) {
  currentPatient = patient;
  try {
    if (patient.binId && cfg.apiKey) {
      sessionData = await jbin.readBin(patient.binId);
      showSyncStatus('online');
    } else {
      const local = localStorage.getItem(LOCAL_KEY + '_' + patient.id);
      sessionData = local ? JSON.parse(local) : emptyPatient(patient.name);
    }
  } catch(e) {
    const local = localStorage.getItem(LOCAL_KEY + '_' + patient.id);
    sessionData = local ? JSON.parse(local) : emptyPatient(patient.name);
    showSyncStatus('offline');
  }
  if (!sessionData.stabilityHistory) sessionData.stabilityHistory = [];
  syncExerciseStatus();
}

async function savePatientData() {
  // Toujours sauvegarder en local d'abord (filet de sécurité)
  localStorage.setItem(LOCAL_KEY + '_' + currentPatient.id, JSON.stringify(sessionData));

  if (!cfg.apiKey) return;
  try {
    if (currentPatient.binId) {
      await jbin.updateBin(currentPatient.binId, sessionData);
    } else {
      const binId = await jbin.createBin(`vb-patient-${currentPatient.id}`, sessionData);
      currentPatient.binId = binId;
      // Mettre à jour le registry avec le nouveau binId
      if (registry.patients[currentPatient.id]) {
        registry.patients[currentPatient.id].binId = binId;
        await saveRegistry();
      }
    }
    showSyncStatus('online');
  } catch(e) { showSyncStatus('offline'); }
}

/* ──────────────────────────────────────────────────────────────────────
   EXPORT JSON
   ────────────────────────────────────────────────────────────────────── */
function exportJSON() {
  const comparisons = EXERCISES.map(ex => {
    const blind = sessionData.blindAssessments.find(b => b.exerciseId === ex.id);
    const post  = sessionData.entries.find(en => en.exerciseId === ex.id);
    return {
      exerciseId: ex.id, exerciseName: ex.name,
      blindPhase: blind || null, postPhase: post || null,
      delta: (blind && post) ? {
        oscillationCm: +(post.avgOscillation - blind.avgOscillation).toFixed(4),
        angularVelDegS: +(post.maxAngularVelocity - blind.maxAngularVelocity).toFixed(2)
      } : null
    };
  });
  const report = {
    appVersion: '3.0', exportedAt: new Date().toISOString(),
    patient: sessionData.patientName,
    session: { number: sessionData.sessionNumber, total: sessionData.totalSessions },
    clinicalScores: {
      dhiEstimate: sessionData.dhiScore !== null ? +sessionData.dhiScore.toFixed(1) : null,
      postureStabilityPct: sessionData.postureStability !== null ? +sessionData.postureStability.toFixed(1) : null
    },
    stabilityHistory: sessionData.stabilityHistory,
    exerciseResults: comparisons,
    rawBlindAssessments: sessionData.blindAssessments,
    rawEntries: sessionData.entries
  };
  const blob = new Blob([JSON.stringify(report, null, 2)], { type:'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `vb_${sessionData.patientName.replace(/\s+/g,'_')}_s${sessionData.sessionNumber}_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ──────────────────────────────────────────────────────────────────────
   HELPERS DOM
   ────────────────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}

function showSyncStatus(state) {
  document.querySelectorAll('.sync-dot').forEach(d => {
    d.className = 'sync-dot ' + state;
    d.title = state === 'online' ? 'Synchronisé avec JSONBin' : 'Hors ligne — sauvegarde locale uniquement';
  });
}

/* ──────────────────────────────────────────────────────────────────────
   ÉCRAN CONFIG (clé API)
   ────────────────────────────────────────────────────────────────────── */
function renderConfig() {
  $('cfg-api-key').value = cfg.apiKey || '';
  $('cfg-registry-id').value = cfg.registryBinId || '';
  $('cfg-status').textContent = cfg.apiKey ? '✓ Clé enregistrée' : 'Aucune clé — mode hors ligne';
  $('cfg-status').className = 'cfg-status ' + (cfg.apiKey ? 'ok' : 'warn');
}

$('cfg-save-btn').addEventListener('click', async () => {
  const key = $('cfg-api-key').value.trim();
  if (!key) { alert('Entrez une clé API JSONBin.'); return; }
  cfg.apiKey = key;
  cfg.registryBinId = $('cfg-registry-id').value.trim() || null;
  saveCfg();
  $('cfg-status').textContent = '⏳ Connexion en cours…';
  await loadRegistry();
  renderConfig();
  renderPatientList();
  $('cfg-registry-id').value = cfg.registryBinId || '';
});

$('cfg-clear-btn').addEventListener('click', () => {
  if (!confirm('Supprimer la clé API ? Les données locales sont conservées.')) return;
  cfg = {};
  saveCfg();
  renderConfig();
});

/* ──────────────────────────────────────────────────────────────────────
   ÉCRAN LISTE PATIENTS
   ────────────────────────────────────────────────────────────────────── */
function patientId(name) {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function sparkline(history) {
  if (!history || history.length === 0) return '<span class="no-data">Aucune donnée</span>';
  const vals = history.map(h => h.stability);
  const max = Math.max(...vals, 1);
  const w = 80, h = 28, pad = 2;
  const pts = vals.map((v, i) => {
    const x = pad + (i / Math.max(vals.length - 1, 1)) * (w - pad * 2);
    const y = h - pad - (v / 100) * (h - pad * 2);
    return `${x},${y}`;
  }).join(' ');
  const last = vals[vals.length - 1];
  const color = last >= 75 ? '#00C9A7' : last >= 50 ? '#FFB347' : '#FF6B6B';
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="${pts.split(' ').pop().split(',')[0]}" cy="${pts.split(' ').pop().split(',')[1]}" r="3" fill="${color}"/>
  </svg>`;
}

function renderPatientList() {
  const list = $('patient-list');
  list.innerHTML = '';
  const patients = registry ? Object.values(registry.patients) : [];

  if (patients.length === 0) {
    list.innerHTML = '<div class="empty-state">Aucun patient — ajoutez-en un ci-dessous.</div>';
    return;
  }

  patients.forEach(p => {
    const card = document.createElement('div');
    card.className = 'patient-card';
    const stability = p.lastStability !== undefined ? Math.round(p.lastStability) + '%' : '—';
    const dhi       = p.lastDhi       !== undefined ? Math.round(p.lastDhi) + '/100' : '—';
    card.innerHTML = `
      <div class="patient-card-header">
        <div class="patient-avatar">${p.name.charAt(0).toUpperCase()}</div>
        <div class="patient-info">
          <div class="patient-name">${p.name}</div>
          <div class="patient-meta">Session ${p.sessionCount || 1} / 12 · Créé le ${new Date(p.createdAt || Date.now()).toLocaleDateString('fr-FR')}</div>
        </div>
        <div class="patient-sync">
          <span class="sync-dot ${cfg.apiKey ? 'online' : 'offline'}"></span>
        </div>
      </div>
      <div class="patient-metrics">
        <div class="metric-pill"><span class="metric-label">Stabilité</span><span class="metric-val teal">${stability}</span></div>
        <div class="metric-pill"><span class="metric-label">DHI</span><span class="metric-val violet">${dhi}</span></div>
        <div class="metric-pill sparkline-pill">${sparkline(p.stabilityHistory)}</div>
      </div>
      <div class="patient-actions">
        <button class="btn btn-primary btn-sm" data-id="${p.id}">▶ Ouvrir la séance</button>
        <button class="btn btn-secondary btn-sm btn-export-patient" data-id="${p.id}">⬇ JSON</button>
        <button class="btn btn-danger btn-sm btn-delete-patient" data-id="${p.id}">✕</button>
      </div>`;
    list.appendChild(card);
  });

  list.querySelectorAll('[data-id]').forEach(btn => {
    const id = btn.dataset.id;
    if (btn.classList.contains('btn-export-patient')) {
      btn.addEventListener('click', async () => { await selectPatient(id); exportJSON(); });
    } else if (btn.classList.contains('btn-delete-patient')) {
      btn.addEventListener('click', () => deletePatient(id));
    } else {
      btn.addEventListener('click', () => selectPatient(id));
    }
  });
}

async function selectPatient(id) {
  const p = registry.patients[id];
  if (!p) return;
  await loadPatientData(p);
  renderDashboard();
  showScreen('dashboard');
}

async function addPatient(name) {
  if (!name.trim()) return;
  const id = patientId(name) + '_' + Date.now();
  const patient = { id, name: name.trim(), binId: null, sessionCount: 1,
                    createdAt: new Date().toISOString(), lastStability: null, lastDhi: null,
                    stabilityHistory: [] };
  registry.patients[id] = patient;
  await saveRegistry();
  renderPatientList();
}

async function deletePatient(id) {
  if (!confirm('Supprimer ce patient ? Les données en ligne restent accessibles via JSONBin.')) return;
  delete registry.patients[id];
  localStorage.removeItem(LOCAL_KEY + '_' + id);
  await saveRegistry();
  renderPatientList();
}

$('add-patient-btn').addEventListener('click', () => {
  const name = $('new-patient-name').value.trim();
  if (!name) { $('new-patient-name').focus(); return; }
  addPatient(name);
  $('new-patient-name').value = '';
});

$('new-patient-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('add-patient-btn').click();
});

/* ──────────────────────────────────────────────────────────────────────
   DASHBOARD PATIENT
   ────────────────────────────────────────────────────────────────────── */
function renderDashboard() {
  if (!sessionData) return;
  $('dash-patient-name').textContent = sessionData.patientName;
  $('session-badge').textContent = `Session ${sessionData.sessionNumber} / ${sessionData.totalSessions}`;
  $('stat-stability').textContent = sessionData.postureStability !== null ? Math.round(sessionData.postureStability) + '%' : '—';
  $('stat-dhi').textContent       = sessionData.dhiScore !== null ? Math.round(sessionData.dhiScore) + '/100' : '—';
  const done = exerciseStatus.filter(s => s === 'done').length;
  $('stat-completed').textContent = `${done} / ${EXERCISES.length}`;
  const pct = Math.round((done / EXERCISES.length) * 100);
  $('progress-fill').style.width = pct + '%';
  $('progress-pct').textContent  = pct + '%';
  const eb = $('export-btn');
  if (eb) eb.disabled = done === 0;
  renderBlindReport();
  renderExerciseList();
  checkXRSupport();
}

function renderExerciseList() {
  const list = $('exercises-list');
  list.innerHTML = '';
  EXERCISES.forEach((ex, i) => {
    const st = exerciseStatus[i];
    const item = document.createElement('div');
    item.className = 'exercise-item' + (st === 'active' ? ' active' : '') + (st === 'done' ? ' done' : '');
    item.innerHTML = `
      <div class="ex-number ${st}">${st === 'done' ? '✓' : i + 1}</div>
      <div class="ex-info">
        <div class="ex-name">${ex.name}</div>
        <div class="ex-sub">${ex.sub}</div>
      </div>
      <div class="ex-meta">
        <div class="ex-duration">${ex.duration}s</div>
        <div class="ex-diff">${'●'.repeat(ex.difficulty)}${'○'.repeat(3-ex.difficulty)}</div>
        <div class="ex-badge ${st === 'done' ? 'termine' : st === 'active' ? 'encours' : 'attente'}">
          ${st === 'done' ? 'Terminé' : st === 'active' ? 'En cours' : 'À venir'}
        </div>
      </div>`;
    item.addEventListener('click', () => { if (st !== 'done') launchExercise(i); });
    list.appendChild(item);
  });
}

function renderBlindReport() {
  const container = $('blind-report');
  if (!container) return;
  const has = sessionData.blindAssessments.length > 0 && sessionData.entries.length > 0;
  if (!has) { container.style.display = 'none'; return; }
  container.style.display = 'block';
  let rows = '';
  EXERCISES.forEach(ex => {
    const blind = sessionData.blindAssessments.find(b => b.exerciseId === ex.id);
    const post  = sessionData.entries.find(e => e.exerciseId === ex.id);
    if (!blind || !post) return;
    const delta = post.avgOscillation - blind.avgOscillation;
    const trend = delta < -0.005 ? '↓ Amélioration' : delta > 0.005 ? '↑ Augmentation' : '→ Stable';
    const tc = delta < -0.005 ? 'trend-good' : delta > 0.005 ? 'trend-bad' : 'trend-neutral';
    rows += `<tr><td>${ex.name}</td><td>${blind.avgOscillation.toFixed(3)} cm</td><td>${post.avgOscillation.toFixed(3)} cm</td><td class="${tc}">${trend}</td></tr>`;
  });
  container.innerHTML = `
    <div class="section-title">Bilan à l'insu</div>
    <div class="blind-info">Mesure pré-exercice (aveugle) vs post-exercice.</div>
    <table class="blind-table">
      <thead><tr><th>Exercice</th><th>Pré</th><th>Post</th><th>Tendance</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/* ──────────────────────────────────────────────────────────────────────
   NAVIGATION
   ────────────────────────────────────────────────────────────────────── */
$('back-to-patients').addEventListener('click', () => { currentPatient = null; sessionData = null; showScreen('patients'); });
$('open-config-btn').addEventListener('click', () => { renderConfig(); showScreen('config'); });
$('back-from-config').addEventListener('click', () => showScreen('patients'));
$('export-btn').addEventListener('click', exportJSON);
$('back-to-dashboard').addEventListener('click', () => { showScreen('dashboard'); });
$('enter-vr-btn').addEventListener('click', () => {
  const idx = exerciseStatus.findIndex(s => s === 'pending');
  if (idx === -1) { alert('Tous les exercices sont terminés !'); return; }
  launchExercise(idx);
});

function launchExercise(index) {
  currentExIdx = index;
  const ex = EXERCISES[index];
  $('vr-exercise-name').textContent = ex.name;
  $('vr-exercise-desc').textContent = ({
    gaze:      'Gardez le regard fixé sur la sphère turquoise pendant que vous tournez doucement la tête.',
    pursuit:   'Suivez la cible des yeux, d\'abord sans bouger la tête, puis avec de légers mouvements.',
    opticflow: 'Restez stable pendant que l\'environnement défile. Respirez calmement et lentement.',
    rotation:  'Tournez la tête vers chaque cible lumineuse qui s\'allume, corps stable.',
    balance:   'Maintenez votre équilibre dans un environnement qui change autour de vous.'
  })[ex.type] || '';
  showScreen('vr-screen');
  checkXRSupport();
}

/* ──────────────────────────────────────────────────────────────────────
   WEBXR + THREE.JS
   ────────────────────────────────────────────────────────────────────── */
let renderer, scene, camera, xrSession = null, clock;
let activeRuntime = null, xrPhase = 'idle';
const BLIND_DUR = 5;

function initThree() {
  const canvas = $('xr-canvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a1628);
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 100);
  scene.add(camera);
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(1, 2, 1); scene.add(dir);
  for (let r = 0.5; r <= 3; r += 0.5) {
    const g = new THREE.RingGeometry(r - 0.006, r, 64);
    const m = new THREE.MeshBasicMaterial({ color:0x00c9a7, side:THREE.DoubleSide, transparent:true, opacity:0.09 });
    const mesh = new THREE.Mesh(g, m); mesh.rotation.x = -Math.PI/2; scene.add(mesh);
  }
  clock = new THREE.Clock();
  window.addEventListener('resize', () => {
    if (!camera||!renderer) return;
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

function checkXRSupport() {
  const btn = $('start-xr-session-btn'), eBtn = $('enter-vr-btn'), msg = $('xr-unsupported-msg'), st = $('xr-status');
  if (!navigator.xr) {
    if(msg) msg.style.display='block'; if(btn) btn.disabled=true; if(eBtn) eBtn.disabled=true;
    if(st) { st.textContent='WebXR non disponible'; st.classList.remove('ready'); } return;
  }
  navigator.xr.isSessionSupported('immersive-vr').then(ok => {
    if(msg) msg.style.display = ok?'none':'block';
    if(btn) btn.disabled = !ok; if(eBtn) eBtn.disabled = !ok;
    if(st) { st.textContent = ok ? 'Casque prêt' : 'Mode immersif non supporté'; if(ok) st.classList.add('ready'); else st.classList.remove('ready'); }
  }).catch(() => { if(msg) msg.style.display='block'; if(btn) btn.disabled=true; });
}

$('start-xr-session-btn').addEventListener('click', startXRSession);

async function startXRSession() {
  if (!renderer) initThree();
  try {
    xrSession = await navigator.xr.requestSession('immersive-vr', { optionalFeatures:['local-floor','bounded-floor'] });
  } catch(e) { alert('Impossible de démarrer la session VR : ' + e.message); return; }
  renderer.xr.setReferenceSpaceType('local-floor');
  await renderer.xr.setSession(xrSession);
  $('exit-banner').style.display = 'block';
  xrSession.addEventListener('end', onXRSessionEnd);
  xrPhase = 'blind';
  activeRuntime = new BlindRuntime(EXERCISES[currentExIdx], scene);
  exerciseStatus[currentExIdx] = 'active';
  renderer.setAnimationLoop(renderLoop);
}

function renderLoop() {
  const delta = clock.getDelta();
  if (!activeRuntime) return;
  activeRuntime.update(delta, camera);
  if (xrPhase === 'blind' && activeRuntime.finished && !activeRuntime.resultRecorded) {
    activeRuntime.resultRecorded = true;
    const r = activeRuntime.getResult();
    if (!sessionData.blindAssessments) sessionData.blindAssessments = [];
    sessionData.blindAssessments = sessionData.blindAssessments.filter(b => b.exerciseId !== EXERCISES[currentExIdx].id);
    sessionData.blindAssessments.push({ exerciseId: EXERCISES[currentExIdx].id, avgOscillation: r.avgOscillation, maxAngularVelocity: r.maxAngularVelocity, timestamp: new Date().toISOString() });
    activeRuntime.dispose();
    xrPhase = 'exercise';
    activeRuntime = createRuntime(EXERCISES[currentExIdx], scene);
  }
  if (xrPhase === 'exercise' && activeRuntime.finished && !activeRuntime.resultRecorded) {
    activeRuntime.resultRecorded = true;
    const r = activeRuntime.getResult();
    sessionData.entries = sessionData.entries.filter(e => e.exerciseId !== EXERCISES[currentExIdx].id);
    sessionData.entries.push({ exerciseId: EXERCISES[currentExIdx].id, avgOscillation: r.avgOscillation, maxAngularVelocity: r.maxAngularVelocity, nausea: r.nausea, durationSeconds: r.durationSeconds, timestamp: new Date().toISOString() });
    recalcScores();
    // Mise à jour de l'historique de stabilité dans le registry
    if (registry && registry.patients[currentPatient.id]) {
      const p = registry.patients[currentPatient.id];
      p.lastStability = sessionData.postureStability;
      p.lastDhi       = sessionData.dhiScore;
      if (!p.stabilityHistory) p.stabilityHistory = [];
      if (!sessionData.stabilityHistory) sessionData.stabilityHistory = [];
      const snap = { session: sessionData.sessionNumber, stability: sessionData.postureStability, dhi: sessionData.dhiScore, date: new Date().toISOString() };
      p.stabilityHistory.push(snap);
      sessionData.stabilityHistory.push(snap);
    }
    exerciseStatus[currentExIdx] = 'done';
    savePatientData().then(() => saveRegistry());
    setTimeout(() => { if (xrSession) xrSession.end(); }, 1800);
  }
  renderer.render(scene, camera);
}

function onXRSessionEnd() {
  renderer.setAnimationLoop(null);
  $('exit-banner').style.display = 'none';
  if (activeRuntime) { activeRuntime.dispose(); activeRuntime = null; }
  xrPhase = 'idle'; xrSession = null;
  renderDashboard();
  showScreen('dashboard');
}

/* ──────────────────────────────────────────────────────────────────────
   RUNTIMES
   ────────────────────────────────────────────────────────────────────── */
class BaseRuntime {
  constructor(ex, scene) {
    this.ex=ex; this.scene=scene; this.objects=[]; this.elapsed=0;
    this.finished=false; this.completed=false; this.resultRecorded=false;
    this._oA=0; this._oS=0; this._mA=0;
    this._lP=new THREE.Vector3(); this._lQ=new THREE.Quaternion(); this._ti=false;
  }
  _th(camera, dt) {
    if (!this._ti) { this._lP.copy(camera.position); this._lQ.copy(camera.quaternion); this._ti=true; return; }
    this._oA += camera.position.distanceTo(this._lP)*100; this._oS++;
    const av = THREE.MathUtils.radToDeg(camera.quaternion.angleTo(this._lQ))/Math.max(dt,0.0001);
    if (av>this._mA) this._mA=av;
    this._lP.copy(camera.position); this._lQ.copy(camera.quaternion);
  }
  update(dt,cam) { this.elapsed+=dt; this._th(cam,dt); this.onUpdate(dt,cam); if(this.elapsed>=this.ex.duration){this.finished=true;this.completed=true;} }
  onUpdate(dt,cam){}
  getResult(){ return { avgOscillation:this._oS>0?this._oA/this._oS:0, maxAngularVelocity:this._mA, nausea:2, durationSeconds:this.elapsed }; }
  dispose(){ this.objects.forEach(o=>this.scene.remove(o)); this.objects=[]; }
  _add(m){ this.scene.add(m); this.objects.push(m); return m; }
  _sph(r,c){ return new THREE.Mesh(new THREE.SphereGeometry(r,24,24),new THREE.MeshStandardMaterial({color:c,emissive:c,emissiveIntensity:0.45})); }
}
class BlindRuntime extends BaseRuntime { constructor(ex,scene){super({...ex,duration:BLIND_DUR},scene);} }
class GazeFixedRuntime extends BaseRuntime {
  constructor(ex,scene){ super(ex,scene); this.t=this._add(this._sph(0.08,0x00c9a7)); this.t.position.set(0,1.6,-2); }
  onUpdate(dt,cam){
    const to=this.t.position.clone().sub(cam.position).normalize();
    const fw=new THREE.Vector3(0,0,-1).applyQuaternion(cam.quaternion);
    const col=THREE.MathUtils.radToDeg(fw.angleTo(to))<=10?0x00c9a7:0xffb347;
    this.t.material.color.set(col); this.t.material.emissive.set(col);
  }
}
class GazePursuitRuntime extends BaseRuntime {
  constructor(ex,scene){ super(ex,scene); this.t=this._add(this._sph(0.08,0x7b61ff)); }
  onUpdate(dt,cam){ this.t.position.set(Math.sin(this.elapsed*0.6)*1.2,1.6+Math.sin(this.elapsed*0.4)*0.35,-2); }
}
class OpticFlowRuntime extends BaseRuntime {
  constructor(ex,scene){
    super(ex,scene);
    const cv=document.createElement('canvas'); cv.width=512; cv.height=256;
    const cx=cv.getContext('2d'); cx.fillStyle='#0f1e38'; cx.fillRect(0,0,512,256);
    cx.strokeStyle='rgba(0,201,167,0.35)'; cx.lineWidth=2;
    for(let i=0;i<512;i+=32){cx.beginPath();cx.moveTo(i,0);cx.lineTo(i,256);cx.stroke();}
    for(let j=0;j<256;j+=32){cx.beginPath();cx.moveTo(0,j);cx.lineTo(512,j);cx.stroke();}
    this.tex=new THREE.CanvasTexture(cv); this.tex.wrapS=this.tex.wrapT=THREE.RepeatWrapping; this.tex.repeat.set(4,2);
    this._add(new THREE.Mesh(new THREE.SphereGeometry(8,32,32),new THREE.MeshBasicMaterial({map:this.tex,side:THREE.BackSide})));
    const a=this._add(this._sph(0.06,0x00c9a7)); a.position.set(0,1.6,-1.5);
  }
  onUpdate(dt){ this.tex.offset.x+=dt*Math.min(this.elapsed/10,1)*0.045; this.tex.needsUpdate=true; }
}
class HeadRotationRuntime extends BaseRuntime {
  constructor(ex,scene){
    super(ex,scene); this.tgts=[];
    [[-1.5,1.6,-1.8],[1.5,1.6,-1.8],[0,2.1,-1.8],[0,1.2,-1.8]].forEach(p=>{
      const m=this._add(this._sph(0.07,0x162440)); m.material.emissiveIntensity=0; m.position.set(...p); this.tgts.push(m);
    });
    this.ai=-1; this.ct=ex.duration/this.tgts.length; this._act(0);
  }
  _act(i){ if(i===this.ai)return; this.tgts.forEach((t,j)=>{const on=j===i;t.material.color.set(on?0x3b82f6:0x162440);t.material.emissive.set(on?0x3b82f6:0x000000);t.material.emissiveIntensity=on?0.7:0;}); this.ai=i; }
  onUpdate(){ this._act(Math.min(Math.floor(this.elapsed/this.ct),this.tgts.length-1)); }
}
class BalanceRuntime extends BaseRuntime {
  constructor(ex,scene){
    super(ex,scene); this.sh=[];
    for(let i=0;i<6;i++){
      const m=this._add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.15,0),new THREE.MeshStandardMaterial({color:0x7b61ff,transparent:true,opacity:0.45,wireframe:true})));
      const a=(i/6)*Math.PI*2; m.position.set(Math.cos(a)*2.2,1.4+Math.sin(i)*0.3,Math.sin(a)*2.2-1);
      this.sh.push({mesh:m,bY:m.position.y,ph:i});
    }
    const a=this._add(this._sph(0.08,0x00c9a7)); a.position.set(0,1.6,-1.8);
  }
  onUpdate(dt){ this.sh.forEach(s=>{s.mesh.position.y=s.bY+Math.sin(this.elapsed*0.8+s.ph)*0.15;s.mesh.rotation.y+=dt*0.3;}); }
}

function createRuntime(ex, scene) {
  const M={gaze:GazeFixedRuntime,pursuit:GazePursuitRuntime,opticflow:OpticFlowRuntime,rotation:HeadRotationRuntime,balance:BalanceRuntime};
  return new (M[ex.type]||GazeFixedRuntime)(ex,scene);
}

/* ──────────────────────────────────────────────────────────────────────
   INIT
   ────────────────────────────────────────────────────────────────────── */
async function init() {
  await loadRegistry();
  renderPatientList();
  showSyncStatus(cfg.apiKey ? 'online' : 'offline');
}

init();
