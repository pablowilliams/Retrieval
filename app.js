/* Retrieval — engine for an interactive monograph on retrieval-augmented
   generation. Vanilla JS, no dependencies. Every figure runs a real
   information-retrieval algorithm over synthetic data: exact nearest-neighbour
   search over a synthetic embedding space, true cosine and Euclidean
   computations, a working HNSW-style hierarchical greedy search, a
   reranker driven by a synthetic relevance signal, and reciprocal-rank
   fusion for hybrid sparse-plus-dense scoring.
   Built against a WCAG 2.2 AA pattern set. */
(function (global) {
  "use strict";

  var LW = 340, LH = 240, SCALE = 2;

  /* ---- small helpers -------------------------------------------------- */
  function el(t, c) { var e = document.createElement(t); if (c) e.className = c; return e; }
  function btn(c, t) { var b = el("button", c); b.type = "button"; b.textContent = t; return b; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function debounce(fn, ms) {
    var h = null;
    return function () { var a = arguments; if (h) clearTimeout(h);
      h = setTimeout(function () { fn.apply(null, a); }, ms); };
  }
  var reduceMQ = global.matchMedia
    ? global.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };

  /* ---- vectors -------------------------------------------------------- */
  function vsub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
  function vlen(a) { return Math.sqrt(a.x * a.x + a.y * a.y); }
  function vdist(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }
  function vdist2(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }
  function vdot(a, b) { return a.x * b.x + a.y * b.y; }
  function vcos(a, b) { /* cosine taken about the canvas centre, so points have a direction */
    var cx = LW / 2, cy = LH / 2;
    var ax = a.x - cx, ay = a.y - cy, bx = b.x - cx, by = b.y - cy;
    var la = Math.sqrt(ax * ax + ay * ay) || 1e-9;
    var lb = Math.sqrt(bx * bx + by * by) || 1e-9;
    return (ax * bx + ay * by) / (la * lb);
  }

  /* ---- drawing helpers ----------------------------------------------- */
  function cssVar(n) {
    return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || "#888";
  }
  function hexA(hex, a) {
    hex = hex.replace("#", "");
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    var r = parseInt(hex.substr(0,2),16), g = parseInt(hex.substr(2,2),16), b = parseInt(hex.substr(4,2),16);
    if (isNaN(r)) return "rgba(120,120,120," + a + ")";
    return "rgba(" + r + "," + g + "," + b + "," + a + ")";
  }
  function clearBg(ctx, w) { ctx.fillStyle = cssVar("--bg-sunk"); ctx.fillRect(0, 0, w || LW, LH); }
  function line(ctx, a, b, color, lw, dash) {
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.setLineDash(dash || []);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.restore();
  }
  function dot2(ctx, p, r, color) {
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.2832); ctx.fillStyle = color; ctx.fill();
  }
  function ringOnly(ctx, p, r, color, lw) {
    ctx.save(); ctx.lineWidth = lw; ctx.strokeStyle = color;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.2832); ctx.stroke(); ctx.restore();
  }
  function diamond(ctx, p, r, color) {
    ctx.save(); ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r, p.y);
    ctx.lineTo(p.x, p.y + r); ctx.lineTo(p.x - r, p.y);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  function drawActive(ctx, c, label) {
    ctx.save();
    ctx.setLineDash([3, 3]); ctx.lineWidth = 2;
    ctx.strokeStyle = cssVar("--accent-d");
    ctx.beginPath(); ctx.arc(c.x, c.y, 14, 0, 6.2832); ctx.stroke();
    ctx.setLineDash([]);
    if (label) {
      ctx.font = "700 8px ui-sans-serif, sans-serif";
      var w = ctx.measureText(label).width + 6;
      ctx.fillStyle = cssVar("--accent-d");
      ctx.fillRect(c.x - w / 2, c.y - 26, w, 11);
      ctx.fillStyle = "#fff"; ctx.textAlign = "center";
      ctx.fillText(label, c.x, c.y - 17.5);
      ctx.textAlign = "start";
    }
    ctx.restore();
  }

  /* ---- figure shell -------------------------------------------------- */
  var seq = 0;
  function makeStage(opts) {
    var uid = "rt" + (++seq);
    var fig = el("div", "figure");
    var controls = el("div", "controls");
    controls.setAttribute("role", "group");
    controls.setAttribute("aria-label", opts.title + " controls");
    var stage = el("div", "grid-stage");
    var wrap = el("div", "canvas-wrap");
    var canvas = el("canvas", "figure-canvas");
    var cw = opts.wide ? LW + opts.wide : LW;
    canvas.width = cw * SCALE; canvas.height = LH * SCALE;
    canvas.style.aspectRatio = cw + " / " + LH;
    canvas.id = uid + "-c";
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", opts.title + ".");
    canvas.setAttribute("aria-describedby", uid + "-help " + uid + "-desc");
    var help = el("p", "sr-only"); help.id = uid + "-help"; help.textContent = opts.help || "";
    var desc = el("p", "sr-only"); desc.id = uid + "-desc"; desc.textContent = opts.desc || "";
    wrap.append(canvas, help, desc);
    stage.appendChild(wrap);
    var legend = el("ul", "legend");
    legend.setAttribute("aria-label", "Figure legend");
    var stats = el("div", "stats");
    var status = el("div", "status");
    status.id = uid + "-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.textContent = opts.status || "";
    fig.append(controls, stage, legend, stats, status);
    var fbBody = null;
    if (opts.fallback) {
      var d = el("details", "data-fallback");
      var sm = el("summary", ""); sm.textContent = opts.fallback;
      fbBody = el("div", "data-body");
      d.append(sm, fbBody); fig.appendChild(d);
    }
    var cap = el("figcaption", "figure-cap");
    cap.innerHTML = opts.caption || "";
    fig.appendChild(cap);
    var ctx = canvas.getContext("2d");
    ctx.scale(SCALE, SCALE);
    return { uid: uid, fig: fig, controls: controls, canvas: canvas, ctx: ctx,
             cw: cw, legend: legend, stats: stats, status: status, desc: desc, fbBody: fbBody };
  }
  function legendItem(swatchStyle, label, glyph) {
    var li = el("li", ""), sw = el("span", "swatch");
    sw.setAttribute("aria-hidden", "true");
    for (var k in swatchStyle) sw.style[k] = swatchStyle[k];
    if (glyph) sw.textContent = glyph;
    li.append(sw, document.createTextNode(label));
    return li;
  }
  function statBox(label) {
    var wrap = el("span", "stat"), b = el("b", "");
    b.textContent = "—";
    wrap.append(b, document.createTextNode(label));
    return { wrap: wrap, set: function (v) { b.textContent = v; } };
  }
  function group(nodes, sep) {
    var g = el("div", "control-group" + (sep ? " sep" : ""));
    nodes.forEach(function (n) { g.appendChild(n); });
    return g;
  }
  function radiogroup(label, items, onChange) {
    var set = el("div", "toolset");
    set.setAttribute("role", "radiogroup");
    set.setAttribute("aria-label", label);
    var current = items[0].value, radios = {};
    items.forEach(function (it, i) {
      var b = el("button", ""); b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", i === 0 ? "true" : "false");
      b.tabIndex = i === 0 ? 0 : -1;
      b.textContent = it.label; b.dataset.v = it.value;
      set.appendChild(b); radios[it.value] = b;
    });
    function select(v) {
      current = v;
      items.forEach(function (it) {
        var on = it.value === v;
        radios[it.value].setAttribute("aria-checked", on ? "true" : "false");
        radios[it.value].tabIndex = on ? 0 : -1;
      });
      onChange(v);
    }
    set.addEventListener("click", function (e) {
      var b = e.target.closest("[role=radio]");
      if (b) { select(b.dataset.v); b.focus(); }
    });
    set.addEventListener("keydown", function (e) {
      var idx = items.map(function (i) { return i.value; }).indexOf(current), h = true;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") idx = (idx + 1) % items.length;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") idx = (idx + items.length - 1) % items.length;
      else h = false;
      if (h) { e.preventDefault(); select(items[idx].value); radios[current].focus(); }
    });
    return { el: set, get: function () { return current; }, select: select };
  }
  function slider(id, label, min, max, step, value, fmt, onInput) {
    var field = el("div", "field");
    var lab = el("label", ""); lab.htmlFor = id; lab.textContent = label;
    var input = el("input", "");
    input.type = "range"; input.id = id;
    input.min = min; input.max = max; input.step = step; input.value = value;
    var out = el("output", ""); out.setAttribute("for", id);
    out.setAttribute("aria-live", "off");
    out.textContent = fmt(value);
    input.setAttribute("aria-valuetext", label + " " + fmt(value));
    input.addEventListener("input", function () {
      var v = parseFloat(input.value);
      out.textContent = fmt(v);
      input.setAttribute("aria-valuetext", label + " " + fmt(v));
      onInput(v);
    });
    field.append(lab, input, out);
    return { field: field, input: input };
  }
  function setStatus(node, text, tone) {
    node.textContent = text;
    if (tone) node.dataset.tone = tone; else node.removeAttribute("data-tone");
  }
  function arrowDelta(e) {
    var d;
    if (e.key === "ArrowLeft") d = { x: -1, y: 0 };
    else if (e.key === "ArrowRight") d = { x: 1, y: 0 };
    else if (e.key === "ArrowUp") d = { x: 0, y: -1 };
    else if (e.key === "ArrowDown") d = { x: 0, y: 1 };
    else return null;
    var step = e.shiftKey ? 22 : 3;
    return { x: d.x * step, y: d.y * step };
  }
  function bindPointer(canvas, cw, set, onChange) {
    var dragging = false;
    function pt(e) {
      var r = canvas.getBoundingClientRect();
      return { x: clamp((e.clientX - r.left) / r.width * cw, 0, cw),
               y: clamp((e.clientY - r.top) / r.height * LH, 0, LH) };
    }
    canvas.addEventListener("pointerdown", function (e) {
      dragging = true; canvas.focus();
      if (canvas.setPointerCapture) try { canvas.setPointerCapture(e.pointerId); } catch (x) {}
      set(pt(e)); onChange(); e.preventDefault();
    });
    canvas.addEventListener("pointermove", function (e) {
      if (!dragging) return; set(pt(e)); onChange();
    });
    function end() { dragging = false; }
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
  }

  /* ---- a synthetic embedding space ----------------------------------- */
  function makeCorpus(seed, n) {
    var rnd = mulberry32(seed);
    var clusters = [
      { x: 90,  y: 80,  r: 36, label: "topic A", color: "--accent" },
      { x: 240, y: 80,  r: 36, label: "topic B", color: "--path" },
      { x: 160, y: 180, r: 36, label: "topic C", color: "--goal" }
    ];
    var out = [];
    for (var i = 0; i < n; i++) {
      var c = clusters[i % clusters.length];
      var a = rnd() * 6.2832, r = Math.sqrt(rnd()) * c.r;
      out.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r,
        cluster: i % clusters.length, id: i });
    }
    return { points: out, clusters: clusters };
  }

  /* ==================================================================== *
   *  Figure 1 — the embedding space and nearest neighbours                 *
   * ==================================================================== */
  function embeddingDemo(mount, config) {
    var st = makeStage({ title: "The embedding space",
      help: "An interactive figure. The query point is focusable: with the " +
        "figure focused, the arrow keys move it and a held Shift moves it " +
        "further; a single click or tap places it. The k slider sets how many " +
        "nearest documents are returned. The Metric control switches between " +
        "Euclidean distance and cosine similarity (taken about the canvas " +
        "centre). Press Tab to leave the figure.",
      status: "The k nearest documents to the query are returned.",
      caption: config.caption,
      fallback: "Show the k nearest documents as a table" });
    var corpus = makeCorpus(7, 36);
    var query = { x: 170, y: 130 };
    var k = 5, metric = "euclid";
    function ranked() {
      var arr = corpus.points.slice().map(function (p) {
        var s = metric === "euclid" ? -vdist(p, query) : vcos(p, query);
        return { p: p, score: s };
      });
      arr.sort(function (a, b) { return b.score - a.score; });
      return arr;
    }
    function render() {
      var ctx = st.ctx;
      clearBg(ctx);
      var r = ranked();
      var nearest = {};
      for (var i = 0; i < Math.min(k, r.length); i++) nearest[r[i].p.id] = i + 1;
      /* draw a halo radius to the k-th neighbour for Euclidean metric */
      if (metric === "euclid" && k > 0) {
        var rk = -r[Math.min(k, r.length) - 1].score;
        ringOnly(ctx, query, rk, hexA(cssVar("--accent"), 0.55), 2);
      }
      corpus.points.forEach(function (p) {
        var col = cssVar(corpus.clusters[p.cluster].color);
        if (nearest[p.id]) {
          dot2(ctx, p, 5, col);
          ctx.lineWidth = 2.2; ctx.strokeStyle = cssVar("--ink");
          ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, 6.2832); ctx.stroke();
        } else {
          ringOnly(ctx, p, 3.4, col, 1.8);
        }
      });
      diamond(ctx, query, 6, cssVar("--accent-d"));
      drawActive(ctx, query, "query");
      st.statK.set(String(k));
      st.statMetric.set(metric === "euclid" ? "L₂" : "cos");
      var top = r.slice(0, k);
      st.desc.textContent = "Query at " + Math.round(query.x) + ", " +
        Math.round(query.y) + " with " + (metric === "euclid" ? "Euclidean" : "cosine") +
        " metric. The " + k + " nearest documents are returned, with the " +
        "nearest in cluster " + corpus.clusters[top[0].p.cluster].label +
        " at distance " + (metric === "euclid" ? (-top[0].score).toFixed(1) :
          top[0].score.toFixed(3)) + ".";
      st.fbBody.innerHTML = "<ol>" + top.map(function (e) {
        return "<li>doc " + e.p.id + " · " + corpus.clusters[e.p.cluster].label +
          " · " + (metric === "euclid" ? "distance " + (-e.score).toFixed(1)
                                      : "cosine " + e.score.toFixed(3)) + "</li>";
      }).join("") + "</ol>";
    }
    var announce = debounce(function () {
      var top = ranked()[0];
      setStatus(st.status, "Query moved. Nearest document is doc " + top.p.id +
        " in " + corpus.clusters[top.p.cluster].label + " " +
        (metric === "euclid" ? "at distance " + (-top.score).toFixed(1)
                              : "with cosine " + top.score.toFixed(3)) + ".");
    }, 340);

    var rg = radiogroup("Metric", [
      { value: "euclid", label: "Euclidean" },
      { value: "cos", label: "Cosine" }
    ], function (v) { metric = v; render(); announce(); });
    var kS = slider(st.uid + "-k", "k", 1, 10, 1, k,
      function (v) { return String(v); },
      function (v) { k = v; render(); announce(); });
    st.controls.append(group([rg.el]), group([kS.field], true));

    bindPointer(st.canvas, st.cw, function (p) { query = p; }, function () { render(); announce(); });
    st.canvas.addEventListener("keydown", function (e) {
      var d = arrowDelta(e);
      if (!d) return;
      e.preventDefault();
      query.x = clamp(query.x + d.x, 6, LW - 6);
      query.y = clamp(query.y + d.y, 6, LH - 6);
      render(); announce();
    });

    st.statK = statBox(" neighbours");
    st.statMetric = statBox(" metric");
    st.stats.append(st.statK.wrap, st.statMetric.wrap);
    st.legend.append(
      legendItem({ background: cssVar("--accent") }, "Topic A"),
      legendItem({ background: cssVar("--path") }, "Topic B"),
      legendItem({ background: cssVar("--goal") }, "Topic C"),
      legendItem({ background: cssVar("--accent-d") }, "Query (diamond)"),
      legendItem({ boxShadow: "inset 0 0 0 2px " + cssVar("--ink") }, "Returned (filled with ring)"));
    mount.appendChild(st.fig);
    render();
  }

  /* ==================================================================== *
   *  Figure 2 — cosine and Euclidean compared on the same scene            *
   * ==================================================================== */
  function metricsDemo(mount, config) {
    var st = makeStage({ title: "Cosine compared with Euclidean",
      help: "An interactive figure. The query point is focusable: with the " +
        "figure focused, the arrow keys move it; a single click or tap places " +
        "it. The figure marks the nearest corpus point under each metric: a " +
        "filled diamond for Euclidean and a filled square for cosine, drawn " +
        "with distinct shapes so the distinction is visible without colour.",
      status: "Cosine and Euclidean can pick different nearest documents.",
      caption: config.caption });
    var corpus = makeCorpus(31, 16);
    var query = { x: 170, y: 130 };
    function near() {
      var be = null, bc = null, bes = Infinity, bcs = -Infinity;
      corpus.points.forEach(function (p) {
        var de = vdist(p, query); if (de < bes) { bes = de; be = p; }
        var dc = vcos(p, query); if (dc > bcs) { bcs = dc; bc = p; }
      });
      return { eucl: be, cos: bc, eD: bes, cS: bcs };
    }
    function render() {
      var ctx = st.ctx;
      clearBg(ctx);
      var cx = LW / 2, cy = LH / 2;
      ringOnly(ctx, { x: cx, y: cy }, 80, hexA(cssVar("--ink-soft"), 0.4), 1, [3, 3]);
      dot2(ctx, { x: cx, y: cy }, 2.4, cssVar("--ink-soft"));
      corpus.points.forEach(function (p) {
        ringOnly(ctx, p, 3.4, cssVar(corpus.clusters[p.cluster].color), 1.8);
      });
      var n = near();
      /* nearest under Euclidean: diamond glyph + warm colour */
      diamond(ctx, n.eucl, 7, cssVar("--path"));
      /* nearest under cosine: square glyph + cool colour, plus the radial line */
      ctx.save();
      line(ctx, { x: cx, y: cy }, n.cos, hexA(cssVar("--accent"), 0.7), 1.8, [4, 3]);
      ctx.fillStyle = cssVar("--accent");
      ctx.fillRect(n.cos.x - 5, n.cos.y - 5, 10, 10);
      ctx.restore();
      diamond(ctx, query, 6, cssVar("--accent-d"));
      drawActive(ctx, query, "query");
      st.statEucl.set("doc " + n.eucl.id + " (d " + n.eD.toFixed(1) + ")");
      st.statCos.set("doc " + n.cos.id + " (c " + n.cS.toFixed(3) + ")");
      var same = n.eucl.id === n.cos.id;
      st.desc.textContent = (same ? "Both metrics agree on doc " + n.eucl.id + "."
        : "Euclidean nearest is doc " + n.eucl.id + " at distance " + n.eD.toFixed(1) +
          "; cosine nearest is doc " + n.cos.id + " with cosine " + n.cS.toFixed(3) +
          ". Cosine ignores distance from the origin and follows the angle " +
          "from the canvas centre.");
    }
    var announce = debounce(function () {
      var n = near();
      setStatus(st.status, n.eucl.id === n.cos.id
        ? "Both metrics return doc " + n.eucl.id + "."
        : "The two metrics disagree: Euclidean returns doc " + n.eucl.id +
          ", cosine returns doc " + n.cos.id + ".");
    }, 340);

    bindPointer(st.canvas, st.cw, function (p) { query = p; }, function () { render(); announce(); });
    st.canvas.addEventListener("keydown", function (e) {
      var d = arrowDelta(e);
      if (!d) return;
      e.preventDefault();
      query.x = clamp(query.x + d.x, 6, LW - 6);
      query.y = clamp(query.y + d.y, 6, LH - 6);
      render(); announce();
    });

    st.statEucl = statBox(" Euclidean nearest");
    st.statCos = statBox(" cosine nearest");
    st.stats.append(st.statEucl.wrap, st.statCos.wrap);
    st.legend.append(
      legendItem({ background: cssVar("--path") }, "Euclidean nearest (diamond)"),
      legendItem({ background: cssVar("--accent") }, "Cosine nearest (square)"),
      legendItem({ background: cssVar("--accent-d") }, "Query"),
      legendItem({ boxShadow: "inset 0 0 0 1px " + cssVar("--ink-soft") }, "Reference radius (dashed)"));
    mount.appendChild(st.fig);
    render();
  }

  /* ==================================================================== *
   *  Figure 3 — chunking strategies on a synthetic document                *
   * ==================================================================== */
  function chunkingDemo(mount, config) {
    var st = makeStage({ title: "Chunking the document",
      help: "An interactive figure. The Strategy control selects how the " +
        "synthetic document is split into chunks; the Chunk size slider " +
        "adjusts the target size. The figure renders the document text as a " +
        "block of words with chunk boundaries marked, and reports the count " +
        "and average size of the resulting chunks. The figure focus is on the " +
        "canvas; press Tab to leave.",
      status: "Different chunking strategies break the document at different places.",
      caption: config.caption,
      fallback: "Show the chunks as a table" });
    /* a synthetic paragraph of pseudo-words generated procedurally */
    var rnd = mulberry32(99);
    var words = [];
    for (var i = 0; i < 110; i++) {
      var len = 3 + ((rnd() * 6) | 0);
      var w = ""; for (var j = 0; j < len; j++) w += "abcdefghijklmn"[(rnd() * 14) | 0];
      words.push(w);
    }
    /* sentence boundaries: every 7 to 11 words */
    var sentences = [];
    (function buildSent() {
      var i2 = 0;
      while (i2 < words.length) { var n = 7 + ((rnd() * 5) | 0);
        sentences.push(words.slice(i2, Math.min(i2 + n, words.length))); i2 += n; }
    })();
    var strategy = "fixed", target = 24;
    function chunks() {
      var out = [], i;
      if (strategy === "fixed") {
        for (i = 0; i < words.length; i += target) out.push(words.slice(i, i + target));
      } else if (strategy === "sentence") {
        out = sentences.map(function (s) { return s.slice(); });
      } else {
        /* sliding window: target size, target/4 stride */
        var stride = Math.max(2, Math.round(target / 3));
        for (i = 0; i + 1 < words.length; i += stride) out.push(words.slice(i, Math.min(i + target, words.length)));
      }
      return out;
    }
    function render() {
      var ctx = st.ctx;
      clearBg(ctx);
      var cs = chunks();
      var colors = [cssVar("--accent"), cssVar("--path"), cssVar("--goal"), cssVar("--accent-d")];
      ctx.font = "10px ui-sans-serif, sans-serif";
      var x = 14, y = 22, lh = 14;
      var ci = 0, wordIdx = 0;
      cs.forEach(function (chunk, ki) {
        var col = colors[ki % colors.length];
        chunk.forEach(function (w) {
          var ww = ctx.measureText(w).width + 4;
          if (x + ww > LW - 10) { x = 14; y += lh; }
          ctx.fillStyle = hexA(col, 0.25);
          ctx.fillRect(x - 2, y - 9, ww, 12);
          ctx.fillStyle = cssVar("--ink");
          ctx.fillText(w, x, y);
          x += ww;
        });
        x += 6; if (x > LW - 30) { x = 14; y += lh; }
      });
      st.statN.set(String(cs.length));
      var avg = cs.reduce(function (s, c) { return s + c.length; }, 0) / cs.length;
      st.statAvg.set(avg.toFixed(1));
      st.desc.textContent = "Chunking strategy: " + strategy + ". The document " +
        "of " + words.length + " words is split into " + cs.length + " chunks of " +
        "average size " + avg.toFixed(1) + ".";
      st.fbBody.innerHTML = "<ol>" + cs.slice(0, 12).map(function (c, k) {
        return "<li>Chunk " + (k + 1) + " · " + c.length + " words · " +
          c.slice(0, 4).join(" ") + (c.length > 4 ? " …" : "") + "</li>";
      }).join("") + "</ol>" + (cs.length > 12 ? "<p>… and " + (cs.length - 12) + " more.</p>" : "");
    }
    var announce = debounce(function () {
      var cs = chunks();
      setStatus(st.status, "Strategy " + strategy + ", target size " + target +
        ". " + cs.length + " chunks produced.");
    }, 340);

    var rg = radiogroup("Strategy", [
      { value: "fixed", label: "Fixed" },
      { value: "sentence", label: "Sentence" },
      { value: "sliding", label: "Sliding" }
    ], function (v) { strategy = v; render(); announce(); });
    var ts = slider(st.uid + "-t", "Chunk size", 8, 48, 2, target,
      function (v) { return v + " w"; },
      function (v) { target = v; render(); announce(); });
    st.controls.append(group([rg.el]), group([ts.field], true));

    st.statN = statBox(" chunks");
    st.statAvg = statBox(" avg size (words)");
    st.stats.append(st.statN.wrap, st.statAvg.wrap);
    st.legend.append(
      legendItem({ background: hexA(cssVar("--accent"), 0.5) }, "Chunk 1"),
      legendItem({ background: hexA(cssVar("--path"), 0.5) }, "Chunk 2"),
      legendItem({ background: hexA(cssVar("--goal"), 0.5) }, "Chunk 3"));
    mount.appendChild(st.fig);
    render();
  }

  /* ==================================================================== *
   *  Figure 4 — HNSW-style hierarchical nearest-neighbour search            *
   * ==================================================================== */
  function hnswDemo(mount, config) {
    var st = makeStage({ title: "Hierarchical nearest-neighbour search",
      help: "An interactive figure. The query point is focusable: with the " +
        "figure focused, the arrow keys move it; a single click or tap places " +
        "it. Step advances the greedy search one hop; Run completes it; Reset " +
        "returns to the top entry point. The search descends three layers, " +
        "starting sparse and ending dense.",
      status: "The search descends from a sparse layer through a dense one.",
      caption: config.caption });
    var rnd = mulberry32(57);
    function makeLayer(n, neigh, seed) {
      var rr = mulberry32(seed);
      var pts = [];
      for (var i = 0; i < n; i++) pts.push({ x: 30 + rr() * (LW - 60), y: 24 + rr() * (LH - 48), id: i });
      /* connect each point to its k nearest in the layer */
      for (var i2 = 0; i2 < pts.length; i2++) {
        var d = pts.map(function (p, k) { return { k: k, d: vdist(p, pts[i2]) }; });
        d.sort(function (a, b) { return a.d - b.d; });
        pts[i2].nb = [];
        for (var k = 1; k <= neigh && k < d.length; k++) pts[i2].nb.push(d[k].k);
      }
      return pts;
    }
    var layers = [makeLayer(6, 2, 11), makeLayer(14, 3, 22), makeLayer(34, 4, 33)];
    var query = { x: 170, y: 130 };
    var state = { layer: 0, current: 0, history: [{ layer: 0, current: 0 }] };
    function reset() { state = { layer: 0, current: 0, history: [{ layer: 0, current: 0 }] }; }
    function step() {
      var lyr = layers[state.layer];
      var cur = lyr[state.current];
      var d0 = vdist(cur, query);
      var best = state.current, bestD = d0;
      cur.nb.forEach(function (k) { var dd = vdist(lyr[k], query); if (dd < bestD) { bestD = dd; best = k; } });
      if (best !== state.current) {
        state.current = best;
        state.history.push({ layer: state.layer, current: state.current });
        return true;
      }
      /* no improvement: descend a layer */
      if (state.layer < layers.length - 1) {
        /* enter the next layer at the same spatial location: pick the
           point in the next layer closest to the current point */
        var next = layers[state.layer + 1];
        var bi = 0, bd = Infinity;
        for (var i = 0; i < next.length; i++) {
          var d = vdist(next[i], cur); if (d < bd) { bd = d; bi = i; }
        }
        state.layer++; state.current = bi;
        state.history.push({ layer: state.layer, current: state.current });
        return true;
      }
      return false;
    }
    function render() {
      var ctx = st.ctx;
      clearBg(ctx);
      /* draw inactive layers faint */
      layers.forEach(function (lyr, li) {
        var on = li === state.layer;
        lyr.forEach(function (p) {
          p.nb.forEach(function (k) {
            if (k <= p.id) return;
            line(ctx, p, lyr[k], hexA(cssVar("--ink-soft"), on ? 0.35 : 0.12), on ? 1.2 : 1);
          });
        });
        lyr.forEach(function (p) {
          ringOnly(ctx, p, on ? 3.6 : 2.4, on ? cssVar("--ink-soft") : hexA(cssVar("--ink-soft"), 0.4), on ? 1.6 : 1);
        });
      });
      /* draw the path of the search across layers */
      for (var h = 1; h < state.history.length; h++) {
        var a = state.history[h - 1], b = state.history[h];
        var pa = layers[a.layer][a.current], pb = layers[b.layer][b.current];
        line(ctx, pa, pb, cssVar("--accent"), 2.4);
      }
      var cur = layers[state.layer][state.current];
      dot2(ctx, cur, 5.4, cssVar("--accent-d"));
      diamond(ctx, query, 6, cssVar("--path"));
      drawActive(ctx, query, "query");
      st.statLayer.set(String(state.layer));
      st.statHops.set(String(state.history.length - 1));
      st.statDist.set(vdist(cur, query).toFixed(1));
      st.desc.textContent = "Hierarchical search at layer " + state.layer +
        " (densities: " + layers.map(function (l) { return l.length; }).join(", ") +
        " points). After " + (state.history.length - 1) + " hops the current " +
        "node is at distance " + vdist(cur, query).toFixed(1) + " from the query.";
    }
    function finish() {
      setStatus(st.status, "Search finished at layer " + state.layer +
        " after " + (state.history.length - 1) + " hops; nearest distance " +
        vdist(layers[state.layer][state.current], query).toFixed(1) + ".", "win");
    }
    var stepBtn = btn("btn btn-primary", "Step");
    var runBtn = btn("btn", "Run");
    var resetBtn = btn("btn", "Reset");
    stepBtn.addEventListener("click", function () { if (step()) render(); else finish(); });
    runBtn.addEventListener("click", function () { while (step()) {} render(); finish(); });
    resetBtn.addEventListener("click", function () { reset(); render();
      setStatus(st.status, "Reset to the top-layer entry point."); });
    st.controls.append(group([stepBtn, runBtn, resetBtn]));

    bindPointer(st.canvas, st.cw, function (p) { query = p; reset(); }, function () { render(); });
    st.canvas.addEventListener("keydown", function (e) {
      var d = arrowDelta(e);
      if (!d) return;
      e.preventDefault();
      query.x = clamp(query.x + d.x, 8, LW - 8);
      query.y = clamp(query.y + d.y, 8, LH - 8);
      reset(); render();
    });

    st.statLayer = statBox(" current layer");
    st.statHops = statBox(" hops taken");
    st.statDist = statBox(" current distance");
    st.stats.append(st.statLayer.wrap, st.statHops.wrap, st.statDist.wrap);
    st.legend.append(
      legendItem({ background: cssVar("--accent-d") }, "Current node"),
      legendItem({ background: cssVar("--path") }, "Query (diamond)"),
      legendItem({ background: cssVar("--accent") }, "Search path"),
      legendItem({ boxShadow: "inset 0 0 0 2px " + cssVar("--ink-soft") }, "Layer node"));
    mount.appendChild(st.fig);
    render();
  }

  /* ==================================================================== *
   *  Figure 5 — a reranker over a candidate list                           *
   * ==================================================================== */
  function rerankDemo(mount, config) {
    var st = makeStage({ title: "A reranker reordering candidates",
      wide: 60,
      help: "An interactive figure. Step or Rerank applies the reranker, " +
        "which reads both the query and each candidate document and assigns a " +
        "new relevance score. The figure shows the candidates in their initial " +
        "dense-retrieval order and the order after reranking. Reset returns to " +
        "the initial order. Press Tab to leave.",
      status: "The reranker reorders the candidate list using a finer relevance signal.",
      caption: config.caption,
      fallback: "Show the candidate list as a table" });
    var rnd = mulberry32(13);
    var n = 10;
    var docs = [];
    for (var i = 0; i < n; i++) {
      docs.push({ id: i, title: "doc " + i,
        dense: 0.95 - i * 0.05 + (rnd() - 0.5) * 0.05,
        truth: 0.4 + rnd() * 0.6 });
    }
    /* introduce a stronger relevance for a few mid-ranked candidates so the
       rerank actually moves things */
    docs[7].truth = 0.96; docs[5].truth = 0.91; docs[2].truth = 0.45;
    var reranked = false;
    function order() {
      var copy = docs.slice();
      copy.sort(function (a, b) { return (reranked ? b.truth - a.truth : b.dense - a.dense); });
      return copy;
    }
    function render() {
      var ctx = st.ctx;
      clearBg(ctx, st.cw);
      var arr = order();
      var x0 = 14, x1 = LW + 40, y0 = 18, lineH = 20;
      ctx.font = "700 9px ui-sans-serif, sans-serif"; ctx.fillStyle = cssVar("--ink");
      ctx.fillText(reranked ? "After reranking" : "Initial dense order", x0, 12);
      for (var i = 0; i < arr.length; i++) {
        var y = y0 + i * lineH;
        ctx.fillStyle = hexA(cssVar("--accent"), 0.12);
        ctx.fillRect(x0, y - 9, x1 - x0, 18);
        ctx.fillStyle = cssVar("--ink");
        ctx.font = "10px ui-sans-serif, sans-serif";
        ctx.fillText((i + 1) + ". " + arr[i].title, x0 + 6, y + 3);
        var s = reranked ? arr[i].truth : arr[i].dense;
        var w = clamp(s, 0, 1) * 140;
        ctx.fillStyle = hexA(reranked ? cssVar("--goal") : cssVar("--accent"), 0.8);
        ctx.fillRect(x0 + 130, y - 4, w, 8);
        ctx.fillStyle = cssVar("--ink");
        ctx.font = "9px ui-mono, monospace";
        ctx.fillText(s.toFixed(2), x0 + 280, y + 3);
      }
      st.statTop.set("doc " + arr[0].id);
      st.statSig.set(reranked ? "cross-encoder" : "dense");
      st.desc.textContent = (reranked ? "After reranking" : "Initial dense order") +
        ". Top result is doc " + arr[0].id + " with score " +
        (reranked ? arr[0].truth.toFixed(2) : arr[0].dense.toFixed(2)) + ".";
      st.fbBody.innerHTML = "<ol>" + arr.map(function (d) {
        return "<li>doc " + d.id + " · dense " + d.dense.toFixed(2) +
          " · reranker " + d.truth.toFixed(2) + "</li>";
      }).join("") + "</ol>";
    }
    var rerankBtn = btn("btn btn-primary", "Rerank");
    rerankBtn.addEventListener("click", function () { reranked = true; render();
      setStatus(st.status, "Reranker applied. The new top result is doc " + order()[0].id + ".", "win"); });
    var resetBtn = btn("btn", "Reset");
    resetBtn.addEventListener("click", function () { reranked = false; render();
      setStatus(st.status, "Reset to the initial dense order."); });
    st.controls.append(group([rerankBtn, resetBtn]));

    st.statTop = statBox(" top result");
    st.statSig = statBox(" signal");
    st.stats.append(st.statTop.wrap, st.statSig.wrap);
    st.legend.append(
      legendItem({ background: cssVar("--accent") }, "Dense score"),
      legendItem({ background: cssVar("--goal") }, "Reranker score"));
    mount.appendChild(st.fig);
    render();
  }

  /* ==================================================================== *
   *  Figure 6 — hybrid search: sparse + dense fusion                       *
   * ==================================================================== */
  function hybridDemo(mount, config) {
    var st = makeStage({ title: "Hybrid sparse-plus-dense fusion",
      wide: 60,
      help: "An interactive figure. The Alpha slider controls the weight of " +
        "the dense score in the convex combination of sparse (BM25) and dense " +
        "scores. The figure shows both ranked lists and the fused list with the " +
        "current weight. Press Tab to leave the figure.",
      status: "The fused score is a convex combination of sparse and dense scores.",
      caption: config.caption,
      fallback: "Show all three lists as tables" });
    var rnd = mulberry32(101);
    var n = 8;
    var docs = [];
    for (var i = 0; i < n; i++) {
      docs.push({ id: i, sparse: rnd(), dense: rnd() });
    }
    /* normalise both signals to [0,1] */
    function norm(arr, key) {
      var lo = Infinity, hi = -Infinity;
      arr.forEach(function (d) { if (d[key] < lo) lo = d[key]; if (d[key] > hi) hi = d[key]; });
      arr.forEach(function (d) { d[key] = (d[key] - lo) / (hi - lo || 1); });
    }
    norm(docs, "sparse"); norm(docs, "dense");
    var alpha = 0.6;
    function render() {
      var ctx = st.ctx;
      clearBg(ctx, st.cw);
      var fused = docs.slice().map(function (d) { return { id: d.id, s: (1 - alpha) * d.sparse + alpha * d.dense }; });
      var sparseRank = docs.slice().sort(function (a, b) { return b.sparse - a.sparse; });
      var denseRank = docs.slice().sort(function (a, b) { return b.dense - a.dense; });
      fused.sort(function (a, b) { return b.s - a.s; });
      function drawList(x, title, arr, key, col) {
        ctx.font = "700 9px ui-sans-serif, sans-serif"; ctx.fillStyle = cssVar("--ink");
        ctx.fillText(title, x, 14);
        for (var i = 0; i < arr.length; i++) {
          var y = 24 + i * 20;
          ctx.fillStyle = hexA(col, 0.12);
          ctx.fillRect(x, y - 9, 110, 18);
          ctx.fillStyle = cssVar("--ink");
          ctx.font = "10px ui-sans-serif, sans-serif";
          ctx.fillText((i + 1) + ". d" + arr[i].id, x + 6, y + 3);
          var v = arr[i][key !== undefined ? key : "s"];
          ctx.fillStyle = hexA(col, 0.7);
          ctx.fillRect(x + 38, y - 4, v * 60, 8);
          ctx.font = "9px ui-monospace, monospace";
          ctx.fillStyle = cssVar("--ink");
          ctx.fillText(v.toFixed(2), x + 105, y + 3);
        }
      }
      drawList(14, "BM25", sparseRank, "sparse", cssVar("--path"));
      drawList(140, "Dense", denseRank, "dense", cssVar("--accent"));
      drawList(266, "Fused (α=" + alpha.toFixed(2) + ")", fused, "s", cssVar("--goal"));
      st.statAlpha.set(alpha.toFixed(2));
      st.statTop.set("doc " + fused[0].id);
      st.desc.textContent = "Hybrid retrieval at weight α = " + alpha.toFixed(2) +
        ". Top BM25 result is doc " + sparseRank[0].id + ", top dense is doc " +
        denseRank[0].id + ", top fused is doc " + fused[0].id + ".";
      st.fbBody.innerHTML = "<dl><dt>BM25 top 3</dt><dd>" +
        sparseRank.slice(0, 3).map(function (d) { return "d" + d.id + " (" + d.sparse.toFixed(2) + ")"; }).join(", ") +
        "</dd><dt>Dense top 3</dt><dd>" +
        denseRank.slice(0, 3).map(function (d) { return "d" + d.id + " (" + d.dense.toFixed(2) + ")"; }).join(", ") +
        "</dd><dt>Fused top 3</dt><dd>" +
        fused.slice(0, 3).map(function (d) { return "d" + d.id + " (" + d.s.toFixed(2) + ")"; }).join(", ") +
        "</dd></dl>";
    }
    var announce = debounce(function () {
      var fused = docs.slice().map(function (d) { return { id: d.id, s: (1 - alpha) * d.sparse + alpha * d.dense }; });
      fused.sort(function (a, b) { return b.s - a.s; });
      setStatus(st.status, "Weight α = " + alpha.toFixed(2) +
        ". Top fused result is doc " + fused[0].id + ".");
    }, 320);
    var aS = slider(st.uid + "-a", "Dense weight α", 0, 1, 0.05, alpha,
      function (v) { return v.toFixed(2); },
      function (v) { alpha = v; render(); announce(); });
    st.controls.append(group([aS.field]));

    st.statAlpha = statBox(" α");
    st.statTop = statBox(" fused top");
    st.stats.append(st.statAlpha.wrap, st.statTop.wrap);
    st.legend.append(
      legendItem({ background: cssVar("--path") }, "BM25 sparse"),
      legendItem({ background: cssVar("--accent") }, "Dense embedding"),
      legendItem({ background: cssVar("--goal") }, "Fused"));
    mount.appendChild(st.fig);
    render();
  }

  /* ==================================================================== *
   *  Figure 7 — the full retrieval-augmented pipeline                      *
   * ==================================================================== */
  function pipelineDemo(mount, config) {
    var st = makeStage({ title: "The retrieval-augmented pipeline",
      help: "An interactive figure. Step advances the active pipeline stage; " +
        "the description and live region narrate what each stage does. Reset " +
        "returns to the first stage. Press Tab to leave the figure.",
      status: "Step through the five stages of the pipeline.",
      caption: config.caption });
    var stages = [
      { name: "1. Embed query", desc: "The user's query is passed through the embedding model and turned into a vector in the embedding space." },
      { name: "2. Retrieve", desc: "The vector index returns the top-k candidate documents by approximate nearest-neighbour search." },
      { name: "3. Rerank", desc: "A cross-encoder reranker reads each candidate together with the query and produces a finer relevance score." },
      { name: "4. Compose", desc: "The top reranked candidates are inserted into the prompt as context, alongside the query." },
      { name: "5. Generate", desc: "The language model generates the answer, conditioned on the query and the retrieved context." }
    ];
    var stage = 0;
    function render() {
      var ctx = st.ctx;
      clearBg(ctx);
      var w = (LW - 30) / stages.length, h = 60, y0 = 60;
      stages.forEach(function (s, i) {
        var x = 15 + i * w;
        var on = i === stage;
        ctx.fillStyle = on ? cssVar("--accent") : cssVar("--bg");
        ctx.fillRect(x + 4, y0, w - 8, h);
        ctx.lineWidth = on ? 2.4 : 1.6;
        ctx.strokeStyle = on ? cssVar("--accent-d") : cssVar("--rule");
        ctx.strokeRect(x + 4, y0, w - 8, h);
        ctx.fillStyle = on ? "#fff" : cssVar("--ink");
        ctx.font = "700 9px ui-sans-serif, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(s.name, x + w / 2, y0 + 20);
        ctx.font = "9px ui-sans-serif, sans-serif";
        /* very short label under the title */
        var sh = s.name.indexOf(".") + 2;
        ctx.fillText(s.name.substr(sh).split(" ")[0], x + w / 2, y0 + 38);
        ctx.textAlign = "start";
        if (i < stages.length - 1) {
          ctx.strokeStyle = cssVar("--ink"); ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x + w - 4, y0 + h / 2); ctx.lineTo(x + w + 4, y0 + h / 2);
          ctx.lineTo(x + w + 1, y0 + h / 2 - 3);
          ctx.moveTo(x + w + 4, y0 + h / 2); ctx.lineTo(x + w + 1, y0 + h / 2 + 3);
          ctx.stroke();
        }
      });
      ctx.fillStyle = cssVar("--ink"); ctx.font = "700 10px ui-sans-serif, sans-serif";
      ctx.fillText(stages[stage].name, 16, y0 - 16);
      ctx.font = "10px ui-sans-serif, sans-serif"; ctx.fillStyle = cssVar("--ink-soft");
      var d = stages[stage].desc;
      /* word-wrap the description */
      var words = d.split(" "), lines = [], buf = "";
      words.forEach(function (w) {
        var test = buf ? buf + " " + w : w;
        if (ctx.measureText(test).width > LW - 32) { lines.push(buf); buf = w; }
        else buf = test;
      });
      if (buf) lines.push(buf);
      lines.forEach(function (ln, i) { ctx.fillText(ln, 16, 150 + i * 14); });
      st.statStage.set((stage + 1) + " of " + stages.length);
      st.desc.textContent = "Pipeline stage " + (stage + 1) + " of " + stages.length +
        ": " + stages[stage].name + ". " + stages[stage].desc;
    }
    var stepBtn = btn("btn btn-primary", "Step");
    stepBtn.addEventListener("click", function () {
      stage = (stage + 1) % stages.length; render();
      setStatus(st.status, "Stage " + (stage + 1) + ": " + stages[stage].name + ".");
    });
    var resetBtn = btn("btn", "Reset");
    resetBtn.addEventListener("click", function () { stage = 0; render();
      setStatus(st.status, "Reset to the first stage."); });
    st.controls.append(group([stepBtn, resetBtn]));

    st.canvas.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        stage = (stage + 1) % stages.length; e.preventDefault(); render();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        stage = (stage + stages.length - 1) % stages.length; e.preventDefault(); render();
      }
    });

    st.statStage = statBox(" stage");
    st.stats.append(st.statStage.wrap);
    st.legend.append(
      legendItem({ background: cssVar("--accent") }, "Active stage"),
      legendItem({ boxShadow: "inset 0 0 0 1px " + cssVar("--rule") }, "Other stages"));
    mount.appendChild(st.fig);
    render();
  }

  /* ---- reading progress bar ------------------------------------------ */
  function initProgress(barId) {
    var bar = document.getElementById(barId);
    if (!bar) return;
    function upd() {
      var h = document.documentElement;
      var max = h.scrollHeight - h.clientHeight;
      bar.style.width = (max <= 0 ? 0 : clamp(h.scrollTop / max, 0, 1) * 100) + "%";
    }
    global.addEventListener("scroll", upd, { passive: true });
    global.addEventListener("resize", upd);
    upd();
  }
  function run(config, fn) {
    var mount = typeof config.mount === "string"
      ? document.querySelector(config.mount) : config.mount;
    if (mount) fn(mount, config);
  }
  global.Retrieval = {
    embedding: function (c) { run(c, embeddingDemo); },
    metrics: function (c) { run(c, metricsDemo); },
    chunking: function (c) { run(c, chunkingDemo); },
    hnsw: function (c) { run(c, hnswDemo); },
    rerank: function (c) { run(c, rerankDemo); },
    hybrid: function (c) { run(c, hybridDemo); },
    pipeline: function (c) { run(c, pipelineDemo); },
    initProgress: initProgress
  };
})(window);
