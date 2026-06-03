/* ============================================================
   Trove landing — interactions
   ============================================================ */
(function () {
  "use strict";

  /* ---------- icon set (from Trove's spool-icons) ---------- */
  var ICONS = {
    search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3",
    grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
    rows: "M4 5h16M4 12h16M4 19h16",
    heart: "M12 20s-7-4.6-9.3-9A4.8 4.8 0 0 1 12 6a4.8 4.8 0 0 1 9.3 5C19 15.4 12 20 12 20Z",
    download: "M12 3v12M7 11l5 5 5-5M5 21h14",
    folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z",
    server: "M4 5h16v6H4zM4 13h16v6H4zM8 8h.01M8 16h.01",
    plus: "M12 5v14M5 12h14",
    layers: "M12 3 2 8l10 5 10-5-10-5ZM2 13l10 5 10-5M2 18l10 5 10-5",
    user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0",
    chevronRight: "M9 6l6 6-6 6",
    check: "M5 12l5 5 9-11",
    moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z",
    ruler: "M5 3h4v18H5zM9 7h4M9 11h4M9 15h4M13 3h6v6M13 21h6v-6",
    slice: "M3 7h18M3 12h18M3 17h18",
    filter: "M3 5h18l-7 8v6l-4 2v-8L3 5Z",
    sparkles: "M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15l-1.8-4.2L5.5 9l4.7-1.3L12 3ZM18 14l.9 2.3L21 17l-2.1.7L18 20l-.9-2.3L15 17l2.1-.7L18 14Z",
    link: "M9 15l6-6M10 7l1-1a4 4 0 0 1 6 6l-1 1M14 17l-1 1a4 4 0 0 1-6-6l1-1",
    eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
    cube: "M12 2 3 7v10l9 5 9-5V7l-9-5ZM3 7l9 5 9-5M12 12v10",
    clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2",
    info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 8h.01",
    refresh: "M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5",
    bell: "M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
    lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4",
    star: "M12 3l2.6 6.3L21 9.8l-5 4.3 1.6 6.6L12 17l-5.6 3.7L8 14.1l-5-4.3 6.4-.5L12 3Z",
    x: "M6 6l12 12M18 6 6 18"
  };

  function svgIcon(name, stroke) {
    var d = ICONS[name];
    if (!d) return "";
    var paths = d.split("M").filter(Boolean).map(function (s) { return '<path d="M' + s + '"/>'; }).join("");
    return '<svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' +
      (stroke || 1.8) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block">' + paths + '</svg>';
  }

  var GEM = '<svg width="100%" height="100%" viewBox="0 0 32 32" fill="none" aria-hidden="true" style="display:block">' +
    '<rect x="1" y="1" width="30" height="30" rx="9" fill="var(--accent)"/>' +
    '<g stroke="var(--accent-ink)" stroke-width="2" fill="none" stroke-linejoin="round" stroke-linecap="round">' +
    '<path d="M16 6 L25 13.5 L16 26 L7 13.5 Z"/><path d="M7 13.5 H25"/>' +
    '<path d="M16 6 L12.5 13.5 L16 26"/><path d="M16 6 L19.5 13.5 L16 26"/></g></svg>';

  function stampIcons(root) {
    root.querySelectorAll("[data-icon]").forEach(function (el) {
      if (el.dataset.stamped) return;
      el.innerHTML = svgIcon(el.getAttribute("data-icon"));
      el.style.display = "inline-flex";
      el.dataset.stamped = "1";
    });
    root.querySelectorAll("[data-mark]").forEach(function (el) {
      if (el.dataset.stamped) return;
      el.innerHTML = GEM;
      el.dataset.stamped = "1";
    });
  }

  /* ---------- hero model grid ---------- */
  var MODELS = [
    { name: "Hex Planter Trio", obj: "cube25", c: "#6f8c5a", cre: "MV", ct: "#9a5b7a", tags: ["planter", "garden"], badge: "3 parts", fav: true },
    { name: "Polyhedral Dice Set", obj: "gem", c: "#9a5b7a", cre: "DK", ct: "#c2693d", tags: ["dice", "tabletop"], badge: "STL" },
    { name: "Modular Desk Tray", obj: "cube25", c: "#c2693d", cre: "AM", ct: "#6f8c5a", tags: ["desk", "organizer"], badge: "3MF" },
    { name: "Tapered Spiral Vase", obj: "cyl", c: "#b5604f", cre: "RP", ct: "#5b7a86", tags: ["vase", "decor"], badge: "STL", fav: true },
    { name: "Planetary Gearbox", obj: "ring", c: "#5b7a86", cre: "JT", ct: "#c06b2e", tags: ["mechanical", "gears"], badge: "STEP" },
    { name: "Low-Poly Fox", obj: "hex", c: "#c06b2e", cre: "EL", ct: "#9a5b7a", tags: ["figurine", "low-poly"], badge: "OBJ" }
  ];

  function objMarkup(type, c) {
    var cls = { cube25: "cube25", gem: "obj-gem", cyl: "obj-cyl", ring: "obj-ring", hex: "obj-hex", sphere: "obj-sphere" }[type] || "obj-sphere";
    var inner = (type === "cyl") ? "" : "";
    return '<div class="scene" style="--c:' + c + '"><div class="' + cls + '" style="position:relative">' + inner + '</div></div>';
  }

  function buildGrid() {
    var grid = document.getElementById("heroGrid");
    if (!grid) return;
    grid.innerHTML = MODELS.map(function (m) {
      return '<div class="mcard">' +
        '<div class="thumb">' + objMarkup(m.obj, m.c) +
          '<div class="heart' + (m.fav ? " on" : "") + '">' + svgIcon("heart") + '</div>' +
          '<div class="badge">' + m.badge + '</div>' +
        '</div>' +
        '<div class="meta">' +
          '<div class="mtitle">' + m.name + '</div>' +
          '<div class="mcreator"><span class="ca" style="background:' + m.ct + '">' + m.cre + '</span> ' + m.cre.replace(/(.)(.)/, "$1. $2") + '.</div>' +
          '<div class="mtags">' + m.tags.map(function (t) { return '<span class="t">' + t + '</span>'; }).join("") + '</div>' +
        '</div>' +
      '</div>';
    }).join("");
  }

  /* ---------- nav scroll state ---------- */
  function navScroll() {
    var nav = document.getElementById("nav");
    if (!nav) return;
    var on = window.scrollY > 24;
    nav.classList.toggle("scrolled", on);
  }

  /* ---------- hero parallax tilt ---------- */
  var heroWindow = null, heroGlow = null, reduce = false;
  function heroParallax() {
    if (!heroWindow || reduce || window.innerWidth <= 720) return;
    var y = window.scrollY;
    var t = Math.max(0, Math.min(1, y / 520));
    var rot = 11 * (1 - t);
    var lift = -t * 30;
    heroWindow.style.transform = "rotateX(" + rot.toFixed(2) + "deg) translateY(" + lift.toFixed(1) + "px)";
    if (heroGlow) heroGlow.style.transform = "translateX(-50%) translateY(" + (y * 0.18).toFixed(1) + "px)";
  }

  /* ---------- visibility helpers (scroll-based; IO is unreliable here) ---------- */
  function inView(el, frac) {
    var r = el.getBoundingClientRect();
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var trigger = vh * (frac == null ? 0.9 : frac);
    return r.top < trigger && r.bottom > 0;
  }

  /* ---------- scroll reveal (rAF tween; CSS transitions unreliable in embeds) ---------- */
  var revealEls = [];
  var STAGGER = { d1: 90, d2: 180, d3: 270 };
  function setupReveal() {
    revealEls = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
    if (reduce) {
      revealEls.forEach(function (e) { e.style.opacity = "1"; e.style.transform = "none"; });
      revealEls = [];
      return;
    }
    revealEls.forEach(function (e) {
      e.style.opacity = "0";
      e.style.transform = "translateY(28px)";
      e.__delay = STAGGER[(e.className.match(/\bd[123]\b/) || ["",""])[0]] || 0;
    });
  }
  /* generic timer tween (setInterval — rAF is throttled in some embeds) */
  function tween(dur, delay, onStep, onDone) {
    var t0 = performance.now() + (delay || 0);
    var iv = setInterval(function () {
      var t = performance.now() - t0;
      if (t < 0) return;
      var p = Math.min(1, t / dur);
      onStep(1 - Math.pow(1 - p, 3), p);
      if (p >= 1) { clearInterval(iv); if (onDone) onDone(); }
    }, 16);
  }

  function tweenReveal(el) {
    tween(700, el.__delay || 0, function (e) {
      el.style.opacity = e.toFixed(3);
      el.style.transform = "translateY(" + (28 * (1 - e)).toFixed(2) + "px)";
    }, function () {
      el.style.opacity = "1"; el.style.transform = "none"; el.style.willChange = "auto";
    });
  }
  function checkReveal() {
    if (!revealEls.length) return;
    revealEls = revealEls.filter(function (el) {
      if (inView(el, 0.92)) { tweenReveal(el); return false; }
      return true;
    });
  }

  /* ---------- JS rotate for 3D viewer turntable ---------- */
  function setupSpin() {
    if (reduce) return;
    var spins = Array.prototype.slice.call(document.querySelectorAll(".spin-y"));
    var cube = document.getElementById("viewerCube");
    var start = performance.now();
    setInterval(function () {
      var el = performance.now() - start;
      var deg = el / 14000 * 360 % 360;
      spins.forEach(function (s) { s.style.transform = "rotate(" + deg.toFixed(2) + "deg)"; });
      if (cube) cube.style.transform = "rotateX(-18deg) rotateY(" + (el / 16000 * 360 % 360).toFixed(2) + "deg)";
    }, 32);
  }

  /* ---------- counters ---------- */
  function animateCount(el) {
    var target = parseFloat(el.getAttribute("data-count"));
    if (reduce) { el.textContent = target; return; }
    tween(1100, 0, function (e) { el.textContent = Math.round(target * e); });
  }
  var countEls = [];
  function setupCounters() { countEls = Array.prototype.slice.call(document.querySelectorAll("[data-count]")); }
  function checkCounters() {
    if (!countEls.length) return;
    countEls = countEls.filter(function (el) {
      if (inView(el, 0.85)) { animateCount(el); return false; }
      return true;
    });
  }

  /* ---------- launcher typing ---------- */
  var launcherTyped = false;
  function checkLauncher() {
    if (launcherTyped) return;
    var q = document.getElementById("lzQuery");
    var launcher = document.getElementById("launcher");
    if (!q || !launcher) { launcherTyped = true; return; }
    if (!inView(launcher, 0.7)) return;
    launcherTyped = true;
    var word = "dice";
    if (reduce) { q.textContent = word; return; }
    var i = 0; q.textContent = "";
    var iv = setInterval(function () {
      q.textContent = word.slice(0, ++i);
      if (i >= word.length) clearInterval(iv);
    }, 120);
  }

  /* ---------- live clock ---------- */
  function clock() {
    var el = document.getElementById("lzClock");
    if (!el) return;
    var d = new Date();
    el.textContent = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  /* ---------- platform-aware download buttons ---------- */
  function setupDownload() {
    var row = document.getElementById("dlRow");
    if (!row) return;
    var ua = navigator.userAgent || "";
    var os = "mac";
    if (/Windows|Win64|Win32/i.test(ua)) os = "win";
    else if (/Linux|X11/i.test(ua) && !/Android/i.test(ua)) os = "linux";
    var labels = { mac: "macOS", win: "Windows", linux: "Linux" };
    row.querySelectorAll("[data-os]").forEach(function (b) {
      var k = b.getAttribute("data-os");
      var primary = (k === os);
      b.classList.toggle("btn-primary", primary);
      var ic = b.querySelector("[data-icon]");
      b.innerHTML = (ic ? ic.outerHTML : "") + (primary ? " Download for " + labels[k] : " " + labels[k]);
    });
    var p = row.querySelector(".btn-primary");
    if (p) row.insertBefore(p, row.firstChild);
  }
  function setupCopy() {
    var btn = document.getElementById("copyCmd");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var cmd = document.querySelector("#cmdChip .cmd").textContent;
      if (navigator.clipboard) navigator.clipboard.writeText(cmd).catch(function () {});
      var orig = btn.innerHTML;
      btn.innerHTML = svgIcon("check") + " Copied";
      setTimeout(function () { btn.innerHTML = orig; }, 1600);
    });
  }

  /* ---------- init ---------- */
  document.addEventListener("DOMContentLoaded", function () {
    reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    stampIcons(document);
    buildGrid();
    stampIcons(document.getElementById("heroGrid") || document);
    heroWindow = document.getElementById("heroWindow");
    heroGlow = document.getElementById("heroGlow");
    navScroll();
    heroParallax();
    setupReveal();
    setupCounters();
    setupCopy();
    setupDownload();
    setupSpin();
    clock();
    setInterval(clock, 30000);

    // initial in-view pass (timers — rAF is throttled in some embeds)
    setTimeout(function () { checkReveal(); checkCounters(); checkLauncher(); }, 60);
    setTimeout(function () { checkReveal(); checkCounters(); checkLauncher(); }, 260);

    var lastScroll = 0;
    window.addEventListener("scroll", function () {
      var now = Date.now();
      if (now - lastScroll < 16) return;
      lastScroll = now;
      navScroll(); heroParallax(); checkReveal(); checkCounters(); checkLauncher();
    }, { passive: true });
    window.addEventListener("resize", function () { checkReveal(); checkCounters(); heroParallax(); }, { passive: true });
  });

  // expose for tweaks
  window.__troveStamp = stampIcons;
})();
