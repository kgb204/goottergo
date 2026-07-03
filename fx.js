'use strict';

// ─── WebGL post-processing layer (PixiJS) ────────────────────────────────────
// The game keeps drawing to its own 2D canvas exactly as before. Each frame
// that canvas is uploaded as a texture and re-rendered through WebGL with a
// bloom pass: bright areas (sun, water glints, night lights, sparkles) bleed a
// soft glow over the scene. If WebGL or the library is unavailable, or the
// device can't hold framerate, gameFX falls back to the plain 2D canvas — the
// game is fully playable without this.
//
// (An earlier version also did per-pool displacement "refraction" of the
// water. It was removed: on some GPUs the displacement smeared pool contents
// at the scrolling screen edges and could bleed over the sand. The 2D canvas
// already animates the water with waves, foam, sunbeams, a sky reflection and
// swimming fish, so bloom alone is the clean win here.)

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
    app.stage.addChild(bloomSprite);

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

      app.renderer.render(app.stage);
    };
    gameFX.active = true;
  } catch (e) {
    // WebGL unavailable — the 2D canvas stays visible and the game runs as-is
    gameFX.active = false;
    gameFX.error = e && e.message;
  }
})();
