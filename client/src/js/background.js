/** Лёгкий анимированный фон: оранжевые частицы + мягкое свечение за курсором. */
export function initBackground(canvas) {
  const ctx = canvas.getContext('2d');
  let w = 0, h = 0, dpr = 1, raf = 0, parts = [];
  const mouse = { x: -999, y: -999, tx: -999, ty: -999 };

  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.min(70, Math.floor((w * h) / 20000));
    parts = Array.from({ length: n }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      r: Math.random() * 1.6 + .4, vy: -(Math.random() * .25 + .05), vx: (Math.random() - .5) * .12,
      a: Math.random() * .5 + .15,
    }));
  };

  const frame = () => {
    ctx.clearRect(0, 0, w, h);
    mouse.x += (mouse.tx - mouse.x) * .08; mouse.y += (mouse.ty - mouse.y) * .08;
    const g = ctx.createRadialGradient(w * .78, h * .15, 0, w * .78, h * .15, Math.max(w, h) * .7);
    g.addColorStop(0, 'rgba(244,17,44,.13)'); g.addColorStop(1, 'rgba(244,17,44,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    if (mouse.x > 0) {
      const m = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 260);
      m.addColorStop(0, 'rgba(244,17,44,.10)'); m.addColorStop(1, 'rgba(244,17,44,0)');
      ctx.fillStyle = m; ctx.fillRect(0, 0, w, h);
    }
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy;
      if (p.y < -5) { p.y = h + 5; p.x = Math.random() * w; }
      if (p.x < -5) p.x = w + 5; else if (p.x > w + 5) p.x = -5;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283);
      ctx.fillStyle = `rgba(255,80,100,${p.a})`; ctx.fill();
    }
    raf = requestAnimationFrame(frame);
  };

  const start = () => { if (!raf) raf = requestAnimationFrame(frame); };
  const stop = () => { cancelAnimationFrame(raf); raf = 0; };

  resize(); start();
  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', (e) => { mouse.tx = e.clientX; mouse.ty = e.clientY; }, { passive: true });
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
}
