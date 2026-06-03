/* ============================================================
   Trove landing — Tweaks panel (host protocol + live apply)
   ============================================================ */
(function () {
  "use strict";

  var HEADLINES = {
    organized: 'Your 3D-print library, <span class="accent">finally organized.</span>',
    findable: 'Every model, <span class="accent">findable in a keystroke.</span>',
    yours: 'Your models, your machine, <span class="accent">your trove.</span>'
  };

  function apply(key, val) {
    if (key === "accent") {
      document.documentElement.style.setProperty("--accent", val);
    } else if (key === "theme") {
      document.documentElement.setAttribute("data-theme", val);
    } else if (key === "wall") {
      document.querySelectorAll(".launcher-stage").forEach(function (s) { s.setAttribute("data-wall", val); });
    } else if (key === "headline") {
      var h1 = document.querySelector(".hero h1");
      if (h1 && HEADLINES[val]) { h1.innerHTML = HEADLINES[val]; h1.style.opacity = "1"; h1.style.transform = "none"; }
    }
  }

  function markSel(container, val) {
    if (!container) return;
    container.querySelectorAll("[data-val]").forEach(function (el) {
      el.classList.toggle("sel", el.getAttribute("data-val") === String(val));
    });
  }

  function init() {
    var state = Object.assign({}, window.__TWEAK_DEFAULTS || {});
    var panel = document.getElementById("tweaks");
    var groups = {
      accent: document.getElementById("twAccent"),
      theme: document.getElementById("twTheme"),
      wall: document.getElementById("twWall"),
      headline: document.getElementById("twHeadline")
    };

    // apply initial state + reflect selection
    Object.keys(state).forEach(function (k) { apply(k, state[k]); markSel(groups[k], state[k]); });

    function set(key, val) {
      state[key] = val;
      apply(key, val);
      markSel(groups[key], val);
      var edits = {}; edits[key] = val;
      try { window.parent.postMessage({ type: "__edit_mode_set_keys", edits: edits }, "*"); } catch (e) {}
    }

    Object.keys(groups).forEach(function (key) {
      var g = groups[key];
      if (!g) return;
      g.addEventListener("click", function (e) {
        var t = e.target.closest("[data-val]");
        if (t) set(key, t.getAttribute("data-val"));
      });
    });

    var closeBtn = document.getElementById("tweaksClose");
    if (closeBtn) closeBtn.addEventListener("click", function () {
      panel.classList.remove("open");
      try { window.parent.postMessage({ type: "__edit_mode_dismissed" }, "*"); } catch (e) {}
    });

    // host protocol: listener BEFORE announcing availability
    window.addEventListener("message", function (ev) {
      var d = ev.data || {};
      if (d.type === "__activate_edit_mode") panel.classList.add("open");
      else if (d.type === "__deactivate_edit_mode") panel.classList.remove("open");
    });
    try { window.parent.postMessage({ type: "__edit_mode_available" }, "*"); } catch (e) {}
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
