'use strict';

/* =====================================================================
   VertiBalance VR — moteur applicatif complet
   - Dashboard clinique (DOM)
   - Bilan à l'insu (mesure pré-exercice aveugle)
   - Moteur WebXR / Three.js avec 5 exercices vestibulaires
   - Sauvegarde localStorage + export JSON
   ===================================================================== */

/* ──────────────────────────────────────────────────────────────────────
   DONNÉES ET EXERCICES
   ────────────────────────────────────────────────────────────────────── */

const EXERCISES = [
  { id:'gaze-fixed',    name:'Stabilisation du regard — cible fixe',         sub:'Réflexe vestibulo-oculaire (VOR) • Environnement calme',           duration:60,  difficulty:1, type:'gaze'      },
  { id:'gaze-moving',   name:'Poursuite oculaire — cible mobile',             sub:'Coordination oculo-motrice dynamique',                              duration:60,  difficulty:2, type:'pursuit'   },
  { id:'optic-flow',    name:'Conflit visuo-vestibulaire — flux optique',      sub:'Désensibilisation aux mouvements visuels • Environnement immersif', duration:90,  difficulty:2, type:'opticflow' },
  { id:'head-rotation', name:'Rotations de tête guidées',                     sub:'Adaptation vestibulaire • Suivi de cibles latérales',               duration:60,  difficulty:2, type:'rotation'  },
  { id:'balance-scene', name:'Équilibre en environnement dynamique',          sub:'Intégration sensorielle multimodale • Scène 360°',                  duration:90,  difficulty:3, type:'balance'   }
];

/* ──────────────────────────────────────────────────────────────────────
   PERSISTANCE
   ────────────────────────────────────────────────────────────────────── */

const STORAGE_KEY = 'vertibalance_v2';

function emptySession() {
  return {
    patientName: 'Patient',
    sessionNumber: 1,
    totalSessions: 12,
    createdAt: new Date().toISOString(),
    entries: [],           // résultats post-exercice
    blindAssessments: [],  // mesures pré-exercice à l'insu
    dhiScore: null,
    postureStability: null
  };
}

function loadSession() {
  try { const r = localStorage.getItem(STORAGE_KEY); if (r) return JSON.parse(r); }
  catch(e) { console.warn('load error', e); }
  return emptySession();
}

function saveSession() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionData)); }
  catch(e) { console.warn('save error', e); }
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

/* Export JSON téléchargeable */
function exportJSON() {
  const comparisons = EXERCISES.map(ex => {
    const blind = sessionData.blindAssessments.find(b => b.exerciseId === ex.id);
    const post  = sessionData.entries.find(en => en.exerciseId === ex.id);
    return {
      exerciseId: ex.id,
      exerciseName: ex.name,
      blindPhase: blind || null,
      postPhase: post  || null,
      delta: (blind && post)
        ? { oscillationCm: +(post.avgOscillation - blind.avgOscillation).toFixed(4),
            angularVelDegS: +(post.maxAngularVelocity - blind.maxAngularVelocity).toFixed(2) }
        : null
    };
  });

  const report = {
    appVersion: '2.0',
    exportedAt: new Date().toISOString(),
    patient: sessionData.patientName,
    session: { number: sessionData.sessionNumber, total: sessionData.totalSessions },
    clinicalScores: {
      dhiEstimate: sessionData.dhiScore !== null ? +sessionData.dhiScore.toFixed(1) : null,
      postureStabilityPct: sessionData.postureStability !== null ? +sessionData.postureStability.toFixed(1) : null
    },
    exerciseResults: comparisons,
    rawBlindAssessments: sessionData.blindAssessments,
    rawEntries: sessionData.entries
  };

  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `vertibalance_session_${sessionData.sessionNumber}_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ──────────────────────────────────────────────────────────────────────
   ÉTAT APPLICATION
   ────────────────────────────────────────────────────────────────────── */

let sessionData     = loadSession();
let exerciseStatus  = EXERCISES.map(() => 'pending'); // pending | active | done
let currentExIdx    = -1;

// Init statut depuis données sauvegardées
(function syncStatus() {
  const doneIds = new Set(sessionData.entries.map(e => e.exerciseId));
  EXERCISES.forEach((ex, i) => { if (doneIds.has(ex.id)) exerciseStatus[i] = 'done'; });
})();

/* ──────────────────────────────────────────────────────────────────────
   HELPERS DOM
   ────────────────────────────────────────────────────────────────────── */

const $ = id => document.getElementById(id);

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}

/* ──────────────────────────────────────────────────────────────────────
   RENDU DASHBOARD
   ────────────────────────────────────────────────────────────────────── */

function renderDashboard() {
  $('session-badge').textContent = `Session ${sessionData.sessionNumber} / ${sessionData.totalSessions}`;

  const stability = sessionData.postureStability;
  const dhi       = sessionData.dhiScore;
  $('stat-stability').textContent = stability !== null ? Math.round(stability) + '%' : '—';
  $('stat-dhi').textContent       = dhi       !== null ? Math.round(dhi) + '/100'   : '—';

  const done = exerciseStatus.filter(s => s === 'done').length;
  $('stat-completed').textContent = `${done} / ${EXERCISES.length}`;
  const pct = Math.round((done / EXERCISES.length) * 100);
  $('progress-fill').style.width = pct + '%';
  $('progress-pct').textContent  = pct + '%';

  // Bouton export : actif si au moins un exercice terminé
  const exportBtn = $('export-btn');
  if (exportBtn) exportBtn.disabled = (done === 0);

  // Bilan à l'insu : affichage du tableau de comparaison si données disponibles
  renderBlindReport();

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
        <div class="ex-badge ${st === 'done' ? 'termine' : (st === 'active' ? 'encours' : 'attente')}">
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
  const hasData = sessionData.blindAssessments.length > 0 && sessionData.entries.length > 0;
  if (!hasData) { container.style.display = 'none'; return; }
  container.style.display = 'block';

  let rows = '';
  EXERCISES.forEach(ex => {
    const blind = sessionData.blindAssessments.find(b => b.exerciseId === ex.id);
    const post  = sessionData.entries.find(e => e.exerciseId === ex.id);
    if (!blind || !post) return;
    const delta = post.avgOscillation - blind.avgOscillation;
    const trend = delta < -0.005 ? '↓ Amélioration' : delta > 0.005 ? '↑ Augmentation' : '→ Stable';
    const trendClass = delta < -0.005 ? 'trend-good' : delta > 0.005 ? 'trend-bad' : 'trend-neutral';
    rows += `<tr>
      <td>${ex.name.split('—')[0].trim()}</td>
      <td>${blind.avgOscillation.toFixed(3)} cm</td>
      <td>${post.avgOscillation.toFixed(3)} cm</td>
      <td class="${trendClass}">${trend}</td>
    </tr>`;
  });

  container.innerHTML = `
    <div class="section-title">Bilan à l'insu — oscillation de tête</div>
    <div class="blind-info">Mesure pré-exercice (aveugle) comparée au résultat post-exercice. Une valeur négative indique une réduction de l'oscillation après l'exercice.</div>
    <table class="blind-table">
      <thead><tr><th>Exercice</th><th>Pré (aveugle)</th><th>Post</th><th>Tendance</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/* ──────────────────────────────────────────────────────────────────────
   NAVIGATION EXERCICES
   ────────────────────────────────────────────────────────────────────── */

function launchExercise(index) {
  currentExIdx = index;
  const ex = EXERCISES[index];
  $('vr-exercise-name').textContent = ex.name;
  $('vr-exercise-desc').textContent = exerciseDescription(ex.type);
  showScreen('vr-screen');
  checkXRSupport();
}

function exerciseDescription(type) {
  return {
    gaze:      'Gardez le regard fixé sur la sphère turquoise pendant que vous tournez doucement la tête de gauche à droite.',
    pursuit:   'Suivez la cible des yeux sans bouger la tête, puis avec de légers mouvements de tête.',
    opticflow: 'Restez stable pendant que l\'environnement défile autour de vous. Respirez lentement et calmement.',
    rotation:  'Tournez la tête vers chaque cible lumineuse qui apparaît, en gardant le corps stable.',
    balance:   'Maintenez votre équilibre dans un environnement qui change autour de vous.'
  }[type] || '';
}

/* ──────────────────────────────────────────────────────────────────────
   WEBXR + THREE.JS
   ────────────────────────────────────────────────────────────────────── */

let renderer, scene, camera, xrSession = null, clock;
let activeRuntime = null;
let xrPhase = 'idle'; // idle | blind | exercise

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
  dir.position.set(1, 2, 1);
  scene.add(dir);

  // Sol : cercles concentriques rassurants
  for (let r = 0.5; r <= 3; r += 0.5) {
    const g = new THREE.RingGeometry(r - 0.006, r, 64);
    const m = new THREE.MeshBasicMaterial({ color: 0x00c9a7, side: THREE.DoubleSide, transparent: true, opacity: 0.10 });
    const mesh = new THREE.Mesh(g, m);
    mesh.rotation.x = -Math.PI / 2;
    scene.add(mesh);
  }

  clock = new THREE.Clock();
  window.addEventListener('resize', () => {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

function checkXRSupport() {
  const btn  = $('start-xr-session-btn');
  const eBtn = $('enter-vr-btn');
  const msg  = $('xr-unsupported-msg');
  const status = $('xr-status');

  if (!navigator.xr) {
    msg.style.display = 'block'; btn.disabled = true;
    if (eBtn) eBtn.disabled = true;
    if (status) { status.textContent = 'WebXR non disponible'; status.classList.remove('ready'); }
    return;
  }
  navigator.xr.isSessionSupported('immersive-vr').then(ok => {
    msg.style.display = ok ? 'none' : 'block';
    btn.disabled = !ok;
    if (eBtn) eBtn.disabled = !ok;
    if (status) {
      status.textContent = ok ? 'Casque prêt — vous pouvez lancer la séance' : 'Mode immersif non supporté';
      if (ok) status.classList.add('ready'); else status.classList.remove('ready');
    }
  }).catch(() => { msg.style.display = 'block'; btn.disabled = true; });
}

async function startXRSession() {
  if (!renderer) initThree();
  try {
    xrSession = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor']
    });
  } catch(e) { alert('Impossible de démarrer la session VR : ' + e.message); return; }

  renderer.xr.setReferenceSpaceType('local-floor');
  await renderer.xr.setSession(xrSession);
  $('exit-banner').style.display = 'block';

  xrSession.addEventListener('end', onXRSessionEnd);

  // ── Phase 1 : bilan à l'insu (5 s de mesure neutre avant de révéler l'exercice)
  xrPhase = 'blind';
  activeRuntime = new BlindAssessmentRuntime(EXERCISES[currentExIdx], scene);
  exerciseStatus[currentExIdx] = 'active';
  renderDashboard();

  renderer.setAnimationLoop(renderLoop);
}

function renderLoop() {
  const delta = clock.getDelta();
  if (!activeRuntime) return;

  activeRuntime.update(delta, camera);

  // ── Transition blind → exercise
  if (xrPhase === 'blind' && activeRuntime.finished && !activeRuntime.resultRecorded) {
    activeRuntime.resultRecorded = true;
    recordBlindAssessment(activeRuntime);
    activeRuntime.dispose();

    xrPhase = 'exercise';
    activeRuntime = createExerciseRuntime(EXERCISES[currentExIdx], scene);
  }

  // ── Fin exercice → retour dashboard
  if (xrPhase === 'exercise' && activeRuntime.finished && !activeRuntime.resultRecorded) {
    activeRuntime.resultRecorded = true;
    recordExerciseResult(activeRuntime);
    exerciseStatus[currentExIdx] = 'done';
    setTimeout(() => { if (xrSession) xrSession.end(); }, 1800);
  }

  renderer.render(scene, camera);
}

function onXRSessionEnd() {
  renderer.setAnimationLoop(null);
  $('exit-banner').style.display = 'none';
  if (activeRuntime) { activeRuntime.dispose(); activeRuntime = null; }
  xrPhase = 'idle';
  xrSession = null;
  showScreen('dashboard');
  renderDashboard();
}

/* ──────────────────────────────────────────────────────────────────────
   ENREGISTREMENT DES MESURES
   ────────────────────────────────────────────────────────────────────── */

const BLIND_DURATION = 5; // secondes

function recordBlindAssessment(runtime) {
  const r = runtime.getResult();
  if (!sessionData.blindAssessments) sessionData.blindAssessments = [];
  // On garde une seule mesure à l'insu par exercice par session
  sessionData.blindAssessments = sessionData.blindAssessments.filter(b => b.exerciseId !== EXERCISES[currentExIdx].id);
  sessionData.blindAssessments.push({
    exerciseId: EXERCISES[currentExIdx].id,
    avgOscillation: r.avgOscillation,
    maxAngularVelocity: r.maxAngularVelocity,
    timestamp: new Date().toISOString()
  });
  saveSession();
}

function recordExerciseResult(runtime) {
  const r = runtime.getResult();
  sessionData.entries = sessionData.entries.filter(e => e.exerciseId !== EXERCISES[currentExIdx].id);
  sessionData.entries.push({
    exerciseId: EXERCISES[currentExIdx].id,
    avgOscillation: r.avgOscillation,
    maxAngularVelocity: r.maxAngularVelocity,
    nausea: r.nausea,
    durationSeconds: r.durationSeconds,
    timestamp: new Date().toISOString()
  });
  recalcScores();
  saveSession();
}

/* ──────────────────────────────────────────────────────────────────────
   RUNTIMES D'EXERCICES
   ────────────────────────────────────────────────────────────────────── */

class BaseRuntime {
  constructor(ex, scene) {
    this.ex = ex;
    this.scene = scene;
    this.objects = [];
    this.elapsed = 0;
    this.finished = false;
    this.completed = false;
    this.resultRecorded = false;
    this._oscAccum = 0; this._oscSamples = 0; this._maxAngVel = 0;
    this._lastPos = new THREE.Vector3(); this._lastQuat = new THREE.Quaternion();
    this._trackInit = false;
  }

  _trackHead(camera, delta) {
    if (!this._trackInit) {
      this._lastPos.copy(camera.position);
      this._lastQuat.copy(camera.quaternion);
      this._trackInit = true; return;
    }
    const d = camera.position.distanceTo(this._lastPos) * 100;
    this._oscAccum += d; this._oscSamples++;
    const av = THREE.MathUtils.radToDeg(camera.quaternion.angleTo(this._lastQuat)) / Math.max(delta, 0.0001);
    if (av > this._maxAngVel) this._maxAngVel = av;
    this._lastPos.copy(camera.position);
    this._lastQuat.copy(camera.quaternion);
  }

  update(delta, camera) {
    this.elapsed += delta;
    this._trackHead(camera, delta);
    this.onUpdate(delta, camera);
    if (this.elapsed >= this.ex.duration) { this.finished = true; this.completed = true; }
  }

  onUpdate(delta, camera) {}

  getResult() {
    return {
      avgOscillation: this._oscSamples > 0 ? this._oscAccum / this._oscSamples : 0,
      maxAngularVelocity: this._maxAngVel,
      nausea: 2,
      durationSeconds: this.elapsed
    };
  }

  dispose() { this.objects.forEach(o => this.scene.remove(o)); this.objects = []; }

  _add(mesh) { this.scene.add(mesh); this.objects.push(mesh); return mesh; }

  _sphere(radius, color, emissive) {
    return new THREE.Mesh(
      new THREE.SphereGeometry(radius, 24, 24),
      new THREE.MeshStandardMaterial({ color, emissive: emissive || color, emissiveIntensity: 0.45 })
    );
  }
}

/* Phase aveugle : scène neutre, aucune consigne visuelle */
class BlindAssessmentRuntime extends BaseRuntime {
  constructor(ex, scene) { super({ ...ex, duration: BLIND_DURATION }, scene); }
}

/* Exercice 1 — VOR cible fixe */
class GazeFixedRuntime extends BaseRuntime {
  constructor(ex, scene) {
    super(ex, scene);
    this.target = this._add(this._sphere(0.08, 0x00c9a7));
    this.target.position.set(0, 1.6, -2);
  }
  onUpdate(delta, camera) {
    const to = this.target.position.clone().sub(camera.position).normalize();
    const fwd = new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion);
    const onTarget = THREE.MathUtils.radToDeg(fwd.angleTo(to)) <= 10;
    const col = onTarget ? 0x00c9a7 : 0xffb347;
    this.target.material.color.set(col);
    this.target.material.emissive.set(col);
  }
}

/* Exercice 2 — Poursuite oculaire */
class GazePursuitRuntime extends BaseRuntime {
  constructor(ex, scene) {
    super(ex, scene);
    this.target = this._add(this._sphere(0.08, 0x7b61ff));
  }
  onUpdate(delta, camera) {
    const t = this.elapsed;
    this.target.position.set(Math.sin(t * 0.6) * 1.2, 1.6 + Math.sin(t * 0.4) * 0.35, -2);
  }
}

/* Exercice 3 — Flux optique 360° */
class OpticFlowRuntime extends BaseRuntime {
  constructor(ex, scene) {
    super(ex, scene);
    const cvs = document.createElement('canvas');
    cvs.width = 512; cvs.height = 256;
    const ctx = cvs.getContext('2d');
    ctx.fillStyle = '#0f1e38'; ctx.fillRect(0,0,512,256);
    ctx.strokeStyle = 'rgba(0,201,167,0.35)'; ctx.lineWidth = 2;
    for (let i=0; i<512; i+=32) { ctx.beginPath(); ctx.moveTo(i,0); ctx.lineTo(i,256); ctx.stroke(); }
    for (let j=0; j<256; j+=32) { ctx.beginPath(); ctx.moveTo(0,j); ctx.lineTo(512,j); ctx.stroke(); }
    this.tex = new THREE.CanvasTexture(cvs);
    this.tex.wrapS = this.tex.wrapT = THREE.RepeatWrapping;
    this.tex.repeat.set(4, 2);
    const sphere = this._add(new THREE.Mesh(
      new THREE.SphereGeometry(8, 32, 32),
      new THREE.MeshBasicMaterial({ map: this.tex, side: THREE.BackSide })
    ));
    const anchor = this._add(this._sphere(0.06, 0x00c9a7));
    anchor.position.set(0, 1.6, -1.5);
  }
  onUpdate(delta) {
    this.tex.offset.x += delta * Math.min(this.elapsed / 10, 1) * 0.045;
    this.tex.needsUpdate = true;
  }
}

/* Exercice 4 — Rotations de tête guidées */
class HeadRotationRuntime extends BaseRuntime {
  constructor(ex, scene) {
    super(ex, scene);
    this.targets = [];
    [[-1.5,1.6,-1.8],[1.5,1.6,-1.8],[0,2.1,-1.8],[0,1.2,-1.8]].forEach(p => {
      const m = this._add(this._sphere(0.07, 0x162440, 0x000000));
      m.material.emissiveIntensity = 0;
      m.position.set(...p);
      this.targets.push(m);
    });
    this.activeIdx = -1;
    this.cycleTime = ex.duration / this.targets.length;
    this._activate(0);
  }
  _activate(idx) {
    if (idx === this.activeIdx) return;
    this.targets.forEach((t,i) => {
      const on = i === idx;
      t.material.color.set(on ? 0x3b82f6 : 0x162440);
      t.material.emissive.set(on ? 0x3b82f6 : 0x000000);
      t.material.emissiveIntensity = on ? 0.7 : 0;
    });
    this.activeIdx = idx;
  }
  onUpdate() {
    this._activate(Math.min(Math.floor(this.elapsed / this.cycleTime), this.targets.length - 1));
  }
}

/* Exercice 5 — Équilibre environnement dynamique */
class BalanceRuntime extends BaseRuntime {
  constructor(ex, scene) {
    super(ex, scene);
    this.shapes = [];
    for (let i=0; i<6; i++) {
      const m = this._add(new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.15, 0),
        new THREE.MeshStandardMaterial({ color: 0x7b61ff, transparent: true, opacity: 0.45, wireframe: true })
      ));
      const angle = (i/6)*Math.PI*2;
      m.position.set(Math.cos(angle)*2.2, 1.4 + Math.sin(i)*0.3, Math.sin(angle)*2.2 - 1);
      this.shapes.push({ mesh: m, baseY: m.position.y, phase: i });
    }
    const anchor = this._add(this._sphere(0.08, 0x00c9a7));
    anchor.position.set(0, 1.6, -1.8);
  }
  onUpdate(delta) {
    this.shapes.forEach(s => {
      s.mesh.position.y = s.baseY + Math.sin(this.elapsed * 0.8 + s.phase) * 0.15;
      s.mesh.rotation.y += delta * 0.3;
    });
  }
}

function createExerciseRuntime(ex, scene) {
  return { gaze: GazeFixedRuntime, pursuit: GazePursuitRuntime, opticflow: OpticFlowRuntime,
           rotation: HeadRotationRuntime, balance: BalanceRuntime }[ex.type]
    ? new ({ gaze: GazeFixedRuntime, pursuit: GazePursuitRuntime, opticflow: OpticFlowRuntime,
              rotation: HeadRotationRuntime, balance: BalanceRuntime }[ex.type])(ex, scene)
    : new GazeFixedRuntime(ex, scene);
}

/* ──────────────────────────────────────────────────────────────────────
   ÉVÉNEMENTS UI
   ────────────────────────────────────────────────────────────────────── */

$('back-to-dashboard').addEventListener('click', () => showScreen('dashboard'));
$('start-xr-session-btn').addEventListener('click', startXRSession);
$('export-btn') && $('export-btn').addEventListener('click', exportJSON);

$('enter-vr-btn').addEventListener('click', () => {
  let idx = nextPending();
  if (idx === -1) { alert('Tous les exercices de cette séance sont terminés !'); return; }
  launchExercise(idx);
});

function nextPending() { return exerciseStatus.findIndex(s => s === 'pending'); }

/* ──────────────────────────────────────────────────────────────────────
   INIT
   ────────────────────────────────────────────────────────────────────── */

renderDashboard();
checkXRSupport();
