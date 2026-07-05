'use strict';
/* VertiBalance VR v4.5
   Simplifications :
   - Config : UNE SEULE case (Master Key JSONBin)
   - Bin ID géré automatiquement, invisible pour l'utilisateur
   - "Continuer sans clé" → dashboard immédiat garanti
   - Transfert Quest : bouton "Envoyer par email/message"
   - QR code conservé en bonus
*/

const EXERCISES = [
  {id:'gaze-fixed',   name:'Stabilisation du regard',          sub:'Réflexe vestibulo-oculaire • Calme',        duration:60,difficulty:1,type:'gaze'},
  {id:'gaze-moving',  name:'Poursuite oculaire',               sub:'Coordination oculo-motrice dynamique',       duration:60,difficulty:2,type:'pursuit'},
  {id:'optic-flow',   name:'Flux optique — désensibilisation', sub:'Conflit visuo-vestibulaire • Immersif',      duration:90,difficulty:2,type:'opticflow'},
  {id:'head-rotation',name:'Rotations de tête guidées',        sub:'Adaptation vestibulaire • Cibles',           duration:60,difficulty:2,type:'rotation'},
  {id:'balance-scene',name:'Équilibre dynamique',              sub:'Intégration sensorielle multimodale • 360°', duration:90,difficulty:3,type:'balance'}
];

const LOCAL_KEY='vb_v45'; const CFG_KEY='vb_cfg_v45';
const JBIN='https://api.jsonbin.io/v3';
const BLIND_DUR=5; const NAUSEA_DELAY=0.4;

let cfg={};
try{cfg=JSON.parse(localStorage.getItem(CFG_KEY))||{};}catch(e){}
function saveCfg(){localStorage.setItem(CFG_KEY,JSON.stringify(cfg));}

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

function emptyStore(){return{patientName:cfg.patientName||'Moi',binId:cfg.binId||null,sessions:[]};}
function emptySession(n){return{sessionNumber:n,date:new Date().toISOString(),exercises:[],dhiScore:null,postureStability:null};}

let store=emptyStore();
let currentSession=null;
let exerciseStatus=EXERCISES.map(()=>'pending');
let currentExIdx=-1;

const jbin={
  h(x={}){return{'Content-Type':'application/json','X-Master-Key':cfg.apiKey||'',...x};},
  async create(d){
    const r=await fetch(`${JBIN}/b`,{method:'POST',
      headers:this.h({'X-Bin-Name':'vertibalance','X-Bin-Private':'true'}),
      body:JSON.stringify(d)});
    if(!r.ok)throw new Error(r.status);
    const id=(await r.json()).metadata.id;
    cfg.binId=id; saveCfg();
    return id;
  },
  async read(id){
    const r=await fetch(`${JBIN}/b/${id}/latest`,
      {headers:this.h({'X-Bin-Meta':'false'})});
    if(!r.ok)throw new Error(r.status);
    return r.json();
  },
  async update(id,d){
    const r=await fetch(`${JBIN}/b/${id}`,
      {method:'PUT',headers:this.h(),body:JSON.stringify(d)});
    if(!r.ok)throw new Error(r.status);
  }
};

async function loadStore(){
  try{const raw=localStorage.getItem(LOCAL_KEY);if(raw)store=JSON.parse(raw);}catch(e){}
  if(cfg.apiKey&&cfg.binId){
    try{
      const cloud=await jbin.read(cfg.binId);
      if(cloud&&cloud.sessions&&cloud.sessions.length>=store.sessions.length){
        store=cloud; store.binId=cfg.binId;
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
    if(cfg.binId){
      await jbin.update(cfg.binId,store);
    }else{
      const id=await jbin.create(store);
      store.binId=id;
      localStorage.setItem(LOCAL_KEY,JSON.stringify(store));
    }
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
  const report={appVersion:'4.5',exportedAt:new Date().toISOString(),
    patient:store.patientName,totalSessions:store.sessions.length,sessions:store.sessions,
    globalTrend:store.sessions.map(s=>({session:s.sessionNumber,date:s.date,
      postureStability:s.postureStability,dhiScore:s.dhiScore}))};
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
  a.download=`vertibalance_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
}

const $=id=>document.getElementById(id);
function showScreen(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));$(id).classList.add('active');}
function setSyncStatus(state){
  document.querySelectorAll('.sync-dot').forEach(d=>d.className='sync-dot '+state);
  const l=$('sync-label-dash');if(l)l.textContent=state==='online'?'☁ Cloud sync':'○ Local';
}
function showNotice(msg,color){
  document.querySelectorAll('.notice').forEach(n=>n.remove());
  const n=document.createElement('div');
  n.className='notice'; n.textContent=msg;
  if(color)n.style.background=color==='red'?'rgba(255,107,107,.15)':'rgba(0,201,167,.15)';
  document.body.appendChild(n);
  setTimeout(()=>n.remove(),4000);
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

function renderConfig(){
  $('cfg-name').value=cfg.patientName||'';
  $('cfg-api-key').value=cfg.apiKey||'';
  if(cfg.apiKey&&cfg.binId){
    $('cfg-status').textContent='✓ Connecté — synchronisation cloud active';
    $('cfg-status').className='cfg-status ok';
  }else if(cfg.apiKey){
    $('cfg-status').textContent='⏳ Clé saisie — bin sera créé au premier exercice';
    $('cfg-status').className='cfg-status ok';
  }else{
    $('cfg-status').textContent='Aucune clé — données sauvegardées localement';
    $('cfg-status').className='cfg-status neutral';
  }
}

async function goToDashboard(saveKey){
  const name=($('cfg-name').value||'').trim()||'Moi';
  cfg.patientName=name;
  if(saveKey){
    const key=($('cfg-api-key').value||'').trim();
    if(key){
      cfg.apiKey=key;
      $('cfg-status').textContent='⏳ Connexion…';
      $('cfg-save-btn').disabled=true;
    }
  }
  saveCfg();
  store.patientName=name;
  if(saveKey&&cfg.apiKey){
    await loadStore();
    $('cfg-save-btn').disabled=false;
  }
  if(!currentSession)currentSession=emptySession(store.sessions.length+1);
  renderDashboard();
  checkXRSupport();
  showScreen('dashboard');
}

$('cfg-save-btn').addEventListener('click',()=>goToDashboard(true));
$('cfg-skip-btn').addEventListener('click',()=>goToDashboard(false));
$('cfg-reset-btn').addEventListener('click',()=>{
  if(!confirm('Réinitialiser la configuration ?'))return;
  cfg={};saveCfg();renderConfig();
});

function buildConfigURL(){
  const base=window.location.href.split('?')[0];
  const p=new URLSearchParams();
  if(cfg.apiKey)p.set('k',cfg.apiKey);
  if(cfg.binId)p.set('b',cfg.binId);
  if(cfg.patientName)p.set('n',cfg.patientName);
  return base+'?'+p.toString();
}

$('cfg-share-btn').addEventListener('click',()=>{
  const name=($('cfg-name').value||'').trim()||'Moi';
  cfg.patientName=name;
  const key=($('cfg-api-key').value||'').trim();
  if(key)cfg.apiKey=key;
  saveCfg();
  showShareModal();
});

function showShareModal(){
  document.getElementById('share-modal')?.remove();
  const url=buildConfigURL();
  const hasKey=!!cfg.apiKey;
  const modal=document.createElement('div');
  modal.id='share-modal';
  modal.innerHTML=`<div class="qr-overlay" id="share-overlay"><div class="qr-box">
        <div class="qr-title">🥽 Transférer vers le Quest</div>
        <div class="share-methods">
          <button class="share-method-btn" id="share-email-btn"><span>✉️ Email</span></button>
          <button class="share-method-btn" id="share-sms-btn"><span>💬 SMS</span></button>
        </div>
        <div id="qr-canvas-wrap" style="display:flex;justify-content:center;margin:10px 0;"></div>
        <div class="qr-url-box">
          <div class="qr-url-text">${url.length>60?url.slice(0,57)+'…':url}</div>
          <button class="qr-copy-btn" id="qr-copy-btn">Copier</button>
        </div>
        <button class="btn" id="share-close-btn" style="margin-top:12px;">Fermer</button>
      </div></div>`;
  document.body.appendChild(modal);
  $('share-close-btn').addEventListener('click',()=>modal.remove());
  $('share-email-btn').addEventListener('click',()=>{window.open(`mailto:?subject=VertiBalance&body=${encodeURIComponent(url)}`);});
  $('share-sms-btn').addEventListener('click',()=>{window.open(`sms:&body=${encodeURIComponent(url)}`);});
  try{new QRCode($('qr-canvas-wrap'),{text:url,width:150,height:150});}catch(e){}
  const copyBtn=document.getElementById('qr-copy-btn');
  if(copyBtn){copyBtn.addEventListener('click',()=>{navigator.clipboard.writeText(url);copyBtn.textContent='✓ Copié !';});}
}

function renderDashboard(){
  if(!currentSession)currentSession=emptySession(store.sessions.length+1);
  $('patient-name-label').textContent=store.patientName||'Moi';
  $('session-badge').textContent=`Séance ${currentSession.sessionNumber}`;
  $('total-sessions-label').textContent=`${store.sessions.length} séances archivées`;
  const done=exerciseStatus.filter(s=>s==='done').length;
  $('stat-completed').textContent=`${done} / ${EXERCISES.length}`;
  const pct=Math.round((done/EXERCISES.length)*100);
  $('progress-fill').style.width=pct+'%'; $('progress-pct').textContent=pct+'%';
  calcScores(currentSession);
  $('stat-stability').textContent=currentSession.postureStability!==null?Math.round(currentSession.postureStability)+'%':'—';
  $('stat-dhi').textContent=currentSession.dhiScore!==null?Math.round(currentSession.dhiScore)+'/100':'—';
  const best=store.sessions.filter(s=>s.postureStability!=null);
  $('stat-best').textContent=best.length?Math.round(Math.max(...best.map(s=>s.postureStability)))+'%':'—';
  renderExerciseList(); renderBlindReport(); renderHistory();
}

function renderExerciseList(){
  const list=$('exercises-list'); list.innerHTML='';
  EXERCISES.forEach((ex,i)=>{
    const st=exerciseStatus[i];
    const item=document.createElement('div');
    item.className='exercise-item'+(st==='active'?' active':'')+(st==='done'?' done':'');
    item.innerHTML=`<div class="ex-info"><div class="ex-name">${ex.name}</div></div>`;
    item.addEventListener('click',()=>{if(st!=='done')launchExercise(i);});
    list.appendChild(item);
  });
}

function renderBlindReport(){
  const c=$('blind-report'); if(!c)return;
  const exDone=currentSession.exercises.filter(e=>e.blind&&e.post);
  if(!exDone.length){c.style.display='none';return;}
  c.style.display='block';
  let rows='';
  exDone.forEach(e=>{
    const d=e.delta?e.delta.osc:0;
    const trend=d<-0.005?'↓':d>0.005?'↑':'→';
    rows+=`<tr><td>${e.id}</td><td>${e.blind.osc.toFixed(3)}</td><td>${e.post.osc.toFixed(3)}</td><td>${trend}</td></tr>`;
  });
  c.innerHTML=`<table style="width:100%;text-align:left;"><tr><th>Ex</th><th>Pré</th><th>Post</th><th>Delta</th></tr>${rows}</table>`;
}

function renderHistory(){
  const c=$('history-section'); if(!c)return;
  if(!store.sessions.length){c.style.display='none';return;}
  c.style.display='block';
  const rows=[...store.sessions].reverse().map(s=>`<tr><td>${s.sessionNumber}</td><td>${s.postureStability!=null?Math.round(s.postureStability)+'%':'—'}</td></tr>`).join('');
  c.innerHTML=`<table style="width:100%;text-align:left;"><tr><th>Session</th><th>Stabilité</th></tr>${rows}</table>`;
}

$('open-config-from-dash').addEventListener('click',()=>{renderConfig();showScreen('config');});
$('back-to-dashboard').addEventListener('click',()=>showScreen('dashboard'));
$('export-btn').addEventListener('click',exportJSON);
$('new-session-btn').addEventListener('click',()=>{startNewSession();});
$('enter-vr-btn').addEventListener('click',()=>{
  const idx=exerciseStatus.findIndex(s=>s==='pending');
  if(idx===-1){alert('Tous terminés !');return;}
  launchExercise(idx);
});

function startNewSession(){
  currentSession=emptySession(store.sessions.length+1);
  exerciseStatus=EXERCISES.map(()=>'pending');
  renderDashboard();
}

async function finalizeSession(){
  if(!currentSession||!currentSession.exercises.some(e=>e.post))return;
  calcScores(currentSession); store.sessions.push(currentSession); await saveStore();
}

function launchExercise(index){
  currentExIdx=index;
  $('vr-exercise-name').textContent=EXERCISES[index].name;
  showScreen('vr-screen'); checkXRSupport();
}

let renderer,scene,camera,xrSession=null,clock;
let activeRuntime=null,xrPhase='idle';
let currentNausea=5,nauseaDebounce=0,hudGroup=null;

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
  }
}

function initThree(){
  const canvas=$('xr-canvas');
  renderer=new THREE.WebGLRenderer({canvas,antialias:true});
  renderer.setSize(window.innerWidth,window.innerHeight);
  renderer.xr.enabled=true;
  scene=new THREE.Scene();scene.background=new THREE.Color(0x0a1628);
  camera=new THREE.PerspectiveCamera(70,window.innerWidth/window.innerHeight,0.05,100);
  scene.add(camera);
  clock=new THREE.Clock();
}

function checkXRSupport(){
  const btn=$('start-xr-session-btn'),msg=$('xr-unsupported-msg');
  if(!navigator.xr){if(msg)msg.style.display='block';if(btn)btn.disabled=true;return;}
  navigator.xr.isSessionSupported('immersive-vr').then(ok=>{
    if(msg)msg.style.display=ok?'none':'block';
    if(btn)btn.disabled=!ok;
  });
}

$('start-xr-session-btn').addEventListener('click',startXRSession);

async function startXRSession(){
  if(!renderer)initThree();
  try{xrSession=await navigator.xr.requestSession('immersive-vr',{optionalFeatures:['local-floor','bounded-floor']});}
  catch(e){alert('Erreur: '+e.message);return;}
  await renderer.xr.setSession(xrSession);
  xrSession.addEventListener('end',onXRSessionEnd);
  xrPhase='blind';
  activeRuntime=new BlindRuntime(EXERCISES[currentExIdx],scene);
  exerciseStatus[currentExIdx]='active';
  renderer.setAnimationLoop(renderLoop);
}

function renderLoop(){
  const dt=clock.getDelta();if(!activeRuntime)return;
  activeRuntime.update(dt,camera);
  pollGamepad(dt);
  if(xrPhase==='blind'&&activeRuntime.finished){
    const br=activeRuntime.getResult();
    let ex=currentSession.exercises.find(e=>e.id===EXERCISES[currentExIdx].id);
    if(!ex){ex={id:EXERCISES[currentExIdx].id};currentSession.exercises.push(ex);}
    ex.blind={osc:br.avgOscillation};
    activeRuntime.dispose();xrPhase='exercise';
    activeRuntime=createRuntime(EXERCISES[currentExIdx],scene);
  }
  if(xrPhase==='exercise'&&activeRuntime.finished){
    const pr=activeRuntime.getResult();
    let ex=currentSession.exercises.find(e=>e.id===EXERCISES[currentExIdx].id);
    ex.post={osc:pr.avgOscillation,nausea:currentNausea};
    exerciseStatus[currentExIdx]='done';
    if(exerciseStatus.every(s=>s==='done')){store.sessions.push(currentSession);saveStore();}
    setTimeout(()=>{if(xrSession)xrSession.end();},1000);
  }
  renderer.render(scene,camera);
}

function onXRSessionEnd(){
  renderer.setAnimationLoop(null);
  if(activeRuntime){activeRuntime.dispose();activeRuntime=null;}
  xrPhase='idle';xrSession=null;
  renderDashboard();showScreen('dashboard');
}

class BaseRuntime{
  constructor(ex,sc){this.ex=ex;this.scene=sc;this.elapsed=0;this.finished=false;this._oA=0;this._oS=0;this._lP=new THREE.Vector3();this._ti=false;}
  update(dt,cam){this.elapsed+=dt;if(this.elapsed>=this.ex.duration)this.finished=true;}
  getResult(){return{avgOscillation:0,durationSeconds:this.elapsed};}
  dispose(){}
}
class BlindRuntime extends BaseRuntime{constructor(ex,sc){super({...ex,duration:2},sc);}}
function createRuntime(ex,sc){return new BaseRuntime(ex,sc);}

async function init(){
  await loadStore();
  renderConfig();showScreen('config');
}
init();