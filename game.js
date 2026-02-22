'use strict';

// ─── Canvas & context ────────────────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');
const W = 800, H = 480;

// ─── DOM ─────────────────────────────────────────────────────────────────────
const overlay        = document.getElementById('overlay');
const startScreen    = document.getElementById('start-screen');
const gameoverScreen = document.getElementById('gameover-screen');
const winScreen      = document.getElementById('win-screen');
const levelupScreen  = document.getElementById('levelup-screen');
const livesPip       = document.getElementById('lives-pip');
const clamCountEl    = document.getElementById('clam-count');
const levelNumEl     = document.getElementById('level-num');
const finalClamsEl   = document.getElementById('final-clams');
const winClamsEl     = document.getElementById('win-clams');
const nextLevelNumEl = document.getElementById('next-level-num');
const countdownEl    = document.getElementById('countdown');
const msgRibbon      = document.getElementById('message-ribbon');

document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('restart-btn').addEventListener('click', startGame);
document.getElementById('next-btn').addEventListener('click', () => { level++; startLevel(); });

// ─── Touch / on-screen controls ───────────────────────────────────────────────
// Bind a touch button to a logical key. pointerdown/up works for both touch & mouse.
function bindTouchBtn(id, key, triggerJump) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('pointerdown', e => {
    e.preventDefault();
    keys[key] = true;
    if (triggerJump && state === 'playing') handleJump();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev =>
    el.addEventListener(ev, e => { e.preventDefault(); keys[key] = false; })
  );
}

// Prevent the canvas from triggering browser scroll / pinch-zoom on touch
canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
canvas.addEventListener('touchmove',  e => e.preventDefault(), { passive: false });

// ─── Cozy colour palette ──────────────────────────────────────────────────────
const PAL = {
  skyTop:      '#7ec8e3',
  skyBot:      '#c8e8f0',
  sunColor:    '#ffe08a',
  cloudColor:  '#ffffff',
  waterDeep:   '#2a7fa8',
  waterShallow:'#4eb5d4',
  waterSurface:'#6dd4ef',
  sandTop:     '#e8c87a',
  sandBody:    '#c8a050',
  rockTop:     '#9a8870',
  rockBody:    '#7a6850',
  rockHighlight:'#b8a888',
  grassTop:    '#6ab84a',
  treeLeaf:    '#4a9a30',
  treeTrunk:   '#6a4a20',
  reedGreen:   '#5a8a20',
  otterBrown:  '#8b5e3c',
  otterBelly:  '#d4a872',
  otterNose:   '#5a3020',
  clam:        '#e8d0b8',
  clamInner:   '#f0a080',
  clamShine:   '#ffffff',
  hawkBody:    '#6a4a20',
  hawkWing:    '#4a3010',
  hawkEye:     '#cc2020',
  sharkBody:   '#607080',
  sharkBelly:  '#c8d8e0',
  sharkFin:    '#506070',
  bubble:      'rgba(255,255,255,0.55)',
  sparkle:     '#ffe0a0',
  heartColor:  '#e86060',
  familyGlow:  '#ffe0a0',
};

// ─── Physics constants ────────────────────────────────────────────────────────
const GRAVITY_LAND  = 0.6;
const GRAVITY_WATER = -0.06;  // negative = buoyancy; otter floats up when idle
const JUMP_V        = -13;
const SWIM_UP_V     = -3.5;
const MOVE_SPEED    = 2.5;
const SWIM_SPEED    = 1.9;
const WATER_DRAG    = 0.88;
const LAND_FRIC     = 0.78;

// ─── Level geometry ───────────────────────────────────────────────────────────
const LEVEL_W   = 3000;
const GROUND_Y  = H - 90;   // top of sandy ground
const WATER_Y   = GROUND_Y; // water surface at the same height (water bodies are sunken)

// ─── Game state ───────────────────────────────────────────────────────────────
let state   = 'start';
let level   = 1;
let lives   = 3;
let clams   = 0;
let cameraX = 0;
let raf, lastTime = 0;
let msgTimer = 0;

const keys = {};
let justJumped = false;

window.addEventListener('keydown', e => {
  if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' '].includes(e.key)) e.preventDefault();
  if (!keys[e.key]) {
    keys[e.key] = true;
    if ((e.key === 'ArrowUp' || e.key === ' ') && state === 'playing') handleJump();
  }
});
window.addEventListener('keyup', e => { keys[e.key] = false; });

// Wire up the on-screen touch buttons (handleJump is hoisted as a function declaration)
bindTouchBtn('btn-left',  'ArrowLeft',  false);
bindTouchBtn('btn-right', 'ArrowRight', false);
bindTouchBtn('btn-up',    'ArrowUp',    true);
bindTouchBtn('btn-down',  'ArrowDown',  false);

// ─── Entities ─────────────────────────────────────────────────────────────────
let player, platforms, waterZones, clamItems, hawks, sharks, family, particles, bubbles, clouds;

// ─── Seeded RNG ───────────────────────────────────────────────────────────────
function mkRng(seed) {
  let s = seed >>> 0;
  return () => { s = Math.imul(s ^ (s >>> 17), 0x45d9f3b) >>> 0; s ^= s >>> 11; s = Math.imul(s ^ (s << 4), 0x27d4eb2d) >>> 0; return (s >>> 0) / 0xffffffff; };
}

// ─── Build level ──────────────────────────────────────────────────────────────
function buildLevel() {
  const rng = mkRng(level * 99991);
  cameraX   = 0;
  particles = [];
  bubbles   = [];

  // Clouds (parallax background)
  clouds = [];
  for (let i = 0; i < 9; i++) {
    clouds.push({ x: rng() * LEVEL_W, y: 30 + rng() * 100, w: 80 + rng() * 120, speed: 0.15 + rng() * 0.2 });
  }

  // Ground platforms (sandy ledges and rocks)
  platforms = [
    // Long sandy ground
    { x: 0,          y: GROUND_Y, w: LEVEL_W, h: H - GROUND_Y, type: 'sand' },
  ];

  // Add raised rocky platforms
  let cur = 260;
  while (cur < LEVEL_W - 500) {
    const pw  = 90 + rng() * 130;
    const ph  = 20 + rng() * 10;
    const py  = GROUND_Y - 80 - rng() * 130;
    platforms.push({ x: cur, y: py, w: pw, h: ph, type: rng() > 0.4 ? 'rock' : 'grass' });
    cur += pw + 100 + rng() * 200;
  }

  // Water zones (sunken pools in the ground) — mostly water, less land
  waterZones = [];
  let wcur = 180;
  while (wcur < LEVEL_W - 280) {
    const ww = 200 + rng() * 180;
    const wy = GROUND_Y;           // surface at ground level so player can enter
    const wd = 100 + rng() * 50;  // depth
    waterZones.push({ x: wcur, y: wy, w: ww, h: wd, surfaceY: wy });
    // smaller gap between zones so water dominates
    wcur += ww + 60 + rng() * 110;
  }

  // Clams — on platforms and in water
  clamItems = [];
  for (const p of platforms) {
    if (p.type === 'sand' && p.x === 0) continue; // skip main ground for now
    const count = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < count; i++) {
      clamItems.push({ x: p.x + 10 + rng() * (p.w - 20), y: p.y - 16, collected: false, bob: rng() * Math.PI * 2 });
    }
  }
  // Clams scattered on ground
  for (let i = 0; i < 6 + level * 2; i++) {
    const cx = 150 + rng() * (LEVEL_W - 400);
    clamItems.push({ x: cx, y: GROUND_Y - 16, collected: false, bob: rng() * Math.PI * 2 });
  }
  // Clams inside water zones
  for (const wz of waterZones) {
    const count = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < count; i++) {
      clamItems.push({ x: wz.x + 14 + rng() * (wz.w - 28), y: wz.y + 20 + rng() * (wz.h - 30), collected: false, bob: rng() * Math.PI * 2, inWater: true });
    }
  }

  // Hawks — patrol the sky in the land sections
  hawks = [];
  const hawkCount = 1 + Math.floor(level * 0.8);
  for (let i = 0; i < hawkCount; i++) {
    const hx = 400 + rng() * (LEVEL_W - 900);
    const patrolRange = 180 + rng() * 120;
    hawks.push({
      x: hx, y: 80 + rng() * 120,
      vx: (rng() > 0.5 ? 1 : -1) * (0.6 + rng() * 0.4 + level * 0.1),
      left: hx - patrolRange / 2, right: hx + patrolRange / 2,
      dive: false, diveY: 0, diveVy: 0, diveTarget: null,
      w: 38, h: 22,
    });
  }

  // Sharks — patrol inside water zones
  sharks = [];
  for (const wz of waterZones) {
    if (rng() > 0.45) {
      sharks.push({
        x: wz.x + 10, y: wz.y + wz.h / 2,
        vx: (rng() > 0.5 ? 1 : -1) * (0.45 + rng() * 0.3 + level * 0.08),
        left: wz.x + 8, right: wz.x + wz.w - 40,
        w: 52, h: 22, wz,
      });
    }
  }

  // Family of otters at the end
  family = { x: LEVEL_W - 260, y: GROUND_Y - 46, w: 130, h: 46, found: false };

  // Player
  resetPlayer();
}

function resetPlayer() {
  player = {
    x: 60, y: GROUND_Y - 32,
    w: 48, h: 26,
    vx: 0, vy: 0,
    onGround: false,
    inWater: false,
    facingRight: true,
    jumpsLeft: 2,
    invincible: 0,   // frames
    frame: 0, frameTimer: 0,
  };
}

// ─── Input ────────────────────────────────────────────────────────────────────
function handleJump() {
  if (player.inWater) {
    player.vy = SWIM_UP_V;
  } else if (player.jumpsLeft > 0) {
    player.vy = JUMP_V;
    player.jumpsLeft--;
    spawnJumpPuff();
  }
}

// ─── Update ──────────────────────────────────────────────────────────────────
function update(dt) {
  if (state !== 'playing') return;

  // ── Determine water state ──
  // Use center-x so half-in/half-out doesn't flicker; enter when feet reach ground level
  let inWaterZone = null;
  const pcx = player.x + player.w / 2;
  for (const wz of waterZones) {
    if (pcx > wz.x && pcx < wz.x + wz.w && player.y + player.h >= wz.y) {
      inWaterZone = wz;
      break;
    }
  }
  player.inWater = !!inWaterZone;

  // ── Horizontal movement ──
  const speed = player.inWater ? SWIM_SPEED : MOVE_SPEED;
  if (keys['ArrowLeft'] || keys['a']) {
    player.vx = -speed;
    player.facingRight = false;
  } else if (keys['ArrowRight'] || keys['d']) {
    player.vx = speed;
    player.facingRight = true;
  } else {
    player.vx *= player.inWater ? WATER_DRAG : LAND_FRIC;
  }

  // ── Vertical movement ──
  if (player.inWater) {
    player.vy += GRAVITY_WATER;
    // Gentle down-key swim
    if (keys['ArrowDown'] || keys['s']) player.vy = Math.min(player.vy + 0.4, 3);
    player.vy *= 0.9;
    player.jumpsLeft = 2;
    // Bubble trail
    if (Math.random() < 0.12) spawnBubble(player.x + player.w / 2, player.y + player.h / 2);
  } else {
    player.vy += GRAVITY_LAND;
  }

  player.x += player.vx;
  player.y += player.vy;

  // ── Clamp to level bounds ──
  if (player.x < 0) { player.x = 0; player.vx = 0; }
  if (player.x + player.w > LEVEL_W) { player.x = LEVEL_W - player.w; player.vx = 0; }

  // ── Platform collisions (only when not in water) ──
  player.onGround = false;
  if (!player.inWater) {
    for (const p of platforms) {
      // Skip the main ground slab directly over water zones so the otter can enter pools
      if (p.type === 'sand' && p.x === 0) {
        if (waterZones.some(wz => pcx > wz.x && pcx < wz.x + wz.w)) continue;
      }
      // Top collision (landing)
      if (player.x + player.w > p.x && player.x < p.x + p.w &&
          player.y + player.h > p.y && player.y + player.h < p.y + p.h + 14 &&
          player.vy >= 0) {
        player.y = p.y - player.h;
        player.vy = 0;
        player.onGround = true;
        player.jumpsLeft = 2;
      }
    }
  }

  // ── Water bottom clamp (no top clamp — player swims out naturally) ──
  if (inWaterZone) {
    const wzBottom = inWaterZone.y + inWaterZone.h - player.h;
    if (player.y > wzBottom) { player.y = wzBottom; player.vy = 0; }
  }

  // ── Fall off screen ──
  if (player.y > H + 60) { hitByPredator(); return; }

  // ── Camera ──
  const scrollEdge = W * 0.5;
  const target = player.x - scrollEdge;
  cameraX = Math.max(0, Math.min(LEVEL_W - W, target));

  // ── Collect clams ──
  const pr = playerRect();
  for (const c of clamItems) {
    if (c.collected) continue;
    if (rectsOverlap(pr, { x: c.x - 10, y: c.y - 8, w: 20, h: 18 })) {
      c.collected = true;
      clams++;
      updateHUD();
      spawnSparkles(c.x, c.y, 8);
      showMessage('🐚 +1 clam!');
    }
  }

  // ── Check family ──
  if (!family.found && rectsOverlap(pr, { x: family.x, y: family.y, w: family.w, h: family.h })) {
    family.found = true;
    triggerWin();
    return;
  }

  // ── Hawks ──
  for (const h of hawks) {
    // Patrol
    if (!h.dive) {
      h.x += h.vx;
      if (h.x <= h.left || h.x + h.w >= h.right) h.vx *= -1;

      // Dive trigger — if player is below hawk and nearby
      const distX = Math.abs((h.x + h.w / 2) - (player.x + player.w / 2));
      if (distX < 120 && player.y > h.y && !player.inWater && level >= 1) {
        h.dive    = true;
        h.diveY   = player.y + player.h;
        h.diveVy  = 0.5 + level * 0.1;
        h.savedY  = h.y;
        h.savedVx = h.vx;
      }
    } else {
      // Diving
      h.y += h.diveVy;
      h.diveVy = Math.min(h.diveVy + 0.04, 2.0);
      if (h.y > h.diveY + 30 || h.y > GROUND_Y - 20) {
        // Return to sky
        h.y    = h.savedY || 80;
        h.dive = false;
        h.vx   = h.savedVx;
      }
    }

    if (player.invincible > 0) continue;
    if (rectsOverlap(pr, { x: h.x + 6, y: h.y + 4, w: h.w - 12, h: h.h - 8 })) {
      hitByPredator();
      h.dive = false;
      h.y    = h.savedY || 80;
      return;
    }
  }

  // ── Sharks ──
  for (const sh of sharks) {
    sh.x += sh.vx;
    if (sh.x <= sh.left || sh.x + sh.w >= sh.right) sh.vx *= -1;
    if (player.invincible > 0) continue;
    if (player.inWater && rectsOverlap(pr, { x: sh.x + 6, y: sh.y - 6, w: sh.w - 12, h: sh.h + 6 })) {
      hitByPredator();
      return;
    }
  }

  // ── Particles & bubbles ──
  updateParticles();
  updateBubbles();

  // ── Invincibility countdown ──
  if (player.invincible > 0) player.invincible--;

  // ── Message timer ──
  if (msgTimer > 0) {
    msgTimer--;
    if (msgTimer === 0) msgRibbon.classList.add('hidden');
  }

  // ── Animate player ──
  player.frameTimer++;
  const moving = Math.abs(player.vx) > 0.4;
  if (moving && player.frameTimer > (player.inWater ? 10 : 7)) {
    player.frame = (player.frame + 1) % 4;
    player.frameTimer = 0;
  } else if (!moving) {
    player.frame = 0;
  }
}

function hitByPredator() {
  lives--;
  updateHUD();
  spawnSparkles(player.x + player.w / 2, player.y + player.h / 2, 14);
  showMessage('Careful, little otter! 💦');
  if (lives <= 0) {
    finalClamsEl.textContent = clams;
    state = 'gameover';
    showScreen(gameoverScreen);
  } else {
    resetPlayer();
    cameraX = 0;
    player.invincible = 100;
  }
}

function triggerWin() {
  state = 'win';
  winClamsEl.textContent = clams;
  spawnSparkles(family.x + family.w / 2, family.y, 24);
  setTimeout(() => showScreen(winScreen), 2800); // delay to enjoy the dance party
}

// ─── Particles ───────────────────────────────────────────────────────────────
function spawnSparkles(x, y, count) {
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
    const spd   = 1.5 + Math.random() * 3;
    particles.push({
      x, y,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd - 1.5,
      life: 1, decay: 0.025 + Math.random() * 0.02,
      r: 2 + Math.random() * 3,
      color: Math.random() > 0.5 ? PAL.sparkle : PAL.clamInner,
    });
  }
}

function spawnJumpPuff() {
  for (let i = 0; i < 5; i++) {
    particles.push({
      x: player.x + player.w / 2 + (Math.random() - 0.5) * 12,
      y: player.y + player.h,
      vx: (Math.random() - 0.5) * 2,
      vy: -0.5 - Math.random(),
      life: 1, decay: 0.05,
      r: 4 + Math.random() * 4,
      color: 'rgba(255,255,255,0.7)',
    });
  }
}

function updateParticles() {
  for (const p of particles) {
    p.x += p.vx; p.y += p.vy; p.vy += 0.08; p.life -= p.decay;
  }
  particles = particles.filter(p => p.life > 0);
}

function spawnBubble(x, y) {
  bubbles.push({ x: x + (Math.random() - 0.5) * 10, y, vy: -0.5 - Math.random() * 0.5, life: 1, r: 2 + Math.random() * 3 });
}

function updateBubbles() {
  for (const b of bubbles) { b.y += b.vy; b.life -= 0.012; }
  bubbles = bubbles.filter(b => b.life > 0);
}

// ─── Draw ─────────────────────────────────────────────────────────────────────
function draw(t) {
  ctx.clearRect(0, 0, W, H);

  // Sky
  const skyGrad = ctx.createLinearGradient(0, 0, 0, H * 0.65);
  skyGrad.addColorStop(0, PAL.skyTop);
  skyGrad.addColorStop(1, PAL.skyBot);
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, H);

  // Sun
  const sunX = W * 0.82 - cameraX * 0.05;
  ctx.shadowColor = PAL.sunColor;
  ctx.shadowBlur  = 32;
  ctx.fillStyle   = PAL.sunColor;
  ctx.beginPath();
  ctx.arc(sunX, 60, 36, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Clouds (parallax 0.2)
  ctx.fillStyle = PAL.cloudColor;
  ctx.globalAlpha = 0.85;
  for (const cl of clouds) {
    const cx = ((cl.x - cameraX * 0.2) % (LEVEL_W + 200) + LEVEL_W + 200) % (LEVEL_W + 200) - 100;
    drawCloud(cx, cl.y, cl.w);
  }
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.translate(-cameraX, 0);

  // ── Ground (sand) ──
  const sandGrad = ctx.createLinearGradient(0, GROUND_Y, 0, H);
  sandGrad.addColorStop(0, PAL.sandTop);
  sandGrad.addColorStop(0.2, PAL.sandBody);
  sandGrad.addColorStop(1, '#a07838');
  ctx.fillStyle = sandGrad;
  ctx.fillRect(0, GROUND_Y, LEVEL_W, H - GROUND_Y);

  // ── Water zones (drawn over sand so they're visible as blue pools) ──
  for (const wz of waterZones) {
    if (wz.x + wz.w < cameraX || wz.x > cameraX + W) continue;
    const wGrad = ctx.createLinearGradient(0, wz.y, 0, wz.y + wz.h);
    wGrad.addColorStop(0, PAL.waterSurface);
    wGrad.addColorStop(0.4, PAL.waterShallow);
    wGrad.addColorStop(1, PAL.waterDeep);
    ctx.fillStyle = wGrad;
    ctx.fillRect(wz.x, wz.y, wz.w, wz.h);

    // Gentle water shimmer
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    const shimX = ((t * 0.05) % wz.w);
    ctx.fillRect(wz.x + shimX, wz.y, 30, 5);
    ctx.fillRect(wz.x + (shimX + wz.w * 0.5) % wz.w, wz.y + 3, 20, 3);
  }

  // ── Floating platforms ──
  for (const p of platforms) {
    if (p.x === 0 && p.type === 'sand') continue; // skip ground slab, drawn above
    if (p.x + p.w < cameraX || p.x > cameraX + W) continue;
    drawPlatform(p);
  }

  // ── Background reed/grass tufts ──
  drawReeds(t);

  // ── Clams ──
  for (const c of clamItems) {
    if (c.collected) continue;
    if (c.x < cameraX - 30 || c.x > cameraX + W + 30) continue;
    const bob = Math.sin(t * 0.003 + c.bob) * 2;
    drawClam(c.x, c.y + bob);
  }

  // ── Family of otters (goal / dance) ──
  if (!family.found) {
    drawFamilyOtters(t);
  } else {
    drawFamilyDance(t); // all reunited — everyone dances!
  }

  // ── Sharks ──
  for (const sh of sharks) {
    if (sh.x + sh.w < cameraX || sh.x > cameraX + W) continue;
    drawShark(sh);
  }

  // ── Hawks ──
  for (const h of hawks) {
    if (h.x + h.w < cameraX - 10 || h.x > cameraX + W + 10) continue;
    drawHawk(h, t);
  }

  // ── Player ──
  drawPlayer(t);

  // ── Particles ──
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle   = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // ── Bubbles ──
  for (const b of bubbles) {
    ctx.globalAlpha = b.life * 0.7;
    ctx.strokeStyle = PAL.bubble;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  ctx.restore();
}

// ─── Draw helpers ────────────────────────────────────────────────────────────

function drawCloud(x, y, w) {
  const h = w * 0.38;
  ctx.beginPath();
  ctx.ellipse(x + w * 0.5, y + h * 0.6, w * 0.5, h * 0.45, 0, 0, Math.PI * 2);
  ctx.ellipse(x + w * 0.3, y + h * 0.55, w * 0.32, h * 0.55, 0, 0, Math.PI * 2);
  ctx.ellipse(x + w * 0.7, y + h * 0.52, w * 0.28, h * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawPlatform(p) {
  const isRock = p.type === 'rock';
  const bodyColor = isRock ? PAL.rockBody : '#5a8a38';
  const topColor  = isRock ? PAL.rockTop  : PAL.grassTop;
  const highlight = isRock ? PAL.rockHighlight : '#90d060';

  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.roundRect(p.x, p.y + 6, p.w, p.h - 6, [0, 0, 4, 4]);
  ctx.fill();

  // Top surface
  ctx.fillStyle = topColor;
  ctx.beginPath();
  ctx.roundRect(p.x, p.y, p.w, 10, [4, 4, 0, 0]);
  ctx.fill();

  // Highlight edge
  ctx.fillStyle = highlight;
  ctx.globalAlpha = 0.4;
  ctx.fillRect(p.x + 3, p.y + 2, p.w - 6, 3);
  ctx.globalAlpha = 1;
}

function drawReeds(t) {
  // Decorative reeds near water zones
  for (const wz of waterZones) {
    if (wz.x + wz.w < cameraX || wz.x > cameraX + W) continue;
    const positions = [wz.x - 12, wz.x - 6, wz.x + wz.w + 2, wz.x + wz.w + 10];
    for (const rx of positions) {
      const sway = Math.sin(t * 0.002 + rx) * 3;
      ctx.strokeStyle = PAL.reedGreen;
      ctx.lineWidth   = 3;
      ctx.beginPath();
      ctx.moveTo(rx, GROUND_Y + 2);
      ctx.quadraticCurveTo(rx + sway, GROUND_Y - 22, rx + sway * 1.5, GROUND_Y - 38);
      ctx.stroke();
      ctx.fillStyle = PAL.reedGreen;
      ctx.beginPath();
      ctx.ellipse(rx + sway * 1.5, GROUND_Y - 44, 4, 8, 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawClam(x, y) {
  // Shell halves
  ctx.fillStyle = PAL.clam;
  ctx.beginPath();
  ctx.ellipse(x, y, 10, 6, 0, 0, Math.PI);   // top half
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x, y, 10, 4, 0, Math.PI, Math.PI * 2); // bottom half
  ctx.fill();
  // Inner pearl glow
  ctx.fillStyle = PAL.clamInner;
  ctx.beginPath();
  ctx.ellipse(x, y, 5, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  // Shine
  ctx.fillStyle = PAL.clamShine;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.ellipse(x - 3, y - 2, 2, 1.5, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawFamilyOtters(t) {
  const footY = family.y + family.h; // ground level
  ctx.shadowColor = PAL.familyGlow;
  ctx.shadowBlur  = 24;
  const offsets = [14, 54, 94]; // center-x of each of the three family members
  for (let i = 0; i < offsets.length; i++) {
    const cx = family.x + offsets[i];
    drawStandingOtter(cx, footY, 0.88, i % 2 === 0, t, false, i * 1.5);
  }
  ctx.shadowBlur = 0;

  // Floating hearts
  for (let i = 0; i < 3; i++) {
    const hx = family.x + 14 + i * 36;
    const hy = family.y - 30 + Math.sin(t * 0.004 + i) * 5;
    ctx.globalAlpha = 0.6 + 0.4 * Math.abs(Math.sin(t * 0.003 + i));
    ctx.fillStyle = PAL.heartColor;
    ctx.font = '14px serif';
    ctx.fillText('♥', hx, hy);
  }
  ctx.globalAlpha = 1;
}

function drawFamilyDance(t) {
  const footY = family.y + family.h;
  ctx.shadowColor = '#FFD700';
  ctx.shadowBlur  = 36;
  const offsets = [14, 54, 94];
  for (let i = 0; i < offsets.length; i++) {
    const cx = family.x + offsets[i];
    drawStandingOtter(cx, footY, 0.92, i % 2 === 0, t, true, i * 1.2);
  }
  ctx.shadowBlur = 0;

  // Celebration hearts and stars flying up
  for (let i = 0; i < 5; i++) {
    const hx = family.x - 10 + i * 30;
    const hy = family.y - 28 + Math.sin(t * 0.006 + i * 1.1) * 14;
    ctx.globalAlpha = 0.7 + 0.3 * Math.abs(Math.sin(t * 0.005 + i));
    ctx.fillStyle   = i % 2 === 0 ? PAL.heartColor : '#FFD700';
    ctx.font = `${15 + Math.sin(t * 0.007 + i) * 3}px serif`;
    ctx.fillText(i % 2 === 0 ? '♥' : '★', hx, hy);
  }
  ctx.globalAlpha = 1;
}

function drawStandingOtter(cx, footY, size, flip, t, dancing, phaseOff) {
  const s = size, ph = phaseOff || 0;
  const phase = (t || 0) * 0.008 + ph;

  // Dance / idle animation values
  const sway = dancing ? Math.sin(phase)              * 7 * s : 0;
  const bob  = dancing ? Math.abs(Math.sin(phase))    * 4 * s : 0;
  const lUp  = dancing ? Math.max(0, Math.sin(phase))              : 0;
  const rUp  = dancing ? Math.max(0, Math.sin(phase + Math.PI))    : 0;

  const bx = cx + sway;       // body center x (sways during dance)
  const fy = footY - bob;     // foot y (bobs up during dance)

  // Structural y positions (bottom-up)
  const legH = 14 * s, bodyH = 22 * s, headR = 11 * s;
  const hipY  = fy  - legH;
  const midY  = hipY - bodyH * 0.5;  // body ellipse center
  const shdY  = hipY - bodyH;        // shoulder level
  const hdY   = shdY - headR - 2 * s;// head center

  ctx.save();
  if (flip) { ctx.scale(-1, 1); ctx.translate(-(cx * 2), 0); }

  // ── Tail (curves behind lower body) ──
  ctx.strokeStyle = PAL.otterBrown;
  ctx.lineWidth = 5 * s; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(bx - 5 * s, hipY - bodyH * 0.2);
  ctx.quadraticCurveTo(bx - 16 * s, hipY + 2 * s, bx - 14 * s, fy + 2 * s);
  ctx.stroke();
  ctx.fillStyle = PAL.otterBrown;
  ctx.beginPath();
  ctx.ellipse(bx - 14 * s, fy + 1 * s, 5 * s, 3 * s, 0.5, 0, Math.PI * 2);
  ctx.fill();

  // ── Legs ──
  ctx.fillStyle = PAL.otterBrown;
  ctx.beginPath(); ctx.roundRect(bx - 11 * s, hipY, 9 * s, legH, 3 * s); ctx.fill();
  ctx.beginPath(); ctx.roundRect(bx + 2  * s, hipY, 9 * s, legH, 3 * s); ctx.fill();

  // ── Feet (webbed) ──
  ctx.fillStyle = PAL.otterBrown;
  ctx.beginPath(); ctx.ellipse(bx - 7 * s, fy, 10 * s, 4 * s,  0.1, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(bx + 7 * s, fy, 10 * s, 4 * s, -0.1, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PAL.otterBelly;
  ctx.beginPath(); ctx.ellipse(bx - 7 * s, fy, 7 * s, 2.5 * s,  0.1, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(bx + 7 * s, fy, 7 * s, 2.5 * s, -0.1, 0, Math.PI * 2); ctx.fill();

  // ── Body ──
  ctx.fillStyle = PAL.otterBrown;
  ctx.beginPath(); ctx.ellipse(bx, midY, 13 * s, bodyH * 0.52, 0, 0, Math.PI * 2); ctx.fill();

  // ── Belly patch ──
  ctx.fillStyle = PAL.otterBelly;
  ctx.beginPath(); ctx.ellipse(bx + 3 * s, midY + 2 * s, 8 * s, bodyH * 0.38, 0.1, 0, Math.PI * 2); ctx.fill();

  // ── Arms (raise up when dancing) ──
  ctx.strokeStyle = PAL.otterBrown;
  ctx.lineWidth = 5 * s; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(bx - 12 * s, shdY + 6 * s);
  ctx.lineTo(bx - 12 * s - lUp * 8 * s, shdY + 6 * s - lUp * 16 * s);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(bx + 12 * s, shdY + 6 * s);
  ctx.lineTo(bx + 12 * s + rUp * 8 * s, shdY + 6 * s - rUp * 16 * s);
  ctx.stroke();

  // ── Head ──
  ctx.fillStyle = PAL.otterBrown;
  ctx.beginPath(); ctx.arc(bx, hdY, headR, 0, Math.PI * 2); ctx.fill();

  // ── Muzzle ──
  ctx.fillStyle = PAL.otterBelly;
  ctx.beginPath();
  ctx.ellipse(bx + headR * 0.45, hdY + headR * 0.2, headR * 0.42, headR * 0.32, 0.15, 0, Math.PI * 2);
  ctx.fill();

  // ── Nose ──
  ctx.fillStyle = PAL.otterNose;
  ctx.beginPath();
  ctx.ellipse(bx + headR * 0.75, hdY + headR * 0.08, 2.5 * s, 1.8 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── Eye ──
  ctx.fillStyle = '#1a0a00';
  ctx.beginPath(); ctx.arc(bx + headR * 0.08, hdY - headR * 0.15, 3 * s, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(bx + headR * 0.03, hdY - headR * 0.22, 1.2 * s, 0, Math.PI * 2); ctx.fill();

  // ── Ears ──
  ctx.fillStyle = PAL.otterBrown;
  ctx.beginPath(); ctx.ellipse(bx - headR * 0.5, hdY - headR * 0.75, 5 * s, 4 * s, -0.3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(bx + headR * 0.5, hdY - headR * 0.75, 5 * s, 4 * s,  0.3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#c87878';
  ctx.beginPath(); ctx.ellipse(bx - headR * 0.5, hdY - headR * 0.75, 2.8 * s, 2.2 * s, -0.3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(bx + headR * 0.5, hdY - headR * 0.75, 2.8 * s, 2.2 * s,  0.3, 0, Math.PI * 2); ctx.fill();

  // ── Whiskers ──
  ctx.strokeStyle = 'rgba(210,185,155,0.85)'; ctx.lineWidth = 1;
  const wx = bx + headR * 0.42, wy = hdY + headR * 0.18;
  ctx.beginPath(); ctx.moveTo(wx, wy - 2 * s); ctx.lineTo(wx + 12 * s, wy - 5 * s); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(wx, wy);          ctx.lineTo(wx + 13 * s, wy);          ctx.stroke();
  ctx.beginPath(); ctx.moveTo(wx, wy + 2 * s);  ctx.lineTo(wx + 12 * s, wy + 4 * s);  ctx.stroke();

  ctx.restore();
}

function drawPlayer(t) {
  const px = player.x, py = player.y, pw = player.w, ph = player.h;

  // Blink when invincible
  if (player.invincible > 0 && Math.floor(player.invincible / 5) % 2 === 0) {
    ctx.globalAlpha = 0.35;
  }

  // On land: draw upright standing otter
  if (!player.inWater) {
    drawStandingOtter(px + pw / 2, py + ph, 1.2, !player.facingRight, t, state === 'win', 0);
    ctx.globalAlpha = 1;
    return;
  }

  // In water: draw horizontal swimming otter
  // Water ripple ring
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.ellipse(px + pw / 2, py + ph * 0.55, pw * 0.55, ph * 0.38, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Flipper animation
  const legSwing = Math.sin(t * 0.015) * 5;

  const flip = !player.facingRight;
  ctx.save();
  if (flip) { ctx.scale(-1, 1); ctx.translate(-(px * 2 + pw), 0); }

  // Thick tapering tail (left side, otter tail is wide at base and tapers)
  ctx.strokeStyle = PAL.otterBrown;
  ctx.lineWidth   = 7;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(px + 10, py + ph * 0.5);
  ctx.quadraticCurveTo(px - 5, py + ph * 0.65, px - 2, py + ph * 0.92);
  ctx.stroke();
  // Tail tip slightly wider
  ctx.fillStyle = PAL.otterBrown;
  ctx.beginPath();
  ctx.ellipse(px - 1, py + ph * 0.9, 5, 3, 0.4, 0, Math.PI * 2);
  ctx.fill();

  // Long streamlined body (wide horizontal ellipse)
  ctx.fillStyle = PAL.otterBrown;
  ctx.beginPath();
  ctx.ellipse(px + pw * 0.44, py + ph * 0.54, pw * 0.44, ph * 0.41, 0, 0, Math.PI * 2);
  ctx.fill();

  // Belly patch (cream colored, elongated)
  ctx.fillStyle = PAL.otterBelly;
  ctx.beginPath();
  ctx.ellipse(px + pw * 0.41, py + ph * 0.6, pw * 0.3, ph * 0.27, 0, 0, Math.PI * 2);
  ctx.fill();

  // Back feet (left side, short stubby with webbing)
  ctx.fillStyle = PAL.otterBrown;
  ctx.beginPath(); ctx.roundRect(px + 10, py + ph * 0.74 + legSwing, 9, 8, 2); ctx.fill();
  ctx.beginPath(); ctx.roundRect(px + 21, py + ph * 0.74 - legSwing, 9, 8, 2); ctx.fill();
  // Front feet (right side)
  ctx.beginPath(); ctx.roundRect(px + pw * 0.58, py + ph * 0.74 + legSwing, 9, 8, 2); ctx.fill();
  ctx.beginPath(); ctx.roundRect(px + pw * 0.72, py + ph * 0.74 - legSwing, 9, 8, 2); ctx.fill();

  // Webbed feet (flat, fan-shaped)
  ctx.fillStyle = PAL.otterBelly;
  ctx.beginPath(); ctx.ellipse(px + 14, py + ph + 2 + legSwing, 9, 3.5, 0.15, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(px + 25, py + ph + 2 - legSwing, 9, 3.5, -0.15, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(px + pw * 0.63, py + ph + 2 + legSwing, 9, 3.5, 0.15, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(px + pw * 0.77, py + ph + 2 - legSwing, 9, 3.5, -0.15, 0, Math.PI * 2); ctx.fill();

  // Head — big, round, friendly (right end)
  ctx.fillStyle = PAL.otterBrown;
  ctx.beginPath();
  ctx.arc(px + pw - 11, py + ph * 0.38, ph * 0.48, 0, Math.PI * 2);
  ctx.fill();

  // Muzzle — broad and soft (forward-pointing)
  ctx.fillStyle = PAL.otterBelly;
  ctx.beginPath();
  ctx.ellipse(px + pw - 2, py + ph * 0.46, ph * 0.22, ph * 0.17, 0.25, 0, Math.PI * 2);
  ctx.fill();

  // Nose — small heart-shaped suggestion
  ctx.fillStyle = PAL.otterNose;
  ctx.beginPath();
  ctx.ellipse(px + pw + 2, py + ph * 0.38, 3.5, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Eye — large, round, expressive (higher on head = friendlier)
  ctx.fillStyle = '#1a0a00';
  ctx.beginPath();
  ctx.arc(px + pw - 18, py + ph * 0.22, 4.2, 0, Math.PI * 2);
  ctx.fill();
  // Eye shine
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(px + pw - 19.5, py + ph * 0.19, 1.7, 0, Math.PI * 2);
  ctx.fill();
  // Second tiny shine for extra cuteness
  ctx.beginPath();
  ctx.arc(px + pw - 16, py + ph * 0.26, 0.8, 0, Math.PI * 2);
  ctx.fill();

  // Whiskers (friendly detail)
  ctx.strokeStyle = 'rgba(210,185,155,0.85)';
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(px + pw - 5, py + ph * 0.43); ctx.lineTo(px + pw + 9, py + ph * 0.38); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(px + pw - 5, py + ph * 0.47); ctx.lineTo(px + pw + 9, py + ph * 0.46); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(px + pw - 5, py + ph * 0.51); ctx.lineTo(px + pw + 8, py + ph * 0.55); ctx.stroke();

  // Ears — small rounded, on top of head
  ctx.fillStyle = PAL.otterBrown;
  ctx.beginPath(); ctx.ellipse(px + pw - 24, py + ph * 0.04, 5.5, 4.5, -0.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(px + pw - 11, py + ph * 0.02, 5.5, 4.5, 0.2, 0, Math.PI * 2); ctx.fill();
  // Inner ear
  ctx.fillStyle = '#c87878';
  ctx.beginPath(); ctx.ellipse(px + pw - 24, py + ph * 0.04, 3, 2.5, -0.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(px + pw - 11, py + ph * 0.02, 3, 2.5, 0.2, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawHawk(h, t) {
  const hx = h.x, hy = h.y;
  const wingFlap = Math.sin(t * 0.018) * 8;

  ctx.save();
  if (h.vx < 0) { ctx.scale(-1, 1); ctx.translate(-(hx * 2 + h.w), 0); }

  // Wings
  ctx.fillStyle = PAL.hawkWing;
  // Left wing
  ctx.beginPath();
  ctx.moveTo(hx + 4, hy + 8);
  ctx.quadraticCurveTo(hx - 10, hy - 2 + wingFlap, hx - 18, hy + 4 + wingFlap);
  ctx.quadraticCurveTo(hx - 8, hy + 14, hx + 4, hy + 10);
  ctx.fill();
  // Right wing
  ctx.beginPath();
  ctx.moveTo(hx + h.w - 4, hy + 8);
  ctx.quadraticCurveTo(hx + h.w + 10, hy - 2 + wingFlap, hx + h.w + 18, hy + 4 + wingFlap);
  ctx.quadraticCurveTo(hx + h.w + 8, hy + 14, hx + h.w - 4, hy + 10);
  ctx.fill();
  // Body
  ctx.fillStyle = PAL.hawkBody;
  ctx.beginPath();
  ctx.ellipse(hx + h.w / 2, hy + h.h / 2, h.w / 2, h.h / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  // Head
  ctx.beginPath();
  ctx.arc(hx + h.w - 7, hy + 5, 7, 0, Math.PI * 2);
  ctx.fill();
  // Eye
  ctx.fillStyle = PAL.hawkEye;
  ctx.beginPath();
  ctx.arc(hx + h.w - 4, hy + 4, 2.5, 0, Math.PI * 2);
  ctx.fill();
  // Beak
  ctx.fillStyle = '#d4a020';
  ctx.beginPath();
  ctx.moveTo(hx + h.w - 1, hy + 6);
  ctx.lineTo(hx + h.w + 6, hy + 9);
  ctx.lineTo(hx + h.w - 1, hy + 11);
  ctx.fill();

  ctx.restore();
}

function drawShark(sh) {
  const sx = sh.x, sy = sh.y;
  const facingRight = sh.vx > 0;

  ctx.save();
  if (!facingRight) { ctx.scale(-1, 1); ctx.translate(-(sx * 2 + sh.w), 0); }

  // Body
  const bodyGrad = ctx.createLinearGradient(sx, sy - sh.h / 2, sx, sy + sh.h / 2);
  bodyGrad.addColorStop(0, PAL.sharkBody);
  bodyGrad.addColorStop(1, PAL.sharkBelly);
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.quadraticCurveTo(sx + sh.w * 0.5, sy - sh.h * 0.6, sx + sh.w, sy);
  ctx.quadraticCurveTo(sx + sh.w * 0.5, sy + sh.h * 0.5, sx, sy);
  ctx.fill();

  // Dorsal fin
  ctx.fillStyle = PAL.sharkFin;
  ctx.beginPath();
  ctx.moveTo(sx + sh.w * 0.45, sy - sh.h * 0.55);
  ctx.lineTo(sx + sh.w * 0.55, sy - sh.h * 1.1);
  ctx.lineTo(sx + sh.w * 0.7,  sy - sh.h * 0.5);
  ctx.fill();

  // Eye
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(sx + sh.w * 0.82, sy - sh.h * 0.15, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(sx + sh.w * 0.82, sy - sh.h * 0.17, 1.2, 0, Math.PI * 2);
  ctx.fill();

  // Teeth
  ctx.fillStyle = '#fff';
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(sx + sh.w * 0.9 + i * -4, sy - 2);
    ctx.lineTo(sx + sh.w * 0.9 + i * -4 - 2, sy + 5);
    ctx.lineTo(sx + sh.w * 0.9 + i * -4 + 2, sy + 5);
    ctx.fill();
  }

  ctx.restore();
}

// ─── Collision helpers ────────────────────────────────────────────────────────
function playerRect() {
  return { x: player.x + 4, y: player.y + 4, w: player.w - 8, h: player.h - 4 };
}
function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// ─── HUD ─────────────────────────────────────────────────────────────────────
function updateHUD() {
  clamCountEl.textContent = clams;
  levelNumEl.textContent  = level;
  // Hearts
  livesPip.innerHTML = '';
  for (let i = 0; i < lives; i++) {
    const s = document.createElement('span');
    s.textContent = '♥';
    livesPip.appendChild(s);
  }
}

function showMessage(text, duration = 90) {
  msgRibbon.textContent = text;
  msgRibbon.classList.remove('hidden');
  msgTimer = duration;
}

// ─── Screen helpers ───────────────────────────────────────────────────────────
function showScreen(el) {
  overlay.classList.remove('hidden');
  [startScreen, gameoverScreen, winScreen, levelupScreen].forEach(s => s.classList.add('hidden'));
  el.classList.remove('hidden');
}

function hideOverlay() { overlay.classList.add('hidden'); }

function showLevelUp() {
  nextLevelNumEl.textContent = level + 1;
  showScreen(levelupScreen);
  let n = 3;
  countdownEl.textContent = n;
  const iv = setInterval(() => {
    n--;
    if (n <= 0) { clearInterval(iv); level++; startLevel(); }
    else countdownEl.textContent = n;
  }, 1000);
}

// ─── Game lifecycle ───────────────────────────────────────────────────────────
function startGame() {
  clams = 0;
  lives = 3;
  level = 1;
  startLevel();
}

function startLevel() {
  state     = 'playing';
  particles = [];
  bubbles   = [];
  buildLevel();
  updateHUD();
  hideOverlay();
  msgRibbon.classList.add('hidden');
  if (!raf) loop(0);
}

// ─── Main loop ────────────────────────────────────────────────────────────────
function loop(t) {
  raf = requestAnimationFrame(loop);
  const dt = Math.min(t - lastTime, 32);
  lastTime = t;
  update(dt);
  draw(t);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
// Paint background on start so the canvas isn't blank
(function boot() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, PAL.skyTop);
  g.addColorStop(1, PAL.skyBot);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
})();
