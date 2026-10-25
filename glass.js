/* Liquid Glass engine: convex-squircle bezel + Snell's law -> displacement map -> SVG feDisplacementMap
   (3 staggered passes = chromatic aberration) applied through backdrop-filter. Chromium only; others get frosted fallback. */
const Glass = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const refracts = /(Chrome|Chromium)\//.test(navigator.userAgent) && !/iP(hone|ad|od)/.test(navigator.userAgent);
  let defs, n = 0;
  const host = () => defs || (defs = (() => {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('width', 0); s.setAttribute('height', 0);
    s.style.cssText = 'position:absolute;pointer-events:none';
    const d = document.createElementNS(NS, 'defs'); s.appendChild(d); document.body.appendChild(s); return d;
  })());

  // Light deflection across the bezel: height h(t)=(1-(1-t)^4)^(1/4); slope -> incidence angle -> Snell -> offset.
  function profile(ior) {
    const N = 64, p = new Float32Array(N + 1), e = 1e-3; let m = 0;
    const h = u => Math.pow(1 - Math.pow(1 - Math.min(Math.max(u, 0), 1), 4), .25);
    for (let i = 0; i <= N; i++) {
      const t = i / N, a1 = Math.atan(.6 * (h(t + e) - h(t - e)) / (2 * e));
      p[i] = Math.tan(a1 - Math.asin(Math.sin(a1) / ior)); m = Math.max(m, p[i]);
    }
    for (let i = 0; i <= N; i++) p[i] /= m || 1;
    return p;
  }

  function map(w, h, r, bz, ior) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'), im = g.createImageData(w, h), d = im.data, P = profile(ior), hw = w / 2, hh = h / 2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const px = x + .5 - hw, py = y + .5 - hh, qx = Math.abs(px) - (hw - r), qy = Math.abs(py) - (hh - r);
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0), out = Math.hypot(ox, oy);
      const depth = -(out + Math.min(Math.max(qx, qy), 0) - r);
      let R = 128, G = 128;
      if (depth >= 0 && depth < bz) {
        const m = P[Math.round(depth / bz * 64)]; let nx, ny;
        if (qx > 0 && qy > 0) { nx = ox / out * Math.sign(px); ny = oy / out * Math.sign(py); }
        else if (qx > qy) { nx = Math.sign(px); ny = 0; } else { nx = 0; ny = Math.sign(py); }
        R = 128 - nx * m * 127; G = 128 - ny * m * 127;   // sample from inside the rim
      }
      const i = (y * w + x) * 4; d[i] = R; d[i + 1] = G; d[i + 2] = 128; d[i + 3] = 255;
    }
    g.putImageData(im, 0, 0); return c.toDataURL();
  }

  function apply(el, o = {}) {
    const O = { radius: null, bezel: 14, scale: 40, blur: 1.5, ior: 1.5, sat: 1.6, aberr: .07, ...o };
    if (!refracts) { el.classList.add('no-refract'); return { setScale() {}, destroy() {}, refracts }; }
    const id = 'lg' + (++n), f = document.createElementNS(NS, 'filter'), ks = [1, 1 - O.aberr, 1 - 2 * O.aberr];
    f.id = id; f.setAttribute('color-interpolation-filters', 'sRGB'); f.setAttribute('filterUnits', 'userSpaceOnUse');
    host().appendChild(f);
    let timer, S = O.scale;
    const build = () => {
      const w = el.offsetWidth, h = el.offsetHeight; if (!w || !h) return;
      const r = O.radius ?? Math.min(w, h) / 2, url = map(w, h, Math.min(r, w / 2, h / 2), O.bezel, O.ior);
      for (const a of ['x', 'y']) f.setAttribute(a, 0); f.setAttribute('width', w); f.setAttribute('height', h);
      const ch = ['1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0', '0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0', '0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0'];
      f.innerHTML = `<feGaussianBlur in="SourceGraphic" stdDeviation="${O.blur}" result="bl"/>
        <feImage href="${url}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="m"/>` +
        ch.map((v, i) => `<feDisplacementMap in="bl" in2="m" scale="${S * ks[i]}" xChannelSelector="R" yChannelSelector="G" result="d${i}"/>
        <feColorMatrix in="d${i}" values="${v}" result="c${i}"/>`).join('') +
        `<feBlend in="c0" in2="c1" mode="screen" result="t"/><feBlend in="t" in2="c2" mode="screen"/>`;
    };
    el.style.webkitBackdropFilter = el.style.backdropFilter = `url(#${id}) saturate(${O.sat})`;
    build();
    const ro = new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(build, 120); }); ro.observe(el);
    return {
      refracts,
      setScale(s) { S = s; f.querySelectorAll('feDisplacementMap').forEach((e, i) => e.setAttribute('scale', s * ks[i])); },
      destroy() { ro.disconnect(); f.remove(); }
    };
  }
  return { apply, refracts };
})();
