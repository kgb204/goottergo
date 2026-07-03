'use strict';

// ─── WebGL post-processing layer (PixiJS) ────────────────────────────────────
// The game keeps drawing to its own 2D canvas exactly as before. Each frame,
// that canvas is uploaded as a texture and re-rendered through WebGL with:
//   • a bloom pass — bright areas (sun, glints, night lights, sparkles)
//     bleed a soft glow over the scene
//   • refractive water — each visible pool re-samples the scene through an
//     animated displacement map, so everything under water genuinely ripples
// If WebGL or the library is unavailable, gameFX.active stays false and the
// plain 2D canvas remains visible — the game is fully playable without this.

window.gameFX = { active: false, render: null };

(async function initFX() {
  if (!window.PIXI) return;
  try {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const app = new PIXI.Application();
    await app.init({
      width: W, height: H,
      resolution: dpr,
      autoDensity: true,
      preference: 'webgl',
      antialias: false,
      backgroundColor: 0x000000,
    });

    // ── Base scene: the game's canvas as a live texture ──
    const baseTex = PIXI.Texture.from(canvas);
    const baseSprite = new PIXI.Sprite(baseTex);

    // ── Displacement map: smooth procedural noise (no external assets) ──
    function makeNoiseTexture() {
      const S = 256;
      const nc = document.createElement('canvas');
      nc.width = nc.height = S;
      const nctx = nc.getContext('2d');
      const img = nctx.createImageData(S, S);
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const i = (y * S + x) * 4;
          img.data[i]     = 128 + 55 * Math.sin(x * 0.10) * Math.cos(y * 0.13) + 35 * Math.sin((x + y) * 0.07);
          img.data[i + 1] = 128 + 55 * Math.cos(x * 0.12 + 2) * Math.sin(y * 0.09 + 1) + 35 * Math.cos((x - y) * 0.06);
          img.data[i + 2] = 128;
          img.data[i + 3] = 255;
        }
      }
      nctx.putImageData(img, 0, 0);
      return PIXI.Texture.from(nc);
    }

    const dispSprite = new PIXI.Sprite(makeNoiseTexture());
    dispSprite.renderable = false;
    dispSprite.scale.set(6); // 256 × 6 = 1536px coverage; drift stays within it
    const dispFilter = new PIXI.DisplacementFilter({ sprite: dispSprite, scale: 5 });

    // ── Water refraction sprites: one per visible pool, re-sampling the
    //    scene texture through the displacement filter ──
    // Keep the displacement bleed tight; the mask below clips whatever remains
    dispFilter.padding = 0;
    const MAX_POOLS = 6;
    const waterSprites = [];
    const waterMasks = [];
    for (let i = 0; i < MAX_POOLS; i++) {
      const tex = new PIXI.Texture({ source: baseTex.source, frame: new PIXI.Rectangle(0, 0, 2, 2) });
      const sp = new PIXI.Sprite(tex);
      sp.visible = false;
      sp.filters = [dispFilter];
      // A rectangle mask pinned to the pool clips the rippling output so the
      // displaced water can never render out over the surrounding sand.
      const mask = new PIXI.Graphics();
      sp.mask = mask;
      waterSprites.push(sp);
      waterMasks.push(mask);
    }

    // ── Bloom: brights-only copy of the scene, blurred, added on top.
    //    High threshold so only genuinely bright pixels glow (sun, glints,
    //    night lights, sparkles) — not the whole sky. ──
    const bloomSprite = new PIXI.Sprite(baseTex);
    const brightPass = new PIXI.ColorMatrixFilter();
    brightPass.matrix = [
      3.0, 0,   0,   0, -2.1,
      0,   3.0, 0,   0, -2.1,
      0,   0,   3.0, 0, -2.1,
      0,   0,   0,   1,  0,
    ];
    const bloomBlur = new PIXI.BlurFilter({ strength: 8, quality: 2, resolution: 0.5 });
    // With filters, the additive composite must be set on the final filter pass
    bloomBlur.blendMode = 'add';
    bloomSprite.filters = [brightPass, bloomBlur];
    bloomSprite.blendMode = 'add';
    bloomSprite.alpha = 0.45;

    app.stage.addChild(baseSprite);
    for (let i = 0; i < waterSprites.length; i++) {
      app.stage.addChild(waterSprites[i]);
      app.stage.addChild(waterMasks[i]);
    }
    app.stage.addChild(bloomSprite);
    app.stage.addChild(dispSprite);

    // ── Swap the visible canvas: hide the 2D one, show the WebGL one ──
    const view = app.canvas;
    view.id = 'fxCanvas';
    view.style.width = '100%';
    view.style.height = '100%';
    view.style.display = 'block';
    canvas.parentNode.insertBefore(view, canvas);
    canvas.style.display = 'none';
    // Same touch guards the 2D canvas has
    view.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
    view.addEventListener('touchmove',  e => e.preventDefault(), { passive: false });

    // Watchdog: if this device can't hold framerate with FX on, switch back
    // to the plain 2D canvas rather than making the game feel worse.
    let wdLast = 0, wdSlow = 0, wdFrames = 0;
    function disableFX() {
      gameFX.active = false;
      canvas.style.display = 'block';
      view.remove();
      app.destroy();
    }

    gameFX.render = function (t) {
      if (gameFX.watchdog !== false && wdFrames < 60) {
        const gap = wdLast ? t - wdLast : 0;
        wdLast = t;
        if (gap > 0 && gap < 500) {     // ignore tab-hidden pauses
          wdFrames++;
          if (gap > 40) wdSlow++;
          if (wdFrames === 60 && wdSlow > 30) { disableFX(); return; }
        }
      }

      baseTex.source.update();          // re-upload this frame's 2D canvas
      baseSprite.width = W; baseSprite.height = H;
      bloomSprite.width = W; bloomSprite.height = H;

      // Drift the displacement map so the water shimmer never sits still
      dispSprite.position.set(
        -180 + Math.sin(t * 0.00055) * 60,
        -180 + Math.cos(t * 0.00042) * 60 + Math.sin(t * 0.0011) * 8
      );

      // Point one refraction sprite at each visible pool. The band starts
      // below the waterline (TOP_INSET) so the foam line, the ground edge,
      // and the otter's feet at ground level stay crisp — only the
      // underwater interior refracts.
      const TOP_INSET = 12;
      const k = canvas.width / W;       // logical px → source-buffer px
      const ox = typeof fxShakeX !== 'undefined' ? fxShakeX : 0;
      const oy = typeof fxShakeY !== 'undefined' ? fxShakeY : 0;
      let si = 0;
      if (typeof waterZones !== 'undefined' && waterZones) {
        for (const wz of waterZones) {
          if (si >= waterSprites.length) break;
          const sx = wz.x - cameraX + ox;
          const x0 = Math.max(0, sx), x1 = Math.min(W, sx + wz.w);
          if (x1 - x0 < 4) continue;
          const y0 = wz.y + TOP_INSET + oy;
          const hgt = Math.min(H - y0, wz.h - TOP_INSET);
          if (hgt < 4) continue;
          const sp = waterSprites[si];
          const fr = sp.texture.frame;
          fr.x = x0 * k; fr.y = y0 * k;
          fr.width = (x1 - x0) * k; fr.height = hgt * k;
          sp.texture.updateUvs();
          sp.position.set(x0, y0);
          sp.width = x1 - x0; sp.height = hgt;
          sp.visible = true;
          // Pin the mask to the pool rect, inset 1px so ripple can't touch the edge
          const mask = waterMasks[si];
          mask.clear();
          mask.rect(x0 + 1, y0, Math.max(1, x1 - x0 - 2), hgt).fill(0xffffff);
          mask.visible = true;
          si++;
        }
      }
      for (; si < waterSprites.length; si++) {
        waterSprites[si].visible = false;
        waterMasks[si].clear();
      }

      app.renderer.render(app.stage);
    };
    gameFX.active = true;
  } catch (e) {
    // WebGL unavailable — the 2D canvas stays visible and the game runs as-is
    gameFX.active = false;
    gameFX.error = e && e.message;
  }
})();
