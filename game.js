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
const GRAVITY_WATER = 0.12;
const JUMP_V        = -13;
const SWIM_UP_V     = -3.5;
const MOVE_SPEED    = 3.8;
const SWIM_SPEED    = 2.8;
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

  // Water zones (sunken pools in the ground)
  waterZones = [];
  let wcur = 400;
  while (wcur < LEVEL_W - 600) {
    const ww = 120 + rng() * 160;
    const wy = GROUND_Y + 4;      // surface just below ground top
    const wd = 80 + rng() * 40;   // depth
    waterZones.push({ x: wcur, y: wy, w: ww, h: wd, surfaceY: wy });
    // gap in ground — handled by painting water over sand
    wcur += ww + 200 + rng() * 300;
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
      vx: (rng() > 0.5 ? 1 : -1) * (1.2 + rng() * 0.8 + level * 0.2),
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
        vx: (rng() > 0.5 ? 1 : -1) * (0.9 + rng() * 0.6 + level * 0.15),
        left: wz.x + 8, right: wz.x + wz.w - 40,
        w: 52, h: 22, wz,
      });
    }
  }

  // Family of otters at the end
  family = { x: LEVEL_W - 180, y: GROUND_Y - 52, w: 80, h: 52, found: false };

  // Player
  resetPlayer();
}

function resetPlayer() {
  player = {
    x: 60, y: GROUND_Y - 46,
    w: 34, h: 38,
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
  let inWaterZone = null;
  for (const wz of waterZones) {
    if (player.x + player.w > wz.x && player.x < wz.x + wz.w &&
        player.y + player.h > wz.y && player.y < wz.y + wz.h) {
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
    // Float near surface
    if (player.y < inWaterZone.surfaceY && player.vy < 0) player.vy *= 0.5;
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
      // Top collision (landing)
      if (player.vx >= -MOVE_SPEED - 1 &&  // wide check not needed, standard rect
          player.x + player.w > p.x && player.x < p.x + p.w &&
          player.y + player.h > p.y && player.y + player.h < p.y + p.h + 14 &&
          player.vy >= 0) {
        player.y = p.y - player.h;
        player.vy = 0;
        player.onGround = true;
        player.jumpsLeft = 2;
      }
    }
  }

  // ── Water surface clamp ──
  if (inWaterZone) {
    // Don't float above the surface
    if (player.y < inWaterZone.surfaceY - 2 && player.vy < 0) {
      player.y = inWaterZone.surfaceY - 2;
      player.vy = 0;
    }
    // Don't sink through the bottom
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
        h.diveVy  = 3 + level * 0.4;
        h.savedY  = h.y;
        h.savedVx = h.vx;
      }
    } else {
      // Diving
      h.y += h.diveVy;
      h.diveVy = Math.min(h.diveVy + 0.3, 8);
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
  setTimeout(() => showScreen(winScreen), 600);
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

  // ── Water zones (painted under ground) ──
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

  // ── Ground (sand) ──
  const sandGrad = ctx.createLinearGradient(0, GROUND_Y, 0, H);
  sandGrad.addColorStop(0, PAL.sandTop);
  sandGrad.addColorStop(0.2, PAL.sandBody);
  sandGrad.addColorStop(1, '#a07838');
  ctx.fillStyle = sandGrad;
  ctx.fillRect(0, GROUND_Y, LEVEL_W, H - GROUND_Y);

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

  // ── Family of otters (goal) ──
  if (!family.found) {
    drawFamilyOtters(t);
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
  const fx = family.x, fy = family.y;
  // Glow
  ctx.shadowColor = PAL.familyGlow;
  ctx.shadowBlur  = 24;
  // Draw three small otters
  const offsets = [0, 28, 56];
  for (let i = 0; i < offsets.length; i++) {
    const ox = fx + offsets[i];
    const oy = fy + Math.sin(t * 0.003 + i * 1.2) * 3;
    drawOtterShape(ox, oy, 22, 28, true, (i % 2 === 0));
  }
  ctx.shadowBlur = 0;

  // Floating hearts
  for (let i = 0; i < 3; i++) {
    const hx = fx + 14 + i * 28;
    const hy = fy - 18 + Math.sin(t * 0.004 + i) * 5;
    ctx.globalAlpha = 0.6 + 0.4 * Math.abs(Math.sin(t * 0.003 + i));
    ctx.fillStyle = PAL.heartColor;
    ctx.font = '14px serif';
    ctx.fillText('♥', hx, hy);
  }
  ctx.globalAlpha = 1;
}

function drawOtterShape(x, y, w, h, small, flip) {
  ctx.save();
  if (flip) { ctx.scale(-1, 1); ctx.translate(-(x * 2 + w), 0); }

  // Body
  ctx.fillStyle = PAL.otterBrown;
  ctx.beginPath();
  ctx.roundRect(x + 2, y + h * 0.35, w - 4, h * 0.55, 6);
  ctx.fill();

  // Belly
  ctx.fillStyle = PAL.otterBelly;
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + h * 0.62, w * 0.28, h * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  // Head
  ctx.fillStyle = PAL.otterBrown;
  ctx.beginPath();
  ctx.roundRect(x + 3, y, w - 6, h * 0.42, 8);
  ctx.fill();

  // Muzzle
  ctx.fillStyle = PAL.otterBelly;
  ctx.beginPath();
  ctx.ellipse(x + w - 9, y + h * 0.22, w * 0.22, h * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();

  // Nose
  ctx.fillStyle = PAL.otterNose;
  ctx.beginPath();
  ctx.ellipse(x + w - 5, y + h * 0.18, 3, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Eye
  ctx.fillStyle = '#1a0a00';
  ctx.beginPath();
  ctx.arc(x + w - 10, y + h * 0.14, 2.5, 0, Math.PI * 2);
  ctx.fill();
  // Eye shine
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x + w - 11, y + h * 0.13, 1, 0, Math.PI * 2);
  ctx.fill();

  // Tail
  ctx.strokeStyle = PAL.otterBrown;
  ctx.lineWidth   = 5;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(x + 4, y + h * 0.75);
  ctx.quadraticCurveTo(x - 8, y + h * 0.9, x + 2, y + h + 4);
  ctx.stroke();

  ctx.restore();
}

function drawPlayer(t) {
  const px = player.x, py = player.y, pw = player.w, ph = player.h;

  // Blink when invincible
  if (player.invincible > 0 && Math.floor(player.invincible / 5) % 2 === 0) {
    ctx.globalAlpha = 0.35;
  }

  // Water ripple ring
  if (player.inWater) {
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.ellipse(px + pw / 2, py + ph * 0.5, pw * 0.7, ph * 0.25, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Leg animation
  const legSwing = player.onGround
    ? Math.sin(t * 0.025 * (Math.abs(player.vx) > 0.5 ? 1 : 0)) * 5
    : (player.inWater ? Math.sin(t * 0.015) * 6 : 0);

  const flip = !player.facingRight;
  ctx.save();
  if (flip) { ctx.scale(-1, 1); ctx.translate(-(px * 2 + pw), 0); }

  // Legs
  ctx.fillStyle = PAL.otterBrown;
  ctx.beginPath(); ctx.roundRect(px + 4,      py + ph - 12 + legSwing, 10, 12, 3); ctx.fill();
  ctx.beginPath(); ctx.roundRect(px + pw - 14, py + ph - 12 - legSwing, 10, 12, 3); ctx.fill();
  // Feet
  ctx.fillStyle = PAL.otterBelly;
  ctx.beginPath(); ctx.ellipse(px + 9,       py + ph + 1 + legSwing, 7, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(px + pw - 9,  py + ph + 1 - legSwing, 7, 4, 0, 0, Math.PI * 2); ctx.fill();

  // Body
  ctx.fillStyle = PAL.otterBrown;
  ctx.beginPath(); ctx.roundRect(px + 2, py + ph * 0.38, pw - 4, ph * 0.52, 7); ctx.fill();

  // Belly
  ctx.fillStyle = PAL.otterBelly;
  ctx.beginPath(); ctx.ellipse(px + pw / 2, py + ph * 0.64, pw * 0.28, ph * 0.2, 0, 0, Math.PI * 2); ctx.fill();

  // Head
  ctx.fillStyle = PAL.otterBrown;
  ctx.beginPath(); ctx.roundRect(px + 3, py, pw - 6, ph * 0.44, 9); ctx.fill();

  // Muzzle
  ctx.fillStyle = PAL.otterBelly;
  ctx.beginPath(); ctx.ellipse(px + pw - 8, py + ph * 0.22, pw * 0.22, ph * 0.14, 0, 0, Math.PI * 2); ctx.fill();

  // Nose
  ctx.fillStyle = PAL.otterNose;
  ctx.beginPath(); ctx.ellipse(px + pw - 4, py + ph * 0.17, 3.5, 2.5, 0, 0, Math.PI * 2); ctx.fill();

  // Eye
  ctx.fillStyle = '#1a0a00';
  ctx.beginPath(); ctx.arc(px + pw - 11, py + ph * 0.13, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(px + pw - 12, py + ph * 0.12, 1.2, 0, Math.PI * 2); ctx.fill();

  // Ears
  ctx.fillStyle = PAL.otterBrown;
  ctx.beginPath(); ctx.ellipse(px + pw - 8, py + 2, 5, 4, -0.3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(px + 8,      py + 2, 5, 4, 0.3, 0, Math.PI * 2); ctx.fill();

  // Tail
  ctx.strokeStyle = PAL.otterBrown;
  ctx.lineWidth   = 5;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(px + 5, py + ph * 0.72);
  ctx.quadraticCurveTo(px - 10, py + ph * 0.88, px + 1, py + ph + 6);
  ctx.stroke();

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
