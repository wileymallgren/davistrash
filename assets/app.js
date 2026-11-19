(function () {
  "use strict";

  const DATA = window.BIN_DATA;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---- Bin kinds -----------------------------------------------------------
  // "cr" stations on the map hold compost and recycling together, "mb" are multi-bins.
  const KINDS = {
    compost: {
      label: "Compost",
      station: "cr",
      sub: "Food scraps and #7 PLA compostable cups and containers",
      nearest: "Nearest compost bin",
      verdict: "Compost bin",
    },
    recycle: {
      label: "Recycling",
      station: "cr",
      sub: "Bottles, cans, glass, paper and #1–6 plastic containers",
      nearest: "Nearest recycling bin",
      verdict: "Recycling bin",
    },
    multibin: {
      label: "Batteries and e-waste",
      station: "mb",
      sub: "Small batteries, phones, CDs and DVDs, small electronics, boxed toner",
      nearest: "Nearest multi-bin",
      verdict: "Multi-bin",
    },
  };
  const STATION_LABEL = { cr: "Compost and recycling station", mb: "Multi-bin for batteries and e-waste" };
  const STATION_COLOR = { cr: "var(--compost)", mb: "var(--multibin)" };
  const VERDICT = {
    compost: { title: "Compost bin", line: "Food scraps and compostable items go in a compost bin." },
    recycle: { title: "Recycling bin", line: "This goes in a recycling bin." },
    multibin: { title: "Multi-bin", line: "Drop this at a campus multi-bin. They take small batteries and electronics." },
    landfill: { title: "Trash", line: "This goes in the landfill bin." },
    special: { title: "Special handling", line: "This doesn't go in a campus bin. The steps are below." },
  };

  const ICON = {
    arrow: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
    back: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>',
    nav: '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>',
    ext: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
    locate: '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/></svg>',
  };

  // ---- Where the person is -------------------------------------------------
  // A QR code carries the can's coordinates as ?at=lat,lng
  let origin = null;
  const atParam = new URLSearchParams(location.search).get("at");
  if (atParam) {
    const [lat, lng] = atParam.split(",").map(Number);
    if (isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      origin = { lat, lng, source: "qr" };
    }
  }
  const fromQR = () => origin && origin.source === "qr";

  // ---- Geometry ------------------------------------------------------------
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  function dist(a, b) {
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  // Paths bend around buildings, so walking is roughly 1.3x the straight line at 80 m a minute
  const walkMin = (m) => Math.max(1, Math.round((m * 1.3) / 80));
  function feet(m) {
    const ft = m * 3.28084;
    if (ft < 1000) return `${Math.round(ft / 10) * 10} ft`;
    return `${(ft / 5280).toFixed(1)} mi`;
  }

  function nearest(kind, from, n = 3) {
    const seen = new Set();
    return DATA.stations
      .filter((s) => s.k === kind)
      .map((s) => ({ ...s, d: dist(from, s) }))
      .sort((a, b) => a.d - b.d)
      .filter((s) => {
        // The map has a few stations twice; keep the closer copy
        if (seen.has(s.n)) return false;
        seen.add(s.n);
        return true;
      })
      .slice(0, n);
  }

  function mapsUrl(to) {
    const p = new URLSearchParams({ api: "1", destination: `${to.lat},${to.lng}`, travelmode: "walking" });
    // From a QR code we know exactly where the can is. From GPS, let Maps use the live location.
    if (origin && origin.source !== "gps") p.set("origin", `${origin.lat},${origin.lng}`);
    return `https://www.google.com/maps/dir/?${p}`;
  }

  // ---- Map -----------------------------------------------------------------
  // Equirectangular projection to meters around the campus, then fit to the svg's pixel width
  const LAT0 = 38.5395, COS0 = Math.cos(rad(LAT0));
  const proj = (p) => ({ x: rad(p.lng) * R * COS0, y: -rad(p.lat) * R });

  function drawMap(svg, opts) {
    const w = Math.max(280, svg.clientWidth || svg.parentElement.clientWidth);
    const pts = opts.fit.map(proj);
    let minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x));
    let minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y));
    const minSpan = opts.minSpan || 400;
    if (maxX - minX < minSpan) { const c = (minX + maxX) / 2; minX = c - minSpan / 2; maxX = c + minSpan / 2; }
    if (maxY - minY < minSpan * 0.5) { const c = (minY + maxY) / 2; minY = c - minSpan / 4; maxY = c + minSpan / 4; }
    const pad = opts.pad || 0.12;
    const sx = maxX - minX, sy = maxY - minY;
    minX -= sx * pad; maxX += sx * pad; minY -= sy * pad * 1.6; maxY += sy * pad * 1.6;
    const scale = w / (maxX - minX);
    const h = Math.round(Math.min(Math.max((maxY - minY) * scale, w * 0.42), w * 0.9));
    // keep the content centered vertically if we clamped the height
    const offY = (h - (maxY - minY) * scale) / 2;
    const P = (p) => { const q = proj(p); return { x: (q.x - minX) * scale, y: (q.y - minY) * scale + offY }; };

    let out = "";
    // faint grid every 250 m
    const step = 250 * scale;
    out += '<g class="grid">';
    const gx0 = (Math.ceil(minX / 250) * 250 - minX) * scale;
    for (let x = gx0; x < w; x += step) out += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="0" y2="${h}"/>`;
    for (let y = ((Math.ceil(minY / 250) * 250 - minY) * scale + offY) % step; y < h; y += step) out += `<line x1="0" x2="${w}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
    out += "</g>";

    for (const s of opts.stations) {
      const p = P(s);
      if (p.x < -10 || p.x > w + 10 || p.y < -10 || p.y > h + 10) continue;
      const r = s === opts.target ? 0 : (opts.dot || 4);
      if (r) out += `<circle class="st${s.faint ? " faint" : ""}" style="--c:${STATION_COLOR[s.k]}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r}"/>`;
    }

    if (opts.target && opts.you) {
      const a = P(opts.you), b = P(opts.target);
      out += `<line class="route draw" style="--c:${opts.color}" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"/>`;
    }
    if (opts.target) {
      const b = P(opts.target);
      out += `<circle cx="${b.x.toFixed(1)}" cy="${b.y.toFixed(1)}" r="11" fill="var(--card)"/>`;
      out += `<circle class="st" style="--c:${opts.color}" cx="${b.x.toFixed(1)}" cy="${b.y.toFixed(1)}" r="7"/>`;
    }
    if (opts.you) {
      const a = P(opts.you);
      out += `<circle class="you" cx="${a.x.toFixed(1)}" cy="${a.y.toFixed(1)}" r="6"/>`;
    }

    // Target and "you" labels sit at opposite ends of the walking line, pushed outward along it
    let u = null;
    if (opts.target && opts.you) {
      const a = P(opts.you), b = P(opts.target);
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
      if (len < 2) u = { x: 0, y: -1 };
    }
    for (const l of opts.labels || []) {
      const p = P(l);
      let anchor = p.x > w * 0.72 ? "end" : p.x < w * 0.28 ? "start" : "middle";
      let dx, dy;
      if (u && (l.role === "target" || l.role === "you")) {
        const s = l.role === "target" ? 1 : -1, r = l.role === "target" ? 16 : 12;
        const vx = u.x * s, vy = u.y * s;
        anchor = vx > 0.35 ? "start" : vx < -0.35 ? "end" : "middle";
        if (anchor === "start" && p.x > w * 0.7) anchor = "end";
        if (anchor === "end" && p.x < w * 0.3) anchor = "start";
        dx = anchor === "middle" ? 0 : (anchor === "start" ? r : -r);
        dy = anchor === "middle" ? (vy > 0 ? r + 10 : -r) : vy * r + 4;
      } else {
        dx = anchor === "end" ? -12 : anchor === "start" ? 12 : 0;
        dy = anchor === "middle" ? (l.below ? 24 : -14) : 4;
      }
      out += `<text class="${l.strong ? "lbl-strong" : "lbl"} halo" x="${(p.x + dx).toFixed(1)}" y="${(p.y + dy).toFixed(1)}" text-anchor="${anchor}">${esc(l.text)}</text>`;
    }

    // scale bar
    const nice = [50, 100, 200, 250, 500, 1000].find((m) => m * scale > w * 0.12) || 1000;
    const bl = nice * scale;
    out += `<g class="scale" transform="translate(8 ${h - 10})"><line x1="0" x2="${bl.toFixed(1)}" y1="0" y2="0"/><line x1="0" x2="0" y1="-4" y2="0"/><line x1="${bl.toFixed(1)}" x2="${bl.toFixed(1)}" y1="-4" y2="0"/><text x="${(bl + 8).toFixed(1)}" y="4">${nice >= 1000 ? nice / 1000 + " km" : nice + " m"}</text></g>`;

    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("height", h);
    svg.innerHTML = out;
  }

  const CAMPUS = DATA.stations;
  const LANDMARKS = [
    { text: "West Village", lat: 38.5415, lng: -121.7712 },
    { text: "Cuarto", lat: 38.5473, lng: -121.7631, below: true },
    { text: "Memorial Union", lat: 38.5420, lng: -121.7496 },
    { text: "Tercero", lat: 38.5363, lng: -121.7574, below: true },
    { text: "Stadium", lat: 38.5365, lng: -121.7628, below: true },
    { text: "Extension", lat: 38.5391, lng: -121.7327 },
  ];

  // Redraw maps when their width changes
  const mapJobs = new Map();
  const ro = "ResizeObserver" in window ? new ResizeObserver((entries) => {
    for (const e of entries) { const job = mapJobs.get(e.target); if (job) job(); }
  }) : null;
  function mountMap(svg, opts) {
    const job = () => drawMap(svg, opts);
    mapJobs.set(svg, job);
    if (ro) ro.observe(svg);
    job();
  }

  // ---- Views ---------------------------------------------------------------
  const views = ["home", "find", "result", "search", "item"];
  function show(name) {
    for (const v of views) $(`#view-${v}`).hidden = v !== name;
    document.querySelectorAll("[data-nav]").forEach((a) => {
      const on = (a.dataset.nav === "find" && (name === "find" || name === "result")) || (a.dataset.nav === "search" && (name === "search" || name === "item"));
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    const el = $(`#view-${name}`);
    el.classList.remove("enter"); void el.offsetWidth; el.classList.add("enter");
  }

  function route() {
    const h = decodeURIComponent(location.hash.replace(/^#/, "").split("?")[0]);
    const [view, arg] = h.split("/");
    if (view === "find" && arg && KINDS[arg]) renderResult(arg);
    else if (view === "find") renderFind();
    else if (view === "search") renderSearch();
    else if (view === "item" && arg) renderItem(arg);
    else if (fromQR()) renderFind(); // a QR visit lands on the picker
    else renderHome();
    window.scrollTo(0, 0);
  }

  // Home -----------------------------------------------------------------------
  function renderHome() {
    show("home");
    const cr = DATA.stations.filter((s) => s.k === "cr").length;
    const mb = DATA.stations.filter((s) => s.k === "mb").length;
    $("#home-legend").innerHTML =
      `<span><i class="dot" style="--c:var(--compost)"></i><span class="mono">${cr}</span> compost and recycling stations</span>` +
      `<span><i class="dot" style="--c:var(--multibin)"></i><span class="mono">${mb}</span> multi-bins for batteries and e-waste</span>`;
    mountMap($("#home-map"), { fit: CAMPUS, stations: CAMPUS, labels: LANDMARKS, pad: 0.06, dot: 4 });

    const cols = [
      ["compost", "Compost", "Food scraps and PLA compostables, at compost and recycling stations"],
      ["recycle", "Recycling", "Clean bottles, cans, glass and paper"],
      ["multibin", "Multi-bin", "Batteries and small electronics. Batteries are illegal to trash in California"],
      ["landfill", "Trash", "Not recyclable on campus, so the can you're at is right"],
    ];
    $("#home-bins").innerHTML = cols.map(([k, title, sub]) => {
      const list = DATA.items.filter((i) => i.v === k);
      const shown = list.slice(0, 6);
      return `<article class="bin-card k-${k}">
        <header><span class="lid"></span><h3>${title}</h3></header>
        <p class="sub">${sub}</p>
        <ul>${shown.map((i) => `<li><a href="#item/${i.id}">${esc(shortName(i.name))}</a></li>`).join("")}</ul>
        ${list.length > shown.length ? `<a class="more" href="#search">and ${list.length - shown.length} more</a>` : ""}
      </article>`;
    }).join("");
  }

  const shortName = (n) => n.replace(/\s*\(e\.g\.[^)]*\)/, "");

  // Find -----------------------------------------------------------------------
  function renderFind() {
    show("find");
    $("#find-here").hidden = !fromQR();
    $("#choices").innerHTML = Object.entries(KINDS).map(([k, v]) =>
      `<a class="choice k-${k}" href="#find/${k}">
        <span><strong>${v.label}</strong><span class="sub">${v.sub}</span></span>
        ${ICON.arrow}
      </a>`).join("");

    const opts = { fit: origin && fromQR() ? nearest("cr", origin, 4).concat(nearest("mb", origin, 2), [origin]) : CAMPUS, stations: CAMPUS, pad: 0.1, dot: 4 };
    if (fromQR()) { opts.you = origin; opts.minSpan = 500; opts.labels = [{ text: "You", ...origin, strong: true }]; }
    else opts.labels = LANDMARKS;
    mountMap($("#find-map"), opts);
    $("#find-map-meta").textContent = "Green: compost and recycling stations. Amber: multi-bins.";
  }

  // Result ---------------------------------------------------------------------
  let locating = false;
  function renderResult(kind) {
    show("result");
    const K = KINDS[kind];
    const body = $("#result-body");
    const head = `<a class="back" href="#find">${ICON.back}Bins</a>`;

    if (!origin) {
      $("#result-map-card").hidden = true;
      body.className = `result k-${kind}`;
      body.innerHTML = `${head}
        <div class="result-label"><span class="lid"></span>${K.nearest}</div>
        <h1 class="result-name">Where are you?</h1>
        <div class="status" id="locate-status"><span class="spin"></span>Finding your location</div>
        <div id="locate-fallback" hidden>
          <p class="walk-note" id="locate-msg"></p>
          <button class="btn btn-secondary" id="locate-retry" style="margin-top:16px">${ICON.locate}Try my location again</button>
          <div class="field">
            <label for="near-pick">Or pick the building you're next to</label>
            <select class="select" id="near-pick"><option value="">Choose a building</option>${
              [...new Map(DATA.stations.map((s) => [s.n, s])).values()].sort((a, b) => a.n.localeCompare(b.n))
                .map((s) => `<option value="${s.lat},${s.lng}">${esc(s.n)}</option>`).join("")
            }</select>
          </div>
        </div>`;
      $("#near-pick").addEventListener("change", (e) => {
        if (!e.target.value) return;
        const [lat, lng] = e.target.value.split(",").map(Number);
        origin = { lat, lng, source: "pick" };
        renderResult(kind);
      });
      $("#locate-retry").addEventListener("click", () => locate(kind));
      locate(kind);
      return;
    }

    const list = nearest(K.station, origin, 3);
    const t = list[0];
    const fromNote = origin.source === "qr" ? "from this trash can" : origin.source === "pick" ? "from the building you picked" : "from where you are";
    const far = t.d > 5000;
    body.className = `result k-${kind}`;
    body.innerHTML = `${head}
      <div class="result-label"><span class="lid"></span>${K.nearest}</div>
      <h1 class="result-name">${esc(t.n)}</h1>
      <div class="walk"><span class="min">${walkMin(t.d)}</span><span class="unit">min walk</span></div>
      <p class="walk-note">About <span class="mono">${feet(t.d * 1.3)}</span> ${fromNote}</p>
      ${far ? `<div class="note">You look like you're off campus. These bins are on the UC Davis campus.</div>` : ""}
      <div class="actions">
        <a class="btn btn-primary" href="${mapsUrl(t)}" target="_blank" rel="noopener">${ICON.nav}Open in Google Maps</a>
        ${t.u ? `<a class="btn btn-secondary" href="${esc(t.u)}" target="_blank" rel="noopener">Building bin map</a>` : ""}
      </div>
      ${kindNote(kind)}
      ${list.length > 1 ? `<div class="nearby"><h3>Also close</h3><ul>${list.slice(1).map((s) =>
        `<li><a href="${mapsUrl(s)}" target="_blank" rel="noopener"><span class="nm">${esc(s.n)}</span><span class="meta">${walkMin(s.d)} min</span>${ICON.ext}</a></li>`).join("")}</ul></div>` : ""}`;

    $("#result-map-card").hidden = false;
    const color = kind === "multibin" ? "var(--multibin)" : kind === "recycle" ? "var(--recycle)" : "var(--compost)";
    const others = DATA.stations.filter((s) => s.k === K.station && !list.includes(s)).map((s) => ({ ...s, faint: true }));
    $("#result-map").setAttribute("aria-label", `Map from your spot to ${t.n}`);
    mountMap($("#result-map"), {
      fit: [origin, ...list],
      stations: [...others, ...list.slice(1)],
      target: t,
      you: origin,
      color,
      minSpan: 320,
      pad: 0.22,
      dot: 5,
      labels: [{ text: shortStation(t.n), ...t, strong: true, role: "target" }, { text: "You", ...origin, role: "you" }],
    });
  }

  const shortStation = (n) => (n.length > 28 ? n.slice(0, 26).trim() + "…" : n);

  function kindNote(kind) {
    if (kind === "multibin") {
      return `<div class="note"><strong>Multi-bins take</strong> small batteries, cell phones, CDs and DVDs, small electronics, and toner cartridges sealed in a box. <a href="#item/battery">Battery details</a></div>`;
    }
    if (kind === "compost") {
      return `<div class="note">Composting is only at a limited number of spots on campus. The guide says to compost when a bin is nearby, and otherwise use the landfill bin.</div>`;
    }
    if (kind === "recycle") {
      return `<div class="note">These are the recycling stations on the campus sustainability map. The guide says any bottle and can or mixed recycling bin on campus works, so a closer one counts too.</div>`;
    }
    return "";
  }

  function locate(kind) {
    const status = $("#locate-status"), fb = $("#locate-fallback");
    const fail = (msg) => {
      locating = false;
      if (status) status.hidden = true;
      if (fb) { fb.hidden = false; $("#locate-msg").textContent = msg; }
    };
    if (!("geolocation" in navigator)) return fail("This browser can't share its location.");
    if (locating) return;
    locating = true;
    if (status) status.hidden = false;
    if (fb) fb.hidden = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        locating = false;
        origin = { lat: pos.coords.latitude, lng: pos.coords.longitude, source: "gps" };
        if (location.hash === `#find/${kind}`) renderResult(kind);
      },
      (err) => fail(err.code === 1 ? "Location is turned off for this site." : "Couldn't get your location."),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  }

  // Search ---------------------------------------------------------------------
  const norm = (s) => s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9#]+/g, " ").trim();
  const INDEX = DATA.items.map((i) => ({ i, name: norm(i.name), words: norm(i.name).split(" "), aliases: i.a.map(norm) }));

  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 3;
    const d = Array.from({ length: a.length + 1 }, (_, k) => [k]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let k = 1; k <= a.length; k++) for (let j = 1; j <= b.length; j++)
      d[k][j] = Math.min(d[k - 1][j] + 1, d[k][j - 1] + 1, d[k - 1][j - 1] + (a[k - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }

  function search(q) {
    q = norm(q);
    if (!q) return [];
    const variants = [q];
    if (q.endsWith("ies")) variants.push(q.slice(0, -3) + "y");
    if (q.endsWith("es")) variants.push(q.slice(0, -2));
    if (q.endsWith("s")) variants.push(q.slice(0, -1));
    const scored = [];
    for (const e of INDEX) {
      let best = 0, via = null;
      for (const v of variants) {
        if (e.name === v) best = Math.max(best, 100);
        else if (e.name.startsWith(v)) best = Math.max(best, 90);
        else if (e.words.some((w) => w.startsWith(v))) best = Math.max(best, 80);
        else if (e.name.includes(v)) best = Math.max(best, 70);
        for (const a of e.aliases) {
          let s = 0;
          if (a === v) s = 85; else if (a.startsWith(v)) s = 65; else if (a.split(" ").some((w) => w.startsWith(v))) s = 60; else if (v.length > 3 && a.includes(v)) s = 50;
          if (s > best) { best = s; via = a; }
        }
        // every word of a multi-word query appears somewhere
        const toks = v.split(" ");
        if (!best && toks.length > 1) {
          const hay = e.name + " " + e.aliases.join(" ");
          if (toks.every((t) => hay.includes(t))) best = 45;
        }
        // one typo
        if (!best && v.length >= 4) {
          const cands = e.words.concat(...e.aliases.map((a) => a.split(" ")));
          if (cands.some((w) => w.length >= 4 && lev(v, w) <= (v.length > 6 ? 2 : 1))) best = 30;
        }
      }
      if (best) scored.push({ e, best, via: best < 70 || via ? via : null });
    }
    return scored.sort((a, b) => b.best - a.best || a.e.name.localeCompare(b.e.name)).slice(0, 12);
  }

  // No match for the whole phrase: try each word on its own and call them close matches
  function searchLoose(q) {
    const words = norm(q).split(" ").filter((w) => w.length >= 3);
    if (words.length < 2) return [];
    const seen = new Map();
    for (const w of words) for (const r of search(w)) if (!seen.has(r.e) || seen.get(r.e).best < r.best) seen.set(r.e, r);
    return [...seen.values()].sort((a, b) => b.best - a.best).slice(0, 6);
  }

  const QUICK = ["food-waste-organics", "bottle-food-beverage", "chip-bag", "battery", "red-solo-cup", "paper", "expanded-polystyrene-foam", "plastic-bag-film"];
  let activeIdx = -1, lastResults = [];

  function chip(v) {
    return `<span class="chip k-${v}"><span class="lid"></span>${VERDICT[v].title}</span>`;
  }

  function renderSearch() {
    show("search");
    const q = $("#q");
    const params = new URLSearchParams(location.hash.split("?")[1] || "");
    if (params.get("q") && !q.value) q.value = params.get("q");
    runSearch();
    if (!matchMedia("(pointer: coarse)").matches || !q.value) setTimeout(() => q.focus({ preventScroll: true }), 50);
  }

  function runSearch() {
    const val = $("#q").value;
    $("#q-clear").hidden = !val;
    lastResults = search(val);
    let loose = false;
    if (!lastResults.length && val.trim()) { lastResults = searchLoose(val); loose = lastResults.length > 0; }
    activeIdx = -1;
    $("#results").innerHTML = lastResults.map(({ e, via }) =>
      `<li><a href="#item/${e.i.id}"><span><span class="nm">${esc(shortName(e.i.name))}</span>${via ? `<span class="alias">${esc(via)}</span>` : ""}</span>${chip(e.i.v)}</a></li>`).join("");
    const empty = $("#search-empty");
    if (!val.trim()) {
      empty.innerHTML = `<p>Common things people ask about</p><div class="quick">${QUICK.map((id) => DATA.items.find((i) => i.id === id)).filter(Boolean)
        .map((i) => `<a href="#item/${i.id}">${esc(shortName(i.name))}</a>`).join("")}</div>`;
    } else if (loose) {
      empty.innerHTML = `<p class="muted">No exact match for “${esc(val.trim())}”. These are the closest entries in the guide.</p>`;
    } else if (!lastResults.length) {
      empty.innerHTML = `<p>“${esc(val.trim())}” isn't in the UC Davis Recycle A–Z guide.</p>
        <p class="muted">Try a broader word, like paper or plastic, or email <a href="mailto:recycling@ucdavis.edu">recycling@ucdavis.edu</a> to ask.</p>`;
    } else empty.innerHTML = "";
  }

  // Item -----------------------------------------------------------------------
  function renderItem(id) {
    const item = DATA.items.find((i) => i.id === id);
    show("item");
    const body = $("#item-body");
    if (!item) {
      body.innerHTML = `<h1 class="h-page">Not in the guide</h1><p class="empty"><a href="#search">Search again</a></p>`;
      return;
    }
    document.title = `${shortName(item.name)} · Davis Trash`;
    const V = VERDICT[item.v];
    let line = V.line;
    if (item.v === "landfill" && fromQR()) line = "The trash can you're at is the right one.";
    const routable = KINDS[item.v];
    body.innerHTML = `
      <h1 class="h-page item-title">${esc(shortName(item.name))}</h1>
      <div class="item-grid">
        <div class="guide">
          <h2>Davis campus</h2>
          ${item.davis || "<p>The guide has no Davis campus entry for this item.</p>"}
          ${item.health ? `<details><summary>UC Davis Health, Sacramento</summary>${item.health}</details>` : ""}
          <p class="src">From the <a href="https://sustainability.ucdavis.edu/how/recycle-a-z" target="_blank" rel="noopener">UC Davis Recycle A–Z guide</a>. Check there if anything looks out of date.</p>
        </div>
        <aside class="verdict k-${item.v}">
          <span class="lid"></span>
          <h2>${V.title}</h2>
          <p>${line}</p>
          ${routable ? `<a class="btn btn-primary btn-block" href="#find/${item.v}">${ICON.nav}${KINDS[item.v].nearest}</a>` : ""}
        </aside>
      </div>`;
  }

  // ---- Wiring --------------------------------------------------------------
  $("#q").addEventListener("input", () => {
    runSearch();
    const v = $("#q").value.trim();
    history.replaceState(null, "", location.pathname + location.search + "#search" + (v ? "?q=" + encodeURIComponent(v) : ""));
  });
  $("#q").addEventListener("keydown", (e) => {
    const links = [...document.querySelectorAll("#results a")];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!links.length) return;
      e.preventDefault();
      activeIdx = (activeIdx + (e.key === "ArrowDown" ? 1 : -1) + links.length) % links.length;
      links.forEach((l, k) => l.classList.toggle("active", k === activeIdx));
      links[activeIdx].scrollIntoView({ block: "nearest" });
    }
  });
  $("#search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const pick = lastResults[Math.max(0, activeIdx)];
    if (pick) location.hash = `item/${pick.e.i.id}`;
  });
  $("#q-clear").addEventListener("click", () => { $("#q").value = ""; runSearch(); $("#q").focus(); });
  $("#find-search").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = e.target.q.value.trim();
    $("#q").value = v;
    location.hash = "search" + (v ? "?q=" + encodeURIComponent(v) : "");
  });
  // Brand link keeps the QR origin so people don't lose their spot
  $("[data-home]").addEventListener("click", (e) => {
    e.preventDefault();
    if (fromQR()) location.hash = "find";
    else { history.pushState(null, "", location.pathname); route(); }
  });

  $("#updated").textContent = DATA.updated;
  window.addEventListener("hashchange", () => {
    document.title = "Davis Trash";
    route();
  });
  route();
})();
