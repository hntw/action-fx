/*! Action FX v2 | comic-strip feedback effects for user actions | MIT */
/*
  The archive: each effect is a symbol from the cartoonist's vocabulary, most named by Mort Walker in
  The Lexicon of Comicana (1980).

    emanata     surprise lines        a click or tap
    plewds      sweat drops           an error, a nervous moment
    agitrons    shake lines           a wrong password, an invalid field
    briffits    dust puffs            send, submit, take off
    solrads     shine rays            success, unlocked, new
    squeans     dizzy stars           loading, overload
    spurls      confusion spiral      not found, nothing here
    waftaroms   waft lines            hot, fresh, just baked
    grawlixes   cursing symbols       a playful error
    speedlines  motion lines          next, go, move along

  Use it
    <script src="actionfx.js" defer data-bind="button, .btn"></script>     emanata on every button
    ActionFX.bind('button', { effect: 'emanata', shape: 'corners' });
    ActionFX.play('plewds', el, opts);        // returns { stop() }
    ActionFX.solrads(el, opts);               // same, one shortcut per effect; ActionFX.click = emanata
    ActionFX.play('emanata', { x, y });       // at a viewport point
    ActionFX.draw(ctx, t, { effect, x, y, w, h, ... });   // pure function of t (seconds): video export

  Per element: data-afx="plewds" picks the effect for bind(), data-afx="off" skips it, and any
  data-afx-<option> sets an option (data-afx-shape="corners", data-afx-color="#e2412f").
*/
(function (root) {
  'use strict';

  var BASE = {
    scale: 1,           // multiplies every size
    speed: 1,           // >1 plays faster
    color: 'auto',      // ink; auto = the surrounding text color, so it reads on light and dark pages
    fill: 'auto',       // paper inside outlined shapes (drops, puffs, stars); auto = the page background
    move: true,         // the element reacts (squash, shake, hop, nudge) where the effect has a move
    loop: false,        // keep going until stop()
    seed: 0,            // 0 = new variation each time
    reducedMotion: 'respect'
  };

  // ---------- helpers (pure) ----------

  function rng(seed) {
    var s = seed >>> 0 || 1;
    return function () { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  }
  function clamp(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function outCubic(x) { return 1 - Math.pow(1 - x, 3); }
  function inOutQuad(x) { return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; }
  function outBack(x) { var c = 1.9; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); }
  function norm(x, y) { var l = Math.hypot(x, y) || 1; return [x / l, y / l]; }
  var TAU = Math.PI * 2;

  // Fade in over fin seconds, out over the last fout seconds (never out while looping).
  function env(t, D, o, fin, fout) {
    return clamp(t / fin) * (o.loop ? 1 : 1 - clamp((t - (D - fout)) / fout));
  }
  function top(o) { return o.h ? o.y : o.cy; }

  // Point and normal at arc length s around a rounded rect centred on 0,0.
  function edge(s, sx, sy, rad, arc) {
    var seg = [2 * sx, arc, 2 * sy, arc, 2 * sx, arc, 2 * sy, arc], k = 0;
    s = (s + sx) % (4 * sx + 4 * sy + 4 * arc); // origin at the top-left end of the top edge
    while (k < 7 && s > seg[k]) { s -= seg[k]; k++; }
    var q = s / (seg[k] || 1), a;
    switch (k) {
      case 0: return [-sx + 2 * sx * q, -sy - rad, 0, -1];
      case 2: return [sx + rad, -sy + 2 * sy * q, 1, 0];
      case 4: return [sx - 2 * sx * q, sy + rad, 0, 1];
      case 6: return [-sx - rad, sy - 2 * sy * q, -1, 0];
    }
    var c = [[sx, -sy, -Math.PI / 2], [sx, sy, 0], [-sx, sy, Math.PI / 2], [-sx, -sy, Math.PI]][(k - 1) / 2];
    a = c[2] + q * Math.PI / 2;
    return [c[0] + Math.cos(a) * rad, c[1] + Math.sin(a) * rad, Math.cos(a), Math.sin(a)];
  }

  // n points spaced evenly around the element grown by gap (a circle for a point). Direction leans from the
  // edge normal toward radial by mix, so lines on a wide button fan out instead of standing up like a comb.
  function ring(o, n, gap, mix, off) {
    var hw = o.w / 2 + gap, hh = o.h / 2 + gap, rad = Math.min(hw, hh);
    var sx = hw - rad, sy = hh - rad, arc = Math.PI * rad / 2, per = 4 * sx + 4 * sy + 4 * arc, out = [];
    for (var i = 0; i < n; i++) {
      var p = edge((((off + i / n) % 1) + 1) % 1 * per, sx, sy, rad, arc);
      var rd = norm(p[0], p[1] * (hw / hh)), d = norm(p[2] * (1 - mix) + rd[0] * mix, p[3] * (1 - mix) + rd[1] * mix);
      out.push({ x: o.cx + p[0], y: o.cy + p[1], dx: d[0], dy: d[1] });
    }
    return out;
  }

  // A brush stroke along a polyline: width w0 at the start, w1 at the end, round ends, one filled path
  // (so a faded stroke has no darker overlaps).
  function strand(ctx, P, w0, w1) {
    var n = P.length, L = [], R = [], i, a0, a1;
    for (i = 0; i < n; i++) {
      var A = P[i > 0 ? i - 1 : 0], B = P[i < n - 1 ? i + 1 : n - 1], t = norm(B[0] - A[0], B[1] - A[1]);
      var w = (w0 + (w1 - w0) * i / (n - 1)) / 2;
      L.push([P[i][0] - t[1] * w, P[i][1] + t[0] * w]); R.push([P[i][0] + t[1] * w, P[i][1] - t[0] * w]);
      if (i === 0) a0 = Math.atan2(t[0], -t[1]);
      if (i === n - 1) a1 = Math.atan2(t[0], -t[1]);
    }
    ctx.beginPath();
    ctx.moveTo(L[0][0], L[0][1]);
    for (i = 1; i < n; i++) ctx.lineTo(L[i][0], L[i][1]);
    ctx.arc(P[n - 1][0], P[n - 1][1], Math.max(w1 / 2, 0.01), a1, a1 - Math.PI, true);
    for (i = n - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
    ctx.arc(P[0][0], P[0][1], Math.max(w0 / 2, 0.01), a0 + Math.PI, a0, true);
    ctx.closePath();
    ctx.fill();
  }

  // An old-comics ink line: full width at the inner end, tapering outward, with a slight bow.
  function ink(ctx, x0, y0, x1, y1, w, bend) {
    var dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1, b = (bend || 0) * l;
    strand(ctx, [[x0, y0], [(x0 + x1) / 2 - dy / l * b, (y0 + y1) / 2 + dx / l * b], [x1, y1]], w, w * 0.22);
  }

  function star(ctx, x, y, R, pts, inner, rot) {
    ctx.beginPath();
    for (var i = 0; i < pts * 2; i++) {
      var r = i % 2 ? R * inner : R, a = rot + i * Math.PI / pts - Math.PI / 2;
      ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
  }

  // Points along an Archimedes spiral, drawn from fraction `from` to `to` of its length.
  function spiral(cx, cy, R, turns, from, to, rot, dir) {
    var P = [], th0 = 0.5 * Math.PI, th1 = turns * TAU, a = th0 + (th1 - th0) * from, b = th0 + (th1 - th0) * to;
    for (var th = a; th <= b + 1e-6; th += 0.22) {
      var r = R * th / th1;
      P.push([cx + Math.cos(dir * th + rot) * r, cy + Math.sin(dir * th + rot) * r]);
    }
    return P.length < 2 ? null : P;
  }

  // Ink outline around a union of circles: fat ink discs first, paper discs on top.
  function puffs(ctx, C, lw, paper, inkc) {
    var i, r;
    ctx.fillStyle = inkc;
    ctx.beginPath();
    for (i = 0; i < C.length; i++) { r = C[i][2] + lw / 2; ctx.moveTo(C[i][0] + r, C[i][1]); ctx.arc(C[i][0], C[i][1], r, 0, TAU); }
    ctx.fill();
    ctx.fillStyle = paper;
    ctx.beginPath();
    for (i = 0; i < C.length; i++) { r = Math.max(C[i][2] - lw / 2, 0); ctx.moveTo(C[i][0] + r, C[i][1]); ctx.arc(C[i][0], C[i][1], r, 0, TAU); }
    ctx.fill();
  }

  // ---------- the effects ----------
  // Each: defaults, peak (the frame shown, still, under reduced motion), native (loops by itself rather than
  // repeating), setup(o, rand) -> state, draw(ctx, t, D, o, state) with t and D in seconds, move(o) -> keyframes.

  var FX = {};

  FX.emanata = {
    name: 'Surprise lines', use: 'a click or tap', peak: 0.4,
    defaults: { shape: 'ring', count: 12, length: 16, width: 3, gap: 6, travel: 0.6, duration: 420 },
    setup: function (o, r) {
      var s = o.scale, gap = o.gap * s, out = [], i;
      function add(p) {
        out.push({ x: p.x, y: p.y, dx: p.dx, dy: p.dy, len: o.length * s * (0.75 + r() * 0.45), delay: r() * 0.1, bend: (r() - 0.5) * 0.12 });
      }
      if (o.shape === 'corners' && o.w) {
        // Three lines fanned off each top corner, like a cartoon "pop".
        [-1, 1].forEach(function (c) {
          var px = o.cx + c * (o.w / 2 + gap * 0.5), py = o.cy - (o.h / 2 + gap * 0.5), base = Math.atan2(-1, c);
          for (i = -1; i <= 1; i++) {
            var a = base + i * 0.52 + (r() - 0.5) * 0.12, d = [Math.cos(a), Math.sin(a)];
            add({ x: px + d[0] * gap * 0.5, y: py + d[1] * gap * 0.5, dx: d[0], dy: d[1] });
          }
        });
      } else {
        ring(o, o.count, o.w ? gap : gap * 1.5, 0.45, r()).forEach(add);
      }
      return out;
    },
    draw: function (ctx, t, D, o, S) {
      var u = t / D;
      for (var i = 0; i < S.length; i++) {
        var L = S[i], v = clamp((u - L.delay) / (1 - L.delay));
        if (v <= 0) continue;
        var head = outCubic(clamp(v / 0.45)), tail = inOutQuad(clamp((v - 0.22) / 0.78)), drift = o.travel * outCubic(v);
        if (o.still) { head = 1; tail = 0; drift = 0; }
        var a = (drift + tail) * L.len, b = (drift + head) * L.len;
        if (b - a < 0.4) continue;
        ink(ctx, L.x + L.dx * a, L.y + L.dy * a, L.x + L.dx * b, L.y + L.dy * b, o.width * o.scale * (1 - 0.3 * v), L.bend);
      }
    },
    move: function () { // a gummy squish and spring back
      return [{ scale: ['1', '0.92', '1.045', '1'], offset: [0, 0.22, 0.6, 1] }, 380];
    }
  };

  FX.plewds = {
    name: 'Sweat drops', use: 'an error or a nervous moment', peak: 0.3,
    defaults: { count: 4, size: 6, duration: 950 },
    setup: function (o, r) {
      var s = o.scale, out = [], inset = Math.min(o.w / 4, 12 * s);
      for (var i = 0; i < o.count; i++) {
        var side = i % 2 ? 1 : -1, a = 0.35 + r() * 0.5, v = (95 + r() * 55) * s;
        out.push({
          x: o.cx + side * (o.w ? o.w / 2 - inset : 4 * s), y: top(o) - 5 * s,
          vx: side * Math.sin(a) * v, vy: -Math.cos(a) * v, r: o.size * s * (0.8 + r() * 0.4),
          delay: (i >> 1) * 0.12 + r() * 0.06
        });
      }
      return out;
    },
    draw: function (ctx, t, D, o, S) {
      var u = t / D, s = o.scale, G = 520 * s, fade = 1 - clamp((u - 0.65) / 0.35);
      ctx.lineWidth = 1.8 * s;
      for (var i = 0; i < S.length; i++) {
        var d = S[i], T = (u - d.delay) * 0.95;
        if (T <= 0) continue;
        var x = d.x + d.vx * T, y = d.y + d.vy * T + 0.5 * G * T * T, ang = Math.atan2(d.vy + G * T, d.vx);
        var r = d.r * outBack(clamp(T / 0.14));
        // Teardrop: round head leading, point trailing back along the path.
        var b = ang + Math.PI, dd = r * 2.5, al = Math.acos(1 / 2.5);
        ctx.globalAlpha = o.a * fade;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(b) * dd, y + Math.sin(b) * dd);
        ctx.lineTo(x + Math.cos(b + al) * r, y + Math.sin(b + al) * r);
        ctx.arc(x, y, r, b + al, b - al + TAU);
        ctx.closePath();
        ctx.fillStyle = o.paper; ctx.fill(); ctx.stroke();
      }
    }
  };

  FX.agitrons = {
    name: 'Shake lines', use: 'a wrong password or invalid field', peak: 0.3, native: true,
    defaults: { lines: 3, gap: 6, duration: 650 },
    setup: function (o, r) { return { ph: r() * TAU }; },
    draw: function (ctx, t, D, o, S) {
      var s = o.scale, k, i, side;
      for (side = -1; side <= 1; side += 2) for (i = 0; i < o.lines; i++) {
        var a = env(t - i * 0.04, D - i * 0.04, o, 0.06, 0.22);
        if (a <= 0) continue;
        var x = o.cx + side * (o.w / 2 + o.gap * s + i * 7 * s), H = (o.h ? Math.min(o.h * 0.85, 44 * s) : 22 * s) * (1 - i * 0.2);
        var P = [];
        for (k = 0; k <= 10; k++) {
          P.push([x + side * 2.2 * s * Math.sin(k / 10 * Math.PI * 3 + (o.still ? 0 : t * 45) + S.ph + i), o.cy - H / 2 + H * k / 10]);
        }
        ctx.globalAlpha = o.a * a;
        strand(ctx, P, 2.4 * s * (1 - 0.2 * i), 2.4 * s * (1 - 0.2 * i));
      }
    },
    move: function (o) { // a decaying side-to-side shake
      var s = o.scale;
      return [{ translate: [0, -6, 6, -5, 5, -3, 3, -1, 0].map(function (v) { return v * s + 'px 0'; }) }, 520];
    }
  };

  FX.briffits = {
    name: 'Dust puffs', use: 'send, submit, take off', peak: 0.35,
    defaults: { count: 10, size: 12, from: 'bottom', duration: 800 },
    setup: function (o, r) {
      var s = o.scale, out = [];
      for (var i = 0; i < o.count; i++) {
        var p = { R: o.size * s * (0.6 + r() * 0.6), delay: r() * 0.18 }, side;
        if (o.from === 'left' || o.from === 'right') {
          side = o.from === 'left' ? -1 : 1;
          p.x = o.cx + side * o.w / 2; p.y = o.h ? o.y + (0.15 + r() * 0.7) * o.h : o.cy + (r() - 0.5) * 16 * s;
          p.vx = side * (20 + r() * 45) * s; p.vy = (r() - 0.5) * 24 * s;
        } else {
          side = i % 2 ? 1 : -1;
          p.x = o.cx + side * (o.w / 2 - r() * Math.min(o.w * 0.25, 16 * s)); p.y = o.y + o.h - 2 * s;
          p.vx = side * (20 + r() * 50) * s; p.vy = -(4 + r() * 18) * s;
        }
        out.push(p);
      }
      return out;
    },
    draw: function (ctx, t, D, o, S) {
      var u = t / D, C = [];
      for (var i = 0; i < S.length; i++) {
        var p = S[i], v = clamp((u - p.delay) / (1 - p.delay));
        if (v <= 0) continue;
        var r = p.R * outBack(clamp(v / 0.3)) * (1 - inOutQuad(clamp((v - 0.5) / 0.5))), m = outCubic(v) * 0.8;
        if (r > 0.3) C.push([p.x + p.vx * m, p.y + p.vy * m, r]);
      }
      puffs(ctx, C, 2 * o.scale, o.paper, o.ink);
    },
    move: function (o) {
      var s = o.scale;
      if (o.from === 'left' || o.from === 'right') {
        var d = (o.from === 'left' ? 1 : -1) * 9 * s;
        return [{ translate: ['0 0', d + 'px 0', -d * 0.2 + 'px 0', '0 0'], offset: [0, 0.3, 0.65, 1] }, 420];
      }
      return [{ translate: ['0 0', '0 ' + -8 * s + 'px', '0 0', '0 ' + -2 * s + 'px', '0 0'], offset: [0, 0.3, 0.6, 0.8, 1] }, 460];
    }
  };

  FX.solrads = {
    name: 'Shine rays', use: 'success, unlocked, new', peak: 0.4,
    defaults: { count: 16, length: 24, gap: 8, width: 2.6, sparkles: 3, duration: 1100 },
    setup: function (o, r) {
      var S = { off: r(), len: [], sp: [] }, i;
      for (i = 0; i < o.count; i++) S.len.push((i % 2 ? 0.55 : 1) * (0.9 + r() * 0.2));
      for (i = 0; i < o.sparkles; i++) S.sp.push({ k: Math.floor(r() * o.count), at: 0.6 + r() * 0.6, side: r() - 0.5, R: 5 + r() * 3, delay: 0.1 + r() * 0.3, rot: r() });
      return S;
    },
    draw: function (ctx, t, D, o, S) {
      var u = t / D, s = o.scale, L = o.length * s, i;
      var R = ring(o, o.count, o.gap * s, 1, S.off + (o.still ? 0 : t * 0.035));
      var head = o.still ? 1 : outCubic(clamp(u / 0.35)), tail = o.still ? 0 : inOutQuad(clamp((u - 0.55) / 0.45));
      for (i = 0; i < R.length; i++) {
        var p = R[i], l = L * S.len[i] * (1 + 0.08 * Math.sin(t * 12 + i)), a = tail * l, b = head * l;
        if (b - a > 0.4) ink(ctx, p.x + p.dx * a, p.y + p.dy * a, p.x + p.dx * b, p.y + p.dy * b, o.width * s, 0);
      }
      for (i = 0; i < S.sp.length; i++) {
        var q = S.sp[i], v = clamp((u - q.delay) / 0.5);
        if (v <= 0 || v >= 1) continue;
        var P = R[q.k], d = L * q.at, sc = outBack(clamp(v / 0.35)) * (1 - inOutQuad(clamp((v - 0.6) / 0.4)));
        star(ctx, P.x + P.dx * d - P.dy * q.side * 10 * s, P.y + P.dy * d + P.dx * q.side * 10 * s, q.R * s * sc, 4, 0.28, q.rot + t * 2);
        ctx.fill();
      }
    },
    move: function () { return [{ scale: ['1', '1.07', '1'], easing: 'ease-in-out' }, 520]; }
  };

  FX.squeans = {
    name: 'Dizzy stars', use: 'loading or overload', peak: 0.3, native: true,
    defaults: { count: 5, size: 8.5, duration: 1600 },
    setup: function (o, r) {
      var kinds = ['star', 'circle', 'plus', 'star', 'circle', 'plus'], S = { ph: r() * TAU, it: [] };
      for (var i = 0; i < o.count; i++) S.it.push({ k: kinds[i % kinds.length], sz: 0.85 + r() * 0.3, rot: r() * TAU });
      return S;
    },
    draw: function (ctx, t, D, o, S) {
      var s = o.scale, rx = o.w ? Math.min(Math.max(o.w * 0.42, 22 * s), 64 * s) : 20 * s, ry = rx * 0.3;
      var cy = top(o) - 10 * s - ry, n = S.it.length, list = [], i, spin = o.still ? 0 : t * 3.2;
      for (i = 0; i < n; i++) {
        var th = S.ph + spin + i * TAU / n, depth = (Math.sin(th) + 1) / 2;
        list.push({ x: o.cx + Math.cos(th) * rx, y: cy + Math.sin(th) * ry, d: depth, it: S.it[i], pop: outBack(clamp((t - i * 0.05) / 0.25)) });
      }
      list.sort(function (a, b) { return a.d - b.d; });
      ctx.lineWidth = 1.7 * s;
      ctx.globalAlpha = o.a * env(t, D, o, 0.01, 0.3);
      for (i = 0; i < n; i++) {
        var q = list[i], R = o.size * s * q.it.sz * (0.6 + 0.4 * q.d) * (o.still ? 1 : q.pop);
        if (R <= 0.2) continue;
        ctx.fillStyle = o.paper;
        if (q.it.k === 'star') { star(ctx, q.x, q.y, R, 5, 0.45, q.it.rot + t); ctx.fill(); ctx.stroke(); }
        else if (q.it.k === 'circle') { ctx.beginPath(); ctx.arc(q.x, q.y, R * 0.5, 0, TAU); ctx.fill(); ctx.stroke(); }
        else {
          ctx.beginPath();
          for (var k = 0; k < 2; k++) {
            var a = q.it.rot + t * 2 + k * Math.PI / 2;
            ctx.moveTo(q.x - Math.cos(a) * R * 0.6, q.y - Math.sin(a) * R * 0.6); ctx.lineTo(q.x + Math.cos(a) * R * 0.6, q.y + Math.sin(a) * R * 0.6);
          }
          ctx.stroke();
        }
      }
    },
    move: function () { return [{ rotate: ['0deg', '-4deg', '4deg', '-2deg', '0deg'] }, 600]; }
  };

  FX.spurls = {
    name: 'Confusion spiral', use: 'not found, nothing here', peak: 0.5,
    defaults: { size: 13, turns: 2.6, width: 2.6, duration: 1300 },
    setup: function (o, r) { return { dir: r() < 0.5 ? 1 : -1, rot: r() * TAU }; },
    draw: function (ctx, t, D, o, S) {
      var u = t / D, s = o.scale, R = o.size * s;
      var P = spiral(o.cx, top(o) - 10 * s - R, R, o.turns, 0, o.still ? 1 : outCubic(clamp(u / 0.45)), S.rot + S.dir * (o.still ? 0 : t * 5), S.dir);
      if (!P) return;
      ctx.globalAlpha = o.a * (1 - clamp((u - 0.75) / 0.25));
      strand(ctx, P, 0.9 * s, o.width * s);
    },
    move: function () { return [{ rotate: ['0deg', '-5deg', '3deg', '0deg'] }, 520]; }
  };

  FX.waftaroms = {
    name: 'Waft lines', use: 'hot, fresh, just out of the oven', peak: 0.5, native: true,
    defaults: { count: 3, length: 26, rise: 26, width: 2.8, duration: 2400 },
    setup: function (o, r) { var S = []; for (var i = 0; i < o.count; i++) S.push(r() * 0.2); return S; },
    draw: function (ctx, t, D, o, S) {
      var s = o.scale, n = S.length, sp = o.w ? Math.min(Math.max(o.w * 0.22, 10 * s), 16 * s) : 9 * s, base = top(o) - 6 * s;
      var all = env(t, D, o, 0.25, 0.6);
      for (var i = 0; i < n; i++) {
        var p = ((o.still ? 0.5 : t / 1.6) + i * 0.37 + S[i]) % 1, x = o.cx + (i - (n - 1) / 2) * sp, P = [];
        for (var k = 0; k <= 10; k++) {
          var v = k / 10;
          P.push([x + 3.4 * s * Math.sin(v * TAU + t * 4 + i * 1.7) * (0.4 + 0.6 * v), base - p * o.rise * s - v * o.length * s]);
        }
        ctx.globalAlpha = o.a * all * Math.sin(Math.PI * p);
        strand(ctx, P, o.width * s, 0.8 * s);
      }
    }
  };

  FX.grawlixes = {
    name: 'Cursing symbols', use: 'a playful error', peak: 0.45,
    defaults: { count: 7, size: 18, duration: 1200, font: '"Arial Black", Impact, system-ui, sans-serif' },
    setup: function (o, r) {
      var pool = ['@', '#', '$', '%', '&', 'spiral', 'bolt', 'star'], out = [], s = o.scale, i;
      for (i = pool.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp; }
      var n = o.count, spread = o.w ? Math.min(o.w / 2 + 6 * s, 60 * s) : 26 * s;
      for (i = 0; i < n; i++) {
        var f = (i + 0.5) / n;
        out.push({
          g: i === n - 1 ? '!' : pool[i % pool.length],
          x: o.cx + spread * (f * 2 - 1) + (r() - 0.5) * 6 * s,
          y: top(o) - 14 * s - r() * 10 * s - Math.sin(Math.PI * f) * 10 * s,
          rot: (r() - 0.5) * 0.6, sz: o.size * s * (0.8 + r() * 0.4), delay: i * 0.045 + r() * 0.03
        });
      }
      return out;
    },
    draw: function (ctx, t, D, o, S) {
      var u = t / D, s = o.scale;
      ctx.globalAlpha = o.a * (1 - clamp((u - 0.75) / 0.25));
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (var i = 0; i < S.length; i++) {
        var q = S[i], v = clamp((u - q.delay) / 0.18);
        if (v <= 0) continue;
        var sc = o.still ? 1 : outBack(v), j = o.still ? 0 : Math.sin(t * 28 + i * 2) * 0.08, z = q.sz;
        ctx.save();
        ctx.translate(q.x, q.y); ctx.rotate(q.rot + j); ctx.scale(sc, sc);
        if (q.g === 'bolt') {
          ctx.beginPath();
          [[0.15, -0.55], [-0.3, 0.05], [0, 0.05], [-0.15, 0.55], [0.3, -0.1], [0, -0.1]].forEach(function (p, k) { ctx[k ? 'lineTo' : 'moveTo'](p[0] * z, p[1] * z); });
          ctx.closePath(); ctx.fill();
        } else if (q.g === 'star') {
          star(ctx, 0, 0, z * 0.5, 5, 0.45, 0); ctx.fill();
        } else if (q.g === 'spiral') {
          strand(ctx, spiral(0, 0, z * 0.45, 2.2, 0, 1, 0, 1), 0.8 * s, 2.4 * s);
        } else {
          ctx.font = '900 ' + Math.round(z) + 'px ' + o.font;
          ctx.lineWidth = 3.5 * s; ctx.strokeStyle = o.paper; ctx.strokeText(q.g, 0, 0);
          ctx.fillText(q.g, 0, 0);
        }
        ctx.restore();
      }
    },
    move: function (o) {
      var s = o.scale;
      return [{ translate: [0, -3, 3, -2, 2, 0].map(function (v) { return v * s + 'px 0'; }) }, 360];
    }
  };

  var DIRS = { right: [1, 0], left: [-1, 0], up: [0, -1], down: [0, 1] };

  FX.speedlines = {
    name: 'Motion lines', use: 'next, go, move along', peak: 0.4,
    defaults: { count: 5, length: 36, gap: 6, width: 2.6, dir: 'right', duration: 520 },
    setup: function (o, r) {
      var s = o.scale, D = DIRS[o.dir] || DIRS.right, out = [];
      for (var i = 0; i < o.count; i++) {
        var f = (i + 0.2 + r() * 0.6) / o.count, x, y;
        if (D[0]) {
          x = D[0] > 0 ? o.x - o.gap * s : o.x + o.w + o.gap * s;
          y = o.h ? o.y + f * o.h : o.cy + (f - 0.5) * 24 * s;
        } else {
          y = D[1] > 0 ? o.y - o.gap * s : o.y + o.h + o.gap * s;
          x = o.w ? o.x + f * o.w : o.cx + (f - 0.5) * 24 * s;
        }
        out.push({ x: x, y: y, dx: -D[0], dy: -D[1], len: o.length * s * (0.5 + r() * 0.7), delay: r() * 0.12 });
      }
      return out;
    },
    draw: function (ctx, t, D, o, S) {
      var u = t / D;
      for (var i = 0; i < S.length; i++) {
        var L = S[i], v = clamp((u - L.delay) / (1 - L.delay));
        if (v <= 0) continue;
        var head = o.still ? 1 : outCubic(clamp(v / 0.4)), tail = o.still ? 0 : inOutQuad(clamp((v - 0.25) / 0.75));
        var a = tail * L.len, b = head * L.len;
        if (b - a > 0.4) ink(ctx, L.x + L.dx * a, L.y + L.dy * a, L.x + L.dx * b, L.y + L.dy * b, o.width * o.scale, 0);
      }
    },
    move: function (o) {
      var D = DIRS[o.dir] || DIRS.right, k = 8 * o.scale;
      return [{ translate: ['0 0', D[0] * k + 'px ' + D[1] * k + 'px', -D[0] * k * 0.25 + 'px ' + -D[1] * k * 0.25 + 'px', '0 0'], offset: [0, 0.3, 0.65, 1] }, 400];
    }
  };

  // ---------- pure draw ----------

  function merge(E, o) {
    var r = {}, k;
    for (k in BASE) r[k] = BASE[k];
    for (k in E.defaults) r[k] = E.defaults[k];
    for (k in o) if (o[k] !== undefined) r[k] = o[k];
    r.x = r.x || 0; r.y = r.y || 0; r.w = r.w || 0; r.h = r.h || 0;
    if (!r.seed) r.seed = 1;
    return r;
  }

  // Draw one effect at t seconds after it started. o: { effect, x, y, w, h (0 for a point), ...options }.
  // H (optional) caches the setup between frames. Returns false once a one-shot effect has finished.
  function draw(ctx, t, o, H) {
    var E = FX[o.effect || 'emanata'];
    if (!E) return false;
    o = merge(E, o);
    o.cx = o.x + o.w / 2; o.cy = o.y + o.h / 2;
    var D = o.duration / 1000, tt = t * o.speed, a = o.fade == null ? 1 : o.fade;
    if (tt < 0) return true;
    if (!o.loop && tt >= D) return false;
    if (o.still) { if (!o.loop) a *= 1 - inOutQuad(clamp(tt / D)); tt = E.peak * D; }
    else if (o.loop && !E.native) tt = tt % D;
    H = H || {};
    if (!H.st) H.st = E.setup(o, rng(o.seed));
    o.ink = o.color === 'auto' ? '#222' : o.color;
    o.paper = o.fill === 'auto' ? '#fff' : o.fill;
    o.a = a;
    ctx.save();
    ctx.globalAlpha = a; ctx.fillStyle = ctx.strokeStyle = o.ink; ctx.lineCap = ctx.lineJoin = 'round';
    E.draw(ctx, tt, D, o, H.st);
    ctx.restore();
    return true;
  }

  // ---------- live page: one shared overlay canvas ----------

  var doc = root.document, canvas, ctx, live = [], raf = 0;
  var reduce = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  function overlay() {
    if (canvas) return;
    canvas = doc.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483000';
    doc.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
  }

  function frame(now) {
    raf = 0;
    var dpr = Math.min(root.devicePixelRatio || 1, 2), w = root.innerWidth, h = root.innerHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    live = live.filter(function (b) {
      if (b.el && b.el.isConnected) { // follow the element if the page scrolls mid-effect
        var rc = b.el.getBoundingClientRect(), dx = rc.left - b.left, dy = rc.top - b.top;
        if (dx || dy) { b.o.x += dx; b.o.y += dy; b.left = rc.left; b.top = rc.top; b.st = null; }
      }
      if (b.stopAt) { b.o.fade = 1 - (now - b.stopAt) / 220; if (b.o.fade <= 0) return false; }
      return draw(ctx, (now - b.t0) / 1000, b.o, b);
    });
    if (live.length) raf = root.requestAnimationFrame(frame);
  }

  function play(name, target, opts) {
    var E = FX[name];
    if (!E || !doc || !doc.body) return null;
    var o = {}, el = null, k;
    for (k in opts) o[k] = opts[k];
    o.effect = name;
    if (target && target.getBoundingClientRect) {
      el = target;
      var ds = el.dataset || {};
      if (ds.afx === 'off') return null;
      for (k in ds) if (k.length > 3 && k.indexOf('afx') === 0) {
        var v = ds[k];
        o[k.charAt(3).toLowerCase() + k.slice(4)] = v === 'true' ? true : v === 'false' ? false : v !== '' && !isNaN(v) ? +v : v;
      }
    }
    o = merge(E, o);
    if (!opts || !opts.seed) o.seed = (Math.random() * 4294967295) >>> 0 || 1;
    if (o.squash === false) o.move = false; // v1 option name
    o.still = o.reducedMotion === 'respect' && reduce.matches;
    if (o.color === 'auto') o.color = inkFor(el);
    if (o.fill === 'auto') o.fill = paperFor(el);

    var b = { o: o, el: null, t0: root.performance.now() };
    if (el && o.shape !== 'point') {
      var rc = el.getBoundingClientRect();
      o.x = rc.left; o.y = rc.top; o.w = rc.width; o.h = rc.height;
      b.el = el; b.left = rc.left; b.top = rc.top;
    } else {
      var p = el ? center(el) : target;
      o.x = p.x; o.y = p.y; o.w = 0; o.h = 0;
    }
    if (el && o.move && !o.still && E.move) react(el, E.move(o));
    overlay();
    live.push(b);
    if (!raf) raf = root.requestAnimationFrame(frame);
    return { stop: function () { if (!b.stopAt) b.stopAt = root.performance.now(); } };
  }

  function center(el) { var r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

  // The marks sit on the page around the element, so ink is the surrounding text color and paper is the
  // nearest painted background, not the element's own.
  function inkFor(el) { return getComputedStyle((el && el.parentElement) || doc.body).color; }
  function paperFor(el) {
    for (var n = el ? el.parentElement : doc.body; n && n.nodeType === 1; n = n.parentElement) {
      var c = getComputedStyle(n).backgroundColor;
      if (c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c)) return c;
    }
    return '#fff';
  }

  // Element reactions use the standalone scale/translate/rotate properties so they stack on any transform.
  function react(el, m) {
    if (!el.animate || !m) return;
    if (el._afx) el._afx.cancel();
    var kf = {}, key;
    for (key in m[0]) if (key !== 'easing') kf[key] = m[0][key];
    el._afx = el.animate(kf, { duration: m[1], easing: m[0].easing || 'ease-out' });
    el._afx.onfinish = function () { el._afx = null; };
  }

  // Delegate on the document so elements added later are covered. Pointer users get it on press (snappier);
  // keyboard activations arrive as click events with detail 0.
  function bind(selector, opts) {
    selector = selector || 'button, [role="button"], input[type="submit"], input[type="button"]';
    opts = opts || {};
    function hit(e) {
      var el = e.target && e.target.closest && e.target.closest(selector);
      if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return null;
      return el;
    }
    function fire(el, e) {
      var name = el.dataset && FX[el.dataset.afx] ? el.dataset.afx : opts.effect || 'emanata';
      var shape = (el.dataset && el.dataset.afxShape) || opts.shape;
      play(name, shape === 'point' && e && e.clientX != null ? { x: e.clientX, y: e.clientY } : el, opts);
    }
    function down(e) { if (e.button === 0) { var el = hit(e); if (el) fire(el, e); } }
    function key(e) { if (e.detail === 0) { var el = hit(e); if (el) fire(el); } }
    doc.addEventListener('pointerdown', down, true);
    doc.addEventListener('click', key, true);
    return { unbind: function () { doc.removeEventListener('pointerdown', down, true); doc.removeEventListener('click', key, true); } };
  }

  var api = { play: play, bind: bind, draw: draw, effects: {}, defaults: BASE, version: '2' };
  Object.keys(FX).forEach(function (n) {
    api.effects[n] = { name: FX[n].name, use: FX[n].use, defaults: FX[n].defaults };
    api[n] = function (target, opts) { return play(n, target, opts); };
  });
  api.click = api.emanata;
  root.ActionFX = api;

  // <script data-bind="..."> auto-binds. data-effect, data-shape, data-color etc. become options.
  var me = doc && doc.currentScript;
  if (me && me.hasAttribute('data-bind')) {
    var o = {}, d = me.dataset;
    for (var k in d) if (k !== 'bind') o[k] = d[k] === 'false' ? false : d[k] !== '' && !isNaN(d[k]) ? +d[k] : d[k];
    bind(d.bind || undefined, o);
  }
})(typeof window !== 'undefined' ? window : this);
