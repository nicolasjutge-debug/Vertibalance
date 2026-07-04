'use strict';
/* VertiBalance VR v4.4
   Corrections :
   - Continuer sans clé : corrigé définitivement (pas de boucle, pas de guard)
   - QR code → dashboard direct sans repasser par config
   - Icône maskable Lightning Launcher
   - Transfert config iPhone→Quest via URL params
*/

const EXERCISES = [
  {id:'gaze-fixed',   name:'Stabilisation du regard',          sub:'Réflexe vestibulo-oculaire • Calme',           duration:60,difficulty:1,type:'gaze'},
  {id:'gaze-moving',  name:'Poursuite oculaire',               sub:'Coordination oculo-motrice dynamique',          duration:60,difficulty:2,type:'pursuit'},
  {id:'optic-flow',   name:'Flux optique — désensibilisation', sub:'Conflit visuo-vestibulaire • Immersif',         duration:90,difficulty:2,type:'opticflow'},
  {id:'head-rotation',name:'Rotations de tête guidées',        sub:'Adaptation vestibulaire • Cibles',              duration:60,difficulty:2,type:'rotation'},
  {id:'balance-scene',name:'Équilibre dynamique',              sub:'Intégration sensorielle multimodale • 360°',    duration:90,difficulty:3,type:'balance'}
];

const LOCAL_KEY='vb_v44'; const CFG_KEY='vb_cfg_v44'; const JBIN='https://api.jsonbin.io/v3';
const BLIND_DUR=5; const NAUSEA_DELAY=0.4;

/* ── Config ── */
let cfg={};
try{cfg=JSON.parse(localStorage.getItem(CFG_KEY))||{};}catch(e){}
function saveCfg(){localStorage.setItem(CFG_KEY,JSON.stringify(cfg));}

/* ── URL params (QR code) ── */
function applyURLParams(){
  try{
    const p=new URLSearchParams(window.location.search);
    let changed=false;
    if(p.get('k')){cfg.apiKey=p.get('k');changed=true;}
    if(p.get('b')){cfg.binId=p.get('b');changed=true;}
    if(p.get('n')){cfg.patientName=p.get('n');changed=true;}
    if(changed){saveCfg();window.history.replaceState({},'',window.location.pathname);}
    return changed;
  }catch(e){return false;}
}

/* ── Store ── */
function emptyStore(){return{patientName:cfg.patientName||'',binId:cfg.binId||null,sessions:[]};}
function emptySession(n){return{sessionNumber:n,date:new Date().toISOString(),exercises:[],dhiScore:null,postureStability:null};}

let store=emptyStore();
let currentSession=null;
let exerciseStatus=EXERCISES.map(()=>'pending');
let currentExIdx=-1;

/* ── JSONBin ── */
const jbin={
  h(x={}){return{'Content-Type':'application/json','X-Master-Key':cfg.apiKey||'',...x};},
  async create(d){
    const r=await fetch(`${JBIN}/b`,{method:'POST',headers:this.h({'X-Bin-Name':'vertibalance','X-Bin-Private':'true'}),body:JSON.stringify(d)});
    if(!r.ok)throw new Error(r.status);
    return(await r.json()).metadata.id;
  },
  async read(id){
    const r=await fetch(`${JBIN}/b/${id}/latest`,{headers:this.h({'X-Bin-Meta':'false'})});
    if(!r.ok)throw new Error(r.status);
    return r.json();
  },
  async update(id,d){
    const r=await fetch(`${JBIN}/b/${id}`,{method:'PUT',headers:this.h(),body:JSON.stringify(d)});
    if(!r.ok)throw new Error(r.status);
  }
};

async function loadStore(){
  try{const raw=localStorage.getItem(LOCAL_KEY);if(raw)store=JSON.parse(raw);}catch(e){}
  if(cfg.apiKey&&cfg.binId){
    try{
      const cloud=await jbin.read(cfg.binId);
      if(cloud&&cloud.sessions&&cloud.sessions.length>=store.sessions.length){
        store=cloud;store.binId=cfg.binId;
        localStorage.setItem(LOCAL_KEY,JSON.stringify(store));
      }
      setSyncStatus('online');
    }catch(e){setSyncStatus('offline');}
  }else{setSyncStatus('offline');}
}

async function saveStore(){
  localStorage.setItem(LOCAL_KEY,JSON.stringify(store));
  if(!cfg.apiKey)return;
  try{
    if(cfg.binId){await jbin.update(cfg.binId,store);}
    else{const id=await jbin.create(store);cfg.binId=id;store.binId=id;saveCfg();localStorage.setItem(LOCAL_KEY,JSON.stringify(store));}
    setSyncStatus('online');
  }catch(e){setSyncStatus('offline');}
}

function calcScores(s){
  const d=s.exercises.filter(e=>e.post);if(!d.length)return;
  let osc=0,nausea=0;
  d.forEach(e=>{osc+=e.post.osc;nausea+=e.post.nausea;});
  osc/=d.length;nausea/=d.length;
  s.postureStability=Math.max(0,Math.min(100,100-osc*8));
  s.dhiScore=Math.max(0,Math.min(100,nausea*6+(100-s.postureStability)*0.3));
}

function exportJSON(){
  const report={appVersion:'4.4',exportedAt:new Date().toISOString(),
    patient:store.patientName,totalSessions:store.sessions.length,sessions:store.sessions,
    globalTrend:store.sessions.map(s=>({session:s.sessionNumber,date:s.date,
      postureStability:s.postureStability,dhiScore:s.dhiScore}))};
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
  a.download=`vertibalance_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
}

/* ── DOM ── */
const $=id=>document.getElementById(id);
function showScreen(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));$(id).classList.add('active');}
function setSyncStatus(state){
  document.querySelectorAll('.sync-dot').forEach(d=>{d.className='sync-dot '+state;});
  const l=$('sync-label-dash');if(l)l.textContent=state==='online'?'Cloud sync':'Local';
}
function showNotice(msg){
  const n=document.createElement('div');n.className='notice';n.textContent=msg;
  document.body.appendChild(n);setTimeout(()=>n.remove(),4000);
}

function recoverSnapshot(){
  try{
    const raw=localStorage.getItem(LOCAL_KEY);if(!raw)return;
    const saved=JSON.parse(raw);const snap=saved.currentSessionSnapshot;if(!snap)return;
    const already=(saved.sessions||[]).some(s=>s.sessionNumber===snap.sessionNumber);
    if(!already&&snap.exercises&&snap.exercises.some(e=>e.post)){
      currentSession=snap;
      snap.exercises.forEach(e=>{const idx=EXERCISES.findIndex(x=>x.id===e.id);if(idx>=0&&e.post)exerciseStatus[idx]='done';});
      showNotice('Séance interrompue récupérée ✓');
    }
    store=saved;delete store.currentSessionSnapshot;
  }catch(e){}
}

/* ════════════════════════════════════════
   CONFIG
   ════════════════════════════════════════ */
function renderConfig(){
  $('cfg-name').value=cfg.patientName||'';
  $('cfg-api-key').value=cfg.apiKey||'';
  $('cfg-bin-id').value=cfg.binId||'';
  $('cfg-status').textContent=cfg.apiKey?'✓ Clé enregistrée':'Aucune clé — données locales uniquement';
  $('cfg-status').className='cfg-status '+(cfg.apiKey?'ok':'neutral');
}

/* Sauvegarde avec ou sans clé — FONCTION UNIQUE appelée par les deux boutons */
async function doSave(withKey){
  const name=($('cfg-name').value||'').trim();
  if(!name){$('cfg-name').focus();showNotice('Entrez votre prénom.');return;}

  cfg.patientName=name;

  if(withKey){
    const key=($('cfg-api-key').value||'').trim();
    if(!key){$('cfg-api-key').focus();showNotice('Entrez votre clé API.');return;}
    cfg.apiKey=key;
    const binId=($('cfg-bin-id').value||'').trim();
    if(binId)cfg.binId=binId;
  }

  saveCfg();
  store.patientName=name;

  if(withKey){
    $('cfg-status').textContent='⏳ Connexion…';
    await loadStore();
  }

  /* Aller au dashboard DANS TOUS LES CAS */
  if(!currentSession)currentSession=emptySession(store.sessions.length+1);
  renderDashboard();
  checkXRSupport();
  showScreen('dashboard');
}

$('cfg-save-btn').addEventListener('click',()=>doSave(true));
$('cfg-skip-btn').addEventListener('click',()=>doSave(false));
$('cfg-reset-btn').addEventListener('click',()=>{if(!confirm('Réinitialiser ?'))return;cfg={};saveCfg();renderConfig();});

/* ── QR code ── */
function buildConfigURL(){
  const base=window.location.href.split('?')[0];
  const p=new URLSearchParams();
  if(cfg.apiKey)p.set('k',cfg.apiKey);
  if(cfg.binId)p.set('b',cfg.binId);
  if(cfg.patientName)p.set('n',cfg.patientName);
  return base+'?'+p.toString();
}

$('cfg-qr-btn').addEventListener('click',()=>{
  const name=($('cfg-name').value||cfg.patientName||'').trim();
  cfg.patientName=name||'Moi';
  const key=($('cfg-api-key').value||'').trim();
  if(key)cfg.apiKey=key;
  const binId=($('cfg-bin-id').value||'').trim();
  if(binId)cfg.binId=binId;
  saveCfg();
  showQRModal();
});

function showQRModal(){
  document.getElementById('qr-modal')?.remove();
  const url=buildConfigURL();
  const modal=document.createElement('div');
  modal.id='qr-modal';
  modal.innerHTML=`<div class="qr-overlay" id="qr-overlay">
    <div class="qr-box">
      <div class="qr-title">Transférer vers le Quest</div>
      <div class="qr-sub">Sur le Quest : Lightning Launcher → Ajouter un site → taper l'URL manuellement, OU scanner ce QR depuis le Quest Browser.</div>
      <div id="qr-canvas-wrap"></div>
      <div class="qr-url-label">URL à copier :</div>
      <div class="qr-url" id="qr-url-text">${url}</div>
      <div class="qr-hint">⚠️ Contient votre clé API — usage personnel uniquement.</div>
      <button class="btn btn-secondary" id="qr-close-btn" style="margin-top:14px;">Fermer</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  $('qr-close-btn').addEventListener('click',()=>modal.remove());
  $('qr-overlay').addEventListener('click',e=>{if(e.target.id==='qr-overlay')modal.remove();});
  try{
    new QRCode($('qr-canvas-wrap'),{text:url,width:220,height:220,
      colorDark:'#00C9A7',colorLight:'#0F1E38',correctLevel:QRCode.CorrectLevel.M});
  }catch(e){
    $('qr-canvas-wrap').innerHTML='<div style="color:#FF6B6B;font-size:.8rem;padding:16px;">QRCode.js non chargé (connexion requise).</div>';
  }
}

/* ════════════════════════════════════════
   DASHBOARD
   ════════════════════════════════════════ */
function renderDashboard(){
  if(!currentSession)currentSession=emptySession(store.sessions.length+1);
  $('patient-name-label').textContent=store.patientName||'Moi';
  $('session-badge').textContent=`Séance ${currentSession.sessionNumber}`;
  $('total-sessions-label').textContent=`${store.sessions.length} séance${store.sessions.length>1?'s':''} archivée${store.sessions.length>1?'s':''}`;
  const done=exerciseStatus.filter(s=>s==='done').length;
  $('stat-completed').textContent=`${done} / ${EXERCISES.length}`;
  const pct=Math.round((done/EXERCISES.length)*100);
  $('progress-fill').style.width=pct+'%';$('progress-pct').textContent=pct+'%';
  calcScores(currentSession);
  $('stat-stability').textContent=currentSession.postureStability!==null?Math.round(currentSession.postureStability)+'%':'—';
  $('stat-dhi').textContent=currentSession.dhiScore!==null?Math.round(currentSession.dhiScore)+'/100':'—';
  const best=store.sessions.filter(s=>s.postureStability!=null);
  $('stat-best').textContent=best.length?Math.round(Math.max(...best.map(s=>s.postureStability)))+'%':'—';
  ['export-btn','export-btn-bottom'].forEach(id=>{const b=$(id);if(b)b.disabled=done===0&&store.sessions.length===0;});
  renderExerciseList();renderBlindReport();renderHistory();
}

function renderExerciseList(){
  const list=$('exercises-list');list.innerHTML='';
  EXERCISES.forEach((ex,i)=>{
    const st=exerciseStatus[i];
    const item=document.createElement('div');
    item.className='exercise-item'+(st==='active'?' active':'')+(st==='done'?' done':'');
    item.innerHTML=`<div class="ex-number ${st}">${st==='done'?'✓':i+1}</div>
      <div class="ex-info"><div class="ex-name">${ex.name}</div><div class="ex-sub">${ex.sub}</div></div>
      <div class="ex-meta"><div class="ex-duration">${ex.duration}s</div>
      <div class="ex-diff">${'●'.repeat(ex.difficulty)}${'○'.repeat(3-ex.difficulty)}</div>
      <div class="ex-badge ${st==='done'?'termine':st==='active'?'encours':'attente'}">${st==='done'?'Terminé':st==='active'?'En cours':'À venir'}</div></div>`;
    item.addEventListener('click',()=>{if(st!=='done')launchExercise(i);});
    list.appendChild(item);
  });
}

function renderBlindReport(){
  const c=$('blind-report');if(!c)return;
  const exDone=currentSession.exercises.filter(e=>e.blind&&e.post);
  if(!exDone.length){c.style.display='none';return;}
  c.style.display='block';
  let rows='';
  exDone.forEach(e=>{
    const d=e.delta?e.delta.osc:0;
    const trend=d<-0.005?'↓ Amélioration':d>0.005?'↑ Augmentation':'→ Stable';
    const tc=d<-0.005?'trend-good':d>0.005?'trend-bad':'trend-neutral';
    const exDef=EXERCISES.find(x=>x.id===e.id);
    rows+=`<tr><td>${exDef?exDef.name:e.id}</td><td>${e.blind.osc.toFixed(3)}</td><td>${e.post.osc.toFixed(3)}</td><td class="${tc}">${trend}</td></tr>`;
  });
  c.innerHTML=`<div class="section-title">Bilan à l'insu</div>
    <div class="blind-info">Oscillation pré (aveugle 5s) vs post. Négatif = amélioration.</div>
    <table class="blind-table"><thead><tr><th>Exercice</th><th>Pré</th><th>Post</th><th>Tendance</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function renderHistory(){
  const c=$('history-section');if(!c)return;
  if(!store.sessions.length){c.style.display='none';return;}
  c.style.display='block';
  const sessions=store.sessions;const n=sessions.length;
  const W=320,H=80,pad=10;
  function polyline(vals,color){
    if(vals.length<2)return'';
    const pts=vals.map((v,i)=>{
      const x=pad+(i/(n-1||1))*(W-pad*2);
      const y=H-pad-(v/100)*(H-pad*2);
      return`${x},${y}`;
    }).join(' ');
    const lx=pad+((n-1)/(n-1||1))*(W-pad*2);
    const ly=H-pad-(vals[n-1]/100)*(H-pad*2);
    return`<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>
      <circle cx="${lx}" cy="${ly}" r="4" fill="${color}"/>`;
  }
  const stabVals=sessions.map(s=>s.postureStability||0);
  const svg=`<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
    ${sessions.map((_,i)=>`<line x1="${pad+(i/(n-1||1))*(W-pad*2)}" y1="${pad}" x2="${pad+(i/(n-1||1))*(W-pad*2)}" y2="${H-pad}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>`).join('')}
    ${polyline(stabVals,'#00C9A7')}
    ${sessions.map((s,i)=>`<text x="${pad+(i/(n-1||1))*(W-pad*2)}" y="${H+4}" fill="#6B8FA8" font-size="9" text-anchor="middle">${i+1}</text>`).join('')}
  </svg>`;
  const rows=[...sessions].reverse().map(s=>`<tr>
    <td>${s.sessionNumber}</td><td>${new Date(s.date).toLocaleDateString('fr-FR')}</td>
    <td style="color:var(--teal);font-weight:600">${s.postureStability!=null?Math.round(s.postureStability)+'%':'—'}</td>
    <td style="color:var(--violet);font-weight:600">${s.dhiScore!=null?Math.round(s.dhiScore):'—'}</td>
    <td>${s.exercises.filter(e=>e.post).length}/${EXERCISES.length}</td></tr>`).join('');
  c.innerHTML=`<div class="section-title">Historique (${n} séance${n>1?'s':''})</div>
    <div class="history-card">
      <div class="chart-label">Stabilité posturale (%)</div>
      <div class="sparkline-big">${svg}</div>
      <table class="history-table"><thead><tr><th>Séance</th><th>Date</th><th>Stabilité</th><th>DHI</th><th>Exercices</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>`;
}

/* ── Navigation ── */
$('open-config-from-dash').addEventListener('click',()=>{renderConfig();showScreen('config');});
$('back-to-dashboard').addEventListener('click',()=>showScreen('dashboard'));
$('export-btn').addEventListener('click',exportJSON);
$('export-btn-bottom').addEventListener('click',exportJSON);
$('new-session-btn').addEventListener('click',()=>{
  if(exerciseStatus.some(s=>s==='done')){if(!confirm('Archiver et nouvelle séance ?'))return;finalizeSession();}
  startNewSession();
});
$('enter-vr-btn').addEventListener('click',()=>{
  const idx=exerciseStatus.findIndex(s=>s==='pending');
  if(idx===-1){alert('Tous les exercices sont terminés !');return;}
  launchExercise(idx);
});

function startNewSession(){
  currentSession=emptySession(store.sessions.length+1);
  exerciseStatus=EXERCISES.map(()=>'pending');
  renderDashboard();
}

async function finalizeSession(){
  if(!currentSession||!currentSession.exercises.some(e=>e.post))return;
  calcScores(currentSession);store.sessions.push(currentSession);await saveStore();
}

function launchExercise(index){
  currentExIdx=index;
  const ex=EXERCISES[index];
  $('vr-exercise-name').textContent=ex.name;
  $('vr-exercise-desc').textContent={
    gaze:     'Gardez le regard fixé sur la sphère turquoise en tournant doucement la tête.',
    pursuit:  'Suivez la cible des yeux, puis avec de légers mouvements de tête.',
    opticflow:'Restez stable pendant que l\'environnement défile. Respirez calmement.',
    rotation: 'Tournez la tête vers chaque cible lumineuse, corps stable.',
    balance:  'Maintenez votre équilibre dans un environnement qui change.'
  }[ex.type]||'';
  showScreen('vr-screen');checkXRSupport();
}

/* ════════════════════════════════════════
   WEBXR + THREE.JS
   ════════════════════════════════════════ */
let renderer,scene,camera,xrSession=null,clock;
let activeRuntime=null,xrPhase='idle';
let currentNausea=5,nauseaDebounce=0,hudGroup=null;

function buildHUD(sc){
  hudGroup=new THREE.Group();
  function sp(w,h,scale){
    const cv=document.createElement('canvas');cv.width=w;cv.height=h;
    const tex=new THREE.CanvasTexture(cv);
    const mat=new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false});
    const s=new THREE.Sprite(mat);s.scale.set(scale,scale*(h/w),1);s.renderOrder=999;
    return{s,cv,ctx:cv.getContext('2d'),tex};
  }
  const bg=sp(512,180,0.75);bg.s.renderOrder=998;
  bg.ctx.fillStyle='rgba(10,22,40,0.85)';bg.ctx.roundRect(0,0,512,180,16);bg.ctx.fill();
  bg.ctx.strokeStyle='rgba(0,201,167,0.4)';bg.ctx.lineWidth=2;bg.ctx.roundRect(1,1,510,178,15);bg.ctx.stroke();
  bg.tex.needsUpdate=true;hudGroup.add(bg.s);
  hudGroup._ex=sp(460,44,0.58);hudGroup._ex.s.position.set(0,0.09,0.01);hudGroup.add(hudGroup._ex.s);
  hudGroup._timer=sp(240,38,0.38);hudGroup._timer.s.position.set(-0.1,0.03,0.01);hudGroup.add(hudGroup._timer.s);
  hudGroup._naus=sp(240,38,0.38);hudGroup._naus.s.position.set(0.12,0.03,0.01);hudGroup.add(hudGroup._naus.s);
  hudGroup._instr=sp(400,34,0.36);hudGroup._instr.s.position.set(0,-0.03,0.01);hudGroup.add(hudGroup._instr.s);
  hudGroup._phase=sp(300,30,0.30);hudGroup._phase.s.position.set(0,-0.078,0.01);hudGroup.add(hudGroup._phase.s);
  function txt(e,t,c,f){e.ctx.clearRect(0,0,e.cv.width,e.cv.height);e.ctx.font=f||'500 22px Inter,sans-serif';
    e.ctx.fillStyle=c||'#E8F4F8';e.ctx.textAlign='center';e.ctx.textBaseline='middle';
    e.ctx.fillText(t,e.cv.width/2,e.cv.height/2);e.tex.needsUpdate=true;}
  txt(hudGroup._instr,'A ↑  B ↓  nausée  •  Menu = STOP','#6B8FA8','500 17px Inter,sans-serif');
  hudGroup._txt=txt;hudGroup.position.set(0,1.55,-1.2);sc.add(hudGroup);
}

function updateHUD(exName,elapsed,duration,nausea,phase){
  if(!hudGroup)return;
  const txt=hudGroup._txt;
  const rem=Math.max(0,Math.ceil(duration-elapsed));
  const mm=String(Math.floor(rem/60)).padStart(2,'0');const ss=String(rem%60).padStart(2,'0');
  const nc=nausea<=3?'#00C9A7':nausea<=6?'#FFB347':'#FF6B6B';
  txt(hudGroup._ex,exName,'#00C9A7','600 22px Inter,sans-serif');
  txt(hudGroup._timer,`⏱ ${mm}:${ss}`,'#E8F4F8','500 20px Inter,sans-serif');
  txt(hudGroup._naus,`Nausée ${nausea}/10`,nc,'600 20px Inter,sans-serif');
  txt(hudGroup._phase,phase==='blind'?'Mesure référence (5s)':'Exercice en cours','#7B61FF','500 16px Inter,sans-serif');
  if(camera){
    const dir=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion);
    const up=new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion);
    hudGroup.position.copy(camera.position).addScaledVector(dir,1.2).addScaledVector(up,-0.18);
    hudGroup.quaternion.copy(camera.quaternion);
  }
}
function removeHUD(){if(!hudGroup)return;scene.remove(hudGroup);hudGroup=null;}

function pollGamepad(dt){
  if(!xrSession)return;
  nauseaDebounce=Math.max(0,nauseaDebounce-dt);if(nauseaDebounce>0)return;
  for(const src of xrSession.inputSources){
    if(!src.gamepad)continue;
    const gp=src.gamepad;
    if(src.handedness==='right'){
      if(gp.buttons[4]?.pressed){currentNausea=Math.min(10,currentNausea+1);nauseaDebounce=NAUSEA_DELAY;break;}
      if(gp.buttons[5]?.pressed){currentNausea=Math.max(0,currentNausea-1);nauseaDebounce=NAUSEA_DELAY;break;}
    }
    if(src.handedness==='left'&&gp.buttons[6]?.pressed){emergencyStop();break;}
  }
}

function emergencyStop(){
  if(activeRuntime&&xrPhase==='exercise'){
    const r=activeRuntime.getResult();
    let ex=currentSession.exercises.find(e=>e.id===EXERCISES[currentExIdx].id);
    if(!ex){ex={id:EXERCISES[currentExIdx].id,blind:null,post:null,delta:null};currentSession.exercises.push(ex);}
    ex.post={osc:r.avgOscillation,angVel:r.maxAngularVelocity,nausea:currentNausea,duration:r.durationSeconds,aborted:true};
    if(ex.blind)ex.delta={osc:r.avgOscillation-ex.blind.osc,angVel:r.maxAngularVelocity-ex.blind.angVel};
    calcScores(currentSession);
    const snap=JSON.parse(JSON.stringify(store));snap.currentSessionSnapshot=currentSession;
    localStorage.setItem(LOCAL_KEY,JSON.stringify(snap));
  }
  if(xrSession)xrSession.end();
}

function initThree(){
  const canvas=$('xr-canvas');
  renderer=new THREE.WebGLRenderer({canvas,antialias:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  renderer.setSize(window.innerWidth,window.innerHeight);
  renderer.xr.enabled=true;
  scene=new THREE.Scene();scene.background=new THREE.Color(0x0a1628);
  camera=new THREE.PerspectiveCamera(70,window.innerWidth/window.innerHeight,0.05,100);
  scene.add(camera);
  scene.add(new THREE.AmbientLight(0xffffff,0.6));
  const d=new THREE.DirectionalLight(0xffffff,0.6);d.position.set(1,2,1);scene.add(d);
  for(let r=0.5;r<=3;r+=0.5){
    const m=new THREE.Mesh(new THREE.RingGeometry(r-.006,r,64),
      new THREE.MeshBasicMaterial({color:0x00c9a7,side:THREE.DoubleSide,transparent:true,opacity:0.08}));
    m.rotation.x=-Math.PI/2;scene.add(m);
  }
  clock=new THREE.Clock();
  window.addEventListener('resize',()=>{if(!camera||!renderer)return;camera.aspect=window.innerWidth/window.innerHeight;camera.updateProjectionMatrix();renderer.setSize(window.innerWidth,window.innerHeight);});
}

function checkXRSupport(){
  const btn=$('start-xr-session-btn'),eBtn=$('enter-vr-btn'),msg=$('xr-unsupported-msg'),st=$('xr-status');
  if(!navigator.xr){if(msg)msg.style.display='block';if(btn)btn.disabled=true;if(eBtn)eBtn.disabled=true;if(st){st.textContent='WebXR non disponible';st.classList.remove('ready');}return;}
  navigator.xr.isSessionSupported('immersive-vr').then(ok=>{
    if(msg)msg.style.display=ok?'none':'block';
    if(btn)btn.disabled=!ok;if(eBtn)eBtn.disabled=!ok;
    if(st){st.textContent=ok?'Casque prêt':'Non supporté';if(ok)st.classList.add('ready');else st.classList.remove('ready');}
  }).catch(()=>{if(msg)msg.style.display='block';if(btn)btn.disabled=true;});
}

$('start-xr-session-btn').addEventListener('click',startXRSession);

async function startXRSession(){
  if(!renderer)initThree();
  try{xrSession=await navigator.xr.requestSession('immersive-vr',{optionalFeatures:['local-floor','bounded-floor']});}
  catch(e){alert('Impossible de démarrer : '+e.message);return;}
  renderer.xr.setReferenceSpaceType('local-floor');
  await renderer.xr.setSession(xrSession);
  $('exit-banner').style.display='block';
  xrSession.addEventListener('end',onXRSessionEnd);
  currentNausea=5;nauseaDebounce=0;buildHUD(scene);
  xrPhase='blind';
  activeRuntime=new BlindRuntime(EXERCISES[currentExIdx],scene);
  exerciseStatus[currentExIdx]='active';
  renderer.setAnimationLoop(renderLoop);
}

function renderLoop(){
  const dt=clock.getDelta();if(!activeRuntime)return;
  activeRuntime.update(dt,camera);
  pollGamepad(dt);
  updateHUD(EXERCISES[currentExIdx]?.name||'',activeRuntime.elapsed,activeRuntime.ex.duration,currentNausea,xrPhase);

  if(xrPhase==='blind'&&activeRuntime.finished&&!activeRuntime.resultRecorded){
    activeRuntime.resultRecorded=true;
    const br=activeRuntime.getResult();
    let ex=currentSession.exercises.find(e=>e.id===EXERCISES[currentExIdx].id);
    if(!ex){ex={id:EXERCISES[currentExIdx].id,blind:null,post:null,delta:null};currentSession.exercises.push(ex);}
    ex.blind={osc:br.avgOscillation,angVel:br.maxAngularVelocity};
    activeRuntime.dispose();xrPhase='exercise';currentNausea=5;
    activeRuntime=createRuntime(EXERCISES[currentExIdx],scene);
  }

  if(xrPhase==='exercise'&&activeRuntime.finished&&!activeRuntime.resultRecorded){
    activeRuntime.resultRecorded=true;
    const pr=activeRuntime.getResult();
    let ex=currentSession.exercises.find(e=>e.id===EXERCISES[currentExIdx].id);
    if(!ex){ex={id:EXERCISES[currentExIdx].id,blind:null,post:null,delta:null};currentSession.exercises.push(ex);}
    ex.post={osc:pr.avgOscillation,angVel:pr.maxAngularVelocity,nausea:currentNausea,duration:pr.durationSeconds};
    if(ex.blind)ex.delta={osc:pr.avgOscillation-ex.blind.osc,angVel:pr.maxAngularVelocity-ex.blind.angVel};
    exerciseStatus[currentExIdx]='done';
    calcScores(currentSession);
    const snap=JSON.parse(JSON.stringify(store));snap.currentSessionSnapshot=currentSession;
    localStorage.setItem(LOCAL_KEY,JSON.stringify(snap));
    if(exerciseStatus.every(s=>s==='done')){
      store.sessions.push(currentSession);saveStore();
      currentSession=emptySession(store.sessions.length+1);
      exerciseStatus=EXERCISES.map(()=>'pending');
    }
    setTimeout(()=>{if(xrSession)xrSession.end();},1800);
  }
  renderer.render(scene,camera);
}

function onXRSessionEnd(){
  renderer.setAnimationLoop(null);$('exit-banner').style.display='none';
  if(activeRuntime){activeRuntime.dispose();activeRuntime=null;}
  removeHUD();xrPhase='idle';xrSession=null;
  renderDashboard();showScreen('dashboard');
}

/* ── Runtimes ── */
class BaseRuntime{
  constructor(ex,sc){this.ex=ex;this.scene=sc;this.objects=[];this.elapsed=0;this.finished=false;this.completed=false;this.resultRecorded=false;this._oA=0;this._oS=0;this._mA=0;this._lP=new THREE.Vector3();this._lQ=new THREE.Quaternion();this._ti=false;}
  _th(cam,dt){if(!this._ti){this._lP.copy(cam.position);this._lQ.copy(cam.quaternion);this._ti=true;return;}this._oA+=cam.position.distanceTo(this._lP)*100;this._oS++;const av=THREE.MathUtils.radToDeg(cam.quaternion.angleTo(this._lQ))/Math.max(dt,0.0001);if(av>this._mA)this._mA=av;this._lP.copy(cam.position);this._lQ.copy(cam.quaternion);}
  update(dt,cam){this.elapsed+=dt;this._th(cam,dt);this.onUpdate(dt,cam);if(this.elapsed>=this.ex.duration){this.finished=true;this.completed=true;}}
  onUpdate(dt,cam){}
  getResult(){return{avgOscillation:this._oS>0?this._oA/this._oS:0,maxAngularVelocity:this._mA,nausea:currentNausea,durationSeconds:this.elapsed};}
  dispose(){this.objects.forEach(o=>this.scene.remove(o));this.objects=[];}
  _add(m){this.scene.add(m);this.objects.push(m);return m;}
  _sph(r,c){return new THREE.Mesh(new THREE.SphereGeometry(r,24,24),new THREE.MeshStandardMaterial({color:c,emissive:c,emissiveIntensity:0.45}));}
}
class BlindRuntime extends BaseRuntime{constructor(ex,sc){super({...ex,duration:BLIND_DUR},sc);}}
class GazeFixedRuntime extends BaseRuntime{
  constructor(ex,sc){super(ex,sc);this.t=this._add(this._sph(0.08,0x00c9a7));this.t.position.set(0,1.6,-2);}
  onUpdate(dt,cam){const to=this.t.position.clone().sub(cam.position).normalize();const fw=new THREE.Vector3(0,0,-1).applyQuaternion(cam.quaternion);const col=THREE.MathUtils.radToDeg(fw.angleTo(to))<=10?0x00c9a7:0xffb347;this.t.material.color.set(col);this.t.material.emissive.set(col);}
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
    this.ai=-1;this.ct=this.ex.duration/this.tgts.length;this._act(0);
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
function createRuntime(ex,sc){
  return new({gaze:GazeFixedRuntime,pursuit:GazePursuitRuntime,opticflow:OpticFlowRuntime,rotation:HeadRotationRuntime,balance:BalanceRuntime}[ex.type]||GazeFixedRuntime)(ex,sc);
}

/* ════════════════════════════════════════
   INIT
   ════════════════════════════════════════ */
async function init(){
  const fromQR=applyURLParams();
  await loadStore();
  recoverSnapshot();
  if(!currentSession)currentSession=emptySession(store.sessions.length+1);

  if(fromQR&&cfg.patientName){
    /* QR code scanné → dashboard direct */
    store.patientName=cfg.patientName;
    renderDashboard();checkXRSupport();showScreen('dashboard');
  } else if(!cfg.patientName){
    /* Premier lancement → config */
    renderConfig();showScreen('config');
  } else {
    /* Retour normal → dashboard */
    store.patientName=cfg.patientName;
    renderDashboard();checkXRSupport();showScreen('dashboard');
  }
  setSyncStatus(cfg.apiKey?'online':'offline');
}
init();
