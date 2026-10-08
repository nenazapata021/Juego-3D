import * as THREE from 'three';

// ---------- Sonido (WebAudio, sin archivos) ----------
let audioCtx = null;
let muted = false;
function beep(freq = 440, dur = 0.1, type = 'sine', vol = 0.08, slide = 0) {
  if (!audioCtx || muted) return;
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
}

// ---------- Escena, cámara y renderizador ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1020);
scene.fog = new THREE.Fog(0x0b1020, 25, 70);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 150);
camera.position.set(0, 10, 14);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

// ---------- Luces ----------
scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 0.8));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(8, 15, 6);
sun.castShadow = true;
sun.shadow.camera.left = -25;
sun.shadow.camera.right = 25;
sun.shadow.camera.top = 25;
sun.shadow.camera.bottom = -25;
scene.add(sun);

// ---------- Suelo ----------
const BOUND = 18;
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(BOUND * 2 + 4, BOUND * 2 + 4),
  new THREE.MeshStandardMaterial({ color: 0x1d2b4f })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(BOUND * 2 + 4, BOUND * 2 + 4, 0x2f4585, 0x263764);
grid.position.y = 0.02;
scene.add(grid);

// ---------- Jugador ----------
const player = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0x2ee6a6 })
);
player.position.y = 0.5;
player.castShadow = true;
scene.add(player);

const shieldMesh = new THREE.Mesh(
  new THREE.SphereGeometry(1.15, 24, 16),
  new THREE.MeshBasicMaterial({ color: 0x4dd2ff, transparent: true, opacity: 0.3 })
);
shieldMesh.visible = false;
player.add(shieldMesh);

// ---------- Utilidades ----------
const hud = document.getElementById('hud');
const msgEl = document.getElementById('msg');
const rand = (a, b) => a + Math.random() * (b - a);
const tmp = new THREE.Vector3();

function spawnPos(minDist = 8) {
  const p = new THREE.Vector3();
  for (let i = 0; i < 20; i++) {
    p.set(rand(-BOUND, BOUND), 0, rand(-BOUND, BOUND));
    if (p.distanceTo(player.position) > minDist) break;
  }
  return p;
}

let msgTimer = 0;
function setMsg(text, time = 1.5) {
  msgEl.textContent = text;
  msgEl.style.opacity = text ? 1 : 0;
  msgTimer = time;
}

// ---------- Partículas ----------
const partGeo = new THREE.BoxGeometry(0.18, 0.18, 0.18);
const partMats = {};
const particles = [];
function burst(pos, color, n = 12, speed = 5) {
  if (!partMats[color]) partMats[color] = new THREE.MeshBasicMaterial({ color });
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(partGeo, partMats[color]);
    m.position.copy(pos);
    const a = Math.random() * Math.PI * 2;
    m.userData.v = new THREE.Vector3(
      Math.cos(a) * rand(0.3, 1) * speed,
      rand(2, 6),
      Math.sin(a) * rand(0.3, 1) * speed
    );
    m.userData.life = m.userData.max = rand(0.4, 0.8);
    scene.add(m);
    particles.push(m);
  }
}

// ---------- Estado del juego ----------
const coins = [];
const enemies = [];
const powerups = [];
let score = 0, lives = 3, level = 1, combo = 0, comboTimer = 0;
let over = false, paused = false;
let hitCooldown = 0, shieldT = 0, boostT = 0, dashT = 0, dashCd = 0;
let enemySpeedMul = 1, powerTimer = 6, shake = 0, pulse = 0;
let best = 0;
try { best = Number(localStorage.getItem('mejor3d')) || 0; } catch (e) {}

const vel = new THREE.Vector3();
const lastDir = new THREE.Vector3(0, 0, -1);
const dashDir = new THREE.Vector3();

// ---------- Creación de objetos ----------
function makeCoin() {
  const geo = new THREE.CylinderGeometry(0.4, 0.4, 0.1, 24);
  geo.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: 0xffd34d, emissive: 0x553d00 })
  );
  m.position.copy(spawnPos(2));
  m.position.y = 0.7;
  m.castShadow = true;
  scene.add(m);
  coins.push(m);
}

function makeEnemy(type = 'wander') {
  const chaser = type === 'chaser';
  const m = new THREE.Mesh(
    chaser ? new THREE.IcosahedronGeometry(0.7, 0) : new THREE.SphereGeometry(0.6, 24, 16),
    new THREE.MeshStandardMaterial({ color: chaser ? 0x8a5cff : 0xff4d6d })
  );
  m.position.copy(spawnPos(9));
  m.position.y = 0.6;
  m.userData.type = type;
  m.userData.speed = chaser ? 3.2 : rand(3, 6);
  m.userData.v = new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1))
    .normalize()
    .multiplyScalar(m.userData.speed);
  m.castShadow = true;
  scene.add(m);
  enemies.push(m);
}

function spawnPowerup() {
  if (powerups.length) return;
  const type = Math.random() < 0.5 ? 'shield' : 'speed';
  const col = type === 'shield' ? 0x4dd2ff : 0xff9f43;
  const geo = type === 'shield' ? new THREE.OctahedronGeometry(0.55) : new THREE.ConeGeometry(0.45, 0.9, 4);
  const m = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.5 })
  );
  m.position.copy(spawnPos(4));
  m.position.y = 0.9;
  m.userData.type = type;
  m.userData.col = col;
  m.userData.life = 10;
  m.castShadow = true;
  scene.add(m);
  powerups.push(m);
}

// ---------- Flujo del juego ----------
function reset() {
  [...coins, ...enemies, ...powerups, ...particles].forEach((o) => scene.remove(o));
  coins.length = 0;
  enemies.length = 0;
  powerups.length = 0;
  particles.length = 0;
  score = 0; lives = 3; level = 1; combo = 0; comboTimer = 0;
  over = false; paused = false;
  hitCooldown = 0; shieldT = 0; boostT = 0; dashT = 0; dashCd = 0;
  enemySpeedMul = 1; powerTimer = 6; shake = 0; pulse = 0;
  vel.set(0, 0, 0);
  player.position.set(0, 0.5, 0);
  player.visible = true;
  for (let i = 0; i < 8; i++) makeCoin();
  for (let i = 0; i < 4; i++) makeEnemy('wander');
  setMsg('¡Nivel 1!', 1.5);
}

function levelUp() {
  level += 1;
  enemySpeedMul = 1 + 0.08 * (level - 1);
  if (enemies.length < 14) makeEnemy(level % 2 === 1 ? 'chaser' : 'wander');
  setMsg(`¡Nivel ${level}!`, 1.5);
  shake = Math.max(shake, 0.3);
  beep(660, 0.25, 'triangle', 0.1, 400);
}

function gameOver() {
  over = true;
  if (score > best) {
    best = score;
    try { localStorage.setItem('mejor3d', String(best)); } catch (e) {}
  }
  setMsg(`Fin del juego\nPuntos: ${score}\nR para reiniciar`, Infinity);
}

function tryDash() {
  if (over || paused || dashCd > 0) return;
  dashT = 0.18;
  dashCd = 1.2;
  dashDir.copy(lastDir);
  beep(300, 0.15, 'sawtooth', 0.06, 500);
}

// ---------- Entrada de teclado ----------
const keys = {};
addEventListener('keydown', (e) => {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  keys[e.code] = true;
  if (e.repeat) return;
  if (e.code === 'KeyR') reset();
  if (e.code === 'Space') tryDash();
  if (e.code === 'KeyM') muted = !muted;
  if (e.code === 'KeyP' && !over) {
    paused = !paused;
    setMsg(paused ? 'Pausa (P para seguir)' : '', paused ? Infinity : 0);
  }
});
addEventListener('keyup', (e) => (keys[e.code] = false));

// ---------- Lógica por cuadro ----------
const SPEED = 9;
const DASH_SPEED = 28;

function update(dt, time) {
  // Movimiento con aceleración suave
  let dx = 0, dz = 0;
  if (keys.ArrowLeft || keys.KeyA) dx -= 1;
  if (keys.ArrowRight || keys.KeyD) dx += 1;
  if (keys.ArrowUp || keys.KeyW) dz -= 1;
  if (keys.ArrowDown || keys.KeyS) dz += 1;

  if (dx || dz) {
    const len = Math.hypot(dx, dz);
    dx /= len; dz /= len;
    lastDir.set(dx, 0, dz);
  }

  dashCd = Math.max(0, dashCd - dt);
  if (dashT > 0) {
    dashT -= dt;
    vel.copy(dashDir).multiplyScalar(DASH_SPEED);
    burst(player.position, 0x2ee6a6, 2, 1);
  } else {
    const maxSpeed = SPEED * (boostT > 0 ? 1.5 : 1);
    const k = 1 - Math.exp(-12 * dt);
    vel.x += (dx * maxSpeed - vel.x) * k;
    vel.z += (dz * maxSpeed - vel.z) * k;
  }

  player.position.x = THREE.MathUtils.clamp(player.position.x + vel.x * dt, -BOUND, BOUND);
  player.position.z = THREE.MathUtils.clamp(player.position.z + vel.z * dt, -BOUND, BOUND);

  // Inclinación y "rebote" del cubo
  player.rotation.z = -vel.x * 0.03;
  player.rotation.x = vel.z * 0.03;
  pulse = Math.max(0, pulse - dt * 3);
  player.scale.setScalar(1 + pulse);

  // Temporizadores
  shieldT = Math.max(0, shieldT - dt);
  boostT = Math.max(0, boostT - dt);
  hitCooldown = Math.max(0, hitCooldown - dt);
  shieldMesh.visible = shieldT > 0;
  if (comboTimer > 0) {
    comboTimer -= dt;
    if (comboTimer <= 0) combo = 0;
  }

  // Monedas (flotan, giran y son atraídas si estás cerca)
  coins.forEach((c, i) => {
    c.rotation.y += 2 * dt;
    c.position.y = 0.7 + Math.sin(time * 3 + i) * 0.15;
    const d = c.position.distanceTo(player.position);
    if (d < 3.5) {
      tmp.subVectors(player.position, c.position).setY(0).normalize();
      c.position.addScaledVector(tmp, 9 * dt);
    }
    if (d < 1.1) {
      combo = comboTimer > 0 ? Math.min(combo + 1, 5) : 1;
      comboTimer = 2.5;
      score += 10 * combo;
      pulse = 0.35;
      burst(c.position, 0xffd34d, 12, 5);
      beep(600 + combo * 120, 0.12, 'triangle', 0.08);
      c.position.copy(spawnPos(3));
      c.position.y = 0.7;
    }
  });

  // Subida de nivel cada 100 puntos
  while (level < 1 + Math.floor(score / 100)) levelUp();

  // Power-ups
  powerTimer -= dt;
  if (powerTimer <= 0) {
    spawnPowerup();
    powerTimer = rand(8, 14);
  }
  for (let i = powerups.length - 1; i >= 0; i--) {
    const p = powerups[i];
    p.rotation.y += 2.5 * dt;
    p.position.y = 0.9 + Math.sin(time * 4) * 0.2;
    p.userData.life -= dt;
    if (p.position.distanceTo(player.position) < 1.3) {
      if (p.userData.type === 'shield') { shieldT = 6; setMsg('¡Escudo!', 1); }
      else { boostT = 5; setMsg('¡Turbo!', 1); }
      burst(p.position, p.userData.col, 20, 6);
      beep(880, 0.25, 'square', 0.07, 400);
      scene.remove(p);
      powerups.splice(i, 1);
    } else if (p.userData.life <= 0) {
      scene.remove(p);
      powerups.splice(i, 1);
    }
  }

  // Enemigos
  for (const e of enemies) {
    const d = e.userData;
    let mul = enemySpeedMul;
    if (d.type === 'chaser') {
      tmp.subVectors(player.position, e.position).setY(0).normalize().multiplyScalar(d.speed * enemySpeedMul);
      d.v.lerp(tmp, 1 - Math.exp(-2 * dt));
      mul = 1;
    }
    e.position.addScaledVector(d.v, dt * mul);
    e.rotation.x += 2 * dt;
    e.rotation.z += 1.5 * dt;
    if (Math.abs(e.position.x) > BOUND) { d.v.x *= -1; e.position.x = Math.sign(e.position.x) * BOUND; }
    if (Math.abs(e.position.z) > BOUND) { d.v.z *= -1; e.position.z = Math.sign(e.position.z) * BOUND; }

    const dist = e.position.distanceTo(player.position);
    if (shieldT > 0 && dist < 1.5) {
      // Con escudo, destruyes al enemigo
      score += 25;
      burst(e.position, 0xff4d6d, 18, 7);
      beep(220, 0.2, 'square', 0.08, 300);
      e.position.copy(spawnPos(9));
      e.position.y = 0.6;
    } else if (hitCooldown === 0 && dashT <= 0 && shieldT <= 0 && dist < 1.2) {
      lives -= 1;
      hitCooldown = 1.2;
      combo = 0;
      shake = 0.6;
      burst(player.position, 0xff4d6d, 20, 7);
      beep(150, 0.3, 'square', 0.1, -80);
      if (lives <= 0) gameOver();
    }
  }

  // Parpadeo del jugador tras un golpe
  player.visible = hitCooldown === 0 || Math.floor(hitCooldown * 10) % 2 === 0;
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.userData.v.y -= 15 * dt;
    p.position.addScaledVector(p.userData.v, dt);
    p.userData.life -= dt;
    p.scale.setScalar(Math.max(0.01, p.userData.life / p.userData.max));
    if (p.userData.life <= 0 || p.position.y < 0) {
      scene.remove(p);
      particles.splice(i, 1);
    }
  }
}

function updateHud() {
  const dash = dashCd > 0 ? `Dash ${dashCd.toFixed(1)}s` : 'Dash listo';
  hud.textContent =
    `Puntos: ${score}   Mejor: ${best}\n` +
    `Nivel: ${level}   Vidas: ${'♥'.repeat(Math.max(lives, 0))}\n` +
    (combo > 1 ? `Combo x${combo}   ` : '') + dash +
    (shieldT > 0 ? `   Escudo ${shieldT.toFixed(0)}s` : '') +
    (boostT > 0 ? `   Turbo ${boostT.toFixed(0)}s` : '');
}

// ---------- Bucle principal ----------
const clock = new THREE.Clock();
const camBase = camera.position.clone();
const camTarget = new THREE.Vector3();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;

  if (!over && !paused) update(dt, time);
  updateParticles(dt);

  // Mensajes en pantalla
  if (msgTimer > 0) {
    msgTimer -= dt;
    if (msgTimer <= 0) msgEl.style.opacity = 0;
  }

  // Cámara con seguimiento, sacudida y cambio de campo de visión
  camTarget.set(player.position.x, 10, player.position.z + 14);
  camBase.lerp(camTarget, 0.08);
  shake = Math.max(0, shake - dt * 2);
  camera.position.copy(camBase);
  camera.position.x += (Math.random() - 0.5) * shake;
  camera.position.y += (Math.random() - 0.5) * shake;
  camera.lookAt(player.position);
  const targetFov = dashT > 0 ? 72 : boostT > 0 ? 66 : 60;
  camera.fov += (targetFov - camera.fov) * 0.1;
  camera.updateProjectionMatrix();

  updateHud();
  renderer.render(scene, camera);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

reset();
animate();