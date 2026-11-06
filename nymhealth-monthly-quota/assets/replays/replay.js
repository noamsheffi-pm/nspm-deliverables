// DOM replays of the Coralogix app: real product UI rebuilt from an rrweb capture (see tools/replay/),
// scaled into its frame, playing while on screen and looping. Markup:
//   <div class="cxr" data-replay="/assets/replays/explore-errors.json" style="--ar: 1512 / 862"></div>
// add data-still="end" (or a time in ms) for a single crisp frame instead of playback, and
// data-cam="cx,cy,w" (app px) to frame it differently from the clip's click-following camera.
// Needs /assets/vendor/rrweb-replay-1.1.3.min.js (global rrwebReplay) loaded first.
// ───── Window chrome: pages write only <figure class="cxw" data-title="Explore · spans"><div class="cxr"
// data-replay="/assets/replays/<clip>.json"></div></figure>; the title bar (dots, title, Interactive badge,
// Light/Dark toggle; the zoom button is added further down) is built here, so every window looks and behaves
// the same. Replays are interactive unless the .cxr has data-static. ─────
(() => {
  const SUN = `<svg class="i-sun" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2.75"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.06 1.06M11.54 11.54l1.06 1.06M3.4 12.6l1.06-1.06M11.54 4.46l1.06-1.06"/></svg>`;
  const MOON = `<svg class="i-moon" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.2 9.8A5.5 5.5 0 0 1 6.2 2.8a5.5 5.5 0 1 0 7 7Z"/></svg>`;
  document.querySelectorAll(".cxw").forEach((win) => {
    const box = win.querySelector(".cxr");
    if (!box || win.querySelector(".cxw-bar")) return;
    if (!box.hasAttribute("data-static")) box.setAttribute("data-interactive", "");
    const bar = document.createElement("div");
    bar.className = "cxw-bar";
    const title = document.createElement("span");
    title.textContent = win.dataset.title || "";
    bar.append(...[0, 1, 2].map(() => document.createElement("i")), title);
    if (box.hasAttribute("data-interactive")) bar.insertAdjacentHTML("beforeend", `<em class="cxw-live" title="${box.dataset.still ? "This is the real app. Hover and click the spans." : "This is the real app. Hover to pause it, then explore."}"><i></i>Interactive</em>`);
    bar.insertAdjacentHTML("beforeend", `<button class="cxw-theme" type="button" data-cxr-theme>${SUN}${MOON}</button>`);
    win.prepend(bar);
    if (!win.hasAttribute("aria-label") && win.dataset.title) win.setAttribute("aria-label", `The Coralogix app: ${win.dataset.title}`);
  });
})();

(() => {
  const still = window.matchMedia("(prefers-reduced-motion: reduce)");
  const HOLD = 2600; // pause on the last frame before looping
  const GLIDE = 1100; // camera move between keyframes
  // the app ships its own light and dark themes (:root[theme="dark"] in the captured CSS); replays follow
  // the site's skin: light only where the page itself is light (the homepage's light skin), else dark
  const skin = () => (document.documentElement.dataset.theme === "light" ? "light" : "dark");
  const players = new Set();
  // a window's own Light/Dark toggle (data-theme on the .cxr) wins over the site's skin
  // chart tooltips recorded in the dark skin write their rows in the "on color" text token, which stays white in
  // the light skin while the card turns white: the app swaps that token in its own light tooltip variant
  // (cxui-chart-tooltip-light), which a dark capture never contains, so the light skin does the same here
  const LIGHT_TIPS = [ // one rule per entry: rrweb's insertStyleRules passes each to insertRule
    `html:not([theme="dark"]) .tw-bg-background-tooltip, html:not([theme="dark"]) cxui-chart-tooltip { --c-text-on-color: var(--c-text-primary); --rgb-text-on-color: var(--rgb-text-primary); --c-text-on-color-secondary: var(--c-text-secondary); --rgb-text-on-color-secondary: var(--rgb-text-secondary); }`,
    // the overlay around the card already computed its white text from the old token, and the rows inherit it
    `html:not([theme="dark"]) .tw-bg-background-tooltip { color: var(--c-text-primary); box-shadow: 0 0 0 1px rgb(0 0 0 / .08), 0 16px 40px rgb(0 0 0 / .16); }`,
  ];
  const paint = (player) => player.iframe?.contentDocument?.documentElement?.setAttribute("theme", player.box?.dataset.theme || skin());
  // A rebuilt app links its stylesheet (assets/replays/media/<clip>-*.css, 300–400 KB), which arrives after the DOM: in
  // between, the app painted unstyled, a white page with black text. Until every stylesheet in it has loaded, the
  // stage stays hidden over the window's own dark ground (.is-styling). A sheet that fails or hangs gives up after 8s.
  const styled = (doc) => {
    const links = [...(doc?.querySelectorAll('link[rel~="stylesheet"]') || [])].filter((l) => !l.sheet);
    return Promise.race([
      Promise.all(links.map((l) => new Promise((done) => { l.addEventListener("load", done, { once: true }); l.addEventListener("error", done, { once: true }); }))),
      new Promise((done) => setTimeout(done, 8000)),
    ]);
  };
  new MutationObserver(() => players.forEach(paint)).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  // iOS Safari redraws a replay's layers at the app's full 1600px size times the pinch zoom (it ignores that
  // the app is scaled down to fit its window), so pinch-zooming a live replay ran the tab out of memory and
  // crashed it. While the page is pinch-zoomed the replays are taken down; they come back on zoom-out.
  // Phones and tablets only: desktop browsers handle the zoom fine, so there the live replay stays.
  const vv = window.visualViewport;
  const touch = window.matchMedia("(hover: none) and (pointer: coarse)");
  const isZoomed = () => !!vv && touch.matches && vv.scale > 1.15;
  const onZoom = new Set();
  let wasZoomed = isZoomed();
  vv?.addEventListener("resize", () => {
    const z = isZoomed();
    if (z === wasZoomed) return;
    wasZoomed = z;
    onZoom.forEach((f) => f(z));
  });
  let scrolledAt = 0; // when the page last scrolled
  addEventListener("scroll", () => (scrolledAt = performance.now()), { passive: true });
  const ease = (k) => (k < .5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
  // ───── the pointer ─────
  // A capture samples the mouse about 15 times a second and rrweb then moves the cursor in those steps, so it
  // lurches across the app. The clip's path is read once here and the cursor is placed from it on every frame
  // instead (replay.css hands it over), interpolated between samples, which also smooths the capture's own
  // uneven spacing. Cubic Hermite with tangents measured over real time: its tangents go to zero wherever the
  // pointer rests, so it eases out of and into every stop by itself.
  function pointerPath(clip) {
    const base = clip.events[0].timestamp;
    // rrweb records the pointer in batches of about half a second, each position timed by an offset back from
    // the batch. Two things make the batches a bad timeline to sort: process.mjs folds everything before the
    // clip's first frame onto that instant, so the lead-in arrives stacked on it, and consecutive batches can
    // claim overlapping times (94 of this site's clips do). Sorting interleaves two runs of the same stretch
    // of path and the cursor zig-zags down it. So the batches are kept in the order they were recorded — which
    // is right in sequence and in space — the fold is dropped, and an overlapping pair is re-timed evenly
    // across the two: a capture samples at a steady rate, so even spacing keeps the speed the mouse really had.
    const fold = Math.min(...clip.events.filter((e) => e.type === 3).map((e) => e.timestamp)) - base;
    const runs = [];
    let end = -Infinity;
    for (const e of clip.events) {
      if (e.type !== 3 || e.data.source !== 1) continue;
      const b = [];
      for (const p of e.data.positions || []) { const t = e.timestamp - base + p.timeOffset; if (t > fold) b.push({ t, x: p.x, y: p.y }); }
      if (!b.length) continue;
      if (b[0].t <= end) { const r = runs[runs.length - 1]; r.push(...b); r.merged = true; } else runs.push(b);
      end = Math.max(end, b[b.length - 1].t);
    }
    for (const r of runs) {
      if (!r.merged) continue;
      const t0 = r[0].t, t1 = r.reduce((m, p) => Math.max(m, p.t), r[0].t);
      r.forEach((p, i) => (p.t = t0 + (t1 - t0) * i / (r.length - 1)));
    }
    const path = runs.flat().filter((p, i, a) => i === 0 || p.t > a[i - 1].t + 0.5);
    if (path.length) path[0] = { ...path[0], t: Math.min(0, path[0].t) };
    return path;
  }
  const herm = (p1, p2, m1, m2, h, k) => { // one axis of a Hermite segment
    const k2 = k * k, k3 = k2 * k;
    return (2 * k3 - 3 * k2 + 1) * p1 + (k3 - 2 * k2 + k) * h * m1 + (-2 * k3 + 3 * k2) * p2 + (k3 - k2) * h * m2;
  };
  function pointAt(path, t) {
    if (!path.length) return null;
    if (t <= path[0].t) return path[0];
    if (t >= path[path.length - 1].t) return path[path.length - 1];
    let lo = 0, hi = path.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (path[m].t <= t) lo = m; else hi = m; }
    const p1 = path[lo], p2 = path[hi], h = p2.t - p1.t;
    // the capture skipped (a new page, a window the app moved the pointer into): jump, don't glide across it
    if (h > 260 && Math.hypot(p2.x - p1.x, p2.y - p1.y) > 40) return p1;
    const p0 = path[Math.max(0, lo - 1)], p3 = path[Math.min(path.length - 1, hi + 1)];
    const k = (t - p1.t) / h;
    const mx1 = (p2.x - p0.x) / (p2.t - p0.t), my1 = (p2.y - p0.y) / (p2.t - p0.t);
    const mx2 = (p3.x - p1.x) / (p3.t - p1.t), my2 = (p3.y - p1.y) / (p3.t - p1.t);
    return { x: herm(p1.x, p2.x, mx1, mx2, h, k), y: herm(p1.y, p2.y, my1, my2, h, k) };
  }
  // ───── Lean replays: a page opts in with <body data-replays="lean"> ─────
  // Measured on Traces and APM: every loop rebuilds the whole app page (150-200 MB of garbage per window, 10-20% CPU
  // nonstop), and several windows playing at once multiply it. Here a clip plays once and holds its payoff (a button
  // plays it again), only the most visible clip plays, and the others wait, paused.
  const LEAN = document.body?.dataset.replays === "lean";
  const seen = new Map(); // clip windows → how much of each is on screen (0-1)
  let lead = null; // the one window allowed to play; none while no clip is on screen (the first fold)
  const elect = () => {
    // a clip qualifies once half of it is on screen (or, taller than the screen, it fills half of it); the most
    // visible one plays. When none qualifies, the lead is released and nothing plays.
    let best = null, most = 0.5;
    seen.forEach((r, b) => { if (r >= most && !b.dataset.done) { most = r; best = b; } });
    if (best === lead) return;
    const old = lead;
    lead = best;
    old?.cxrLead?.(false);
    best?.cxrLead?.(true);
  };
  const ranks = new IntersectionObserver((es) => {
    for (const e of es) seen.set(e.target, e.isIntersecting ? Math.max(e.intersectionRatio, e.rootBounds ? e.intersectionRect.height / e.rootBounds.height : 0) : 0);
    elect();
  }, { threshold: [0, .25, .5, .6, .7, .8, .9, 1] });

  function mount(box) {
    // a pre-rendered still of the clip (tools/replay/frames.mjs --still → assets/replays/stills/<clip>.webp), shown
    // only while a phone is pinch-zoomed (the live app is taken down then). It isn't fetched until that happens.
    const poster = new Image();
    poster.className = "cxr-poster"; poster.alt = ""; poster.decoding = "async";
    box.prepend(poster);
    const setPoster = () => { // the dark or light still, matching the window's skin (its own toggle, else the site's)
      if (!box.classList.contains("is-zoomed") || !visible) return; // only the window on screen fetches its still
      const [path, q] = (box.dataset.poster || box.dataset.replay.replace(/([^/]+)\.json(\?|$)/, "stills/$1.webp$2")).split("?");
      const src = ((box.dataset.theme || skin()) === "light" ? path.replace(/\.webp$/, "-light.webp") : path) + (q ? "?" + q : "");
      if (poster.getAttribute("src") !== src) poster.src = src;
    };
    const watchers = [new MutationObserver(setPoster), new MutationObserver(setPoster)];
    watchers[0].observe(box, { attributes: true, attributeFilter: ["data-theme"] });
    watchers[1].observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    let player = null, clip = null, stage = null, visible = false, loopTimer = 0, loading = null, raf = 0, path = null, cursor = null;
    let held = false; // set while the window is open in the zoom view: this copy stays paused
    const controls = box.hasAttribute("data-controls") && !box.dataset.still;
    const lean = LEAN && !box.dataset.still && !controls && !box.dataset.hold; // plays once, and only while it leads
    const leads = () => !lean || lead === box;
    if (lean) {
      ranks.observe(box);
      box.cxrLead = (on) => { if (on) show(); else if (player) { cancelAnimationFrame(raf); player.pause(); } };
      const again = document.createElement("button");
      again.type = "button"; again.className = "cxr-again"; again.setAttribute("aria-label", "Play again");
      again.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.75 8a5.25 5.25 0 1 0 1.6-3.77M2.75 2.5v3h3"/></svg>`;
      again.addEventListener("click", (e) => {
        e.stopPropagation();
        delete box.dataset.done;
        box.dataset.watch = "1"; // the pointer is on the window now: don't pause it under the pointer until it leaves
        box.classList.remove("is-live");
        box.querySelector("iframe")?.contentDocument?.__cxReset?.();
        const old = lead; lead = box;
        if (old && old !== box) old.cxrLead?.(false);
        if (player) { player.play(0); cancelAnimationFrame(raf); tick(); } else show();
      });
      box.append(again);
    }

    // the camera: where it should be at time t (ms), framed into the box
    function frame(t) {
      if (!clip) return;
      const fixed = box.dataset.cam?.split(",").map(Number); // data-cam="cx,cy,w": one fixed framing
      const cam = fixed ? [{ t: 0, cx: fixed[0], cy: fixed[1], w: fixed[2] }] : clip.camera || [{ t: 0, cx: clip.width / 2, cy: clip.height / 2, w: clip.width }];
      let i = 0; // b: the latest keyframe reached; glide to it from the one before
      while (i + 1 < cam.length && cam[i + 1].t <= t) i++;
      const a = cam[Math.max(0, i - 1)], b = cam[i];
      const k = i === 0 ? 1 : ease(Math.min(1, Math.max(0, t - b.t) / GLIDE));
      const bw = box.clientWidth, bh = box.clientHeight;
      // small frames zoom in further so text stays legible on phones
      const tight = (w) => (fixed || w >= clip.width ? w : Math.max(560, w * Math.min(1, bw / 1100))); // data-cam is exact
      const w = tight(a.w) + (tight(b.w) - tight(a.w)) * k, cx = a.cx + (b.cx - a.cx) * k, cy = a.cy + (b.cy - a.cy) * k;
      const s = Math.max(bw / w, bh / clip.height);
      const tx = Math.min(0, Math.max(bw - clip.width * s, bw / 2 - cx * s));
      const ty = Math.min(0, Math.max(bh - clip.height * s, bh / 2 - cy * s));
      stage.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${s.toFixed(5)})`;
      const at = path && pointAt(path, t); // the cursor belongs to this frame too, not to rrweb's sampling
      if (!at) return;
      if (!cursor?.isConnected) cursor = player?.iframe?.parentElement?.querySelector(".replayer-mouse");
      if (cursor) { cursor.style.setProperty("--cxr-mx", at.x.toFixed(2) + "px"); cursor.style.setProperty("--cxr-my", at.y.toFixed(2) + "px"); }
    }
    const tick = () => { if (player) { const t = player.getCurrentTime(); frame(t); ctl?.update(t); } raf = requestAnimationFrame(tick); };

    // after a (re)build: the app's skin, its live tooltips, and the window's own interactions (cxr:rebuilt)
    const rebuilt = (hovers, clicks) => {
      paint(player);
      liveRows(box, player);
      if (hovers) liveHovers(box, player, hovers);
      if (clicks) liveClicks(box, player, clicks);
      box.dispatchEvent(new Event("cxr:rebuilt"));
    };
    // data-baked (a still, tools/replay/bake.mjs): the app as plain HTML at the still's moment. The browser parses it
    // in one pass: no clip download, no rrweb, no fast-forward to the moment. A stand-in for the replayer covers what
    // the rest of this file asks of a player.
    function loadBaked() {
      loading = new Promise((done) => {
        stage = document.createElement("div");
        stage.className = "cxr-stage";
        const iframe = document.createElement("iframe");
        iframe.setAttribute("sandbox", "allow-same-origin"); // no scripts in there, like the replayer's own iframe
        iframe.addEventListener("load", () => {
          if (!stage) return; // taken down while it loaded
          const doc = iframe.contentDocument, root = doc.documentElement;
          clip = { width: +root.dataset.cxW || 1600, height: +root.dataset.cxH || 900 };
          iframe.width = clip.width; iframe.height = clip.height;
          stage.style.width = `${clip.width}px`; stage.style.height = `${clip.height}px`;
          for (const el of doc.querySelectorAll("[data-cx-scroll]")) { const [t, l] = el.dataset.cxScroll.split(",").map(Number); el.scrollTop = t; el.scrollLeft = l; }
          const nodes = new Map(); // rrweb ids the live tooltips point at
          for (const el of doc.querySelectorAll("[data-rr]")) nodes.set(+el.dataset.rr, el);
          // text nodes: a <!--rr:id--> marker sits just before each (":e" for an empty one, which XML can't hold);
          // the app's own comments (anchors tooltips are inserted next to) carry "rr:id:c:" before their text
          const marks = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT), found = [];
          for (let c = marks.nextNode(); c; c = marks.nextNode()) if (/^rr:\d+(:e|:c:[\s\S]*)?$/.test(c.data)) found.push(c);
          for (const c of found) {
            const [, id, kind] = c.data.split(":");
            if (kind === "c") { c.data = c.data.replace(/^rr:\d+:c:/, ""); nodes.set(+id, c); continue; }
            let t = c.nextSibling;
            if (kind === "e" || t?.nodeType !== 3) { t = doc.createTextNode(""); c.after(t); }
            nodes.set(+id, t); c.remove();
          }
          const t = +box.dataset.still || 0;
          player = { box, iframe, baked: true, getMirror: () => ({ getNode: (id) => nodes.get(id) || null }), getCurrentTime: () => t, getMetaData: () => ({ totalTime: t }), pause() {}, play() {}, setConfig() {} };
          players.add(player);
          stage.dataset.settled = "1";
          let hovers = null;
          try { hovers = JSON.parse(doc.getElementById("cx-hovers")?.textContent || "null"); } catch {} // older bakes
          // the states file (tools/replay/bake.mjs): the tooltips, the controls and the stylesheet rules only they
          // need, fetched once a visitor points at the window (a tap fires it too, just before its click), so none of
          // it weighs on the page's load. Kept per window: a still taken down and rebuilt doesn't fetch it again
          const states = doc.querySelector('meta[name="cx-states"]')?.getAttribute("content");
          let applied = null;
          const get = states && (() => (applied ||= (box.cxStates ||= fetch(states).then((r) => r.json()).catch(() => ({})))
            .then((j) => {
              if (j.css && doc.head) { const st = doc.createElement("style"); st.textContent = j.css; doc.head.append(st); }
              if (j.hovers && !hovers && iframe.contentDocument === doc) liveHovers(box, player, j.hovers);
              return j;
            })));
          if (get) box.addEventListener("pointerenter", get, { once: true });
          rebuilt(hovers, states && { url: states, get });
          box.paint = () => paint(player);
          box.cxr = { player, start() {} };
          box.classList.add("is-ready");
          done(player);
        }, { once: true });
        iframe.src = box.dataset.baked;
        stage.append(iframe);
        box.append(stage);
      });
      return loading;
    }

    let json = null; // the clip's data stays cached; the rebuilt app (its iframe) only exists near the viewport
    async function load() {
      if (box.dataset.baked) return loading || loadBaked();
      json ||= fetch(box.dataset.replay).then((r) => r.json());
      if (!loading) loading = json.then((c) => {
        clip = c;
        stage = document.createElement("div");
        stage.className = "cxr-stage";
        stage.style.width = `${clip.width}px`;
        stage.style.height = `${clip.height}px`;
        box.classList.add("is-styling"); // the replayer's blank iframe paints white too (its color-scheme isn't the page's)
        box.append(stage);
        player = new rrwebReplay.Replayer(clip.events, {
          root: stage,
          skipInactive: false,
          mouseTail: false,
          showWarning: false,
          triggerFocus: false,
          insertStyleRules: [
            "* { scrollbar-width: none !important; }", "::-webkit-scrollbar { display: none; }", // the app shows scrollbars on hover, which would narrow its panels
            // no extra GPU layers: blurred backdrops and will-change layers get re-drawn at every zoom level and
            // ran mobile browsers out of graphics memory (tiles dropped when zoomed, tabs crashed on phones)
            "*, *::before, *::after { will-change: auto !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }",
            ...LIGHT_TIPS,
          ],
        });
        player.box = box;
        path = pointerPath(clip);
        // rrweb 1.1.3 queues one action per event, in event order, and never sorts; but a mousemove batch is
        // queued at its *first* position's time, half a second before its own timestamp, so the queue runs
        // backwards at every batch. Its runner stops at the first action that isn't due yet, and the batch's
        // own positions are then spliced in by a binary search over an unsorted list: the clip stalled, then
        // caught up in one frame with the app's changes out of order. Sorting the queue is all it needs.
        const timer = player.timer;
        if (timer?.addActions) {
          const add = timer.addActions.bind(timer);
          timer.addActions = (as) => { add(as); timer.actions.sort((a, b) => a.delay - b.delay); };
        }
        players.add(player);
        player.on("fullsnapshot-rebuilded", () => {
          const built = player.iframe?.contentDocument;
          if ([...(built?.querySelectorAll('link[rel~="stylesheet"]') || [])].some((l) => !l.sheet)) {
            box.classList.add("is-styling");
            styled(built).then(() => { if (player?.iframe?.contentDocument === built) box.classList.remove("is-styling"); });
          } else box.classList.remove("is-styling");
          // a (re)build lands at once: the app's own entry animations (the drawer sliding in from the side, rows
          // easing into place) would otherwise replay every time a window is rebuilt. Finished, not removed, so
          // they don't restart when the rule goes away; stills keep it.
          const doc = player.iframe?.contentDocument, st = doc?.createElement("style");
          if (st) {
            st.textContent = "*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; transition-delay: 0s !important; }";
            doc.head?.append(st);
            if (!box.dataset.still) setTimeout(() => st.remove(), 1200);
          }
          // a clip names its states file (tools/replay/states.mjs splitStates): tooltips and controls, fetched once a
          // visitor points at the window, kept per window across rebuilds
          const get = clip.states && (() => (box.cxClipStates ||= fetch(clip.states).then((r) => r.json()).catch(() => ({}))));
          if (get && !clip.hovers) {
            const doc = player.iframe?.contentDocument;
            box.addEventListener("pointerenter", () => get().then((j) => { if (j.hovers && player.iframe?.contentDocument === doc) liveHovers(box, player, j.hovers); }), { once: true });
          }
          rebuilt(clip.hovers, clip.clicks ? { states: clip.clicks, shared: clip.shared } : get && { url: clip.states, get });
        });
        player.on("finish", () => {
          if (box.dataset.still) return;
          if (lean) { // played through: hold the payoff, hand the lead on
            box.dataset.done = "1";
            cancelAnimationFrame(raf);
            frame(player.getMetaData().totalTime); // land the camera and the pointer on the last frame exactly
            if (lead === box) { lead = null; elect(); }
            return;
          }
          clearTimeout(loopTimer);
          loopTimer = setTimeout(() => { if (visible && !still.matches) player.play(0); }, HOLD);
        });
        frame(0);
        // tools/replay/render.mjs renders clips to video: data-hold keeps it still until it calls start()
        box.paint = () => paint(player);
        box.cxr = { player, start: () => { player.play(0); cancelAnimationFrame(raf); tick(); } };
        box.classList.add("is-ready");
        return player;
      });
      return loading;
    }
    async function show() {
      if (isZoomed() || held) return;
      await load();
      if (isZoomed()) return unmount(true);
      if (box.dataset.hold) return;
      const total = player.getMetaData().totalTime;
      if (box.dataset.still || still.matches) { // a crisp still: one frame of the clip, no playback
        const t = box.dataset.still && box.dataset.still !== "end" ? Math.min(+box.dataset.still, total) : total;
        frame(t + GLIDE);
        if (stage.dataset.settled) return;
        // played up to t at high speed, hidden, rather than jumped to: rrweb's jump can drop nodes the app added
        // mid-clip (a chart's tooltip container), which leaves panels incomplete and live tooltips nothing to land on
        stage.style.visibility = "hidden";
        player.setConfig({ speed: 12 });
        player.play(0);
        const limit = box.dataset.patient ? Infinity : 6000; // tools (render.html) wait it out, however loaded the machine
        await new Promise((done) => { const t0 = performance.now(); const wait = () => (player.getCurrentTime() >= t - 30 || performance.now() - t0 > limit ? done() : setTimeout(wait, 16)); wait(); });
        player.pause(); player.setConfig({ speed: 1 });
        if (player.getCurrentTime() < t - 30) player.pause(t); // too slow a device: jump the rest
        stage.dataset.settled = "1"; stage.style.visibility = "";
        frame(t + GLIDE);
        return;
      }
      if (controls && box.classList.contains("is-live")) { frame(player.getCurrentTime()); ctl?.update(player.getCurrentTime()); return; } // paused by the visitor
      if (lean && box.dataset.done) { frame(total); return; } // played once: it holds the payoff
      if (!leads()) { frame(player.getCurrentTime()); return; } // another window is playing: wait, paused
      const t = box.dataset.start ? Math.min(+box.dataset.start, total) : player.getCurrentTime();
      delete box.dataset.start; // the zoom view opens where the window was
      player.play(t > 0 && t < total ? t : 0); // resume where it paused, else from the top
      cancelAnimationFrame(raf); tick();
    }
    // tear the rebuilt app down once it is well off screen: every replay is a full copy of the app's DOM,
    // and keeping them all alive is what exhausted memory on phones. It's rebuilt from the cached clip on return.
    async function unmount(force) {
      if (!loading) return;
      const p = await loading;
      if ((visible && !force) || loading === null || !player) return;
      clearTimeout(loopTimer); cancelAnimationFrame(raf);
      p.pause(); players.delete(p);
      p.iframe?.contentDocument?.documentElement?.remove(); // drop the rebuilt app even if the replayer is still referenced
      stage.remove();
      delete box.cxr; delete box.paint; delete box.dataset.done; // a lean clip plays again when the visitor comes back
      player = stage = null; loading = null; path = cursor = null;
      box.classList.remove("is-ready", "is-styling");
    }
    // data-interactive on a playing clip: hovering pauses it and hands the app to the visitor (desktop only;
    // on touch a finger scrolling past would pause it). Leaving undoes their changes and resumes the clip.
    if (box.hasAttribute("data-interactive") && !box.dataset.still && !controls) {
      const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
      // the pointer sweeping across a clip while the page scrolls doesn't pause it (no flashing pill and cursor):
      // it pauses once the page has been still under the pointer for a moment
      let wait = 0;
      // a pause the visitor can see: a small bar (play/pause and what's going on) that shows on hover and stays
      // while paused, and a pause sign that flashes in the middle at the moment it stops, like a video
      const bar = document.createElement("div");
      bar.className = "cxr-hold";
      bar.innerHTML = `<button type="button" class="cxr-pp" aria-label="Pause"><svg viewBox="0 0 16 16" aria-hidden="true"><path class="i-pause" d="M5 3.5v9M11 3.5v9"/><path class="i-play" d="M5 3v10l8-5z"/></svg></button><span class="cxr-hold-t"></span>`;
      const sign = document.createElement("span");
      sign.className = "cxr-sign"; sign.setAttribute("aria-hidden", "true");
      sign.innerHTML = `<svg viewBox="0 0 16 16"><path d="M5 3.5v9M11 3.5v9"/></svg>`;
      box.append(bar, sign);
      const label = bar.querySelector(".cxr-hold-t"), pp = bar.querySelector(".cxr-pp");
      const paintHold = () => {
        const paused = box.classList.contains("is-live");
        box.classList.toggle("is-held", paused);
        pp.setAttribute("aria-label", paused ? "Play" : "Pause");
        label.textContent = paused ? (fine.matches ? "Paused so you can interact · hover out to continue" : "Paused") : "Playing";
      };
      const pauseNow = (flash) => {
        if (!player || box.classList.contains("is-live")) return;
        clearTimeout(loopTimer); cancelAnimationFrame(raf);
        player.pause();
        box.classList.add("is-live");
        box.dispatchEvent(new Event("cxr:live"));
        paintHold();
        if (flash) { sign.classList.remove("is-on"); void sign.offsetWidth; sign.classList.add("is-on"); }
      };
      const playNow = () => {
        if (!player) return;
        box.dataset.watch = "1"; // played from under the pointer: don't pause again until it leaves
        delete box.dataset.done;
        box.classList.remove("is-live");
        box.querySelector("iframe")?.contentDocument?.__cxReset?.();
        if (lean && lead !== box) { const old = lead; lead = box; if (old) old.cxrLead?.(false); }
        paintHold();
        if (visible) show();
      };
      pp.addEventListener("click", (e) => { e.stopPropagation(); if (box.classList.contains("is-live")) playNow(); else pauseNow(true); });
      bar.addEventListener("click", (e) => e.stopPropagation());
      paintHold();
      const tryPause = () => {
        if (!fine.matches || !player || box.dataset.hold || box.dataset.watch || box.classList.contains("is-live")) return;
        if (performance.now() - scrolledAt < 350) { wait = setTimeout(tryPause, 120); return; }
        pauseNow(true);
      };
      // a pointer passing over on its way somewhere doesn't pause it: only one that rests for a moment
      box.addEventListener("pointerenter", () => { clearTimeout(wait); wait = setTimeout(tryPause, 400); });
      box.addEventListener("pointerleave", () => {
        clearTimeout(wait);
        delete box.dataset.watch;
        if (!box.classList.contains("is-live")) return;
        box.classList.remove("is-live");
        box.classList.remove("is-held");
        box.querySelector("iframe")?.contentDocument?.__cxReset?.();
        if (visible && player) show();
        box.querySelector(".cxr-hold-t").textContent = "Playing";
        box.querySelector(".cxr-pp").setAttribute("aria-label", "Pause");
      });
    }
    // data-controls (the zoom view): a player bar shown on hover, with play/pause, a scrubber and the time.
    // Pausing hands the app to the visitor, as hovering does in the page; playing undoes their changes.
    let ctl = null;
    if (controls) {
      const bar = document.createElement("div");
      bar.className = "cxr-ctl";
      bar.innerHTML = `<button type="button" class="cxr-pp" aria-label="Pause"><svg viewBox="0 0 16 16" aria-hidden="true"><path class="i-pause" d="M5 3.5v9M11 3.5v9"/><path class="i-play" d="M5 3v10l8-5z"/></svg></button>` +
        `<input type="range" min="0" max="1000" step="1" value="0" aria-label="Position in the clip"><span class="cxr-time">0:00 / 0:00</span>`;
      box.append(bar);
      const pp = bar.querySelector(".cxr-pp"), range = bar.querySelector("input"), time = bar.querySelector(".cxr-time");
      const fmt = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
      const total = () => player?.getMetaData().totalTime || 0;
      let dragging = false;
      ctl = {
        update(t) {
          if (!dragging && total()) { range.max = total(); range.value = Math.min(t, total()); }
          time.textContent = `${fmt(t)} / ${fmt(total())}`;
          const paused = box.classList.contains("is-live");
          box.classList.toggle("is-paused", paused);
          pp.setAttribute("aria-label", paused ? "Play" : "Pause");
        },
      };
      const pause = () => {
        if (!player || box.classList.contains("is-live")) return;
        clearTimeout(loopTimer); player.pause();
        box.classList.add("is-live");
        box.dispatchEvent(new Event("cxr:live"));
        ctl.update(player.getCurrentTime());
      };
      const play = () => {
        if (!player) return;
        box.classList.remove("is-live");
        box.querySelector("iframe")?.contentDocument?.__cxReset?.();
        show();
      };
      ctl.toggle = () => (box.classList.contains("is-live") ? play() : pause());
      pp.addEventListener("click", (e) => { e.stopPropagation(); ctl.toggle(); });
      bar.addEventListener("click", (e) => e.stopPropagation());
      box.addEventListener("click", () => pause()); // clicking the playing clip pauses it, like a video
      box.addEventListener("wheel", (e) => { if (!box.classList.contains("is-live")) { e.preventDefault(); pause(); } }, { passive: false }); // so does the wheel: then it scrolls the app
      range.addEventListener("input", () => {
        if (!player) return;
        dragging = true;
        const t = +range.value;
        box.querySelector("iframe")?.contentDocument?.__cxReset?.();
        clearTimeout(loopTimer);
        if (box.classList.contains("is-live")) player.pause(t); else player.play(t);
        frame(t); time.textContent = `${fmt(t)} / ${fmt(total())}`;
      });
      range.addEventListener("change", () => { dragging = false; });
    }
    // the zoom view's hooks into this window
    box.cxrApi = {
      time: () => (player ? player.getCurrentTime() : 0),
      hold(on) { // pause this copy while the zoom view is open (on touch devices drop it, to keep memory low)
        held = on;
        if (on) { clearTimeout(loopTimer); cancelAnimationFrame(raf); player?.pause(); if (touch.matches) unmount(true); }
        else if (visible) show();
      },
      toggle: () => ctl?.toggle(),
      destroy() { // the zoom view closed: tear this copy down completely
        held = true; visible = false;
        unmount(true);
        observers.forEach((o) => o.disconnect()); watchers.forEach((o) => o.disconnect());
        onZoom.delete(zoomed);
      },
    };
    const zoomed = (z) => {
      box.classList.toggle("is-zoomed", z);
      setPoster();
      if (z) unmount(true); else if (visible) show();
    };
    onZoom.add(zoomed);
    if (isZoomed()) { box.classList.add("is-zoomed"); setPoster(); }
    const observers = [];
    observers.push(new ResizeObserver(() => { if (player) frame(player.getCurrentTime()); }));
    observers[0].observe(box);
    observers.push(new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) { setPoster(); show(); }
      else if (player) { clearTimeout(loopTimer); cancelAnimationFrame(raf); if (!box.dataset.still) player.pause(); }
    }, { rootMargin: "200px 0px", threshold: 0.2 }));
    // lean pages take windows down sooner: half a screen away rather than a full one
    observers.push(new IntersectionObserver(([e]) => { if (!e.isIntersecting && !box.dataset.hold) unmount(); }, { rootMargin: LEAN ? "50% 0px" : "100% 0px" }));
    observers[1].observe(box); observers[2].observe(box);
  }
  // ───── Live tooltips: the app's own hover states, recorded by capture.mjs s.hovers() ─────
  // Each state names the element that was hovered (rrweb id; `band` for a slice of a chart) and what the app changed:
  // nodes it added (its tooltip), attributes and text it switched. Hovering the same spot applies them; moving on
  // undoes them. Only on a still or a clip the visitor paused, so it never fights the playing timeline.
  // A recorded state (capture.mjs: the full difference the app made from the recorded frame) applied to the replay:
  // nodes it took out, attributes and text it switched, nodes it added. Returns how to undo it, and what it added.
  function applyDiff(doc, mirror, h, { follow = true } = {}) {
    const SVG = "http://www.w3.org/2000/svg", undo = [], nodes = [], fresh = new Map();
    // a recorded node the app re-created (it keeps its id): what the state adds inside it goes into the new copy
    const get = (id) => fresh.get(id) || mirror.getNode(id);
    const build = (n) => { // keeps Angular's _ngcontent/_nghost attributes: the app's scoped CSS matches on them
      if (n.type === 3) return doc.createTextNode(n.textContent || "");
      if (n.type !== 2) return null;
      const el = n.isSVG ? doc.createElementNS(SVG, n.tagName) : doc.createElement(n.tagName);
      if (n.id > 0) fresh.set(n.id, el);
      for (const [k, v] of Object.entries(n.attributes || {})) { if (k === "_cssText" || v == null) continue; try { el.setAttribute(k, v === true ? "" : v); } catch {} }
      if (n.attributes?._cssText && n.tagName === "style") el.textContent = n.attributes._cssText;
      for (const c of n.childNodes || []) { const k = build(c); if (k) el.append(k); }
      return el;
    };
    const target = mirror.getNode(h.id);
    const r = target?.getBoundingClientRect?.(), dx = r && h.rect ? r.left - h.rect[0] : 0, dy = r && h.rect ? r.top - h.rect[1] : 0;
    // the panel that scrolls the target: what a state adds inside it (a chart's crosshair, a row's tint) already moved
    // with the scroll, and only an overlay outside it has to follow (moving both put a crosshair a scroll away)
    const pane = (Math.abs(dx) > 1 || Math.abs(dy) > 1) && (() => {
      for (let n = target?.parentElement; n && n !== doc.body && n !== doc.documentElement; n = n.parentElement) {
        if (/(auto|scroll)/.test(doc.defaultView.getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight + 1) return n;
      }
      return null;
    })();
    for (const id of h.del || []) { // what the app took out to redraw it (a chart's old tooltip rows, the Gantt for a flame graph)
      const el = mirror.getNode(id), parent = el?.parentNode; if (!parent) continue;
      const next = el.nextSibling; el.remove(); undo.push(() => parent.insertBefore(el, next && next.parentNode === parent ? next : null));
    }
    for (const a of h.attrs || []) {
      const el = mirror.getNode(a.id); if (!el?.setAttribute) continue;
      const old = el.getAttribute(a.name);
      a.v == null ? el.removeAttribute(a.name) : el.setAttribute(a.name, a.v);
      undo.push(() => (old == null ? el.removeAttribute(a.name) : el.setAttribute(a.name, old)));
    }
    for (const t of h.text || []) {
      const el = mirror.getNode(t.id); if (!el) continue;
      const old = el.textContent; el.textContent = t.v; undo.push(() => (el.textContent = old));
    }
    // an add whose parent is a re-created node waits until that node is built
    const inside = new Set(), walk = (n) => { if (n.id > 0) inside.add(n.id); (n.childNodes || []).forEach(walk); };
    (h.add || []).forEach((a) => walk(a.node));
    let todo = h.add || [];
    for (let pass = 0; todo.length && pass < 8; pass++) {
      const later = [];
      for (const a of todo) {
        if (inside.has(a.p) && !fresh.has(a.p)) { later.push(a); continue; }
        const parent = get(a.p), node = parent && build(a.node);
        if (!node) continue;
        const next = a.n != null ? get(a.n) : null;
        parent.insertBefore(node, next && next.parentNode === parent ? next : null);
        // a tooltip that lives outside the hovered element (an overlay on the page) follows it if the visitor scrolled
        if (follow && target && (Math.abs(dx) > 1 || Math.abs(dy) > 1) && node.style && !target.contains(parent) && !(pane && pane.contains(parent)) && !parent.closest?.("[style*='z-index']")) node.style.translate = `${dx}px ${dy}px`;
        nodes.push(node); undo.push(() => node.remove());
      }
      todo = later;
    }
    return { nodes, undo: () => { while (undo.length) undo.pop()(); } };
  }

  function liveHovers(box, player, states) {
    const doc = player.iframe?.contentDocument, mirror = player.getMirror?.();
    if (!doc || !mirror || doc.__cxHovers) return;
    doc.__cxHovers = true;
    // the app's floating tooltips (a span card, an icon's label) follow the pointer here, with a quieter, darker
    // card than the app's slate one, so it reads over the red error rows as well as the dark ones
    const st = doc.createElement("style");
    st.textContent = `[data-cx-tip] { transition: none !important; animation: none !important; }
      html[theme="dark"] [data-cx-tip] .tw-bg-background-tooltip, html[theme="dark"] [data-cx-tip].tw-bg-background-tooltip { background-color: #17191f !important; }
      html[theme="dark"] [data-cx-tip]:not(.highcharts-tooltip-container), html[theme="dark"] .highcharts-tooltip-container[data-cx-tip] .tw-bg-background-tooltip { border-radius: 10px; box-shadow: 0 0 0 1px rgb(255 255 255 / .12), 0 18px 44px rgb(0 0 0 / .6) !important; }
      [data-cx-tip] .highcharts-tooltip-box, [data-cx-tip] .highcharts-label-box { display: none !important; } /* the chart's own frame: the card inside carries it */
      .highcharts-tooltip-container[data-cx-tip] .tw-bg-background-tooltip { border-radius: 10px; }
      html[theme="dark"] [data-cx-tip] .span-tooltip-divider { background-color: rgb(255 255 255 / .08) !important; border-color: rgb(255 255 255 / .08) !important; }
      html:not([theme="dark"]) [data-cx-tip]:not(.highcharts-tooltip-container), html:not([theme="dark"]) .highcharts-tooltip-container[data-cx-tip] .tw-bg-background-tooltip { border-radius: 10px; box-shadow: 0 0 0 1px rgb(0 0 0 / .08), 0 16px 40px rgb(0 0 0 / .16) !important; }`;
    st.textContent += LIGHT_TIPS.join("\n");
    doc.head?.append(st);
    let cur = null, undo = null, tips = [];
    // undoing a row's state restores the class it had when applied, liveRows' hover mark included: re-sync the marks
    const revert = () => { tips.forEach((el) => el.removeAttribute("data-cx-tip")); undo?.(); undo = null; cur = null; tips = []; box.classList.remove("is-hovering"); doc.__cxSyncRows?.(); };
    // The floating box inside what a state added: an element the app placed by pixel left/top (the trace drawer's
    // span card, a Highcharts readout), or one it moves with a transform (Tippy's cards, APM's honeycomb, sit at
    // inset 0 0 auto auto and carry translate(): placed the same way, see place())
    const positioned = (el) => {
      const st = el.style; if (!st) return null;
      const abs = () => /^(absolute|fixed)$/.test(doc.defaultView.getComputedStyle(el).position);
      if (el.hasAttribute("data-tippy-root") || (/translate|matrix/.test(st.transform || "") && /^0px/.test(st.inset || "") && abs())) return "transform";
      if (/px$/.test(st.left) && /px$/.test(st.top) && !/translate|matrix/.test(st.transform || "") && abs()) return "offset";
      return null;
    };
    const floating = (nodes) => {
      const out = [];
      for (const n of nodes) {
        const q = [n];
        for (let k = 0; k < q.length && k < 12; k++) {
          const el = q[k];
          if (el.nodeType !== 1) continue;
          const how = positioned(el);
          if (how) { el.__cxHow = how; out.push(el); break; }
          q.push(...el.children);
        }
      }
      return out;
    };
    // the part of the app the window shows (data-cam crops it): a card kept inside the app could still open
    // outside the window's frame
    const shown = () => shownPart(box, doc);
    // beside the pointer: to its right with the arrow (when the card has one) at the pointer, flipped to the left
    // near the window's right edge, and kept inside the window top to bottom
    // Every card opens from the pointer: to its right (with its arrow, when it has one, at the pointer), flipped to
    // the left near the frame's right edge, and kept inside the frame top to bottom. The card's own origin is
    // measured first (left/top 0, or no transform), so whatever box it is positioned against, it lands where meant;
    // writing left/top onto a Tippy card while its transform still applied is what once threw those off screen.
    const place = (el, x, y) => {
      const f = shown(), pad = 8, gap = 14;
      const w = el.offsetWidth, h = el.offsetHeight;
      const arrow = el.__cxHow === "offset" ? [...el.children].find((c) => c.style?.insetBlockStart) : null;
      if (arrow && !arrow.dataset.cxAt) arrow.dataset.cxAt = parseFloat(arrow.style.insetBlockStart) || 0;
      el.querySelectorAll(".tippy-arrow, [data-popper-arrow]").forEach((a) => (a.style.visibility = "hidden")); // it pointed at the app's own spot
      const ah = arrow ? arrow.offsetHeight || 10 : 0;
      let left = x + gap, flip = false;
      if (left + w > f.r - pad) { left = Math.max(f.l + pad, x - gap - w); flip = true; }
      let top = arrow ? y - +arrow.dataset.cxAt - ah / 2 : y - Math.min(h / 2, 28); // no arrow: just above the pointer's line
      top = Math.max(f.t + pad, Math.min(f.b - h - pad, top));
      if (el.__cxHow === "transform") {
        el.style.inset = "0px auto auto 0px"; el.style.transform = "none";
        const o = el.getBoundingClientRect();
        el.style.transform = `translate(${Math.round(left - o.left)}px, ${Math.round(top - o.top)}px)`;
      } else {
        el.style.translate = "none"; el.style.left = "0px"; el.style.top = "0px";
        const o = el.getBoundingClientRect();
        el.style.left = `${Math.round(left - o.left)}px`; el.style.top = `${Math.round(top - o.top)}px`;
      }
      if (arrow) { arrow.style.visibility = flip ? "hidden" : ""; arrow.style.insetBlockStart = `${Math.max(8, Math.min(h - ah - 8, y - top - ah / 2))}px`; }
    };
    const apply = (h, e) => {
      revert();
      if (h.id != null && !mirror.getNode(h.id)) return; // a state's own chart readouts have no target node (liveClicks)
      const r = applyDiff(doc, mirror, h);
      undo = r.undo;
      tips = floating(r.nodes); // a span card, a chart's readout (Highcharts' tooltip container), a Tippy card
      // a recorded tooltip the state moved and showed rather than added (the app reuses its tooltip element)
      for (const a of h.attrs || []) {
        if (a.name !== "style" || !/left:\s*-?[\d.]+px/.test(a.v || "")) continue;
        const el = mirror.getNode(a.id);
        if (!el?.style || tips.includes(el) || !(el.innerText || "").trim() || !el.getClientRects().length) continue;
        // read where the state leaves it, not where the app's own fade-in has got to (it starts at opacity 0, and a card
        // shown from nothing was skipped and stayed at its recorded spot instead of following the pointer)
        const was = el.style.transition; el.style.transition = "none";
        const cs = doc.defaultView.getComputedStyle(el), vis = cs.visibility, op = cs.opacity, pos = cs.position;
        el.style.transition = was;
        if (vis === "hidden" || op === "0" || !/^(absolute|fixed)$/.test(pos)) continue;
        const how = positioned(el); if (how) { el.__cxHow = how; tips.push(el); }
      }
      tips.forEach((el) => el.setAttribute("data-cx-tip", ""));
      if (e) tips.forEach((el) => place(el, e.clientX, e.clientY));
      cur = h; box.classList.add("is-hovering");
    };
    const live = () => !!box.dataset.still || box.classList.contains("is-live");
    // the smallest target whose box holds the pointer, but one that holds the element actually under the pointer
    // first: a pie's wedges have overlapping boxes, and the smallest box alone answered a wedge with its neighbour's
    const pick = (x, y) => {
      const hit = doc.elementFromPoint(x, y);
      let best = null, area = Infinity, held = false;
      for (const h of states) {
        const el = mirror.getNode(h.id); if (!el?.getBoundingClientRect) continue;
        const r = el.getBoundingClientRect();
        if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
        if (h.band) { const f = (x - r.left) / r.width; if (f < h.band[0] || f >= h.band[1]) continue; }
        const a = r.width * r.height * (h.band ? h.band[1] - h.band[0] : 1);
        const holds = !!hit && (el === hit || !!el.contains?.(hit));
        if ((holds && !held) || (holds === held && a < area)) { area = a; best = h; held = holds; }
      }
      return best;
    };
    doc.addEventListener("mousemove", (e) => {
      if (!live()) { if (cur) revert(); return; }
      // over an open menu (liveClicks): the app behind it doesn't answer, as in the app
      if (doc.__cxInMenu?.(e.target)) { if (cur) revert(); return; }
      const h = pick(e.clientX, e.clientY) || doc.__cxMoreHovers?.(e.clientX, e.clientY) || null;
      if (h !== cur) h ? apply(h, e) : revert();
      else tips.forEach((el) => place(el, e.clientX, e.clientY));
    });
    doc.addEventListener("mouseleave", revert);
    box.addEventListener("pointerleave", revert);
    doc.__cxResetHovers = revert;
  }

  // the part of the app a window shows (data-cam crops it), in the app's own coordinates
  function shownPart(box, doc) {
    const W = doc.documentElement.clientWidth, H = doc.documentElement.clientHeight;
    const stage = box.querySelector(".cxr-stage"), br = box.getBoundingClientRect();
    const m = stage && new DOMMatrixReadOnly(getComputedStyle(stage).transform);
    if (!m || !m.a) return { l: 0, t: 0, r: W, b: H };
    return { l: Math.max(0, -m.e / m.a), t: Math.max(0, -m.f / m.d), r: Math.min(W, (br.width - m.e) / m.a), b: Math.min(H, (br.height - m.f) / m.d) };
  }

  // ───── Rows and menu items under the pointer ─────
  // The app marks the row the pointer is on with a class its own script sets (ag-grid's .ag-row-hover: the row's
  // tint, and the row's hover-only buttons), and the option a menu's pointer is on with data-active; a replay runs
  // none of that script, so rows and menu items sat flat under the pointer. Here they get the same marks, on the
  // row's every part (a grid splits a row into pinned and scrolling containers that share its row-index). Menu
  // items also get data-cx-hover with the app's own hover colour behind it, since a still's trimmed stylesheet may
  // have dropped the data-active rule (no item was active when it was baked).
  const escapeOut = () => dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  function liveRows(box, player) {
    const doc = player.iframe?.contentDocument;
    if (!doc || doc.__cxRows) return;
    doc.__cxRows = true;
    const st = doc.createElement("style");
    // (and the same colour behind a hovered row, for stills whose stylesheet kept no row-hover rule of the theme's)
    st.textContent = `:is([role=option], [role=menuitem], [role=menuitemradio], [role=menuitemcheckbox])[data-cx-hover] { background-color: var(--c-background-hover, rgb(127 127 127 / .14)) !important; cursor: pointer; }
      .ag-row.ag-row-hover:not(.ag-full-width-row) { background-color: var(--c-background-hover, rgb(127 127 127 / .1)); }
      .cgx-grid .ag-row.ag-row-hover:not(.ag-full-width-row) { box-shadow: inset 0 0 0 100vmax var(--c-background-hover, rgb(127 127 127 / .1)); }`; /* a dashboard widget's grid keeps its rows transparent, more specifically */
    doc.head?.append(st);
    const live = () => !!box.dataset.still || box.classList.contains("is-live");
    let rows = [], item = null;
    const clearRows = () => { rows.forEach((r) => r.classList.remove("ag-row-hover")); rows = []; };
    const clearItem = () => { if (item) { item.removeAttribute("data-cx-hover"); if (item.__cxSetActive) { item.removeAttribute("data-active"); item.__cxSetActive = false; } } item = null; };
    doc.addEventListener("mouseover", (e) => {
      if (!live()) { clearRows(); clearItem(); return; }
      const t = e.target;
      const row = t.closest?.(".ag-row:not(.ag-header-row)");
      if (!row) clearRows();
      else if (!rows.includes(row)) {
        clearRows();
        const grid = row.closest(".ag-root") || doc, i = row.getAttribute("row-index");
        rows = i == null ? [row] : [...grid.querySelectorAll(`.ag-row[row-index="${i}"]`)];
        rows.forEach((r) => r.classList.add("ag-row-hover"));
      }
      const it = t.closest?.("[role=option], [role=menuitem], [role=menuitemradio], [role=menuitemcheckbox]");
      if (it !== item) {
        clearItem();
        if (it) { item = it; it.setAttribute("data-cx-hover", ""); if (!it.hasAttribute("data-active")) { it.setAttribute("data-active", ""); it.__cxSetActive = true; } }
      }
    });
    // a click in the app puts the keyboard in its frame, where the page never hears Escape: the zoom view stayed
    // open, and the page under it locked (html.cxz-open). Whatever the app doesn't use Escape for goes up to the page
    doc.addEventListener("keydown", (e) => { if (e.key === "Escape" && !doc.__cxClicks) escapeOut(); });
    const off = () => { clearRows(); clearItem(); };
    // only the rows under the pointer keep the mark (a hover state's undo can put back one it had recorded)
    doc.__cxSyncRows = () => doc.querySelectorAll(".ag-row-hover").forEach((r) => { if (!rows.includes(r)) r.classList.remove("ag-row-hover"); });
    doc.addEventListener("mouseleave", off);
    box.addEventListener("pointerleave", off);
  }

  // ───── Live controls: what the app's own buttons do, recorded by capture.mjs s.clicks() ─────
  // Clicking a recorded control applies its state: a menu or popover opens over the current view and closes on
  // Escape or a click outside it (an option in it applies its own state); a view, highlight or selected row replaces
  // the current one; a toggle turns off on a second click; ↑ ↓ step through the selectable rows. Baked stills keep
  // these states in their own file (<meta name="cx-states">), fetched once a visitor points at the window.
  // control states store repeated parts once (tools/replay/states.mjs pack): { ref: i } points into `shared`.
  // Resolved by reference, so a panel recorded for 20 spans is one object in memory
  function unpackStates(clicks, shared) {
    if (!clicks || !shared) return clicks;
    const get = (v) => (v && typeof v === "object" && !Array.isArray(v) && "ref" in v ? shared[v.ref] : v);
    // a shared block holds no refs (pack stores it whole), so it's used as is, never copied
    const node = (n) => ("ref" in n ? shared[n.ref] : n.childNodes ? { ...n, childNodes: n.childNodes.map(node) } : n);
    const one = (h) => ({ ...h, add: (h.add || []).map((a) => ({ ...a, node: node(a.node) })), del: get(h.del), attrs: get(h.attrs), text: get(h.text) });
    return clicks.map((c) => ({ ...one(c), hovers: c.hovers?.map(one) }));
  }
  function liveClicks(box, player, { states, shared, url, get }) {
    const doc = player.iframe?.contentDocument, mirror = player.getMirror?.();
    if (!doc || !mirror || doc.__cxClicks || (!states && !url)) return;
    doc.__cxClicks = true; // interactive stills (below) leave the span card, selection and filter to these states
    let list = states ? unpackStates(states, shared) : null, loading = null;
    const load = () => (list ? Promise.resolve(list) : (loading ||= (get ? get() : fetch(url).then((r) => r.json())).then((j) => (list = unpackStates(j.clicks, j.shared) || [])).catch(() => (list = []))));
    box.addEventListener("pointerenter", load, { once: true }); // a tap fires it too, just before its click
    let base = null, over = null; // the view in place, and the menu open over it
    const live = () => !!box.dataset.still || box.classList.contains("is-live");
    const close = () => { over?.undo(); over = null; };
    const clear = () => { close(); base?.undo(); base = null; };
    // a view that opened a drawer or a dialog over the whole app: Escape or a click on its dim backdrop closes it,
    // as in the app (a view in place otherwise stays until another control replaces it)
    const MODAL = ".cdk-overlay-backdrop, cxui-slide-in-dialog-container, mat-dialog-container, [role=dialog]";
    const modal = () => !!base?.nodes?.some((n) => n.nodeType === 1 && (n.matches?.(MODAL) || n.querySelector?.(MODAL)));
    // A menu opens against its button as the button is now, not where the recording had it: the app placed the menu
    // for its own layout at that moment (the ⋮ menus opened 74px under their buttons, more once the visitor had
    // scrolled the app a few rows). Below the button, above it when the frame has no room below, on the side the
    // app opened it.
    const anchor = (nodes, trigger) => {
      if (!trigger?.getBoundingClientRect) return null;
      const MENU = "[role=menu], [role=listbox]"; // a dialog (a "See all" panel) stays where the app put it
      let menu = null;
      for (const n of nodes) { if (n.nodeType !== 1) continue; menu = n.matches?.(MENU) ? n : n.querySelector?.(MENU); if (menu) break; }
      if (!menu || menu.contains(trigger)) return null;
      let el = menu; // move what the app positioned: the menu, or the overlay pane around it
      for (let a = menu; a && a !== doc.body; a = a.parentElement) if (/^(absolute|fixed)$/.test(doc.defaultView.getComputedStyle(a).position)) { el = a; break; }
      const tr = trigger.getBoundingClientRect(), mr = menu.getBoundingClientRect();
      if (!mr.width || !mr.height) return null;
      const f = shownPart(box, doc), pad = 6, gap = 4;
      let top = tr.bottom + gap;
      if (top + mr.height > f.b - pad && tr.top - gap - mr.height >= f.t + pad) top = tr.top - gap - mr.height;
      top = Math.max(f.t + pad, Math.min(f.b - pad - mr.height, top)); // taller than the room on either side: kept in the frame
      let left = mr.left + mr.width / 2 >= tr.left + tr.width / 2 ? tr.left : tr.right - mr.width;
      left = Math.max(f.l + pad, Math.min(f.r - pad - mr.width, left));
      const was = el.style.translate, [x0 = 0, y0 = 0] = (was || "").split(/\s+/).map(parseFloat).filter((v) => !isNaN(v));
      el.style.translate = `${Math.round(x0 + left - mr.left)}px ${Math.round(y0 + top - mr.top)}px`;
      return () => (el.style.translate = was);
    };
    const show = (h, menu) => {
      doc.__cxResetHovers?.(); // a tooltip from the old view would stay on top of the new one
      if (menu) {
        close();
        over = { h, ...applyDiff(doc, mirror, h, { follow: false }) };
        const back = !h.parent && anchor(over.nodes, mirror.getNode(h.id));
        if (back) { const undo = over.undo; over.undo = () => { back(); undo(); }; }
        return;
      }
      clear();
      if (h.kind !== "reset") base = { h, ...applyDiff(doc, mirror, h, { follow: false }) };
    };
    // the smallest recorded control that holds the clicked element
    const control = (t) => {
      let best = null, area = Infinity;
      for (const h of list) {
        if (h.parent) continue;
        const el = mirror.getNode(h.id);
        if (!el?.contains?.(t) || !el.isConnected) continue;
        const r = el.getBoundingClientRect(), a = r.width * r.height;
        if (a < area) { area = a; best = h; }
      }
      return best;
    };
    const step = (dir) => {
      const rows = list.filter((h) => h.kind === "select" && mirror.getNode(h.id)?.isConnected)
        .map((h) => ({ h, y: mirror.getNode(h.id).getBoundingClientRect().top })).sort((a, b) => a.y - b.y).map((x) => x.h);
      if (!rows.length) return;
      let i = rows.indexOf(base?.h);
      if (i < 0) i = rows.findIndex((h) => /selected/.test(mirror.getNode(h.id).getAttribute?.("class") || "")); // the recorded frame's own selection
      show(rows[Math.max(0, Math.min(rows.length - 1, i + dir))]);
    };
    const said = (t, label, stop) => { for (let n = t; n && n !== stop; n = n.parentElement) if (n.textContent?.trim().replace(/\s+/g, " ") === label) return true; return false; };
    doc.addEventListener("click", (e) => {
      if (!live()) return;
      const t = e.target, done = () => { e.preventDefault(); e.stopImmediatePropagation(); };
      // a row's chevron collapses it (interactive stills, below), it doesn't select it
      const row = t.closest?.(".gantt-row"), name = row?.querySelector(".span-name-wrapper");
      if (name && e.clientX < name.getBoundingClientRect().left) { close(); return; }
      if (!list) { done(); load().then(() => act(t, done)); return; } // a tap before the states arrived: answered when they do
      act(t, done);
    }, true);
    const act = (t, done) => {
      if (over) {
        const menu = over.nodes.find((n) => n.contains?.(t));
        if (menu) { // inside the open menu: an option with its own state, or an item that closes it
          done();
          const opt = list.find((h) => h.parent === over.h.name && said(t, h.label, menu.parentNode));
          if (opt) show(opt, opt.kind === "menu");
          else if (t.closest?.("[role=menuitem], [role=option], button, a")) close();
          return;
        }
      }
      // a close button inside the view in place (the Columns panel's ×): the view goes, as in the app
      const x = base && t.closest?.("button, [role=button]");
      if (x && base.nodes?.some((n) => n.contains?.(x)) && /^(close|dismiss|cancel)$/i.test((x.getAttribute("aria-label") || x.getAttribute("title") || x.textContent || "").trim())) { done(); clear(); return; }
      // the dim layer beside it: cdk's backdrop, or the slide-in drawer's own (it has no cdk backdrop)
      if (!over && t.closest?.(".cdk-overlay-backdrop, [data-testid=slide-in-backdrop]") && modal()) { done(); clear(); return; }
      const h = control(t);
      if (!h) { if (over) { done(); close(); } return; }
      done();
      if (h.kind === "next" || h.kind === "prev") { close(); step(h.kind === "next" ? 1 : -1); return; }
      if (h.kind === "menu") { if (over?.h === h) close(); else show(h, true); return; }
      if (h.kind === "toggle" && base?.h === h) { clear(); return; }
      show(h);
    };
    doc.addEventListener("keydown", (e) => { if (e.key !== "Escape") return; if (over) close(); else if (modal()) clear(); else escapeOut(); });
    doc.__cxResetClicks = clear;
    doc.__cxInMenu = (t) => !!over?.nodes.some((n) => n.contains?.(t)); // liveHovers stays quiet over an open menu
    // the view in place may bring its own chart readouts (a selected span's duration heatmap), placed by position
    doc.__cxMoreHovers = (x, y) => {
      for (const s of base?.h.hovers || []) {
        const [l, t, w, hh] = s.rect;
        if (x < l || x > l + w || y < t || y > t + hh) continue;
        const f = (x - l) / w;
        if (f >= s.band[0] && f < s.band[1]) return s;
      }
      return null;
    };
  }

  // the page's head preloads a baked still's files (tools/build.mjs bakedPreload) as fetches: take them, so Chrome
  // doesn't warn they went unused; the window's frame then gets the same files from the HTTP cache
  document.querySelectorAll("link[rel=preload][data-cx-baked]").forEach((l) => fetch(l.href, { mode: "cors", credentials: "same-origin" }).catch(() => {}));
  window.cxrMount = mount; // the zoom view mounts its own copy
  document.querySelectorAll("[data-replay]").forEach(mount);
  document.querySelectorAll("[data-replay][data-tips]").forEach(tips);

  // ───── Tips: data-tips='[{"sel": "...", "text": "...", "title": "...", "body": "...", "at": [ms, ms]}]' ─────
  // A pulsing dot on an element of the replayed app (sel: a CSS selector inside the app, text: the element whose own
  // text contains it, else x/y in app px) that opens a short card on hover, focus or tap. Dots follow the element
  // through the camera and the visitor's scrolling; `at` limits a dot to that stretch of a clip.
  function tips(box) {
    let list;
    try { list = JSON.parse(box.dataset.tips); } catch { return; }
    if (!Array.isArray(list) || !list.length) return;
    const layer = document.createElement("div"), card = document.createElement("div");
    layer.className = "cxr-tips"; card.className = "cxr-tip-card"; card.setAttribute("role", "tooltip");
    card.id = "cxr-tip-" + Math.random().toString(36).slice(2, 8);
    layer.append(card);
    const dots = list.map((tip) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "cxr-tip" + (tip.title || tip.body ? "" : " is-hint"); b.setAttribute("aria-label", tip.title || tip.body || "Hover for details");
      b.setAttribute("aria-describedby", card.id);
      layer.append(b);
      return { tip, b, el: null, seen: 0 };
    });
    box.append(layer);
    let open = null, pinned = false;
    const place = (d) => {
      card.innerHTML = (d.tip.title ? `<b>${d.tip.title}</b>` : "") + (d.tip.body ? `<span>${d.tip.body}</span>` : "");
      const bw = box.clientWidth, bh = box.clientHeight, x = parseFloat(d.b.style.left), y = parseFloat(d.b.style.top);
      card.style.maxWidth = Math.min(280, bw - 24) + "px";
      const cw = card.offsetWidth, ch = card.offsetHeight, below = y - ch - 18 < 8;
      card.style.left = Math.max(8, Math.min(bw - cw - 8, x - cw / 2)) + "px";
      card.style.top = (below ? Math.min(bh - ch - 8, y + 18) : y - ch - 18) + "px";
    };
    const show = (d, pin) => { open = d; pinned = !!pin; place(d); layer.classList.add("is-open"); dots.forEach((o) => o.b.classList.toggle("is-on", o === d)); };
    const hide = () => { open = null; pinned = false; layer.classList.remove("is-open"); dots.forEach((o) => o.b.classList.remove("is-on")); };
    for (const d of dots) {
      d.b.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") show(d); });
      d.b.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && !pinned) hide(); });
      d.b.addEventListener("focus", () => show(d));
      d.b.addEventListener("blur", () => { if (!pinned) hide(); });
      d.b.addEventListener("click", (e) => { e.stopPropagation(); open === d && pinned ? hide() : show(d, true); });
    }
    document.addEventListener("click", (e) => { if (pinned && !layer.contains(e.target)) hide(); });
    const find = (doc, tip) => {
      if (!tip.sel && !tip.text) return null;
      const all = doc.querySelectorAll(tip.sel || "body *");
      for (const el of all) {
        if (tip.text && ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.includes(tip.text))) continue;
        const r = el.getBoundingClientRect();
        if (r.width && r.height) return el;
      }
      return null;
    };
    let raf = 0, visible = false;
    const tick = (now) => {
      raf = visible ? requestAnimationFrame(tick) : 0;
      const stage = box.querySelector(".cxr-stage"), doc = box.querySelector("iframe")?.contentDocument;
      const ready = stage && doc && box.classList.contains("is-ready") && !box.classList.contains("is-zoomed");
      layer.classList.toggle("is-ready", !!ready);
      if (!ready) return;
      const m = new DOMMatrixReadOnly(getComputedStyle(stage).transform), t = box.cxr?.player?.getCurrentTime?.() ?? 0;
      const bw = box.clientWidth, bh = box.clientHeight;
      for (const d of dots) {
        let x = d.tip.x, y = d.tip.y;
        if (d.tip.sel || d.tip.text) {
          if (!d.el?.isConnected || now - d.seen > 600) { d.el = find(doc, d.tip); d.seen = now; }
          if (d.el) { const r = d.el.getBoundingClientRect(); x = r.left + r.width * (d.tip.ax ?? 0.5); y = r.top + r.height * (d.tip.ay ?? 0.5); } else x = y = undefined;
        }
        const bx = m.e + (x ?? NaN) * m.a + (d.tip.dx || 0), by = m.f + (y ?? NaN) * m.d + (d.tip.dy || 0);
        const inTime = !d.tip.at || (t >= d.tip.at[0] && t <= d.tip.at[1]);
        const on = inTime && bx >= 10 && by >= 10 && bx <= bw - 10 && by <= bh - 10;
        d.b.hidden = !on;
        if (on) { d.b.style.left = bx.toFixed(1) + "px"; d.b.style.top = by.toFixed(1) + "px"; }
        if (open === d) on ? place(d) : hide();
      }
    };
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !raf) raf = requestAnimationFrame(tick); }).observe(box);
  }
  window.cxrTips = tips; // the zoom view's copy gets its own
})();

// ───── Light/Dark toggle in a window's title bar: [data-cxr-theme] switches the app inside that window ─────
window.cxrTheme = (btn) => {
  const box = btn.closest(".cxw")?.querySelector(".cxr");
  if (!box) return;
  const win = btn.closest(".cxw");
  const show = () => {
    const t = box.dataset.theme || (document.documentElement.dataset.theme === "light" ? "light" : "dark");
    btn.dataset.mode = t;
    win.dataset.skin = t; // the frame (title bar, border) matches the app inside it
    btn.setAttribute("aria-label", t === "light" ? "Show the app in dark mode" : "Show the app in light mode");
  };
  btn.addEventListener("click", () => { box.dataset.theme = btn.dataset.mode === "light" ? "dark" : "light"; box.paint?.(); show(); });
  show();
  new MutationObserver(show).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  new MutationObserver(() => { box.paint?.(); show(); }).observe(box, { attributes: true, attributeFilter: ["data-theme"] }); // set from the zoom view
};
document.querySelectorAll("[data-cxr-theme]").forEach(window.cxrTheme);

// ───── Interactive stills: [data-interactive] lets visitors hover and click the frozen app ─────
// The replay is the app's real DOM (its CSS hover states work as-is) but none of its JavaScript, so this
// re-creates the trace drawer's main interactions: hover card on a span, select a span, collapse/expand
// a subtree, and the All / Errors filter. A clip with recorded controls (liveClicks above) gets the app's own span
// card, selection and filter from those instead; collapsing stays here.
(() => {
  const CARD = `position:fixed;z-index:9999;pointer-events:none;min-width:260px;max-width:380px;padding:12px 14px;border-radius:10px;
    background:#25262b;border:1px solid rgba(255,255,255,.12);box-shadow:0 16px 40px rgba(0,0,0,.55);
    font:12.5px/1.5 "Nunito Sans",sans-serif;color:#e6e7ea;opacity:0;transition:opacity .12s;`;
  const LIGHT = "background:#fff;border-color:rgba(0,0,0,.12);color:#1d1f22;box-shadow:0 16px 40px rgba(0,0,0,.18);";
  function wire(box) {
    const doc = box.querySelector("iframe")?.contentDocument;
    if (!doc || doc.__cxInteractive) return;
    doc.__cxInteractive = true;
    const st = doc.createElement("style");
    st.textContent = `.gantt-row { cursor: pointer; } .cx-hide, [data-cx-hide] { display: none !important; }`;
    doc.head.append(st);
    const card = doc.createElement("div");
    doc.body.append(card);
    const rows = () => [...doc.querySelectorAll(".gantt-row")];
    const segs = () => [...doc.querySelectorAll("button")].filter((b) => /^(All|Errors)$/.test(b.textContent.trim()));
    // what the recording showed before the visitor changed anything, so a playing clip can resume cleanly
    let orig = null;
    const remember = () => { orig ||= { sel: rows().find((r) => r.classList.contains("selected-span-row")), act: segs().filter((b) => b.classList.contains("active")) }; };
    const scrolled = new Map(); // panels the visitor scrolled, and where the recording had them
    const own = () => !!doc.__cxClicks; // the app's own states (liveClicks) do the rest
    // a clip that was paused resets on its own way out, but a still has no such moment: without this, anything
    // the visitor scrolled or selected stayed that way for the rest of the visit
    // A first-fold still keeps its few rows of scrolling, though: jumping back the moment the pointer left read as a
    // glitch, and the scroll can't stray more than a few rows from the recorded frame anyway (see the wheel below)
    const first = !!box.dataset.still && !!box.closest(".page-hero");
    box.addEventListener("pointerleave", () => doc.__cxReset?.({ keepScroll: first }));
    // the recording's own chart readout stays where the recording left it: once the visitor scrolls a panel it
    // would float off its chart, so it hides until the scroll is undone (a live hover's readout is data-cx-tip)
    const off = doc.createElement("style");
    off.textContent = `html[data-cx-scrolled] .highcharts-tooltip-container:not([data-cx-tip]), html[data-cx-scrolled] .cdk-overlay-pane:has(cxui-chart-tooltip):not(:has([data-cx-tip])) { visibility: hidden !important; }`;
    doc.head?.append(off);
    doc.__cxReset = ({ keepScroll } = {}) => {
      doc.__cxResetClicks?.();
      card.style.opacity = "0";
      if (!keepScroll) { scrolled.forEach((top, el) => (el.scrollTop = top)); scrolled.clear(); doc.documentElement?.removeAttribute("data-cx-scrolled"); }
      if (!orig) return;
      rows().forEach((r) => { r.classList.remove("cx-hide"); r.removeAttribute("data-cx-hide"); if (!own()) r.classList.toggle("selected-span-row", r === orig.sel); delete r.dataset.cxCollapsed; });
      segs().forEach((b) => b.classList.toggle("active", orig.act.includes(b)));
      orig = null;
    };
    const indent = (r) => r.querySelector(".span-name-wrapper")?.getBoundingClientRect().left ?? 0;
    const info = (r) => {
      const name = r.querySelector(".span-name-wrapper")?.textContent.trim().replace(/\s+/g, " ") || "";
      const dur = (r.textContent.match(/([\d.]+\s?(?:ms|µs|s))\s*\(([\d.]+%)\)/) || []);
      const err = r.classList.contains("error-span-row");
      return { name, dur: dur[1] || "", pct: dur[2] || "", err };
    };
    const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
    const show = (r, x, y) => {
      const { name, dur, pct, err } = info(r);
      const status = (name.match(/^(\d+ [A-Z]+|POST|GET)/) || [""])[0];
      const op = name.replace(/^(POST\s+)?(\d{3}\s+)?(\d+ [A-Z]+\s+)?/, "");
      card.style.cssText = CARD + (box.dataset.theme === "light" || doc.documentElement.getAttribute("theme") === "light" ? LIGHT : "");
      card.innerHTML = `<div style="font-weight:700;font-size:13.5px;margin-bottom:6px">${esc(op)}</div>` +
        (err ? `<div style="color:#f87171;margin-bottom:6px">● Error${/payments|Charge|PlaceOrder/.test(op) ? ": missing Idempotency-Key header" : ""}</div>` : `<div style="color:#34d399;margin-bottom:6px">● OK</div>`) +
        (dur ? `<div style="opacity:.8">Duration <b>${dur}</b> (${pct} of total trace)</div>` : "") +
        `<div style="opacity:.55;margin-top:6px;font-size:11.5px">Click to select · click ▸ to collapse</div>`;
      const W = doc.documentElement.clientWidth;
      card.style.left = Math.min(x + 16, W - 400) + "px"; card.style.top = y + 18 + "px"; card.style.opacity = "1";
    };
    doc.addEventListener("mousemove", (e) => {
      if (own()) return;
      const r = e.target.closest?.(".gantt-row");
      if (r) show(r, e.clientX, e.clientY); else card.style.opacity = "0";
    });
    doc.addEventListener("mouseleave", () => (card.style.opacity = "0"));
    // Only the first fold's window scrolls the app in the page, and only a few rows: a panel moves at most three of
    // its own rows away from where the recording had it, either way, so the visitor can always scroll back; past
    // that, or at the panel's end, the wheel scrolls the page. Windows further down leave the wheel to the page:
    // scrolling down past them never gets caught. The zoom view has no limit.
    const reach = new Map(); // panel → how far it may move from its recorded position
    const scroller = (el, dy) => {
      for (; el && el !== doc.documentElement; el = el.parentElement) {
        if (!/(auto|scroll)/.test(doc.defaultView.getComputedStyle(el).overflowY) || el.scrollHeight <= el.clientHeight + 1) continue;
        if (dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0) return el;
      }
      return null;
    };
    // the rest goes to whatever scrolls around the window: the page, or a scrolling dialog it sits in
    // three of the panel's own rows (a table's, a list's), within reason; a panel without rows: about three lines
    const rowsOf = (el) => {
      const hs = [...el.querySelectorAll('[role=row], tr, .ag-row, .gantt-row, [class*="row"]')].slice(0, 40)
        .map((r) => r.getBoundingClientRect().height).filter((h) => h >= 16 && h <= 90).sort((a, b) => a - b);
      return Math.max(72, Math.min(200, 3 * (hs[hs.length >> 1] || 40)));
    };
    const hostScroll = (dy) => {
      for (let el = box.parentElement; el && el !== document.body; el = el.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1) { el.scrollTop += dy; return; }
      }
      window.scrollBy({ top: dy, left: 0, behavior: "instant" });
    };
    // A finger can't be given a few rows and then the page mid-swipe, so on a touch screen the page gets the whole
    // swipe: the panels under the finger stop scrolling until it lifts, and the gesture carries on to the page.
    // Otherwise a swipe on the hero ran the app to its panel's end and the page stood still.
    doc.addEventListener("touchstart", (e) => {
      if (box.closest(".cxz")) return; // the zoom view keeps the app's own scrolling
      // (and a panel that contains its overscroll, like the app's tables, would keep the swipe from reaching the page)
      const held = [];
      for (let el = e.target; el && el !== doc.documentElement; el = el.parentElement) {
        if (el.nodeType !== 1) continue;
        const cs = doc.defaultView.getComputedStyle(el), scrolls = /(auto|scroll)/.test(cs.overflowY), contains = cs.overscrollBehaviorY !== "auto";
        if (!scrolls && !contains) continue;
        held.push([el, el.style.overflowY, el.style.overscrollBehaviorY]);
        if (scrolls) el.style.overflowY = "hidden";
        if (contains) el.style.overscrollBehaviorY = "auto";
      }
      const free = () => { held.forEach(([el, o, b]) => { el.style.overflowY = o; el.style.overscrollBehaviorY = b; }); doc.removeEventListener("touchend", free); doc.removeEventListener("touchcancel", free); };
      doc.addEventListener("touchend", free); doc.addEventListener("touchcancel", free);
    }, { passive: true });
    doc.addEventListener("wheel", (e) => {
      const zoomed = !!box.closest(".cxz");
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1);
      // scroll it here rather than leaving it to the browser, which sometimes picks no panel at all inside the
      // replay (no app code runs there) and drops the wheel: the page would stall over the window
      e.preventDefault();
      let rest = dy;
      const playing = !box.dataset.still && !box.classList.contains("is-live"); // a clip still playing: the page's
      // A still is framed by data-cam to show one thing: a few rows keep the subject in its frame and stop short of
      // a panel's empty tail. data-wheel="page" opts a window out entirely.
      const first = !!box.closest(".page-hero");
      // the panel under the pointer that can still move this way within its few rows. Only the first fold's window
      // scrolls its app by default; data-reach opts any other window in, once the visitor has paused it (a playing
      // clip still hands the wheel to the page, so scrolling past a window never catches on it)
      let el = !playing && (zoomed || first || !!box.dataset.reach) && box.dataset.wheel !== "page" && scroller(e.target, dy);
      if (el && !zoomed) {
        // data-reach on the window: "all" scrolls a panel to its end (a still recorded with its whole panel loaded),
        // a number allows that many app px; otherwise a few rows
        if (!reach.has(el)) reach.set(el, box.dataset.reach === "all" ? Infinity : +box.dataset.reach || rowsOf(el));
        const base = scrolled.has(el) ? scrolled.get(el) : el.scrollTop;
        if (!(dy > 0 ? el.scrollTop < base + reach.get(el) - 0.5 : el.scrollTop > base - reach.get(el) + 0.5)) el = null; // its rows are used up: the page's turn
      }
      if (el) doc.documentElement.setAttribute("data-cx-scrolled", "");
      if (zoomed) { if (el) { if (!scrolled.has(el)) scrolled.set(el, el.scrollTop); el.scrollTop += dy; } return; } // the zoom view: no limit, and the page behind stays put
      if (el) {
        if (!scrolled.has(el)) scrolled.set(el, el.scrollTop);
        const before = el.scrollTop, base = scrolled.get(el), r = reach.get(el);
        el.scrollTop = Math.max(base - r, Math.min(base + r, before + dy));
        const moved = el.scrollTop - before;
        rest = dy - moved; // what the panel couldn't take (its end, or its few rows) goes on to the page
      }
      if (Math.abs(rest) >= 1) hostScroll(rest);
    }, { passive: false });
    doc.addEventListener("click", (e) => {
      e.preventDefault();
      const t = e.target;
      // All / Errors filter
      let label = "", n = t;
      for (let k = 0; k < 4 && n && !label; k++, n = n.parentElement) { const x = n.textContent?.trim(); if (x === "Errors" || x === "All") label = x; }
      if (!label) { // a click on the segment's padding: pick the label under the pointer
        const hit = [...doc.querySelectorAll("button, span, div")].find((x) => /^(All|Errors)$/.test(x.textContent.trim()) && (() => { const b = x.getBoundingClientRect(); return e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom; })());
        if (hit) label = hit.textContent.trim();
      }
      if ((label === "Errors" || label === "All") && !own()) {
        remember();
        const btns = segs();
        btns.forEach((b) => b.classList.toggle("active", b.textContent.trim() === label)); // the segment's selected look
        rows().forEach((r) => r.classList.toggle("cx-hide", label === "Errors" && !r.classList.contains("error-span-row")));
        return;
      }
      const r = t.closest?.(".gantt-row");
      if (!r) return;
      remember();
      const name = r.querySelector(".span-name-wrapper");
      if (name && e.clientX < name.getBoundingClientRect().left) { // the chevron area: collapse / expand the subtree
        const all = rows(), i = all.indexOf(r), lvl = indent(r), kids = [];
        for (let j = i + 1; j < all.length && indent(all[j]) > lvl + 2; j++) kids.push(all[j]);
        const hide = !r.dataset.cxCollapsed;
        r.dataset.cxCollapsed = hide ? "1" : "";
        kids.forEach((k) => k.toggleAttribute("data-cx-hide", hide)); // an attribute the app's recorded states never touch
        return;
      }
      if (own()) return;
      rows().forEach((x) => x.classList.toggle("selected-span-row", x === r));
    }, true);
  }
  window.cxrInteract = (box) => {
    // A still reaches its moment by fast-forwarding, so its app arrives after the rebuild: wait for the player
    // to mark the stage settled. This used to wait for a .gantt-row instead, which only the Traces hero has —
    // so the other 34 hero stills were never wired at all. Nothing handled their wheel, and the browser scrolled
    // whatever panel was under the pointer, as far as it went, with nothing to put it back.
    const tryWire = (n = 0) => {
      const doc = box.querySelector("iframe")?.contentDocument;
      if (doc && (box.querySelector(".cxr-stage")?.dataset.settled || n >= 8)) return wire(box);
      if (n < 40) setTimeout(() => tryWire(n + 1), 250);
    };
    box.addEventListener("cxr:rebuilt", () => (box.dataset.still ? tryWire() : wire(box))); // also after the app is rebuilt on scrolling back
    box.addEventListener("cxr:live", () => wire(box)); // a playing clip, paused under the pointer
  };
  document.querySelectorAll(".cxr[data-interactive]").forEach(window.cxrInteract);
})();

// ───── Zoom: a button in each window's title bar opens the replay large, over the page ─────
// The zoom view mounts its own copy of the replay (an iframe can't be moved without reloading), starting
// where the window was; the window waits paused underneath. Clips get a player bar there (data-controls).
(() => {
  const ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9"/></svg>`;
  const CLOSE = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>`;
  let open = null;
  function close() {
    if (!open) return;
    const { layer, box, src, last, onKey } = open;
    if (box.dataset.theme) src.dataset.theme = box.dataset.theme; // a theme picked in the zoom view sticks
    box.cxrApi?.destroy();
    layer.remove();
    document.documentElement.classList.remove("cxz-open");
    removeEventListener("keydown", onKey);
    src.cxrApi?.hold(false);
    last?.focus({ preventScroll: true });
    open = null;
  }
  function zoom(win) {
    const src = win.querySelector(".cxr");
    if (!src || open) return;
    const layer = document.createElement("div");
    layer.className = "cxz";
    layer.setAttribute("role", "dialog"); layer.setAttribute("aria-modal", "true");
    layer.setAttribute("aria-label", win.getAttribute("aria-label") || "Product view");
    const fig = document.createElement("figure");
    fig.className = "cxw cxz-win";
    if (win.dataset.skin) fig.dataset.skin = win.dataset.skin;
    const bar = win.querySelector(".cxw-bar").cloneNode(true);
    const zb = bar.querySelector(".cxw-zoom");
    zb.className = "cxw-zoom cxw-close"; zb.innerHTML = CLOSE; zb.setAttribute("aria-label", "Close");
    zb.addEventListener("click", close);
    const box = document.createElement("div");
    box.className = "cxr";
    for (const a of ["data-replay", "data-baked", "data-still", "data-cam", "data-interactive", "data-theme", "data-poster", "data-tips"]) if (src.hasAttribute(a)) box.setAttribute(a, src.getAttribute(a));
    box.style.cssText = src.style.cssText;
    if (!src.dataset.still) { box.dataset.controls = ""; box.dataset.start = Math.round(src.cxrApi?.time() || 0); }
    fig.append(bar, box);
    layer.append(fig);
    const onKey = (e) => {
      if (e.key === "Escape") close();
      else if (e.key === " " && box.dataset.controls !== undefined && !/INPUT|BUTTON/.test(document.activeElement?.tagName)) { e.preventDefault(); box.cxrApi?.toggle(); }
    };
    layer.addEventListener("click", (e) => { if (e.target === layer) close(); });
    addEventListener("keydown", onKey);
    open = { layer, box, src, last: document.activeElement, onKey };
    src.cxrApi?.hold(true);
    document.documentElement.classList.add("cxz-open");
    document.body.append(layer);
    window.cxrMount(box);
    if (box.dataset.tips) window.cxrTips(box);
    if (box.hasAttribute("data-interactive")) window.cxrInteract(box);
    const tb = bar.querySelector("[data-cxr-theme]");
    if (tb) { const fresh = tb.cloneNode(true); tb.replaceWith(fresh); window.cxrTheme(fresh); fresh.addEventListener("click", () => (fig.dataset.skin = box.dataset.theme)); }
    zb.focus({ preventScroll: true });
  }
  document.querySelectorAll(".cxw").forEach((win) => {
    const bar = win.querySelector(".cxw-bar");
    if (!bar || !win.querySelector(".cxr")) return;
    const b = document.createElement("button");
    b.type = "button"; b.className = "cxw-zoom"; b.innerHTML = ICON; b.setAttribute("aria-label", "Open larger");
    b.addEventListener("click", () => zoom(win));
    bar.append(b);
  });
})();
