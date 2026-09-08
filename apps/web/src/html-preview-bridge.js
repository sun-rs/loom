// Raft TYe/vYe behavior port; only this trusted asset executes. The attachment
// remains an opaque-origin document with no network, forms, or user scripts.
(() => {
  const channel = document.currentScript.dataset.channel;
  let overlay, start, highlight, timer, selectionBox;
  const send = (type, data) =>
    parent.postMessage({ rahHtml: channel, type, ...data }, "*");
  const valid = (v) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 10_000_000;
  const root = () => document.documentElement;
  // Official index-D8Neh8lc.css: anchor-flash / --color-brutal-yellow.
  const flashStyle = document.createElement("style");
  flashStyle.textContent =
    "@keyframes rahHtmlFlash{0%,35%{background-color:#ffd440}to{background-color:transparent}}";
  document.head.append(flashStyle);
  // Structural port of the live Raft iframe bridge (2026-09-08), SHA-256
  // 6b921a421b6f772fea3168813c80d319bb2785dc4103f167244132d9cd2ebed0.
  // Provenance and local isolation adaptations: HTML official verification audit.
  var MAX_QUOTE = 200;
  var normalizeText = function (value) {
    return (typeof value === "string" ? value : "").replace(/\s+/g, " ").trim();
  };
  var isBoundary = function (ch) {
    return (
      ch === "\n" ||
      ch === "\r" ||
      ch === "." ||
      ch === "!" ||
      ch === "?" ||
      ch === "。" ||
      ch === "！" ||
      ch === "？" ||
      ch === ";" ||
      ch === "；"
    );
  };
  var snippetFromTextNode = function (node, offset) {
    var raw =
      typeof (node && node.textContent) === "string" ? node.textContent : "";
    if (!normalizeText(raw)) return "";
    var i =
      typeof offset === "number" && isFinite(offset)
        ? Math.max(0, Math.min(raw.length, Math.floor(offset)))
        : 0;
    while (i < raw.length && /\s/.test(raw.charAt(i))) i++;
    if (i >= raw.length) {
      i = Math.max(
        0,
        Math.min(
          raw.length - 1,
          (typeof offset === "number" ? Math.floor(offset) : raw.length) - 1,
        ),
      );
      while (i > 0 && /\s/.test(raw.charAt(i))) i--;
    }
    var start = i;
    while (start > 0 && !isBoundary(raw.charAt(start - 1)) && i - start < 40)
      start--;
    while (start < raw.length && /\s/.test(raw.charAt(start))) start++;
    var end = Math.max(i, start + 1);
    while (
      end < raw.length &&
      !isBoundary(raw.charAt(end)) &&
      end - start < MAX_QUOTE
    )
      end++;
    return normalizeText(raw.slice(start, end)).slice(0, MAX_QUOTE);
  };
  var snippetFromCaretPoint = function (clientX, clientY) {
    try {
      var pos = document.caretPositionFromPoint
        ? document.caretPositionFromPoint(clientX, clientY)
        : null;
      if (pos && pos.offsetNode && pos.offsetNode.nodeType === 3) {
        var byPosition = snippetFromTextNode(pos.offsetNode, pos.offset);
        if (byPosition) return byPosition;
      }
    } catch (e) {}
    try {
      var range = document.caretRangeFromPoint
        ? document.caretRangeFromPoint(clientX, clientY)
        : null;
      if (
        range &&
        range.startContainer &&
        range.startContainer.nodeType === 3
      ) {
        var byRange = snippetFromTextNode(
          range.startContainer,
          range.startOffset,
        );
        if (byRange) return byRange;
      }
    } catch (e) {}
    return "";
  };
  var rectIntersects = function (a, b) {
    return (
      a &&
      b &&
      a.right > b.left &&
      a.left < b.right &&
      a.bottom > b.top &&
      a.top < b.bottom
    );
  };
  var joinSnippets = function (parts) {
    var out = "";
    for (var i = 0; i < parts.length; i++) {
      var part = normalizeText(parts[i]);
      if (!part) continue;
      if (out && (out.indexOf(part) !== -1 || part.indexOf(out) !== -1))
        continue;
      var next = out ? out + " ... " + part : part;
      if (next.length <= MAX_QUOTE) {
        out = next;
        continue;
      }
      if (!out) return next.slice(0, MAX_QUOTE);
      var remaining = MAX_QUOTE - out.length - 5;
      if (remaining > 20) out += " ... " + part.slice(0, remaining);
      return out.slice(0, MAX_QUOTE);
    }
    return out;
  };
  var textFromCaretScan = function (left, top, width, height) {
    var right = left + Math.max(1, width);
    var bottom = top + Math.max(1, height);
    var stepX = Math.max(8, Math.min(24, Math.max(1, width) / 4));
    var stepY = Math.max(8, Math.min(24, Math.max(1, height) / 4));
    var checked = 0;
    for (var y = top + 1; y <= bottom && checked < 400; y += stepY) {
      for (var x = left + 1; x <= right && checked < 400; x += stepX) {
        checked++;
        var text = snippetFromCaretPoint(x, y);
        if (text) return text;
      }
    }
    return (
      snippetFromCaretPoint(left + 1, top + 1) ||
      snippetFromCaretPoint(left + width / 2, top + height / 2)
    );
  };
  var textFromIntersectingRects = function (left, top, width, height) {
    var query = {
      left: left,
      top: top,
      right: left + Math.max(1, width),
      bottom: top + Math.max(1, height),
    };
    var candidates = [];
    try {
      var root = document.body || document.documentElement;
      var walker = document.createTreeWalker(root, 4, null);
      var node,
        seen = 0;
      while ((node = walker.nextNode()) && seen < 5000) {
        seen++;
        if (
          overlay?.contains(node) ||
          highlight?.contains(node) ||
          node.parentElement?.closest("script,style")
        )
          continue;
        if (!normalizeText(node.textContent || "")) continue;
        var range = document.createRange();
        range.selectNodeContents(node);
        var rects = range.getClientRects ? range.getClientRects() : [];
        var nodeScore = Infinity;
        for (var i = 0; i < rects.length; i++) {
          var r = rects[i];
          if (!rectIntersects(r, query)) continue;
          var score =
            Math.max(0, r.top - query.top) * 100000 +
            Math.max(0, r.left - query.left);
          if (score < nodeScore) nodeScore = score;
        }
        if (nodeScore < Infinity) {
          var text = snippetFromTextNode(node, 0);
          if (text) candidates.push({ score: nodeScore, text: text });
        }
        if (range.detach) range.detach();
      }
    } catch (e) {}
    candidates.sort(function (a, b) {
      return a.score - b.score;
    });
    var parts = [];
    for (var j = 0; j < candidates.length; j++) parts.push(candidates[j].text);
    return joinSnippets(parts);
  };
  var fallbackTextFromPoint = function (left, top, width, height) {
    var points = [
      [left + 1, top + 1],
      [left + width / 2, top + height / 2],
    ];
    for (var i = 0; i < points.length; i++) {
      try {
        var hit = document.elementFromPoint(points[i][0], points[i][1]);
        var cur = hit;
        while (cur && cur !== document.documentElement) {
          var text = normalizeText(cur.innerText || cur.textContent || "");
          if (text) return text.slice(0, MAX_QUOTE);
          cur = cur.parentElement;
        }
      } catch (e) {}
    }
    return "";
  };
  var describeRegion = function (x, y, w, h) {
    var left = x - window.scrollX;
    var top = y - window.scrollY;
    var width = Math.max(0, w);
    var height = Math.max(0, h);
    var isRegion = width >= 4 && height >= 4;
    return (
      (isRegion ? textFromIntersectingRects(left, top, width, height) : "") ||
      textFromCaretScan(left, top, width, height) ||
      (!isRegion ? textFromIntersectingRects(left, top, width, height) : "") ||
      fallbackTextFromPoint(left, top, width, height)
    );
  };
  const describe = (x, y, w, h) => {
    overlay.style.visibility = "hidden";
    try {
      return describeRegion(x + scrollX, y + scrollY, w, h);
    } finally {
      overlay.style.visibility = "visible";
    }
  };
  function mode(enabled) {
    overlay?.remove();
    overlay = undefined;
    if (!enabled || matchMedia("(pointer: coarse)").matches) return;
    overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:2147483646;cursor:crosshair;touch-action:none";
    const hint = document.createElement("span");
    hint.textContent = "点击或拖动以对区域评论";
    hint.style.cssText =
      "position:absolute;top:8px;left:8px;background:#fffdf5;border:1px solid black;padding:4px 8px;font:12px sans-serif;pointer-events:none";
    overlay.append(hint);
    overlay.onpointerdown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      start = { x: event.clientX, y: event.clientY };
      overlay.setPointerCapture(event.pointerId);
    };
    overlay.onpointermove = (event) => {
      if (!start) return;
      if (!selectionBox) {
        selectionBox = document.createElement("div");
        overlay.append(selectionBox);
      }
      selectionBox.style.cssText = `position:absolute;pointer-events:none;border:1px solid #c0b9b1;background:rgba(192,185,177,.2);left:${Math.min(start.x, event.clientX)}px;top:${Math.min(start.y, event.clientY)}px;width:${Math.abs(start.x - event.clientX)}px;height:${Math.abs(start.y - event.clientY)}px`;
    };
    overlay.onpointercancel = () => {
      selectionBox?.remove();
      selectionBox = undefined;
      start = undefined;
    };
    overlay.onpointerup = (event) => {
      if (!start) return;
      const x = Math.min(start.x, event.clientX),
        y = Math.min(start.y, event.clientY);
      const w = Math.abs(start.x - event.clientX),
        h = Math.abs(start.y - event.clientY);
      start = undefined;
      selectionBox?.remove();
      selectionBox = undefined;
      send("anchor", {
        data: {
          x: Math.round(x + scrollX),
          y: Math.round(y + scrollY),
          w: Math.round(w),
          h: Math.round(h),
          viewportWidth: innerWidth,
          documentWidth: root().scrollWidth,
          documentHeight: root().scrollHeight,
          quote: describe(x, y, w, h),
        },
      });
    };
    document.body.append(overlay);
  }
  function jump(data) {
    if (![data.x, data.y, data.w, data.h].every(valid)) return;
    let { x, y, w, h } = data;
    // Immutable attachment text is preferred over coordinates after a resize.
    if (
      typeof data.quote === "string" &&
      data.quote.length &&
      data.quote.length <= 1000
    ) {
      const quote = normalizeText(data.quote);
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_ELEMENT,
      );
      const candidates = [];
      let element,
        seen = 0;
      while ((element = walker.nextNode()) && seen++ < 5000) {
        if (
          overlay?.contains(element) ||
          highlight?.contains(element) ||
          element.closest("script,style")
        )
          continue;
        if (normalizeText(element.textContent).includes(quote))
          candidates.push(element);
      }
      const minimal = candidates.filter(
        (e) => !candidates.some((other) => other !== e && e.contains(other)),
      );
      let best,
        distance = Infinity;
      for (const element of minimal) {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 && rect.height <= 0) continue;
        const delta = Math.abs(
          rect.top + scrollY + rect.height / 2 - (y + h / 2),
        );
        if (delta < distance) {
          best = rect;
          distance = delta;
        }
      }
      if (best) {
        x = Math.round(best.left + scrollX);
        y = Math.round(best.top + scrollY);
        w = Math.round(best.width);
        h = Math.round(best.height);
      }
    }

    highlight?.remove();
    clearTimeout(timer);
    highlight = document.createElement("div");
    highlight.dataset.rahRegionHighlight = "";
    highlight.style.cssText = `position:absolute;pointer-events:none;z-index:2147483647;left:${x}px;top:${y}px;width:${Math.max(14, w)}px;height:${Math.max(14, h)}px;animation:1.6s ease-out rahHtmlFlash;border:2px solid black;box-sizing:border-box`;
    document.body.append(highlight);
    scrollTo({
      left: Math.max(0, x - innerWidth / 2),
      top: Math.max(0, y - innerHeight / 3),
      behavior: "smooth",
    });
    timer = setTimeout(() => highlight?.remove(), 1800);
  }
  addEventListener("message", (event) => {
    const message = event.data;
    if (event.source !== parent || !message || message.rahHtml !== channel)
      return;
    if (message.type === "mode") mode(message.enabled === true);
    if (
      message.type === "jump" &&
      message.data &&
      typeof message.data === "object"
    )
      jump(message.data);
  });
  send("ready", {});
})();
