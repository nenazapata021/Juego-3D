import * as THREE from 'three';

// ---------- Audio ----------
let audioCtx = null;
let muted = false;
function beep(freq = 440, dur = 0.1, type = 'sine', vol = 0.08, slide = 0) {
  if (!audioCtx || muted) return;
  try {
    const t = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(audioCtx.destination);
    o.start(t);
    o.stop(t + dur);
  } catch (e) { /* noop */ }
}
function unlockAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* noop */ }
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

// ---------- Estado ----------
const STATE = { MENU: 0, PLAY: 1, PAUSE: 2, OVER: 3 };
let state = STATE.MENU;

const BOUND_X = 8;
const LANE_LEN = 400;
const SPAWN_Z = -140;
const DESPAWN_Z = 18;

const keys = {};

let score = 0, lives = 3, level = 1, combo = 0, comboTimer = 0;
let distance = 0, kills = 0;
let speed = 16, targetSpeed = 16;
let fireCd = 0, dashCd = 0, dashT = 0, invT = 0;
let shieldT = 0, rapidT = 0;
let shake = 0, fovKick = 0, hitStop = 0;
let spawnMeter = 0, powerMeter = 0;
let over = false;
let best = 0;
try { best = Number(localStorage.getItem('neonrush_best')) || 0; } catch (e) { /* noop */ }

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const hud = $('hud');
const menuScreen = $('menuScreen');
const pauseScreen = $('pauseScreen');
const overScreen = $('overScreen');
const centerMsg = $('centerMsg');
const damageFlash = $('damageFlash');
const pickupFlash = $('pickupFlash');
const speedVignette = $('speedVignette');
const comboEl = $('combo');
const scoreVal = $('scoreVal');
const bestVal = $('bestVal');
const distVal = $('distVal');
const levelVal = $('levelVal');
const dashFill = $('dashFill');
const distFill = $('distFill');
const livesEl = $('lives');
const puShield = $('puShield');
const puBoost = $('puBoost');

bestVal.textContent = best;

function buildLives() {
  livesEl.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const d = document.createElement('div');
    d.className = 'life';
    livesEl.appendChild(d);
  }
}
buildLives();

let msgTimer = 0;
function setMsg(text, time = 1.6) {
  if (!text) {
    centerMsg.classList.remove('on');
    msgTimer = 0;
    return;
  }
  centerMsg.textContent = text;
  centerMsg.classList.add('on');
  msgTimer = time;
}

function flash(el) {
  el.classList.add('on');
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('on')));
}

// ---------- Escena ----------
const scene = new THREE.Scene();
const BG_BASE = new THREE.Color(0x070b16);
const BG_LEVEL = new THREE.Color(0x2a1248);
scene.background = BG_BASE.clone();
scene.fog = new THREE.Fog(BG_BASE.clone(), 45, 130);
let bgFlashT = 0;

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 300);
camera.position.set(0, 5.2, 11);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0x8fb8ff, 0x0a0e1a, 0.75));
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(6, 18, 8);
sun.castShadow = true;
sun.shadow.camera.left = -20;
sun.shadow.camera.right = 20;
sun.shadow.camera.top = 20;
sun.shadow.camera.bottom = -20;
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);
const rim = new THREE.DirectionalLight(0x2ee6ff, 0.5);
rim.position.set(-8, 6, -12);
scene.add(rim);

// ---------- Suelo con rejilla desplazable ----------
function makeGridTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#0a1122';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(46, 230, 255, 0.35)';
  g.lineWidth = 2;
  g.strokeRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(46, 230, 255, 0.12)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(128, 0); g.lineTo(128, 256);
  g.moveTo(0, 128); g.lineTo(256, 128);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, LANE_LEN / 10);
  tex.anisotropy = 4;
  return tex;
}
const groundTex = makeGridTexture();
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(40, LANE_LEN),
  new THREE.MeshStandardMaterial({ map: groundTex, color: 0xffffff, roughness: 0.9, metalness: 0.1 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.z = -LANE_LEN / 2 + 30;
ground.receiveShadow = true;
scene.add(ground);

const railMat = new THREE.MeshBasicMaterial({ color: 0x2ee6ff });
for (const side of [-1, 1]) {
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, LANE_LEN), railMat);
  rail.position.set(side * (BOUND_X + 1.4), 0.04, ground.position.z);
  scene.add(rail);
}

const pillars = [];
const pillarGeo = new THREE.BoxGeometry(0.5, 6, 0.5);
const pillarMatA = new THREE.MeshStandardMaterial({ color: 0x15203a, emissive: 0x2ee6ff, emissiveIntensity: 0.35 });
const pillarMatB = new THREE.MeshStandardMaterial({ color: 0x1a1530, emissive: 0x8a5cff, emissiveIntensity: 0.3 });
for (let i = 0; i < 26; i++) {
  const side = i % 2 === 0 ? -1 : 1;
  const m = new THREE.Mesh(pillarGeo, i % 4 < 2 ? pillarMatA : pillarMatB);
  m.position.set(side * (BOUND_X + 3.5), 3, 10 - i * 12);
  m.castShadow = true;
  scene.add(m);
  pillars.push(m);
}

// ---------- Transición de nivel: portal al siguiente cuarto ----------
let transT = 0;
const levelPortal = new THREE.Group();
{
  const portalRing = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.2, 14, 48), new THREE.MeshBasicMaterial({ color: 0x2ee6ff, transparent: true, opacity: 0.95, side: THREE.DoubleSide }));
  portalRing.position.y = 2.8;
  levelPortal.add(portalRing);

  const portalCore = new THREE.Mesh(new THREE.RingGeometry(2.0, 2.4, 48), new THREE.MeshBasicMaterial({ color: 0x8a5cff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
  portalCore.rotation.x = -Math.PI / 2;
  portalCore.position.y = 2.8;
  levelPortal.add(portalCore);

  const portalGlow = new THREE.Mesh(new THREE.RingGeometry(2.9, 3.3, 48), new THREE.MeshBasicMaterial({ color: 0x2ee6ff, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
  portalGlow.rotation.x = -Math.PI / 2;
  portalGlow.position.y = 2.8;
  levelPortal.add(portalGlow);

  const portalFrame = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.3, 10, 48), new THREE.MeshBasicMaterial({ color: 0x0d1830, transparent: true, opacity: 0.95, side: THREE.DoubleSide }));
  portalFrame.rotation.x = -Math.PI / 2;
  portalFrame.position.y = 2.8;
  levelPortal.add(portalFrame);

  scene.add(levelPortal);
}
levelPortal.visible = false;

function startLevelTransition() {
  transT = 0;
  levelPortal.position.set(player.position.x, 0, player.position.z - 32);
  levelPortal.rotation.y = 0;
  levelPortal.visible = true;
  fovKick = Math.max(fovKick, 2.2);
}

function finishLevelTransition() {
  transT = 0;
  levelPortal.visible = false;
  clearEntities();
  combo = 0;
  comboTimer = 0;
  spawnMeter = 0;
  player.position.set(player.position.x, 1.1, SPAWN_Z - 15);
  velX = 0;
  camera.position.set(player.position.x, 5.2, 11);
  camLook.set(player.position.x * 0.5, 1.3, player.position.z - 8);
  camera.lookAt(camLook);
}

// ---------- Jugador: dron ----------
const player = new THREE.Group();
{
  const body = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.55, 0),
    new THREE.MeshStandardMaterial({ color: 0x0e1628, emissive: 0x2ee6a6, emissiveIntensity: 0.55, metalness: 0.7, roughness: 0.25 })
  );
  body.scale.set(1, 0.55, 1.6);
  body.castShadow = true;
  player.add(body);

  const wingMat = new THREE.MeshStandardMaterial({ color: 0x101a30, emissive: 0x2ee6ff, emissiveIntensity: 0.4, metalness: 0.6, roughness: 0.3 });
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.55), wingMat);
  wing.position.y = 0.05;
  wing.castShadow = true;
  player.add(wing);

  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 0.7, 4),
    new THREE.MeshStandardMaterial({ color: 0x2ee6ff, emissive: 0x2ee6ff, emissiveIntensity: 1.2 })
  );
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -1.05;
  player.add(nose);

  const thruster = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xffd34d })
  );
  thruster.position.z = 1.15;
  thruster.scale.z = 1.8;
  player.add(thruster);
  player.userData.thruster = thruster;

  const glow = new THREE.PointLight(0x2ee6ff, 1.4, 12);
  glow.position.set(0, 0.5, 0);
  player.add(glow);

  const shieldMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1.35, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0x4dd2ff, transparent: true, opacity: 0.28, wireframe: true })
  );
  shieldMesh.visible = false;
  player.add(shieldMesh);
  player.userData.shieldMesh = shieldMesh;
}
player.position.set(0, 1.1, 0);
scene.add(player);

// ---------- Entidades ----------
const obstacles = [];
const enemies = [];
const pickups = [];
const powerups = [];
const pShots = [];
const eShots = [];
const particles = [];
const floats = [];

const partGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
const partMats = {};
function burst(pos, color, n = 12, speedMul = 6) {
  if (!partMats[color]) partMats[color] = new THREE.MeshBasicMaterial({ color, transparent: true });
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(partGeo, partMats[color]);
    m.position.copy(pos);
    const a = Math.random() * Math.PI * 2;
    m.userData.v = new THREE.Vector3(Math.cos(a) * Math.random() * speedMul, Math.random() * 5 + 1, Math.sin(a) * Math.random() * speedMul + 4);
    m.userData.life = m.userData.max = 0.35 + Math.random() * 0.45;
    scene.add(m);
    particles.push(m);
  }
}

function floatText(text, worldPos, color) {
  const el = document.createElement('div');
  el.className = 'float-score';
  el.textContent = text;
  el.style.color = color;
  hud.appendChild(el);
  floats.push({ el, pos: worldPos.clone(), life: 0.85 });
}

function spawnPosZ() {
  return SPAWN_Z - Math.random() * 30;
}

// ---------- Creacion de objetos ----------
function makeObstacle() {
  const gapSide = Math.random() < 0.5 ? -1 : 1;
  const gapCenter = gapSide * (2.5 + Math.random() * 3.5);
  const gapW = 4.2;
  const totalHalf = BOUND_X + 1;
  const edges = [-totalHalf, gapCenter - gapW / 2, gapCenter + gapW / 2, totalHalf];
  const segments = [];
  for (let i = 0; i < edges.length - 1; i += 2) {
    const x0 = edges[i], x1 = edges[i + 1];
    if (x1 - x0 < 0.6) continue;
    segments.push({ x: (x0 + x1) / 2, w: x1 - x0 });
  }
  const z = spawnPosZ();
  const grp = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2a0f1a, emissive: 0xff4d6d, emissiveIntensity: 0.7,
    metalness: 0.4, roughness: 0.4
  });
  for (const s of segments) {
    const h = 2.6 + Math.random() * 1.4;
    const m = new THREE.Mesh(new THREE.BoxGeometry(s.w, h, 1.2), mat);
    m.position.set(s.x, h / 2, 0);
    m.castShadow = true;
    m.receiveShadow = true;
    grp.add(m);
    const top = new THREE.Mesh(new THREE.BoxGeometry(s.w, 0.12, 1.35), new THREE.MeshBasicMaterial({ color: 0xff4d6d }));
    top.position.set(s.x, h, 0);
    grp.add(top);
  }
  grp.position.z = z;
  grp.userData = { type: 'wall' };
  scene.add(grp);
  obstacles.push(grp);
}

function makeEnemy(type = 'swarm') {
  const z = spawnPosZ();
  const m = new THREE.Group();
  if (type === 'blocker') {
    const core = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 2.2, 2.2),
      new THREE.MeshStandardMaterial({ color: 0x1a1030, emissive: 0x8a5cff, emissiveIntensity: 0.65, metalness: 0.6, roughness: 0.3 })
    );
    core.castShadow = true;
    m.add(core);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.15, 2.35), new THREE.MeshBasicMaterial({ color: 0x8a5cff }));
    m.add(edge);
    m.userData = { type, hp: 3, speed: 2.2, r: 1.6, vx: 0, cool: 0 };
  } else if (type === 'turret') {
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.85, 0),
      new THREE.MeshStandardMaterial({ color: 0x301510, emissive: 0xff9f43, emissiveIntensity: 0.8, metalness: 0.5, roughness: 0.35 })
    );
    core.castShadow = true;
    m.add(core);
    m.userData = { type, hp: 2, speed: 1.2, r: 1.1, vx: (Math.random() < 0.5 ? -1 : 1) * 1.6, cool: 1 + Math.random() };
  } else {
    const core = new THREE.Mesh(
      new THREE.TetrahedronGeometry(0.75, 0),
      new THREE.MeshStandardMaterial({ color: 0x301018, emissive: 0xff4d6d, emissiveIntensity: 0.85, metalness: 0.5, roughness: 0.35 })
    );
    core.castShadow = true;
    m.add(core);
    m.userData = { type, hp: 1, speed: 3.4 + Math.random() * 1.6, r: 1.0, vx: (Math.random() - 0.5) * 3, cool: 0 };
  }
  m.position.set((Math.random() * 2 - 1) * (BOUND_X - 1.5), 1.4 + Math.random() * 1.6, z);
  scene.add(m);
  enemies.push(m);
}

function makePickup(x, z, kind = 'cell') {
  let mesh;
  if (kind === 'cell') {
    mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.38, 0),
      new THREE.MeshStandardMaterial({ color: 0x3a2c00, emissive: 0xffd34d, emissiveIntensity: 1.1 })
    );
  } else {
    mesh = new THREE.Mesh(
      new THREE.TorusGeometry(0.4, 0.14, 10, 20),
      new THREE.MeshStandardMaterial({ color: 0x003a2a, emissive: 0x2ee6a6, emissiveIntensity: 1.2 })
    );
  }
  mesh.position.set(x, 1.2, z);
  mesh.userData = { kind, phase: Math.random() * Math.PI * 2 };
  scene.add(mesh);
  pickups.push(mesh);
}

function makePickupPattern() {
  const z = spawnPosZ();
  const x = (Math.random() * 2 - 1) * (BOUND_X - 2);
  const arc = Math.random() < 0.5;
  const n = 5 + Math.floor(Math.random() * 4);
  for (let i = 0; i < n; i++) {
    const px = arc ? x + Math.sin((i / (n - 1)) * Math.PI) * 2.5 * (Math.random() < 0.5 ? -1 : 1) : x;
    makePickup(px, z - i * 3, Math.random() < 0.12 ? 'ring' : 'cell');
  }
}

function makePowerup() {
  const type = Math.random() < 0.5 ? 'shield' : 'rapid';
  const col = type === 'shield' ? 0x4dd2ff : 0xff9f43;
  const geo = type === 'shield' ? new THREE.OctahedronGeometry(0.55, 0) : new THREE.ConeGeometry(0.45, 0.9, 4);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.9 }));
  m.position.set((Math.random() * 2 - 1) * (BOUND_X - 2), 1.3, spawnPosZ());
  m.userData = { type, life: 12 };
  scene.add(m);
  powerups.push(m);
}

function makeShot(from, dir, enemy = false) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(enemy ? 0.22 : 0.17, 10, 10),
    new THREE.MeshBasicMaterial({ color: enemy ? 0xff4d6d : 0xffd34d })
  );
  m.position.copy(from);
  m.userData = {
    v: dir.clone().normalize().multiplyScalar(enemy ? 26 : 55),
    life: enemy ? 3 : 1.6
  };
  scene.add(m);
  (enemy ? eShots : pShots).push(m);
}

// ---------- Limpieza / reinicio ----------
function clearEntities() {
  for (const arr of [obstacles, enemies, pickups, powerups, pShots, eShots, particles]) {
    for (const o of arr) scene.remove(o);
    arr.length = 0;
  }
  for (const f of floats) f.el.remove();
  floats.length = 0;
}

let velX = 0;

function resetGame() {
  clearEntities();
  score = 0; lives = 3; level = 1; combo = 0; comboTimer = 0;
  distance = 0; kills = 0;
  speed = 16; targetSpeed = 16;
  fireCd = 0; dashCd = 0; dashT = 0; invT = 0;
  shieldT = 0; rapidT = 0;
  shake = 0; fovKick = 0; hitStop = 0;
  bgFlashT = 0;
  scene.background.copy(BG_BASE);
  scene.fog.color.copy(BG_BASE);
  spawnMeter = 0; powerMeter = 0;
  over = false;
  player.position.set(0, 1.1, 0);
  player.rotation.set(0, 0, 0);
  player.visible = true;
  velX = 0;
  camera.position.set(0, 5.2, 11);
  buildLives();
  setMsg('¡NIVEL 1!\nSobrevive y encadena bajas', 2.2);
}

// ---------- Spawn por distancia ----------
function spawnWave() {
  const roll = Math.random();
  if (roll < 0.3) makeObstacle();
  else if (roll < 0.5) makePickupPattern();
  else if (roll < 0.7) {
    makeEnemy(Math.random() < 0.4 + level * 0.03 ? 'swarm' : 'turret');
    if (level >= 3 && Math.random() < 0.35) makeEnemy('swarm');
  } else if (roll < 0.85) {
    makeObstacle();
    makePickupPattern();
  } else {
    const n = 1 + Math.min(3, Math.floor(level / 3));
    for (let i = 0; i < n; i++) makeEnemy('swarm');
  }
  if (level >= 4 && Math.random() < 0.18) makeEnemy('blocker');
}

// ---------- Input ----------
let firing = false;

addEventListener('keydown', (e) => {
  unlockAudio();
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  keys[e.code] = true;
  if (e.repeat) return;
  if (e.code === 'KeyM') muted = !muted;
  if (e.code === 'KeyP') {
    if (state === STATE.PLAY) pauseGame();
    else if (state === STATE.PAUSE) resumeGame();
  }
  if (e.code === 'Enter') {
    if (state === STATE.MENU || state === STATE.OVER) startGame();
  }
  if (e.code === 'Space' && state === STATE.PLAY) tryDash();
  if ((e.code === 'KeyW' || e.code === 'ArrowUp') && state === STATE.PLAY) {
    firing = true;
    fireShot();
  }
});
addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'KeyW' || e.code === 'ArrowUp') firing = false;
});

renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

function fireShot() {
  if (fireCd > 0 || state !== STATE.PLAY) return;
  fireCd = rapidT > 0 ? 0.06 : 0.13;
  const dir = new THREE.Vector3(0, 0, -1);
  makeShot(player.position.clone().add(new THREE.Vector3(0, 0, -1)), dir, false);
  fovKick = Math.max(fovKick, 0.35);
  beep(880, 0.05, 'square', 0.03, -200);
}

function tryDash() {
  if (dashCd > 0 || state !== STATE.PLAY) return;
  dashT = 0.22;
  dashCd = 1.3;
  invT = Math.max(invT, 0.3);
  shake = Math.max(shake, 0.25);
  fovKick = 1.4;
  burst(player.position, 0x2ee6ff, 10, 7);
  beep(240, 0.18, 'sawtooth', 0.06, 520);
}

// ---------- Flujo de pantallas ----------
function startGame() {
  unlockAudio();
  resetGame();
  state = STATE.PLAY;
  menuScreen.classList.add('hidden');
  overScreen.classList.add('hidden');
  pauseScreen.classList.add('hidden');
  hud.classList.add('on');
  beep(520, 0.15, 'triangle', 0.08, 380);
}

function pauseGame() {
  if (state !== STATE.PLAY) return;
  state = STATE.PAUSE;
  pauseScreen.classList.remove('hidden');
}

function resumeGame() {
  if (state !== STATE.PAUSE) return;
  state = STATE.PLAY;
  pauseScreen.classList.add('hidden');
}

function backToMenu() {
  state = STATE.MENU;
  clearEntities();
  over = false;
  hud.classList.remove('on');
  pauseScreen.classList.add('hidden');
  overScreen.classList.add('hidden');
  menuScreen.classList.remove('hidden');
  setMsg('');
  player.position.set(0, 1.1, 0);
  velX = 0;
  speed = 10;
  targetSpeed = 10;
}

function gameOver() {
  if (over) return;
  over = true;
  state = STATE.OVER;
  const isRecord = score > best;
  if (isRecord) {
    best = score;
    try { localStorage.setItem('neonrush_best', String(best)); } catch (e) { /* noop */ }
  }
  $('finalScore').textContent = Math.floor(score);
  $('finalDist').textContent = Math.floor(distance) + ' m';
  $('finalKills').textContent = kills;
  $('finalLevel').textContent = level;
  $('newRecord').classList.toggle('on', isRecord);
  bestVal.textContent = best;
  overScreen.classList.remove('hidden');
  burst(player.position, 0xff4d6d, 30, 9);
  shake = 1;
  beep(200, 0.5, 'sawtooth', 0.1, -150);
}

$('playBtn').addEventListener('click', startGame);
$('retryBtn').addEventListener('click', startGame);
$('resumeBtn').addEventListener('click', resumeGame);
$('quitBtn').addEventListener('click', backToMenu);
$('menuBtn').addEventListener('click', backToMenu);

// ---------- Dano ----------
function damagePlayer(srcPos) {
  if (invT > 0 || dashT > 0) return;
  if (shieldT > 0) {
    shieldT = 0;
    invT = 1;
    burst(player.position, 0x4dd2ff, 16, 7);
    floatText('¡ESCUDO ROTO!', player.position.clone().add(new THREE.Vector3(0, 1.5, 0)), '#4dd2ff');
    shake = Math.max(shake, 0.4);
    beep(660, 0.2, 'sine', 0.08, -300);
    return;
  }
  lives -= 1;
  combo = 0;
  comboTimer = 0;
  invT = 1.6;
  hitStop = 0.08;
  shake = Math.max(shake, 0.8);
  fovKick = 1.8;
  flash(damageFlash);
  burst(player.position, 0xff4d6d, 22, 8);
  buildLives();
  beep(140, 0.3, 'square', 0.1, -90);
  if (srcPos) floatText('-1 VIDA', player.position.clone().add(new THREE.Vector3(0, 1.6, 0)), '#ff4d6d');
  if (lives <= 0) gameOver();
}

function addScore(n, worldPos, color = '#ffd34d') {
  combo = comboTimer > 0 ? Math.min(combo + 1, 9) : 1;
  comboTimer = 2.6;
  const total = Math.floor(n * combo);
  score += total;
  if (worldPos) floatText('+' + total, worldPos, color);
}

// ---------- Actualizacion ----------
const tmpV = new THREE.Vector3();

function updatePlayer(dt) {
  let dx = 0;
  if (keys.ArrowLeft || keys.KeyA) dx -= 1;
  if (keys.ArrowRight || keys.KeyD) dx += 1;

  const accel = 55;
  const maxV = dashT > 0 ? 26 : 16;
  velX += dx * accel * dt;
  if (!dx) velX *= Math.exp(-9 * dt);
  velX = THREE.MathUtils.clamp(velX, -maxV, maxV);
  player.position.x = THREE.MathUtils.clamp(player.position.x + velX * dt, -BOUND_X, BOUND_X);

  player.position.y = 1.1 + Math.sin(clock.elapsedTime * 3.2) * 0.12;
  player.rotation.z = THREE.MathUtils.lerp(player.rotation.z, -velX * 0.05, 1 - Math.exp(-10 * dt));
  player.rotation.x = THREE.MathUtils.lerp(player.rotation.x, dashT > 0 ? -0.35 : 0, 1 - Math.exp(-8 * dt));

  const thr = player.userData.thruster;
  const throb = 1 + Math.sin(clock.elapsedTime * 30) * 0.25 + (dashT > 0 ? 1.2 : 0);
  thr.scale.set(throb, throb, 1.8 * throb);

  player.userData.shieldMesh.visible = shieldT > 0;
  player.userData.shieldMesh.rotation.y += dt * 2;
  player.visible = invT <= 0 || Math.floor(invT * 12) % 2 === 0;

  if (firing) fireShot();
}

function scrollWorld(dt) {
  const dz = speed * dt;
  groundTex.offset.y += dz / 10;

  for (const p of pillars) {
    p.position.z += dz;
    if (p.position.z > 20) p.position.z -= 26 * 12;
  }

  for (let i = obstacles.length - 1; i >= 0; i--) {
    const o = obstacles[i];
    o.position.z += dz;
    if (o.position.z > DESPAWN_Z) {
      scene.remove(o);
      obstacles.splice(i, 1);
    }
  }

  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    p.position.z += dz;
    p.rotation.y += dt * 3;
    p.position.y = 1.2 + Math.sin(clock.elapsedTime * 4 + p.userData.phase) * 0.2;
    if (p.position.z > DESPAWN_Z) {
      scene.remove(p);
      pickups.splice(i, 1);
    }
  }

  for (let i = powerups.length - 1; i >= 0; i--) {
    const p = powerups[i];
    p.position.z += dz;
    p.rotation.y += dt * 2.5;
    p.userData.life -= dt;
    if (p.position.z > DESPAWN_Z || p.userData.life <= 0) {
      scene.remove(p);
      powerups.splice(i, 1);
    }
  }
}

function updateObstacles() {
  if (invT > 0 || dashT > 0) return;
  const pz = player.position.z;
  const px = player.position.x;
  for (const o of obstacles) {
    if (Math.abs(o.position.z - pz) > 1.4) continue;
    for (const seg of o.children) {
      const params = seg.geometry.parameters;
      const halfW = (params && params.width ? params.width : 1) / 2;
      const lx = o.position.x + seg.position.x;
      if (Math.abs(px - lx) < halfW + 0.55 && Math.abs(o.position.z - pz) < 1.2) {
        damagePlayer(o.position);
        return;
      }
    }
  }
}

function updateEnemies(dt) {
  const dz = speed * dt;
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    const d = e.userData;
    e.position.z += dz;

    if (d.type === 'swarm') {
      tmpV.subVectors(player.position, e.position).setY(0);
      const dist = tmpV.length();
      if (dist > 0.01) tmpV.normalize().multiplyScalar(d.speed * dt);
      e.position.add(tmpV);
      e.rotation.x += dt * 4;
      e.rotation.y += dt * 3;
    } else if (d.type === 'turret') {
      e.position.x += d.vx * dt;
      if (Math.abs(e.position.x) > BOUND_X - 0.8) d.vx *= -1;
      e.rotation.y += dt * 2;
      d.cool -= dt;
      if (d.cool <= 0 && e.position.z < -8 && e.position.z > SPAWN_Z * 0.4) {
        d.cool = Math.max(0.7, 1.8 - level * 0.08);
        tmpV.subVectors(player.position, e.position).normalize();
        makeShot(e.position.clone(), tmpV, true);
        beep(320, 0.08, 'sawtooth', 0.03, -80);
      }
    } else {
      e.rotation.x += dt * 1.2;
      e.rotation.z += dt * 0.9;
      e.position.y = 1.6 + Math.sin(clock.elapsedTime * 2) * 0.3;
    }

    const dist = e.position.distanceTo(player.position);
    if (dist < d.r + 0.7) {
      if (dashT > 0 || (shieldT > 0 && d.type !== 'wall')) {
        killEnemy(i, e);
        continue;
      }
      damagePlayer(e.position);
      if (d.type !== 'blocker') {
        e.position.z = DESPAWN_Z + 5;
      }
    }

    if (e.position.z > DESPAWN_Z) {
      scene.remove(e);
      enemies.splice(i, 1);
    }
  }
}

function killEnemy(index, e) {
  const d = e.userData;
  const col = d.type === 'blocker' ? 0x8a5cff : d.type === 'turret' ? 0xff9f43 : 0xff4d6d;
  burst(e.position, col, d.type === 'blocker' ? 26 : 16, 8);
  addScore(d.type === 'blocker' ? 250 : d.type === 'turret' ? 150 : 100, e.position.clone().add(new THREE.Vector3(0, 1, 0)), '#2ee6a6');
  kills += 1;
  shake = Math.max(shake, d.type === 'blocker' ? 0.5 : 0.25);
  hitStop = Math.max(hitStop, 0.04);
  beep(d.type === 'blocker' ? 180 : 420, 0.16, 'square', 0.07, 300);
  scene.remove(e);
  enemies.splice(index, 1);
}

function updateShots(dt) {
  const dz = speed * dt;
  for (let i = pShots.length - 1; i >= 0; i--) {
    const p = pShots[i];
    p.position.addScaledVector(p.userData.v, dt);
    p.position.z += dz * 0.4;
    p.userData.life -= dt;
    let dead = p.userData.life <= 0 || p.position.z < SPAWN_Z - 20;
    if (!dead) {
      for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j];
        if (p.position.distanceTo(e.position) < e.userData.r + 0.4) {
          e.userData.hp -= 1;
          burst(p.position, 0xffd34d, 6, 4);
          if (e.userData.hp <= 0) killEnemy(j, e);
          else beep(700, 0.06, 'triangle', 0.05, -100);
          dead = true;
          break;
        }
      }
    }
    if (!dead) {
      for (let j = obstacles.length - 1; j >= 0; j--) {
        const o = obstacles[j];
        if (Math.abs(o.position.z - p.position.z) > 1.2) continue;
        let hitSeg = null;
        for (const seg of o.children) {
          const params = seg.geometry.parameters;
          const halfW = (params && params.width ? params.width : 1) / 2;
          const halfH = (params && params.height ? params.height : 1) / 2;
          const lx = o.position.x + seg.position.x;
          if (Math.abs(p.position.x - lx) < halfW + 0.2 &&
              Math.abs(p.position.y - (o.position.y + seg.position.y)) < halfH + 0.2) {
            hitSeg = seg;
            break;
          }
        }
        if (hitSeg) {
          const hitPos = hitSeg.getWorldPosition(new THREE.Vector3());
          burst(hitPos, 0xff4d6d, 14, 6);
          addScore(75, hitPos.clone().add(new THREE.Vector3(0, 1, 0)), '#ffd34d');
          const hitX = hitSeg.position.x;
          for (let k = o.children.length - 1; k >= 0; k--) {
            if (Math.abs(o.children[k].position.x - hitX) < 0.01) o.remove(o.children[k]);
          }
          beep(300, 0.12, 'square', 0.06, 200);
          shake = Math.max(shake, 0.3);
          if (o.children.length === 0) {
            scene.remove(o);
            obstacles.splice(j, 1);
          }
          dead = true;
          break;
        }
      }
    }
    if (dead) {
      scene.remove(p);
      pShots.splice(i, 1);
    }
  }

  for (let i = eShots.length - 1; i >= 0; i--) {
    const p = eShots[i];
    p.position.addScaledVector(p.userData.v, dt);
    p.userData.life -= dt;
    let dead = p.userData.life <= 0;
    if (!dead && p.position.distanceTo(player.position) < 1.0) {
      damagePlayer(p.position);
      dead = true;
    }
    if (dead) {
      scene.remove(p);
      eShots.splice(i, 1);
    }
  }
}

function updatePickups(dt) {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    if (p.position.distanceTo(player.position) < 1.5) {
      if (p.userData.kind === 'ring') {
        addScore(300, p.position.clone(), '#2ee6a6');
        flash(pickupFlash);
        beep(990, 0.2, 'triangle', 0.09, 400);
      } else {
        addScore(50, p.position.clone());
        beep(600 + combo * 80, 0.09, 'triangle', 0.06);
      }
      burst(p.position, p.userData.kind === 'ring' ? 0x2ee6a6 : 0xffd34d, 10, 5);
      scene.remove(p);
      pickups.splice(i, 1);
      continue;
    }
    const d = p.position.distanceTo(player.position);
    if (d < 3.2 && d > 0.01) {
      tmpV.subVectors(player.position, p.position).setY(0).normalize();
      p.position.addScaledVector(tmpV, 10 * dt);
    }
  }

  for (let i = powerups.length - 1; i >= 0; i--) {
    const p = powerups[i];
    if (p.position.distanceTo(player.position) < 1.6) {
      if (p.userData.type === 'shield') {
        shieldT = 7;
        setMsg('¡ESCUDO!', 1);
      } else {
        rapidT = 6;
        setMsg('¡FUEGO RÁPIDO!', 1);
      }
      burst(p.position, p.userData.type === 'shield' ? 0x4dd2ff : 0xff9f43, 18, 6);
      flash(pickupFlash);
      beep(760, 0.25, 'square', 0.08, 420);
      scene.remove(p);
      powerups.splice(i, 1);
    }
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.userData.v.y -= 14 * dt;
    p.position.addScaledVector(p.userData.v, dt);
    p.position.z += speed * dt * 0.3;
    p.userData.life -= dt;
    p.scale.setScalar(Math.max(0.01, p.userData.life / p.userData.max));
    if (p.userData.life <= 0 || p.position.y < 0) {
      scene.remove(p);
      particles.splice(i, 1);
    }
  }
}

function updateFloats(dt) {
  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i];
    f.life -= dt;
    f.pos.y += dt * 1.6;
    if (f.life <= 0) {
      f.el.remove();
      floats.splice(i, 1);
      continue;
    }
    tmpV.copy(f.pos).project(camera);
    if (tmpV.z > 1) {
      f.el.style.opacity = 0;
      continue;
    }
    f.el.style.left = ((tmpV.x * 0.5 + 0.5) * innerWidth) + 'px';
    f.el.style.top = ((-tmpV.y * 0.5 + 0.5) * innerHeight) + 'px';
  }
}

function updateProgress(dt) {
  distance += speed * dt * 0.55;
  score += speed * dt * 0.6;

  targetSpeed = Math.min(42, 16 + distance * 0.012 + level * 0.6);
  speed = THREE.MathUtils.lerp(speed, targetSpeed, 1 - Math.exp(-1.5 * dt));

  const newLevel = 1 + Math.floor(distance / 350);
  if (newLevel > level) {
    level = newLevel;
    startLevelTransition();
    setMsg('¡NIVEL ' + level + '!\nMás rápido, más hostil', 1.8);
    shake = Math.max(shake, 0.35);
    fovKick = Math.max(fovKick, 1);
    burst(player.position, 0x8a5cff, 24, 8);
    bgFlashT = 2.4;
    beep(520, 0.22, 'triangle', 0.09, 480);
    if (level % 3 === 0) makeEnemy('blocker');
  }

  spawnMeter += speed * dt;
  const gap = Math.max(14, 34 - level * 1.6);
  if (spawnMeter >= gap) {
    spawnMeter = 0;
    spawnWave();
  }

  powerMeter += speed * dt;
  if (powerMeter >= 220) {
    powerMeter = 0;
    makePowerup();
  }

  if (comboTimer > 0) {
    comboTimer -= dt;
    if (comboTimer <= 0) combo = 0;
  }
}

function updateHud() {
  scoreVal.textContent = Math.floor(score);
  distVal.textContent = Math.floor(distance) + ' M';
  levelVal.textContent = 'NIVEL ' + level;
  dashFill.style.width = (100 * (1 - Math.min(1, dashCd / 1.3))) + '%';
  const speedPct = THREE.MathUtils.clamp((speed - 16) / (42 - 16), 0, 1) * 100;
  distFill.style.width = speedPct + '%';

  puShield.classList.toggle('on', shieldT > 0);
  puBoost.classList.toggle('on', rapidT > 0);

  if (combo > 1 && comboTimer > 0) {
    comboEl.classList.add('on');
    comboEl.innerHTML = 'x' + combo + '<small>COMBO</small>';
  } else {
    comboEl.classList.remove('on');
  }

  speedVignette.style.opacity = Math.max(0, (speed - 26) / 20).toFixed(2);
}

// ---------- Bucle ----------
const clock = new THREE.Clock();
const camLook = new THREE.Vector3(0, 1.2, -6);

function animate() {
  requestAnimationFrame(animate);
  let dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;

  if (hitStop > 0) {
    hitStop -= dt;
    dt *= 0.15;
  }

  if (transT > 0) {
    transT = Math.min(1, transT + dt * 0.6);
    const ring = levelPortal.children[0];
    const glow = levelPortal.children[2];
    ring.scale.setScalar(1 + Math.sin(time * 6) * 0.08);
    glow.scale.setScalar(1 + Math.sin(time * 6 + 0.8) * 0.1);
    levelPortal.rotation.y += dt * 2.5;
    levelPortal.position.set(player.position.x, 0, player.position.z - 32);
    const portalTarget = new THREE.Vector3(levelPortal.position.x, 2.4, levelPortal.position.z + 7);
    camera.position.lerp(portalTarget, 1 - Math.exp(-4 * dt));
    camLook.lerp(tmpV.copy(portalTarget).setY(2.4), 1 - Math.exp(-6 * dt));
    if (transT >= 1) finishLevelTransition();
  }

  const active = state === STATE.PLAY;

  if (active) {
    updatePlayer(dt);
    scrollWorld(dt);
    updateObstacles();
    updateEnemies(dt);
    updateShots(dt);
    updatePickups(dt);
    updateProgress(dt);
  } else if (state === STATE.MENU) {
    scrollWorld(dt);
    player.position.y = 1.1 + Math.sin(time * 2.2) * 0.2;
    player.rotation.z = Math.sin(time * 1.4) * 0.12;
  }

  updateParticles(dt);
  updateFloats(active || state === STATE.OVER ? dt : 0);

  if (msgTimer > 0) {
    msgTimer -= dt;
    if (msgTimer <= 0) setMsg('');
  }

  if (active) {
    fireCd = Math.max(0, fireCd - dt);
    dashCd = Math.max(0, dashCd - dt);
    dashT = Math.max(0, dashT - dt);
    invT = Math.max(0, invT - dt);
    shieldT = Math.max(0, shieldT - dt);
    rapidT = Math.max(0, rapidT - dt);
  }

  shake = Math.max(0, shake - dt * 2.4);
  fovKick = Math.max(0, fovKick - dt * 4);

  if (bgFlashT > 0) {
    bgFlashT = Math.max(0, bgFlashT - dt);
  }
  const bgTarget = bgFlashT > 0 ? BG_LEVEL : BG_BASE;
  scene.background.lerp(bgTarget, 1 - Math.exp(-4 * dt));
  scene.fog.color.copy(scene.background);

  if (transT > 0) {
    const portalTarget = new THREE.Vector3(levelPortal.position.x, 2.4, levelPortal.position.z + 7);
    camera.position.lerp(portalTarget, 1 - Math.exp(-4 * dt));
    camLook.lerp(tmpV.copy(portalTarget).setY(2.4), 1 - Math.exp(-6 * dt));
  } else {
    const camZ = 11 + (dashT > 0 ? 1.6 : 0) + (speed - 16) * 0.06;
    const camX = player.position.x * 0.35;
    const camY = 5.2 + (state === STATE.MENU ? 1.5 : 0);
    camera.position.x += (camX - camera.position.x) * (1 - Math.exp(-5 * dt));
    camera.position.y += (camY - camera.position.y) * (1 - Math.exp(-5 * dt));
    camera.position.z += (camZ - camera.position.z) * (1 - Math.exp(-3 * dt));
  }
  camera.position.x += (Math.random() - 0.5) * shake * 0.7;
  camera.position.y += (Math.random() - 0.5) * shake * 0.7;

  camLook.lerp(tmpV.set(player.position.x * 0.5, 1.3, player.position.z - 8), 1 - Math.exp(-6 * dt));
  camera.lookAt(camLook);

  const targetFov = 62 + (speed - 16) * 0.35 + fovKick * 6;
  camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-8 * dt));
  camera.updateProjectionMatrix();

  if (active) updateHud();

  renderer.render(scene, camera);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

speed = 10;
targetSpeed = 10;
animate();
