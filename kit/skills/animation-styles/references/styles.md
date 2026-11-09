# Style recipes

Each snippet is a `<style>`, one root element and an optional `<script>` right after it. The root is a square that fills its container's width. Scripts find the root with `document.currentScript.previousElementSibling`, so keep the script directly after it and use a classic script, not a module. Every snippet has a reduced motion branch that shows a good still frame; script loops also check the preference each frame, so turning it on mid-session freezes them.

`gallery.html` is built from the html blocks below; run `python3 build_gallery.py` after editing one.

## 01 Liquid morph

**Technique:** SVG + CSS

> Make it a liquid morph: one glossy blob in a pink to violet to blue gradient on a dark background, bulging into lobes that stretch away and melt back in, like a lava lamp seen up close.

- Palette: hot pink top left through violet to blue bottom right, on a near-black indigo, so the blob is the only light in the frame.
- Timing: each lobe drifts on its own 4.5 to 6.5s `ease-in-out` `alternate` loop with offset delays, so the outline never repeats.
- Layering: a core circle plus five lobe circles in one group with a goo filter (blur, then a steep alpha curve), one gradient across the whole group, a soft highlight on top.
- The detail people miss: the gradient must use `gradientUnits="userSpaceOnUse"` so it spans the whole blob; with the default each circle gets its own gradient and the lobes read as separate balls. Rest the lobes inside the core and push a few of them past core radius plus lobe radius plus the blur at peak, on staggered timings, so they detach for part of each cycle and merge back.

```html
<style>
.lm{display:block;width:100%;aspect-ratio:1;background:radial-gradient(circle at 50% 45%,#1d1440,#0a0816 70%)}
.lm .lobe{animation:lm-pull var(--t) ease-in-out var(--d) infinite alternate}
.lm .core{transform-origin:50px 50px;animation:lm-breathe 4s ease-in-out infinite alternate}
@keyframes lm-pull{to{transform:translate(var(--x),var(--y))}}
@keyframes lm-breathe{to{transform:scale(1.07)}}
@media (prefers-reduced-motion:reduce){.lm *{animation:none!important}}
</style>
<svg class="lm" viewBox="0 0 100 100" role="img" aria-label="Liquid gradient blob">
  <defs>
    <linearGradient id="lm-g" gradientUnits="userSpaceOnUse" x1="34" y1="30" x2="68" y2="72">
      <stop offset="0" stop-color="#ff6fd8"/><stop offset=".5" stop-color="#a35cff"/><stop offset="1" stop-color="#4f8dff"/>
    </linearGradient>
    <filter id="lm-goo"><feGaussianBlur stdDeviation="4"/><feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -10"/></filter>
    <filter id="lm-soft"><feGaussianBlur stdDeviation="2.5"/></filter>
  </defs>
  <g filter="url(#lm-goo)" fill="url(#lm-g)">
    <circle class="core" cx="50" cy="51" r="19"/>
    <circle class="lobe" cx="38" cy="44" r="10" style="--x:-19px;--y:-13px;--t:5s;--d:0s"/>
    <circle class="lobe" cx="61" cy="40" r="9" style="--x:9px;--y:-8px;--t:6s;--d:-2s"/>
    <circle class="lobe" cx="62" cy="60" r="11" style="--x:18px;--y:15px;--t:5.5s;--d:-4s"/>
    <circle class="lobe" cx="43" cy="62" r="9" style="--x:-7px;--y:9px;--t:6.5s;--d:-1s"/>
    <circle class="lobe" cx="51" cy="36" r="8" style="--x:2px;--y:-22px;--t:4.5s;--d:-3s"/>
  </g>
  <ellipse cx="43" cy="41" rx="7" ry="3.5" fill="#fff" opacity=".45" filter="url(#lm-soft)"/>
</svg>
```

## 02 ASCII art

**Technique:** JS into a `<pre>`

> Render it as ASCII art: a slowly rotating sphere drawn in green monospace characters on black, like an old terminal demo.

- Palette: one phosphor green on black, with a faint text-shadow glow.
- Timing: redraw at about 15 fps. Full 60 fps reads as a video filter; a lower rate reads as a terminal.
- Layering: lighting picks the character from a density ramp (` .:-=+*#%@`); a banded texture on the sphere is what shows it turning.
- Key detail: monospace cells are about 0.6 as wide as they are tall, so use more columns than rows (48 by 30 here) or the sphere comes out as an egg.

```html
<style>
.as{aspect-ratio:1;display:grid;place-items:center;background:#040804;overflow:hidden}
.as pre{margin:0;color:#5dff7a;font:12px/1 ui-monospace,Menlo,Consolas,monospace;text-shadow:0 0 6px #1f7a30}
</style>
<div class="as" role="img" aria-label="ASCII sphere"><pre></pre></div>
<script>
(() => {
  const root = document.currentScript.previousElementSibling, pre = root.firstElementChild;
  const RAMP = ' .:-=+*#%@', ROWS = 30, COLS = 48;
  const fit = () => pre.style.fontSize = root.clientWidth / (COLS * 0.62) + 'px';
  fit(); addEventListener('resize', fit);
  function draw(t) {
    let s = '';
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const nx = (x + .5) / COLS * 2 - 1, ny = (y + .5) / ROWS * 2 - 1, d = nx * nx + ny * ny;
        if (d > 1) { s += ' '; continue; }
        const nz = Math.sqrt(1 - d), lon = Math.atan2(nx, nz) + t, lat = Math.asin(ny);
        const light = Math.max(0, -.45 * nx - .5 * ny + .74 * nz);
        const tex = .6 + .4 * Math.sin(lon * 5) * Math.cos(lat * 6);
        s += RAMP[Math.min(9, (1 + light * tex * 9) | 0)];
      }
      s += '\n';
    }
    pre.textContent = s;
  }
  // first frame up front, a demo paused before its first rAF still shows the sphere
  draw(.8);
  const rm = matchMedia('(prefers-reduced-motion: reduce)');
  if (rm.matches) return;
  let last = 0;
  const loop = now => {
    requestAnimationFrame(loop);
    if (now - last < 66 || rm.matches) return;
    last = now; draw(now / 1400);
  };
  requestAnimationFrame(loop);
})();
</script>
```

## 03 Holographic foil

**Technique:** CSS

> Give it a holographic foil look: a trading card that tilts back and forth in 3D, with a rainbow sheen and a bright glare band that slide as it turns.

- Palette: pastel rainbow (pink, gold, mint, sky, lilac) on a dark table, white lettering.
- Timing: one 5s `ease-in-out` `alternate` cycle drives the tilt, the rainbow shift and the glare together.
- Layering: rainbow gradient at 300% size, a fine diagonal line texture in `overlay`, then a narrow white glare band on top.
- Key detail: the glare must move with the tilt (same duration, same easing). A glare on its own timer reads as a sticker, not foil.

```html
<style>
.hf{aspect-ratio:1;display:grid;place-items:center;background:#16151a;perspective:700px;overflow:hidden;container-type:inline-size}
.hf .card{position:relative;width:54%;aspect-ratio:5/7;border-radius:5cqi;overflow:hidden;display:grid;place-content:center;text-align:center;color:#fff;background:linear-gradient(115deg,#ff9bd2,#ffd27a,#9bffcf,#7cc4ff,#c79bff,#ff9bd2) 0 0/300% 300%;box-shadow:inset 0 0 0 1px rgba(255,255,255,.4);animation:hf-tilt 5s ease-in-out infinite alternate,hf-shift 5s ease-in-out infinite alternate}
.hf .card::before{content:"";position:absolute;inset:0;background:repeating-linear-gradient(60deg,transparent 0 5px,rgba(255,255,255,.22) 5px 6px);mix-blend-mode:overlay}
.hf .card::after{content:"";position:absolute;inset:-50%;background:linear-gradient(105deg,transparent 44%,rgba(255,255,255,.8) 50%,transparent 56%);mix-blend-mode:overlay;animation:hf-glare 5s ease-in-out infinite alternate}
.hf b{position:relative;font:900 12cqi/1 system-ui,sans-serif;text-shadow:0 2px 10px rgba(90,0,130,.35)}
.hf small{position:relative;margin-top:2cqi;font:600 2.6cqi/1 system-ui,sans-serif;letter-spacing:.3em;opacity:.85}
@keyframes hf-tilt{from{transform:rotateY(-22deg) rotateX(8deg)}to{transform:rotateY(22deg) rotateX(-8deg)}}
@keyframes hf-shift{to{background-position:100% 100%}}
@keyframes hf-glare{from{transform:translateX(-28%)}to{transform:translateX(28%)}}
@media (prefers-reduced-motion:reduce){
  .hf .card,.hf .card::after{animation:none}
  .hf .card{transform:rotateY(-12deg) rotateX(4deg);background-position:40% 40%}
}
</style>
<div class="hf" role="img" aria-label="Holographic card"><div class="card"><b>HOLO</b><small>RARE FOIL</small></div></div>
```

## 04 Bauhaus shapes

**Technique:** SVG + CSS

> Do it in a Bauhaus style: flat red, blue, yellow and black shapes on cream paper with thick black rules, moving like a machine, snapping between poses and holding.

- Palette: cream `#efe8d8`, red `#e63a2e`, blue `#2a5cd6`, yellow `#f2b630`, black. No gradients, no shadows.
- Timing: 4.8s loop, `cubic-bezier(.7,0,.25,1)` on every segment, with holds between moves.
- Layering: rules first, then shapes; one vertical word on the edge for the poster feel.
- Key detail: the holds. Shapes that ease forever look like a screensaver; moving then stopping on a shared beat looks designed.

```html
<style>
.bh{display:block;width:100%;aspect-ratio:1}
.bh .c,.bh .t,.bh .s,.bh .h{transform-box:fill-box;transform-origin:center;animation:4.8s cubic-bezier(.7,0,.25,1) infinite}
.bh .c{animation-name:bh-c}.bh .t{animation-name:bh-t}.bh .s{animation-name:bh-s}
.bh .h{animation-name:bh-h;transform-origin:50% 100%}
@keyframes bh-c{0%,15%,85%,100%{transform:none}30%,70%{transform:translate(-24px,0)}}
@keyframes bh-t{0%,15%{transform:none}30%,50%{transform:rotate(120deg)}65%,85%{transform:rotate(240deg)}100%{transform:rotate(360deg)}}
@keyframes bh-s{0%,30%,100%{transform:none}45%,85%{transform:translate(18px,0) rotate(45deg)}}
@keyframes bh-h{0%,40%,100%{transform:none}55%,80%{transform:scaleY(.45)}}
@media (prefers-reduced-motion:reduce){.bh *{animation:none!important}}
</style>
<svg class="bh" viewBox="0 0 100 100" role="img" aria-label="Bauhaus shapes">
  <rect width="100" height="100" fill="#efe8d8"/>
  <path d="M16 0V70M0 70H100M70 70V100" stroke="#111" stroke-width="1.8" fill="none"/>
  <polygon class="t" points="38,42 66,20 62,52" fill="#2a5cd6"/>
  <circle class="c" cx="78" cy="52" r="13" fill="#e63a2e"/>
  <rect class="s" x="30" y="76" width="9" height="9" fill="#111"/>
  <path class="h" d="M52 100a14 14 0 0 1 28 0z" fill="#f2b630"/>
  <text x="94" y="4" transform="rotate(90 94 4)" font-family="system-ui,sans-serif" font-weight="800" font-size="7" letter-spacing="1.5" fill="#111">BAUHAUS</text>
</svg>
```

## 05 Neon glow

**Technique:** CSS

> Make it neon: thin pink tube lettering inside a cyan rounded frame on a dark wall, glowing, with the odd flicker like a real sign.

- Palette: near-white tube core, pink and cyan halos, a wall that is dark but not pure black.
- Timing: the frame hums (3s glow swell); the letters flicker on a 4s linear loop with three short dips.
- Layering: stacked shadows, tight white first, then wider and more saturated: `0 0 .5 #fff, 0 0 2 pink, 0 0 5 pink, 0 0 10 deep pink`.
- Key detail: an unlit tube is dim, not gone. Flicker to about 25% opacity, never 0, and keep it under three dips a second.

```html
<style>
.ng{aspect-ratio:1;display:grid;place-items:center;background:radial-gradient(circle,#1c1122,#07050a 70%);container-type:inline-size}
.ng div{padding:5cqi 7cqi;border:1.1cqi solid #c9faff;border-radius:6cqi;box-shadow:0 0 1cqi #fff,0 0 3cqi #29e6ff,0 0 8cqi #00b8ff,inset 0 0 3cqi #29e6ff;animation:ng-hum 3s ease-in-out infinite alternate}
.ng span{display:block;font:300 17cqi/1 system-ui,sans-serif;letter-spacing:.04em;color:#ffeefc;text-shadow:0 0 .5cqi #fff,0 0 2cqi #ff3fd8,0 0 5cqi #ff1fc8,0 0 10cqi #c400a0;animation:ng-flicker 4s linear infinite}
@keyframes ng-hum{to{box-shadow:0 0 1cqi #fff,0 0 4cqi #29e6ff,0 0 11cqi #00b8ff,inset 0 0 4cqi #29e6ff}}
@keyframes ng-flicker{0%,18%,20%,22%,62%,64%,100%{opacity:1}19%,21%,63%{opacity:.25}}
@media (prefers-reduced-motion:reduce){.ng div,.ng span{animation:none}}
</style>
<div class="ng" role="img" aria-label="Neon sign"><div><span>NEON</span></div></div>
```

## 06 Dithering

**Technique:** Canvas 2D

> Use a dithered look: a soft light drifting across a dark field, rendered in only two colors with an ordered Bayer dither, chunky and crisp.

- Palette: exactly two colors, warm paper on near-black. Any third tone breaks it.
- Timing: smooth continuous drift, full frame rate; the pattern is stable so it does not shimmer.
- Layering: draw a grayscale tone, then threshold each pixel against an 8 by 8 Bayer matrix.
- Key detail: render small (96 by 96) and scale up with `image-rendering: pixelated`. Dithering at screen resolution just looks like gray.

```html
<style>
.dt{display:block;width:100%;aspect-ratio:1;image-rendering:pixelated;background:#0d0c0b}
</style>
<canvas class="dt" width="96" height="96" role="img" aria-label="Dithered light"></canvas>
<script>
(() => {
  const c = document.currentScript.previousElementSibling, x = c.getContext('2d'), N = 96;
  const img = x.createImageData(N, N), px = img.data;
  const B = [0,32,8,40,2,34,10,42,48,16,56,24,50,18,58,26,12,44,4,36,14,46,6,38,60,28,52,20,62,30,54,22,
    3,35,11,43,1,33,9,41,51,19,59,27,49,17,57,25,15,47,7,39,13,45,5,37,63,31,55,23,61,29,53,21];
  function draw(t) {
    const cx = .5 + .18 * Math.cos(t * .7), cy = .5 + .14 * Math.sin(t * .9), r = .32 + .04 * Math.sin(t * 1.3);
    for (let y = 0; y < N; y++) for (let i = 0; i < N; i++) {
      const d = Math.hypot(i / N - cx, y / N - cy) / r;
      const v = Math.min(1, Math.max(0, 1.25 - d)) + .14 * (i / N);
      const on = v * 64 > B[(y & 7) * 8 + (i & 7)], o = (y * N + i) * 4;
      px[o] = on ? 236 : 13; px[o + 1] = on ? 228 : 12; px[o + 2] = on ? 206 : 11; px[o + 3] = 255;
    }
    x.putImageData(img, 0, 0);
  }
  const rm = matchMedia('(prefers-reduced-motion: reduce)');
  if (rm.matches) return draw(1.2);
  const loop = now => { if (!rm.matches) draw(now / 1000); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
})();
</script>
```

## 07 Clay 3D

**Technique:** CSS

> Make it look like clay 3D: soft matte pastel shapes (a ball, a rounded cube, a capsule and a mint torus) on a pink set, the ground shapes hopping and squashing when they land, the torus floating above them.

- Palette: pastel pink, sky, butter and mint on a pink set; lighter floor line behind.
- Timing: 1.6s `alternate` hop with a symmetric curve, staggered 0.4s per shape; the torus floats on a slower 2.4s loop with no squash.
- Layering: radial highlight top left, inset shade bottom right, and a separate blurred contact shadow on the floor. The torus is a disc with its centre masked out and a darker band around the hole for volume.
- The detail people miss: the floor shadow does not move with the shape. It stays put and shrinks and fades as the shape rises; squash only in the frames touching the ground.

```html
<style>
.cl{position:relative;aspect-ratio:1;background:linear-gradient(#fbd8e5 64%,#f5c2d4 64%);overflow:hidden}
.cl .slot{position:absolute;bottom:30%;width:var(--w);aspect-ratio:1}
.cl .slot::after{content:"";position:absolute;left:8%;right:8%;bottom:-7%;height:12%;border-radius:50%;background:rgba(160,60,100,.28);filter:blur(3px);animation:cl-shadow 1.6s cubic-bezier(.33,0,.67,1) var(--d) infinite alternate}
.cl i{position:absolute;inset:0;border-radius:var(--r);transform-origin:50% 100%;background:radial-gradient(circle at 32% 26%,rgba(255,255,255,.75),transparent 40%),var(--c);box-shadow:inset -.7em -.9em 1.4em rgba(90,20,60,.2),inset .3em .3em .8em rgba(255,255,255,.35);animation:cl-hop 1.6s cubic-bezier(.33,0,.67,1) var(--d) infinite alternate}
.cl .float{bottom:64%}
.cl .float::after{display:none}
.cl .float i{background:radial-gradient(circle at 34% 24%,rgba(255,255,255,.7),transparent 32%),radial-gradient(circle,rgba(40,90,60,.35) 30%,transparent 46%),var(--c);-webkit-mask:radial-gradient(circle,transparent 27%,#000 29%);mask:radial-gradient(circle,transparent 27%,#000 29%);animation:cl-float 2.4s ease-in-out infinite alternate}
@keyframes cl-hop{0%{transform:scale(1.12,.86)}16%{transform:translateY(-8%) scale(1)}100%{transform:translateY(-55%) scale(.97,1.03)}}
@keyframes cl-shadow{0%{transform:scaleX(1.1)}100%{transform:scaleX(.6);opacity:.4}}
@keyframes cl-float{from{transform:translateY(0) rotate(-8deg)}to{transform:translateY(-14%) rotate(8deg)}}
@media (prefers-reduced-motion:reduce){.cl i,.cl .float i,.cl .slot::after{animation:none}}
</style>
<div class="cl" role="img" aria-label="Clay shapes">
  <div class="slot" style="left:5%;--w:31%;--c:#f7a1c4;--r:50%;--d:0s"><i></i></div>
  <div class="slot float" style="left:52%;--w:19%;--c:#9fe0b4;--r:50%"><i></i></div>
  <div class="slot" style="left:66%;--w:23%;--c:#f7d77a;--r:999px;--d:-.8s"><i style="top:-65%"></i></div>
  <div class="slot" style="left:30%;--w:29%;--c:#9fd3f7;--r:24%;--d:-.4s"><i></i></div>
</div>
```

## 08 Halftone dots

**Technique:** Canvas 2D

> Give it a halftone treatment: a dark magenta shape drifting under a rotated dot screen on off-white paper, dots swelling where it is dark.

- Palette: off-white paper, magenta that deepens to near-black in the shadows.
- Timing: slow drift, 0.6 to 0.8 rad per second on two axes.
- Layering: one dot per screen cell, screen rotated 15 degrees like a print plate.
- Key detail: tone is dot area, not radius, so radius goes with the square root of darkness. Linear radius crushes the midtones.

```html
<style>
.ht{display:block;width:100%;aspect-ratio:1;background:#f6f1ea}
</style>
<canvas class="ht" role="img" aria-label="Halftone dots"></canvas>
<script>
(() => {
  const c = document.currentScript.previousElementSibling, x = c.getContext('2d');
  let W = 0;
  const size = () => W = c.width = c.height = Math.round(c.clientWidth * (devicePixelRatio || 1));
  size(); addEventListener('resize', size);
  const n = 30, a = Math.PI / 12, ca = Math.cos(a), sa = Math.sin(a);
  function draw(t) {
    x.fillStyle = '#f6f1ea'; x.fillRect(0, 0, W, W);
    const s = W / n, cx = Math.cos(t * .6) * .12, cy = Math.sin(t * .8) * .1;
    x.save(); x.translate(W / 2, W / 2); x.rotate(a);
    for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
      const px = i * s, py = j * s;
      const ux = (px * ca - py * sa) / W, uy = (px * sa + py * ca) / W;
      const d = Math.hypot(ux - cx, uy - cy);
      const tone = .04 + .96 * Math.max(0, Math.min(1, 1 - d / .42)) ** 1.2;
      const r = s * .62 * Math.sqrt(tone);
      x.fillStyle = `rgb(${200 - 160 * tone | 0},${30 - 15 * tone | 0},${110 - 70 * tone | 0})`;
      x.beginPath(); x.arc(px, py, r, 0, 7); x.fill();
    }
    x.restore();
  }
  const rm = matchMedia('(prefers-reduced-motion: reduce)');
  if (rm.matches) { addEventListener('resize', () => draw(.5)); return draw(.5); }
  const loop = now => { if (!rm.matches) draw(now / 1000); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
})();
</script>
```

## 09 Kinetic typography

**Technique:** CSS

> Do kinetic typography: one huge heavy word at a time (MOVE, FAST, BOLD, TYPE, LOUD) punching in on the beat, the field flipping between yellow and black, with ticker lines sliding in opposite directions above and below.

- Palette: two colors only, black and signal yellow, swapping roles every beat.
- Timing: one 0.8s beat drives the word swap, the punch and the color flip (all `steps(1)` except the punch); tickers run linear on their own 6s loop.
- Layering: the words stack in one grid cell and take turns; tickers frame them.
- Key detail: hard cuts. The words swap with `steps(1)`, never a crossfade, and only the scale eases (with overshoot). A ticker that loops without a visible seam repeats its content twice and moves exactly `-50%`. A full-field flip is a flash, so keep it under three a second (this is 1.25).

```html
<style>
.kt{aspect-ratio:1;display:grid;grid-template:auto 1fr auto/minmax(0,1fr);background:#ffd400;color:#111;overflow:hidden;container-type:inline-size;font-family:system-ui,sans-serif;animation:kt-flip 4s steps(1) infinite}
.kt .row{display:flex;width:max-content;font-weight:800;font-size:6cqi;line-height:1.7;white-space:nowrap;animation:kt-run 6s linear infinite}
.kt .row.rev{animation-direction:reverse}
.kt .row span{padding-right:.6em}
.kt .words{display:grid;place-self:center;animation:kt-punch .8s infinite}
.kt .words b{grid-area:1/1;text-align:center;font-weight:900;font-size:27cqi;line-height:1;letter-spacing:-.04em;opacity:0;animation:kt-word 4s steps(1) infinite}
.kt .words b:nth-child(2){animation-delay:.8s}
.kt .words b:nth-child(3){animation-delay:1.6s}
.kt .words b:nth-child(4){animation-delay:2.4s}
.kt .words b:nth-child(5){animation-delay:3.2s}
@keyframes kt-run{to{transform:translateX(-50%)}}
@keyframes kt-word{0%{opacity:1}20%{opacity:0}}
@keyframes kt-flip{0%,40%,80%{background:#ffd400;color:#111}20%,60%{background:#111;color:#ffd400}}
@keyframes kt-punch{0%{transform:scale(.8);animation-timing-function:cubic-bezier(.2,1.8,.4,1)}35%,100%{transform:scale(1)}}
@media (prefers-reduced-motion:reduce){
  .kt,.kt .row,.kt .words,.kt .words b{animation:none}
  .kt .words b:first-child{opacity:1}
}
</style>
<div class="kt" role="img" aria-label="Kinetic type">
  <div class="row"><span>TYPE IN MOTION ·</span><span>TYPE IN MOTION ·</span><span>TYPE IN MOTION ·</span><span>TYPE IN MOTION ·</span></div>
  <div class="words"><b>MOVE</b><b>FAST</b><b>BOLD</b><b>TYPE</b><b>LOUD</b></div>
  <div class="row rev"><span>TYPE IN MOTION ·</span><span>TYPE IN MOTION ·</span><span>TYPE IN MOTION ·</span><span>TYPE IN MOTION ·</span></div>
</div>
```

## 10 Pixel art

**Technique:** Canvas 2D

> Make it pixel art: a 32 by 32 sunset with banded sky, a pixel sun, dark hills, a little green slime bobbing and a blinking heart, animated at a choppy 8 fps.

- Palette: a short ramp per area (6 sky bands, 2 greens), no blending between them.
- Timing: 8 fps, and everything moves in whole pixels.
- Layering: sky bands, sun, far hills, ground, then sprites.
- Key detail: draw at the real resolution (32 by 32) and upscale with `image-rendering: pixelated`. Drawing big squares at screen size lets sprites land between pixels.

```html
<style>
.px{display:block;width:100%;aspect-ratio:1;image-rendering:pixelated;background:#3b1f5c}
</style>
<canvas class="px" width="32" height="32" role="img" aria-label="Pixel art sunset"></canvas>
<script>
(() => {
  const c = document.currentScript.previousElementSibling, x = c.getContext('2d');
  const P = (col, X, Y, w = 1, h = 1) => { x.fillStyle = col; x.fillRect(X, Y, w, h); };
  const sprite = (rows, X, Y, cols) => rows.forEach((r, j) => [...r].forEach((ch, i) => cols[ch] && P(cols[ch], X + i, Y + j)));
  function draw(f) {
    ['#3b1f5c', '#5a2a72', '#8a3a7a', '#c2506e', '#ef7a5a', '#f7a35c'].forEach((col, i) => P(col, 0, i * 3, 32, 3));
    P('#f7a35c', 0, 18, 32, 4);
    for (let y = -6; y <= 0; y++) for (let i = -6; i <= 6; i++) if (i * i + y * y <= 38) P('#ffd36b', 16 + i, 17 + y);
    const cx = ((f >> 1) % 44) - 8;
    P('#f6c9e0', cx, 5, 7, 1); P('#f6c9e0', cx + 2, 4, 3, 1);
    for (let i = 0; i < 32; i++) { const h = 2 + (i % 7 < 3 ? 2 : 0) + (i % 5 === 1 ? 1 : 0); P('#4a2a5c', i, 20 - h, 1, h + 2); }
    P('#2f6b3a', 0, 22, 32, 4);
    for (let i = 1; i < 32; i += 4) P('#3f8a4a', i, 21);
    P('#1f4a2b', 0, 26, 32, 6);
    sprite(['.###.', '#####', '#o#o#', '#####'], 13, 18 - ((f >> 2) & 1), { '#': '#7be38a', o: '#1b2a1b' });
    if ((f >> 3) & 1) sprite(['.#.#.', '#####', '.###.', '..#..'], 23, 8, { '#': '#ff4f6d' });
  }
  const rm = matchMedia('(prefers-reduced-motion: reduce)');
  if (rm.matches) return draw(8);
  let f = 0, last = 0;
  const loop = now => {
    requestAnimationFrame(loop);
    if (now - last < 125 || rm.matches) return;
    last = now; draw(f++);
  };
  requestAnimationFrame(loop);
})();
</script>
```

## 11 Particle swarm

**Technique:** Canvas 2D

> Make a particle swarm: hundreds of glowing violet and pink specks circling in a loose ring on a dark background, leaving soft trails.

- Palette: violet to pink specks on deep indigo; overlaps build to near white.
- Timing: each particle has its own speed (0.15 to 0.5 rad/s) so the ring shears instead of spinning as a disc.
- Layering: `lighter` composite for the specks, a translucent fill each frame for trails.
- Key detail: do not clear the canvas. Paint the background at about 18% alpha each frame; the leftovers are the trails, and additive blending is the glow.

```html
<style>
.ps{display:block;width:100%;aspect-ratio:1;background:#0a0614}
</style>
<canvas class="ps" role="img" aria-label="Particle swarm"></canvas>
<script>
(() => {
  const c = document.currentScript.previousElementSibling, x = c.getContext('2d');
  let W = 0;
  const size = () => { W = c.width = c.height = Math.round(c.clientWidth * (devicePixelRatio || 1)); x.fillStyle = '#0a0614'; x.fillRect(0, 0, W, W); };
  size(); addEventListener('resize', size);
  const P = Array.from({ length: 1400 }, () => ({
    a: Math.random() * 6.283, r: .28 + (Math.random() - .5) * .14, s: .15 + Math.random() * .35,
    z: Math.random() * 6.283, col: `hsla(${270 + Math.random() * 60},90%,66%,.6)`
  }));
  function draw(t) {
    x.globalCompositeOperation = 'source-over';
    x.fillStyle = 'rgba(10,6,20,.18)'; x.fillRect(0, 0, W, W);
    x.globalCompositeOperation = 'lighter';
    const dot = Math.max(1, W / 150);
    for (const p of P) {
      const a = p.a + t * p.s, r = (p.r + .03 * Math.sin(t * 1.7 + p.z * 3)) * W;
      x.fillStyle = p.col;
      x.fillRect(W / 2 + Math.cos(a) * r, W / 2 + Math.sin(a) * r * .9 + Math.sin(a * 3 + t) * W * .02, dot, dot);
    }
  }
  const rm = matchMedia('(prefers-reduced-motion: reduce)');
  const still = () => { for (let k = 0; k < 12; k++) draw(k * .03); };
  if (rm.matches) { addEventListener('resize', still); return still(); }
  const loop = now => { if (!rm.matches) draw(now / 1000); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
})();
</script>
```

## 12 Risograph print

**Technique:** SVG + CSS

> Style it as a risograph print: a red sun with yellow rays over a blue wave and the word RISO, inks overprinting on grainy cream paper, slightly out of register.

- Palette: real riso inks: fluorescent red `#ff4b3e`, yellow `#ffe800`, blue `#0078bf` on cream.
- Timing: the rays turn slowly (24s); registration jitters in `steps(1)` every 0.3s, like flipping through prints.
- Layering: every ink layer uses `mix-blend-mode: multiply` so overlaps darken, then a noise layer for paper grain.
- Key detail: misregistration is a pixel or less and moves per layer, not the whole image. Big offsets read as a glitch, not print.

```html
<style>
.rs{display:block;width:100%;aspect-ratio:1}
.rs .ink{mix-blend-mode:multiply}
.rs .red{animation:rs-reg 1.2s steps(1) infinite}
.rs .blue{animation:rs-reg 1.2s steps(1) -.6s infinite reverse}
.rs .rays{transform-box:view-box;transform-origin:50px 52px;animation:rs-spin 24s linear infinite}
@keyframes rs-reg{0%{transform:none}25%{transform:translate(.7px,-.4px)}50%{transform:translate(-.4px,.6px)}75%{transform:translate(.5px,.3px)}}
@keyframes rs-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.rs *{animation:none!important}.rs .red{transform:translate(.6px,-.4px)}}
</style>
<svg class="rs" viewBox="0 0 100 100" role="img" aria-label="Risograph sun">
  <filter id="rs-grain"><feTurbulence type="fractalNoise" baseFrequency="1.3" numOctaves="2" seed="4"/><feColorMatrix type="saturate" values="0"/></filter>
  <rect width="100" height="100" fill="#f3ead6"/>
  <g class="ink">
    <circle class="rays" cx="50" cy="52" r="31" fill="none" stroke="#ffe800" stroke-width="7" stroke-dasharray="3.5 12.73"/>
  </g>
  <g class="ink red"><circle cx="50" cy="52" r="21" fill="#ff4b3e"/></g>
  <g class="ink blue" fill="#0078bf">
    <path d="M0 80Q12.5 70 25 80T50 80T75 80T100 80V100H0Z"/>
    <text x="50" y="32" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="900" font-size="17">RISO</text>
  </g>
  <rect width="100" height="100" filter="url(#rs-grain)" opacity=".28" style="mix-blend-mode:multiply"/>
</svg>
```

## 13 Glitch effect

**Technique:** CSS

> Add a glitch effect: bold white text on black with red and cyan channel splits, mostly steady, then short bursts where horizontal slices jump sideways.

- Palette: white text, pure red and cyan channel copies on black, faint scanlines.
- Timing: a 2.4s loop that is calm for about 75% of it, then a 0.3s burst in `steps(1)`.
- Layering: two `::before`/`::after` copies of the text (via `data-text`) in `screen` blend, sliced with `clip-path: inset()`.
- Key detail: a glitch that never stops is noise. The calm stretch is what makes the burst land; keep bursts under three a second.

```html
<style>
.gl{position:relative;aspect-ratio:1;display:grid;place-items:center;background:#000;overflow:hidden;container-type:inline-size}
.gl::after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(transparent 0 2px,rgba(255,255,255,.04) 2px 3px);pointer-events:none}
.gl b{position:relative;font:900 19cqi/1 system-ui,sans-serif;letter-spacing:-.02em;color:#f2f2f2;animation:gl-shake 2.4s steps(1) infinite}
.gl b::before,.gl b::after{content:attr(data-text);position:absolute;inset:0;mix-blend-mode:screen}
.gl b::before{color:#ff2a55;animation:gl-r 2.4s steps(1) infinite}
.gl b::after{color:#22e6ff;animation:gl-c 2.4s steps(1) infinite}
@keyframes gl-r{0%{transform:translate(-.6cqi,0);clip-path:none}76%{transform:translate(-3cqi,0);clip-path:inset(18% 0 56% 0)}80%{transform:translate(2cqi,0);clip-path:inset(62% 0 8% 0)}84%{transform:translate(-1.5cqi,0);clip-path:inset(4% 0 78% 0)}88%{transform:translate(-.6cqi,0);clip-path:none}}
@keyframes gl-c{0%{transform:translate(.6cqi,0);clip-path:none}76%{transform:translate(2.5cqi,0);clip-path:inset(50% 0 22% 0)}80%{transform:translate(-2cqi,0);clip-path:inset(10% 0 66% 0)}84%{transform:translate(1.4cqi,0);clip-path:inset(70% 0 4% 0)}88%{transform:translate(.6cqi,0);clip-path:none}}
@keyframes gl-shake{0%{transform:none}78%{transform:translateX(1cqi) skewX(-8deg)}82%{transform:none}86%{transform:translateX(-.8cqi)}88%{transform:none}}
@media (prefers-reduced-motion:reduce){
  .gl b,.gl b::before,.gl b::after{animation:none}
  .gl b::before{transform:translateX(-.6cqi)}.gl b::after{transform:translateX(.6cqi)}
}
</style>
<div class="gl"><b data-text="GLITCH">GLITCH</b></div>
```

## 14 Topographic lines

**Technique:** Canvas 2D

> Draw it as topographic lines: brown contour lines on a sand colored map, slowly shifting like the terrain is breathing, every fifth line heavier, with a small red marker.

- Palette: sand `#e9e0cb`, contour brown, darker index lines, one red pin.
- Timing: very slow; the field moves about a quarter radian per second.
- Layering: compute a smooth height field, mark a pixel where its contour band differs from its right or lower neighbor.
- Key detail: thresholding `fract(height)` gives lines that fatten on gentle slopes. The neighbor band test keeps every line one pixel wide, and index lines (every 5th) sell it as a real map.

```html
<style>
.tp{display:block;width:100%;aspect-ratio:1;background:#e9e0cb}
</style>
<canvas class="tp" width="240" height="240" role="img" aria-label="Topographic contour map"></canvas>
<script>
(() => {
  const c = document.currentScript.previousElementSibling, x = c.getContext('2d'), N = 240, M = N + 1;
  const img = x.createImageData(N, N), px = img.data, band = new Int16Array(M * M);
  const height = (u, v, t) => Math.sin(u * 3.1 + t) + Math.sin(v * 2.7 - t * .8) + Math.sin((u + v) * 2.2 + t * .6)
    + Math.sin(Math.hypot(u - 1.2, v - .9) * 5 - t * .5) + .6 * Math.sin(u * 5.3 - v * 4.1 + t * .3);
  function draw(t) {
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) band[j * M + i] = Math.floor(height(i / N * 2, j / N * 2, t) * 2.6);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * M + i, b = band[k], hi = Math.max(b, band[k + 1], band[k + M]), o = (j * N + i) * 4;
      const line = hi !== b || hi !== band[k + 1] || hi !== band[k + M];
      const rgb = !line ? [233, 224, 203] : hi % 5 === 0 ? [52, 36, 24] : [128, 104, 78];
      px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; px[o + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    x.fillStyle = '#d8432f'; x.beginPath(); x.arc(N * .6, N * .74, 3.5, 0, 7); x.fill();
  }
  const rm = matchMedia('(prefers-reduced-motion: reduce)');
  if (rm.matches) return draw(2);
  const loop = now => { if (!rm.matches) draw(now / 4000); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
})();
</script>
```

## 15 Glassmorphism

**Technique:** CSS

> Use glassmorphism: a frosted translucent card with a thin bright edge, floating over big blurred blobs of pink, blue and orange that drift behind it.

- Palette: saturated blobs on deep purple; the card is white at 14% with white text.
- Timing: blobs drift on 9 to 11s `alternate` loops with offset delays; the card itself stays still.
- Layering: blobs, then the card with `backdrop-filter: blur() saturate()`, a 1px border at 35% white and a 1px inset top highlight.
- Key detail: glass is only visible when something moves behind it. Over a flat background it is just a gray box; also add the `-webkit-` prefix for Safari.

```html
<style>
.gm{position:relative;aspect-ratio:1;overflow:hidden;background:#1b1430;container-type:inline-size;font-family:system-ui,sans-serif}
.gm .blob{position:absolute;width:60%;aspect-ratio:1;border-radius:50%;filter:blur(8cqi);animation:gm-drift 9s ease-in-out infinite alternate}
.gm .b1{background:#ff5fa2;left:-10%;top:-8%}
.gm .b2{background:#3ec5ff;right:-16%;top:8%;animation-duration:11s;animation-delay:-3s;animation-direction:alternate-reverse}
.gm .b3{background:#ffb347;left:18%;bottom:-22%;animation-duration:10s;animation-delay:-6s}
@keyframes gm-drift{to{transform:translate(16cqi,-10cqi) scale(1.15)}}
.gm .card{position:absolute;inset:27% 11%;padding:6cqi;border-radius:5cqi;color:#fff;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.35);box-shadow:inset 0 1px 0 rgba(255,255,255,.55),0 10px 30px rgba(20,0,40,.25);-webkit-backdrop-filter:blur(14px) saturate(160%);backdrop-filter:blur(14px) saturate(160%)}
.gm h3{margin:0;font-size:6cqi;font-weight:600;line-height:1.2}
.gm p{margin:1cqi 0 4cqi;font-size:3.6cqi;opacity:.75}
.gm .bar{height:2cqi;border-radius:1cqi;background:rgba(255,255,255,.3);margin-bottom:2.5cqi}
.gm .btn{position:absolute;right:5cqi;bottom:5cqi;padding:2.4cqi 4cqi;border-radius:99px;background:#fff;color:#2a1a40;font-size:3.4cqi;font-weight:600}
@media (prefers-reduced-motion:reduce){.gm .blob{animation:none}}
</style>
<div class="gm" role="img" aria-label="Frosted glass card">
  <i class="blob b1"></i><i class="blob b2"></i><i class="blob b3"></i>
  <div class="card"><h3>Glass card</h3><p>Frosted, translucent</p><div class="bar" style="width:80%"></div><div class="bar" style="width:55%"></div><span class="btn">Continue</span></div>
</div>
```

## 16 Paper cutout

**Technique:** SVG + CSS

> Make it a paper cutout scene: layered paper hills in dusty pinks and purples under a peach sky and orange sun, a little boat bobbing, each layer drifting sideways at its own speed.

- Palette: peach sky, orange sun, hills stepping from dusty pink to deep plum toward the viewer.
- Timing: back layer 30s, middle 20s, front 12s, all linear; the boat rocks on a 3s `ease-in-out` loop.
- Layering: every hill casts a small soft shadow upward onto the layer behind (`drop-shadow(0 -1px 1.5px)`).
- Key detail: the shadow between layers is what makes it paper. Without it the scene is flat vector art. Make hills periodic and pan exactly one period so the loop has no visible seam.

```html
<style>
.pc{display:block;width:100%;aspect-ratio:1}
.pc .l{filter:drop-shadow(0 -1px 1.5px rgba(60,20,50,.4));animation:pc-pan linear infinite}
.pc .l1{animation-duration:30s}.pc .l2{animation-duration:20s}.pc .l3{animation-duration:12s}
.pc .boat{transform-box:fill-box;transform-origin:50% 100%;animation:pc-bob 3s ease-in-out infinite alternate}
.pc .birds{animation:pc-fly 16s linear infinite}
@keyframes pc-pan{to{transform:translateX(-50px)}}
@keyframes pc-bob{from{transform:translateY(0) rotate(-5deg)}to{transform:translateY(-1.5px) rotate(5deg)}}
@keyframes pc-fly{from{transform:translateX(-40px)}to{transform:translateX(100px)}}
@media (prefers-reduced-motion:reduce){.pc *{animation:none!important}}
</style>
<svg class="pc" viewBox="0 0 100 100" role="img" aria-label="Paper cutout landscape">
  <rect width="100" height="100" fill="#f3dcc0"/>
  <circle cx="68" cy="32" r="12" fill="#ec8f5e"/>
  <path class="birds" d="M20 22q2-2 4 0q2-2 4 0M28 28q1.5-1.5 3 0q1.5-1.5 3 0" fill="none" stroke="#3a2a3a" stroke-width=".7"/>
  <path class="l l1" fill="#d39aa8" d="M0 60Q12.5 48 25 60T50 60T75 60T100 60T125 60T150 60V100H0Z"/>
  <path class="l l2" fill="#a0628c" d="M0 72Q12.5 82 25 72T50 72T75 72T100 72T125 72T150 72V100H0Z"/>
  <g class="boat"><path d="M38 79h12l-2.5 3h-7z" fill="#3a2234"/><path d="M44 78.5V69l5 9.5z" fill="#fff6e8"/></g>
  <path class="l l3" fill="#5e3a6e" d="M0 84Q12.5 78 25 84T50 84T75 84T100 84T125 84T150 84V100H0Z"/>
</svg>
```

## 17 Vaporwave grid

**Technique:** CSS

> Go vaporwave: a purple night sky with stars, a big striped sunset sun sinking into the horizon, a hot pink perspective grid rolling toward the viewer, and VAPOR in glowing cyan italics.

- Palette: indigo to magenta sky, sun from yellow through orange to pink, hot pink grid, cyan type.
- Timing: the floor scrolls one cell per second, linear.
- Layering: sky and stars, sun, then the floor plane (`perspective` + `rotateX(70deg)`) covering the sun's lower half, title on top.
- Key detail: the floor loops by moving exactly one grid cell, and the sun's stripe gaps grow toward the bottom. Even stripes look like a barcode.

```html
<style>
.vw{position:relative;aspect-ratio:1;overflow:hidden;container-type:inline-size;background:radial-gradient(1px 1px at 18% 14%,#fff,transparent),radial-gradient(1px 1px at 72% 10%,#fff,transparent),radial-gradient(1px 1px at 86% 30%,#fff,transparent),radial-gradient(1px 1px at 30% 34%,#fff,transparent),radial-gradient(circle at 50% 58%,rgba(255,70,170,.45),transparent 42%),linear-gradient(#12052e,#3a0d5c 45%,#8a1f7a 58%,#12052e 58%)}
.vw .sun{position:absolute;left:29%;top:26%;width:42%;aspect-ratio:1;border-radius:50%;background:linear-gradient(#ffe36b,#ff9a3c 50%,#ff3fa4);-webkit-mask:linear-gradient(#000 54%,transparent 54% 57%,#000 57% 66%,transparent 66% 70%,#000 70% 77%,transparent 77% 83%,#000 83%);mask:linear-gradient(#000 54%,transparent 54% 57%,#000 57% 66%,transparent 66% 70%,#000 70% 77%,transparent 77% 83%,#000 83%)}
.vw .floor{position:absolute;left:-60%;right:-60%;top:58%;height:70%;transform-origin:top;transform:perspective(30cqi) rotateX(70deg);background:linear-gradient(90deg,#ff3fd0 .35cqi,transparent .35cqi) 0 0/4.5cqi 4.5cqi,linear-gradient(#ff3fd0 .35cqi,transparent .35cqi) 0 0/4.5cqi 4.5cqi,#12052e;-webkit-mask:linear-gradient(transparent,#000 35%);mask:linear-gradient(transparent,#000 35%);animation:vw-run 1s linear infinite}
.vw b{position:absolute;top:8%;width:100%;text-align:center;font:italic 800 11cqi/1 system-ui,sans-serif;letter-spacing:.2em;color:#8ff5ff;text-shadow:0 0 2cqi #19d6ff}
@keyframes vw-run{to{background-position:0 4.5cqi,0 4.5cqi,0 0}}
@media (prefers-reduced-motion:reduce){.vw .floor{animation:none}}
</style>
<div class="vw" role="img" aria-label="Vaporwave sunset grid"><i class="sun"></i><i class="floor"></i><b>VAPOR</b></div>
```

## 18 Flow fields

**Technique:** Canvas 2D

> Make it a flow field: thousands of thin glowing violet and pink trails following an invisible current across a dark background, like silk or smoke.

- Palette: violet and pink at very low alpha on near-black; density does the brightening.
- Timing: particles move a fixed small step per frame; the field itself shifts slowly so the pattern never freezes.
- Layering: one path per color per frame, `lighter` composite, translucent background fill for decay.
- Key detail: build the field as the curl of a smooth potential. A raw `angle = noise(x, y)` field has sinks, and within seconds every particle piles into a few lines. Lifetimes with random respawn keep the coverage even. Also, a fade alpha under about 0.05 never fully clears and leaves gray ghosts.

```html
<style>
.ff{display:block;width:100%;aspect-ratio:1;background:#0c0618}
</style>
<canvas class="ff" role="img" aria-label="Flow field trails"></canvas>
<script>
(() => {
  const c = document.currentScript.previousElementSibling, x = c.getContext('2d');
  let W = 0;
  const size = () => { W = c.width = c.height = Math.round(c.clientWidth * (devicePixelRatio || 1)); x.fillStyle = '#0c0618'; x.fillRect(0, 0, W, W); };
  size(); addEventListener('resize', size);
  const spawn = p => { p.x = Math.random(); p.y = Math.random(); p.life = 80 + Math.random() * 200; return p; };
  const P = Array.from({ length: 2000 }, () => spawn({}));
  // curl of psi = sin(a)cos(2.7v) + .6 sin(b) + .4 cos(c): divergence free, so no sinks
  const angle = (u, v, t) => {
    const a = 3.1 * u + .3 * t, b = 2.3 * (u + v) - .2 * t, c = 4.3 * u - 3.7 * v;
    const du = 3.1 * Math.cos(a) * Math.cos(2.7 * v) + 1.38 * Math.cos(b) - 1.72 * Math.sin(c);
    const dv = -2.7 * Math.sin(a) * Math.sin(2.7 * v) + 1.38 * Math.cos(b) + 1.48 * Math.sin(c);
    return Math.atan2(-du, dv);
  };
  const COLS = ['rgba(176,92,255,.5)', 'rgba(255,92,200,.42)'];
  function step(t) {
    x.globalCompositeOperation = 'source-over';
    x.fillStyle = 'rgba(12,6,24,.06)'; x.fillRect(0, 0, W, W);
    x.globalCompositeOperation = 'lighter';
    x.lineWidth = Math.max(1, W / 300);
    COLS.forEach((col, k) => {
      x.strokeStyle = col; x.beginPath();
      for (let i = k; i < P.length; i += 2) {
        const p = P[i], a = angle(p.x * 2, p.y * 2, t), nx = p.x + Math.cos(a) * .0025, ny = p.y + Math.sin(a) * .0025;
        x.moveTo(p.x * W, p.y * W); x.lineTo(nx * W, ny * W);
        p.x = nx; p.y = ny;
        if (--p.life < 0 || nx < 0 || nx > 1 || ny < 0 || ny > 1) spawn(p);
      }
      x.stroke();
    });
  }
  const rm = matchMedia('(prefers-reduced-motion: reduce)');
  const still = () => { for (let k = 0; k < 160; k++) step(0); };
  if (rm.matches) { addEventListener('resize', still); return still(); }
  const loop = now => { if (!rm.matches) step(now / 1000); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
})();
</script>
```

## 19 Metaballs

**Technique:** WebGL

> Do metaballs: a few glowing orange blobs drifting on a dark purple background, stretching and merging into each other when they get close, like a lava lamp.

- Palette: dark plum background, orange blobs with hot yellow cores and a dim orange halo.
- Timing: each ball on its own Lissajous path with slightly different speeds so the merges never repeat exactly.
- Layering: one fragment shader: sum `r^2 / d^2` per ball, `smoothstep` around 1.0 for the edge, the raw field for the halo.
- Key detail: threshold the field with a narrow `smoothstep` (0.95 to 1.05). A hard step aliases, a wide one turns blobs into fog, and the halo comes from the same field below the threshold.

```html
<style>
.mb{display:block;width:100%;aspect-ratio:1;background:#1a0a24}
</style>
<canvas class="mb" role="img" aria-label="Metaballs"></canvas>
<script>
(() => {
  const c = document.currentScript.previousElementSibling, g = c.getContext('webgl');
  if (!g) return;
  const FS = `precision mediump float;uniform vec2 R;uniform float T;
void main(){vec2 p=(gl_FragCoord.xy-.5*R)/R.y;float f=0.;
for(int i=0;i<5;i++){float k=float(i);vec2 b=.3*vec2(sin(T*(.5+.13*k)+k*1.7),cos(T*(.4+.11*k)+k*2.3));float r=.08+.015*k;f+=r*r/dot(p-b,p-b);}
vec3 bg=vec3(.10,.04,.14)+vec3(1.,.35,.05)*smoothstep(.15,1.,f)*.3;
vec3 core=mix(vec3(1.,.42,.05),vec3(1.,.88,.45),smoothstep(1.,4.,f));
gl_FragColor=vec4(mix(bg,core,smoothstep(.95,1.05,f)),1.);}`;
  const sh = (type, src) => { const s = g.createShader(type); g.shaderSource(s, src); g.compileShader(s); return s; };
  const pr = g.createProgram();
  g.attachShader(pr, sh(g.VERTEX_SHADER, 'attribute vec2 a;void main(){gl_Position=vec4(a,0,1);}'));
  g.attachShader(pr, sh(g.FRAGMENT_SHADER, FS));
  g.bindAttribLocation(pr, 0, 'a'); g.linkProgram(pr); g.useProgram(pr);
  g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer());
  g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW);
  g.enableVertexAttribArray(0); g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
  const uR = g.getUniformLocation(pr, 'R'), uT = g.getUniformLocation(pr, 'T');
  const size = () => { c.width = c.height = Math.round(c.clientWidth * Math.min(2, devicePixelRatio || 1)); g.viewport(0, 0, c.width, c.height); };
  size(); addEventListener('resize', size);
  const draw = t => { g.uniform2f(uR, c.width, c.height); g.uniform1f(uT, t); g.drawArrays(g.TRIANGLES, 0, 3); };
  const rm = matchMedia('(prefers-reduced-motion: reduce)');
  if (rm.matches) { addEventListener('resize', () => draw(2)); return draw(2); }
  const loop = now => { if (!rm.matches) draw(now / 1000); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
})();
</script>
```

## 20 Ray-marched fractals

**Technique:** WebGL

> Render a ray-marched fractal: a Mandelbulb slowly rotating in a dark purple void, lit warm orange on its ridges fading to violet in the crevices.

- Palette: orange and amber on exposed ridges, violet in the folds, dark purple vignette behind.
- Timing: slow orbit, about a quarter radian per second. Fast camera moves turn the detail into noise.
- Layering: sphere tracing with the Mandelbulb distance estimator, diffuse light, step count ambient occlusion, orbit trap for color, a little rim light.
- Key detail: cheap ambient occlusion from the march step count (`1 - steps / max`) is what gives the crevices depth. Also cap device pixel ratio; this shader is expensive per pixel.

```html
<style>
.rm{display:block;width:100%;aspect-ratio:1;background:#0d0614}
</style>
<canvas class="rm" role="img" aria-label="Mandelbulb fractal"></canvas>
<script>
(() => {
  const c = document.currentScript.previousElementSibling, g = c.getContext('webgl');
  if (!g) return;
  const FS = `precision highp float;uniform vec2 R;uniform float T;
float de(vec3 p,out float trap){vec3 z=p;float dr=1.,r=0.;trap=9.;
for(int i=0;i<6;i++){r=length(z);if(r>2.)break;trap=min(trap,r);
float th=acos(clamp(z.z/r,-1.,1.))*8.,ph=atan(z.y,z.x)*8.;dr=pow(r,7.)*8.*dr+1.;
z=pow(r,8.)*vec3(sin(th)*cos(ph),sin(th)*sin(ph),cos(th))+p;}
return .5*log(r)*r/dr;}
vec3 nrm(vec3 p){float t;vec2 e=vec2(.001,0);
return normalize(vec3(de(p+e.xyy,t)-de(p-e.xyy,t),de(p+e.yxy,t)-de(p-e.yxy,t),de(p+e.yyx,t)-de(p-e.yyx,t)));}
void main(){vec2 uv=(gl_FragCoord.xy-.5*R)/R.y;float a=T*.25;
vec3 ro=vec3(sin(a),.35,cos(a))*3.,f=normalize(-ro),rt=normalize(cross(vec3(0,1,0),f)),up=cross(f,rt);
vec3 rd=normalize(f*1.25+uv.x*rt+uv.y*up);
float d=0.,trap=0.,steps=0.;bool hit=false;
for(int i=0;i<72;i++){float h=de(ro+rd*d,trap);if(h<.0012*d){hit=true;break;}d+=h;steps+=1.;if(d>6.)break;}
vec3 col=mix(vec3(.002,.001,.004),vec3(.022,.006,.034),1.-length(uv));
if(hit){vec3 p=ro+rd*d,n=nrm(p);float dif=max(dot(n,normalize(vec3(.6,.8,.4))),0.),ao=1.-steps/72.;
vec3 base=mix(vec3(.42,.16,.6),vec3(1.,.55,.18),clamp((trap-.8)*3.,0.,1.));
col=base*(.2+.8*dif)*ao+vec3(.6,.3,.8)*.2*pow(1.-max(dot(n,-rd),0.),3.);}
gl_FragColor=vec4(pow(col,vec3(.4545)),1.);}`;
  const sh = (type, src) => { const s = g.createShader(type); g.shaderSource(s, src); g.compileShader(s); return s; };
  const pr = g.createProgram();
  g.attachShader(pr, sh(g.VERTEX_SHADER, 'attribute vec2 a;void main(){gl_Position=vec4(a,0,1);}'));
  g.attachShader(pr, sh(g.FRAGMENT_SHADER, FS));
  g.bindAttribLocation(pr, 0, 'a'); g.linkProgram(pr); g.useProgram(pr);
  g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer());
  g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW);
  g.enableVertexAttribArray(0); g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
  const uR = g.getUniformLocation(pr, 'R'), uT = g.getUniformLocation(pr, 'T');
  const size = () => { c.width = c.height = Math.round(c.clientWidth * Math.min(1.5, devicePixelRatio || 1)); g.viewport(0, 0, c.width, c.height); };
  size(); addEventListener('resize', size);
  const draw = t => { g.uniform2f(uR, c.width, c.height); g.uniform1f(uT, t); g.drawArrays(g.TRIANGLES, 0, 3); };
  const rm = matchMedia('(prefers-reduced-motion: reduce)');
  if (rm.matches) { addEventListener('resize', () => draw(1.5)); return draw(1.5); }
  const loop = now => { if (!rm.matches) draw(now / 1000); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
})();
</script>
```
