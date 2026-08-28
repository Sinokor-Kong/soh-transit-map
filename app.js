(function () {
  "use strict";

  const CAL = {
    AX: 384.141825, AY: 36.092978, AC: -21990.764500,
    BX: 19.574403, BY: -553.534439, BC: 13573.274362,
  };

  const CP_PX = {
    "CP-A": { x: 458.88, y: 255.61 },
    "CP-S": { x: 574.68, y: 97.31 },
    "CP-D": { x: 664.62, y: 67.68 },
    "CP-H": { x: 676.02, y: 281.65 },
    "CP-Z": { x: 607.48, y: 500.64 },
  };

  // pixel trace of the green dotted route on the background image, CP-A end to CP-Z end
  // (extracted directly from the image's dashed-line pixels, endpoints snapped to the CP
  // tags); INBOUND travels it Z->A (decreasing index), OUTBOUND travels it A->Z (increasing)
  const ROUTE_PATH = [
    { x: 458.9, y: 255.6 }, { x: 442.2, y: 236.7 }, { x: 533.0, y: 113.5 },
    { x: 547.4, y: 99.2 }, { x: 541.6, y: 92.6 }, { x: 600.0, y: 56.8 },
    { x: 642.5, y: 52.0 }, { x: 696.6, y: 59.4 }, { x: 709.2, y: 89.1 },
    { x: 702.5, y: 265.2 }, { x: 705.6, y: 276.6 }, { x: 636.6, y: 495.6 },
    { x: 607.5, y: 500.6 },
  ];

  const STAGE_W = 892, STAGE_H = 688;
  const CP_LIST = ["CP-A", "CP-S", "CP-D", "CP-H", "CP-Z"];

  const CP_DATE_OFFSET = {
    "CP-A": { dx: -67, dy: -34 },
    "CP-S": { dx: -68, dy: -24 },
    "CP-D": { dx: 86, dy: -16 },
    "CP-H": { dx: 89, dy: 4 },
    "CP-Z": { dx: 88, dy: 0 },
  };

  function project(lat, lon) {
    return { x: CAL.AX * lon + CAL.AY * lat + CAL.AC, y: CAL.BX * lon + CAL.BY * lat + CAL.BC };
  }

  // inverse of project(): pixel -> {lat, lon}, solving the 2x2 linear system above
  function unproject(x, y) {
    const det = CAL.AY * CAL.BX - CAL.AX * CAL.BY;
    const dx = x - CAL.AC, dy = y - CAL.BC;
    const lat = (CAL.BX * dx - CAL.AX * dy) / det;
    const lon = (CAL.AY * dy - CAL.BY * dx) / det;
    return { lat, lon };
  }

  function formatDMS(value, posHem, negHem) {
    const hem = value >= 0 ? posHem : negHem;
    const abs = Math.abs(value);
    const deg = Math.floor(abs);
    const minFull = (abs - deg) * 60;
    const min = Math.floor(minFull);
    const sec = (minFull - min) * 60;
    return `${deg} ${String(min).padStart(2, "0")}'${sec.toFixed(1)}"${hem}`;
  }

  // great-circle distance in nautical miles
  function distanceNM(lat1, lon1, lat2, lon2) {
    const R_NM = 3440.065;
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLon = (lon2 - lon1) * toRad;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
    return R_NM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function parseCoord(str) {
    if (!str) return null;
    str = String(str).trim();
    if (!str) return null;
    const hemMatch = str.match(/([NSEWnsew])\s*$/);
    const hem = hemMatch ? hemMatch[1].toUpperCase() : null;
    const body = hem ? str.slice(0, hemMatch.index) : str;
    const nums = body.match(/-?\d+(?:\.\d+)?/g);
    if (!nums) return null;
    let value;
    if (nums.length >= 3) {
      value = Math.abs(parseFloat(nums[0])) + parseFloat(nums[1]) / 60 + parseFloat(nums[2]) / 3600;
    } else if (nums.length === 2) {
      value = Math.abs(parseFloat(nums[0])) + parseFloat(nums[1]) / 60;
    } else {
      value = Math.abs(parseFloat(nums[0]));
    }
    if (isNaN(value)) return null;
    if (hem === "S" || hem === "W") value = -value;
    else if (nums[0].trim().startsWith("-")) value = -value;
    return value;
  }

  const REF_YEAR = 2024;

  function formatCPDateTime(month, day, hh, mm) {
    if (month === "" || day === "" || hh === "" || mm === "") return "";
    const d = new Date(REF_YEAR, parseInt(month, 10) - 1, parseInt(day, 10), parseInt(hh, 10), parseInt(mm, 10));
    if (isNaN(d.getTime())) return "";
    return `${d.getMonth() + 1}/${d.getDate()} ${hh}${mm}LT`;
  }

  function getCPDate(cp) {
    const month = document.getElementById("month-" + cp).value;
    const day = document.getElementById("day-" + cp).value;
    if (month === "" || day === "") return null;
    const hh = document.getElementById("hour-" + cp).value;
    const mm = document.getElementById("min-" + cp).value;
    return new Date(REF_YEAR, parseInt(month, 10) - 1, parseInt(day, 10), parseInt(hh, 10), parseInt(mm, 10));
  }

  function setCPDate(cp, date) {
    document.getElementById("month-" + cp).value = String(date.getMonth() + 1);
    document.getElementById("day-" + cp).value = String(date.getDate());
    document.getElementById("hour-" + cp).value = String(date.getHours()).padStart(2, "0");
    document.getElementById("min-" + cp).value = String(date.getMinutes()).padStart(2, "0");
  }

  const SEGMENTS = [
    { id: "AS", defaultH: 2, defaultM: 0 },
    { id: "SD", defaultH: 1, defaultM: 30 },
    { id: "DH", defaultH: 1, defaultM: 30 },
    { id: "HZ", defaultH: 1, defaultM: 30 },
  ];

  function segmentMinutes(id) {
    const h = parseInt(document.getElementById("durH-" + id).value, 10) || 0;
    const m = parseInt(document.getElementById("durM-" + id).value, 10) || 0;
    return h * 60 + m;
  }

  function currentDirection() {
    return document.querySelector('input[name="direction"]:checked').value;
  }

  function currentChainConfig() {
    if (currentDirection() === "OUTBOUND") {
      return { anchor: "CP-A", steps: [["CP-S", "AS"], ["CP-D", "SD"], ["CP-H", "DH"], ["CP-Z", "HZ"]] };
    }
    return { anchor: "CP-Z", steps: [["CP-H", "HZ"], ["CP-D", "DH"], ["CP-S", "SD"], ["CP-A", "AS"]] };
  }

  function fillChain() {
    const { anchor, steps } = currentChainConfig();
    const base = getCPDate(anchor);
    if (!base) return;
    let cur = base;
    steps.forEach(([toCp, segId]) => {
      cur = new Date(cur.getTime() + segmentMinutes(segId) * 60000);
      setCPDate(toCp, cur);
    });
    applyAll();
  }

  function updateAnchorHighlight() {
    const anchor = currentChainConfig().anchor;
    CP_LIST.forEach((cp) => {
      document.querySelector(`.cp-field[data-cp="${cp}"]`).classList.toggle("anchor", cp === anchor);
    });
  }

  function populateDurationSelects() {
    SEGMENTS.forEach((seg) => {
      const hourSel = document.getElementById("durH-" + seg.id);
      const minSel = document.getElementById("durM-" + seg.id);
      for (let h = 0; h <= 6; h++) {
        const opt = document.createElement("option");
        opt.value = opt.textContent = String(h);
        hourSel.appendChild(opt);
      }
      for (let m = 0; m < 60; m += 5) {
        const opt = document.createElement("option");
        opt.value = opt.textContent = String(m).padStart(2, "0");
        minSel.appendChild(opt);
      }
      hourSel.value = String(seg.defaultH);
      minSel.value = String(seg.defaultM).padStart(2, "0");
    });
  }

  function populateTimeSelects() {
    CP_LIST.forEach((cp) => {
      const monthSel = document.getElementById("month-" + cp);
      const daySel = document.getElementById("day-" + cp);
      const hourSel = document.getElementById("hour-" + cp);
      const minSel = document.getElementById("min-" + cp);

      [monthSel, daySel].forEach((sel) => {
        const blank = document.createElement("option");
        blank.value = "";
        blank.textContent = "--";
        sel.appendChild(blank);
      });
      for (let mo = 1; mo <= 12; mo++) {
        const opt = document.createElement("option");
        opt.value = opt.textContent = String(mo);
        monthSel.appendChild(opt);
      }
      for (let d = 1; d <= 31; d++) {
        const opt = document.createElement("option");
        opt.value = opt.textContent = String(d);
        daySel.appendChild(opt);
      }
      for (let h = 0; h < 24; h++) {
        const opt = document.createElement("option");
        opt.value = opt.textContent = String(h).padStart(2, "0");
        hourSel.appendChild(opt);
      }
      for (let m = 0; m < 60; m++) {
        const opt = document.createElement("option");
        opt.value = opt.textContent = String(m).padStart(2, "0");
        minSel.appendChild(opt);
      }
    });
  }

  // ---- DOM refs ----
  const stage = document.getElementById("mapStage");
  const svg = document.getElementById("overlaySvg");
  const titleBox = document.getElementById("titleBox");
  const vesselIcon = document.getElementById("vesselIcon");
  const vesselNameBox = document.getElementById("vesselNameBox");
  const arrowHandleStart = document.getElementById("arrowHandleStart");
  const arrowHandleEnd = document.getElementById("arrowHandleEnd");
  const arrowWidthInput = document.getElementById("arrowWidth");
  const rulerHandleStart = document.getElementById("rulerHandleStart");
  const rulerHandleEnd = document.getElementById("rulerHandleEnd");
  const coordReadout = document.getElementById("coordReadout");
  const cpBoxes = {};
  CP_LIST.forEach((cp) => (cpBoxes[cp] = document.getElementById("box-" + cp)));

  const moved = { title: false, icon: false, name: false, arrowStart: false, arrowEnd: false };
  CP_LIST.forEach((cp) => (moved[cp] = false));

  let vesselManuallyShown = false;
  let passageArrow = null; // { points:[{x,y},...], handles:[el,...] }
  let manualArrows = [];   // [{ points:[{x,y},{x,y}], handles:[el,el] }, ...]
  let manualArrowSeq = 0;
  let rulerActive = false;

  // once a box's text has been hand-edited, applyAll() must stop overwriting it with the
  // auto-computed value (date string, vessel name, etc.)
  const textEdited = { title: false, name: false };
  CP_LIST.forEach((cp) => (textEdited[cp] = false));
  let customBoxes = []; // [{ el, key }, ...] -- freestanding user-added white text boxes
  let customBoxSeq = 0;

  // ---- generic drag support ----
  function makeDraggable(el, key, onMove) {
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const startX = e.clientX, startY = e.clientY;
      const startLeft = el.offsetLeft, startTop = el.offsetTop;

      function onPointerMove(ev) {
        let nx = startLeft + (ev.clientX - startX);
        let ny = startTop + (ev.clientY - startY);
        nx = Math.max(0, Math.min(nx, STAGE_W - el.offsetWidth));
        ny = Math.max(0, Math.min(ny, STAGE_H - el.offsetHeight));
        el.style.left = nx + "px";
        el.style.top = ny + "px";
        moved[key] = true;
        drawConnectors();
        if (onMove) onMove();
      }
      function onPointerUp() {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      }
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    });
  }

  // like makeDraggable, but for a dynamically-created arrow point handle that isn't
  // tracked in `moved` -- the caller's onMove is responsible for updating its own state
  function makePointDraggable(el, onMove) {
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const startX = e.clientX, startY = e.clientY;
      const startLeft = el.offsetLeft, startTop = el.offsetTop;

      function onPointerMove(ev) {
        let nx = startLeft + (ev.clientX - startX);
        let ny = startTop + (ev.clientY - startY);
        nx = Math.max(0, Math.min(nx, STAGE_W - el.offsetWidth));
        ny = Math.max(0, Math.min(ny, STAGE_H - el.offsetHeight));
        el.style.left = nx + "px";
        el.style.top = ny + "px";
        onMove();
      }
      function onPointerUp() {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      }
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    });
  }

  // like makeDraggable, but double-click switches the box into contenteditable text-entry
  // mode instead of dragging; single-click-drag keeps working exactly as before once not
  // editing. opts.onEditEnd(text) fires when editing finishes (blur / Enter / Escape).
  function makeEditableDraggable(el, key, opts) {
    opts = opts || {};

    function selectAllText(node) {
      const range = document.createRange();
      range.selectNodeContents(node);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }

    function finishEditing() {
      if (el.contentEditable !== "true") return;
      el.contentEditable = "false";
      el.classList.remove("editing");
      if (opts.onEditEnd) opts.onEditEnd(el.textContent);
    }

    el.addEventListener("dblclick", (e) => {
      e.preventDefault();
      el.contentEditable = "true";
      el.classList.add("editing");
      el.focus();
      selectAllText(el);
    });
    el.addEventListener("blur", finishEditing);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); el.blur(); }
      e.stopPropagation();
    });

    el.addEventListener("pointerdown", (e) => {
      if (el.contentEditable === "true") return; // let native caret placement/selection happen
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const startX = e.clientX, startY = e.clientY;
      const startLeft = el.offsetLeft, startTop = el.offsetTop;

      function onPointerMove(ev) {
        let nx = startLeft + (ev.clientX - startX);
        let ny = startTop + (ev.clientY - startY);
        nx = Math.max(0, Math.min(nx, STAGE_W - el.offsetWidth));
        ny = Math.max(0, Math.min(ny, STAGE_H - el.offsetHeight));
        el.style.left = nx + "px";
        el.style.top = ny + "px";
        moved[key] = true;
        drawConnectors();
      }
      function onPointerUp() {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      }
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    });
  }

  function setCenterPos(el, cx, cy) {
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = cx - w / 2, top = cy - h / 2;
    left = Math.max(0, Math.min(left, STAGE_W - w));
    top = Math.max(0, Math.min(top, STAGE_H - h));
    el.style.left = left + "px";
    el.style.top = top + "px";
  }

  function centerOf(el) {
    return { x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop + el.offsetHeight / 2 };
  }

  function defaultCpAnchor(cp) {
    const p = CP_PX[cp];
    const o = CP_DATE_OFFSET[cp];
    return { x: p.x + o.dx, y: p.y + o.dy };
  }

  function positionVesselNameBox() {
    if (moved.name) return;
    const ic = centerOf(vesselIcon);
    const candidates = [{ dx: 80, dy: 28 }, { dx: -80, dy: 28 }, { dx: 80, dy: -28 }, { dx: -80, dy: -28 }];
    let best = candidates[0], bestScore = -Infinity;
    candidates.forEach((c) => {
      const cx = ic.x + c.dx, cy = ic.y + c.dy;
      const minDist = Math.min(...Object.values(CP_PX).map((p) => Math.hypot(p.x - cx, p.y - cy)));
      if (minDist > bestScore) { bestScore = minDist; best = c; }
    });
    setCenterPos(vesselNameBox, ic.x + best.dx, ic.y + best.dy);
  }

  // ---- shared arrow rendering: any polyline (2+ points) with a single arrowhead at the end.
  // an invisible wide "hit" polyline (arrowId set) sits underneath so the whole arrow body,
  // not just its endpoint handles, can be grabbed and dragged. ----
  function polylineArrowSVG(points, width, arrowId) {
    if (!points || points.length < 2) return "";
    const last = points[points.length - 1];
    const prev = points[points.length - 2];
    const dx = last.x - prev.x, dy = last.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const headLen = width * 3.2, headWidth = width * 1.4;
    const backX = last.x - ux * headLen, backY = last.y - uy * headLen;
    const leftX = backX - uy * headWidth, leftY = backY + ux * headWidth;
    const rightX = backX + uy * headWidth, rightY = backY - ux * headWidth;
    const linePts = points.slice(0, -1).concat([{ x: backX, y: backY }]);
    const attr = linePts.map((p) => `${p.x},${p.y}`).join(" ");
    const fullAttr = points.map((p) => `${p.x},${p.y}`).join(" ");
    const hit = arrowId
      ? `<polyline points="${fullAttr}" fill="none" stroke="transparent" stroke-width="${Math.max(width + 14, 18)}" stroke-linecap="round" stroke-linejoin="round" class="arrow-hit" data-arrow-id="${arrowId}" style="pointer-events:stroke;cursor:move;" />`
      : "";
    return hit + `<polyline points="${attr}" fill="none" stroke="#ffd400" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;" />
      <polygon points="${last.x},${last.y} ${leftX},${leftY} ${rightX},${rightY}" fill="#ffd400" style="pointer-events:none;" />`;
  }

  // renders the NM ruler: a dashed line with end ticks between the two ruler handles plus
  // a distance label at the midpoint; marked .no-export so it never appears in the saved PNG
  function rulerSVG() {
    const p1 = centerOf(rulerHandleStart), p2 = centerOf(rulerHandleEnd);
    const c1 = unproject(p1.x, p1.y), c2 = unproject(p2.x, p2.y);
    const nm = distanceNM(c1.lat, c1.lon, c2.lat, c2.lon);
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const tick = 7;
    const midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;
    const label = `${nm.toFixed(2)} NM`;
    const boxW = label.length * 6.6 + 12, boxH = 17;
    return `<g class="no-export">
      <line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="#38bdf8" stroke-width="1.6" stroke-dasharray="6 4" />
      <line x1="${p1.x - uy * tick}" y1="${p1.y + ux * tick}" x2="${p1.x + uy * tick}" y2="${p1.y - ux * tick}" stroke="#38bdf8" stroke-width="1.6" />
      <line x1="${p2.x - uy * tick}" y1="${p2.y + ux * tick}" x2="${p2.x + uy * tick}" y2="${p2.y - ux * tick}" stroke="#38bdf8" stroke-width="1.6" />
      <rect x="${midX - boxW / 2}" y="${midY - boxH / 2}" width="${boxW}" height="${boxH}" rx="3" fill="rgba(10,14,20,0.85)" stroke="#38bdf8" stroke-width="1" />
      <text x="${midX}" y="${midY + 4}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="11" fill="#e7ecf1">${label}</text>
    </g>`;
  }

  function addRuler() {
    if (!rulerActive) {
      setCenterPos(rulerHandleStart, STAGE_W / 2 - 100, STAGE_H / 2);
      setCenterPos(rulerHandleEnd, STAGE_W / 2 + 100, STAGE_H / 2);
    }
    rulerActive = true;
    rulerHandleStart.style.visibility = "visible";
    rulerHandleEnd.style.visibility = "visible";
    drawConnectors();
  }

  function clearRuler() {
    rulerActive = false;
    rulerHandleStart.style.visibility = "hidden";
    rulerHandleEnd.style.visibility = "hidden";
    drawConnectors();
  }

  // lets the user grab an arrow's body (not just an endpoint handle) and drag the whole
  // thing; moves every handle element together and keeps the arrow's points array in sync
  function bindArrowBodyDrag(hitEl, handleEls, opts) {
    opts = opts || {};
    hitEl.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      hitEl.setPointerCapture(e.pointerId);
      if (opts.onDragStart) opts.onDragStart();
      const startX = e.clientX, startY = e.clientY;
      const origin = handleEls.map((el) => ({ left: el.offsetLeft, top: el.offsetTop }));

      function onPointerMove(ev) {
        const dx = ev.clientX - startX, dy = ev.clientY - startY;
        handleEls.forEach((el, i) => {
          let nx = origin[i].left + dx, ny = origin[i].top + dy;
          nx = Math.max(0, Math.min(nx, STAGE_W - el.offsetWidth));
          ny = Math.max(0, Math.min(ny, STAGE_H - el.offsetHeight));
          el.style.left = nx + "px";
          el.style.top = ny + "px";
        });
        if (opts.onMove) opts.onMove();
        drawConnectors();
      }
      function onPointerUp() {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      }
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    });
  }

  function drawConnectors() {
    const width = parseFloat(arrowWidthInput.value) || 5;
    const parts = [];
    const bindings = [];

    if (vesselIcon.style.visibility !== "hidden") {
      const iconC = centerOf(vesselIcon);
      const nameC = { x: vesselNameBox.offsetLeft, y: vesselNameBox.offsetTop + vesselNameBox.offsetHeight / 2 };
      parts.push(`<line x1="${iconC.x}" y1="${iconC.y}" x2="${nameC.x}" y2="${nameC.y}" stroke="#8a8f94" stroke-width="1.5" />`);

      const target = document.getElementById("arrowTarget").value;
      if (target && CP_PX[target]) {
        const t = CP_PX[target];
        if (!moved.arrowStart) setCenterPos(arrowHandleStart, iconC.x, iconC.y);
        if (!moved.arrowEnd) {
          const dx0 = t.x - iconC.x, dy0 = t.y - iconC.y;
          const len0 = Math.hypot(dx0, dy0) || 1;
          setCenterPos(arrowHandleEnd, t.x - (dx0 / len0) * 4, t.y - (dy0 / len0) * 4);
        }
        arrowHandleStart.style.visibility = "visible";
        arrowHandleEnd.style.visibility = "visible";
        parts.push(polylineArrowSVG([centerOf(arrowHandleStart), centerOf(arrowHandleEnd)], width, "cp-target"));
        bindings.push({
          id: "cp-target",
          handleEls: [arrowHandleStart, arrowHandleEnd],
          opts: { onDragStart: () => { moved.arrowStart = true; moved.arrowEnd = true; } },
        });
      } else {
        arrowHandleStart.style.visibility = "hidden";
        arrowHandleEnd.style.visibility = "hidden";
      }
    } else {
      arrowHandleStart.style.visibility = "hidden";
      arrowHandleEnd.style.visibility = "hidden";
    }

    if (passageArrow) {
      parts.push(polylineArrowSVG(passageArrow.points, width, "passage"));
      bindings.push({
        id: "passage",
        handleEls: passageArrow.handles,
        opts: { onMove: () => { passageArrow.points = passageArrow.handles.map(centerOf); } },
      });
    }
    manualArrows.forEach((a, i) => {
      const id = "manual-" + i;
      parts.push(polylineArrowSVG(a.points, width, id));
      bindings.push({
        id,
        handleEls: a.handles,
        opts: { onMove: () => { a.points = a.handles.map(centerOf); } },
      });
    });

    if (rulerActive) parts.push(rulerSVG());

    svg.innerHTML = parts.join("");

    bindings.forEach(({ id, handleEls, opts }) => {
      const hit = svg.querySelector(`.arrow-hit[data-arrow-id="${id}"]`);
      if (hit) bindArrowBodyDrag(hit, handleEls, opts);
    });
  }

  // ---- main apply/render ----
  function applyAll() {
    const name = (document.getElementById("vesselName").value || "VESSEL NAME").trim().toUpperCase();

    if (!textEdited.title) titleBox.textContent = `${name} - SOH TRANSIT PLAN`;
    if (!moved.title) setCenterPos(titleBox, STAGE_W / 2, 24);

    CP_LIST.forEach((cp) => {
      const month = document.getElementById("month-" + cp).value;
      const day = document.getElementById("day-" + cp).value;
      const hh = document.getElementById("hour-" + cp).value;
      const mm = document.getElementById("min-" + cp).value;
      const text = formatCPDateTime(month, day, hh, mm);
      const box = cpBoxes[cp];
      if (!textEdited[cp]) {
        box.textContent = text || cp + " 일시 미입력";
        box.style.visibility = text ? "visible" : "hidden";
      }
      if (!moved[cp]) {
        const a = defaultCpAnchor(cp);
        setCenterPos(box, a.x, a.y);
      }
    });

    const lat = parseCoord(document.getElementById("vesselLat").value);
    const lon = parseCoord(document.getElementById("vesselLon").value);
    if (lat !== null && lon !== null) {
      vesselIcon.style.visibility = "visible";
      vesselNameBox.style.visibility = "visible";
      if (!textEdited.name) vesselNameBox.textContent = name;
      if (!moved.icon) {
        const p = project(lat, lon);
        setCenterPos(vesselIcon, p.x, p.y);
      }
      positionVesselNameBox();
    } else if (vesselManuallyShown) {
      vesselIcon.style.visibility = "visible";
      vesselNameBox.style.visibility = "visible";
      if (!textEdited.name) vesselNameBox.textContent = name;
      if (!moved.icon) setCenterPos(vesselIcon, STAGE_W - 70, STAGE_H - 55);
      positionVesselNameBox();
    } else {
      vesselIcon.style.visibility = "hidden";
      vesselNameBox.style.visibility = "hidden";
    }

    drawConnectors();
  }

  function showVessel() {
    vesselManuallyShown = true;
    applyAll();
  }

  function resetPositions() {
    Object.keys(moved).forEach((k) => (moved[k] = false));
    applyAll();
  }

  function clearPassageArrow() {
    if (passageArrow) passageArrow.handles.forEach((el) => el.remove());
    passageArrow = null;
    drawConnectors();
  }

  // point-to-segment projection used to find where the vessel currently sits along the route
  function nearestPointOnSegment(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return { x: a.x + t * dx, y: a.y + t * dy };
  }

  function setPassageArrow(points) {
    clearPassageArrow();
    passageArrow = { points, handles: [] };
    points.forEach((pt, i) => {
      const el = document.createElement("div");
      el.className = "drag-box arrow-handle passage-handle";
      el.title = "PASSAGE 화살표 꺾임점 " + (i + 1);
      stage.appendChild(el);
      setCenterPos(el, pt.x, pt.y);
      makePointDraggable(el, () => {
        passageArrow.points[i] = centerOf(el);
        drawConnectors();
      });
      passageArrow.handles.push(el);
    });
    drawConnectors();
  }

  function autoPassageArrow() {
    if (vesselIcon.style.visibility === "hidden") {
      alert("먼저 선박을 표시하거나(선박 표시 버튼) 좌표를 입력하세요.");
      return;
    }
    // snap to the nearest point on the traced green route, then keep only the remaining
    // leg in the direction of travel -- this naturally bends wherever the route itself bends
    const P = centerOf(vesselIcon);
    let bestSeg = 0, bestDist = Infinity, bestProj = null;
    for (let i = 0; i < ROUTE_PATH.length - 1; i++) {
      const a = ROUTE_PATH[i], b = ROUTE_PATH[i + 1];
      const proj = nearestPointOnSegment(P, a, b);
      const d = Math.hypot(proj.x - P.x, proj.y - P.y);
      if (d < bestDist) { bestDist = d; bestSeg = i; bestProj = proj; }
    }
    const points = [bestProj];
    if (currentDirection() === "OUTBOUND") {
      for (let i = bestSeg + 1; i < ROUTE_PATH.length; i++) points.push({ ...ROUTE_PATH[i] });
    } else {
      for (let i = bestSeg; i >= 0; i--) points.push({ ...ROUTE_PATH[i] });
    }
    setPassageArrow(points);
  }

  function addManualArrow() {
    const idx = manualArrowSeq++;
    const offset = (idx % 6) * 18;
    const points = [
      { x: STAGE_W / 2 - 70 + offset, y: STAGE_H / 2 + 50 + offset },
      { x: STAGE_W / 2 + 70 + offset, y: STAGE_H / 2 - 50 + offset },
    ];
    const arrow = { points, handles: [] };
    points.forEach((pt, i) => {
      const el = document.createElement("div");
      el.className = "drag-box arrow-handle manual-handle";
      el.title = i === 0 ? "화살표 시작점" : "화살표 끝점";
      stage.appendChild(el);
      setCenterPos(el, pt.x, pt.y);
      makePointDraggable(el, () => {
        arrow.points[i] = centerOf(el);
        drawConnectors();
      });
      arrow.handles.push(el);
    });
    manualArrows.push(arrow);
    drawConnectors();
  }

  function clearManualArrows() {
    manualArrows.forEach((a) => a.handles.forEach((el) => el.remove()));
    manualArrows = [];
    drawConnectors();
  }

  function addTextBox() {
    const idx = customBoxSeq++;
    const key = "custom-" + idx;
    const offset = (idx % 6) * 16;
    const el = document.createElement("div");
    el.className = "drag-box cp-date-box";
    el.textContent = "텍스트 입력";
    stage.appendChild(el);
    setCenterPos(el, STAGE_W / 2 + offset, STAGE_H / 2 + 90 + offset);
    moved[key] = true; // freestanding box has no default layout to fall back to
    makeEditableDraggable(el, key);
    customBoxes.push({ el, key });
  }

  function clearTextBoxes() {
    customBoxes.forEach(({ el, key }) => {
      el.remove();
      delete moved[key];
    });
    customBoxes = [];
  }

  function resetForm() {
    document.getElementById("vesselName").value = "";
    document.getElementById("vesselLat").value = "";
    document.getElementById("vesselLon").value = "";
    document.getElementById("directionInbound").checked = true;

    SEGMENTS.forEach((seg) => {
      document.getElementById("durH-" + seg.id).value = String(seg.defaultH);
      document.getElementById("durM-" + seg.id).value = String(seg.defaultM).padStart(2, "0");
    });

    CP_LIST.forEach((cp) => {
      document.getElementById("month-" + cp).value = "";
      document.getElementById("day-" + cp).value = "";
      document.getElementById("hour-" + cp).value = "00";
      document.getElementById("min-" + cp).value = "00";
    });

    document.getElementById("arrowTarget").value = "";
    arrowWidthInput.value = "5";

    vesselManuallyShown = false;
    clearPassageArrow();
    clearManualArrows();
    clearTextBoxes();
    clearRuler();

    Object.keys(textEdited).forEach((k) => (textEdited[k] = false));
    Object.keys(moved).forEach((k) => (moved[k] = false));
    updateAnchorHighlight();
    applyAll();
  }

  populateTimeSelects();
  populateDurationSelects();

  // ---- wire up drag handlers ----
  makeEditableDraggable(titleBox, "title", { onEditEnd: () => { textEdited.title = true; } });
  makeDraggable(vesselIcon, "icon", drawConnectors);
  makeEditableDraggable(vesselNameBox, "name", { onEditEnd: () => { textEdited.name = true; } });
  makeDraggable(arrowHandleStart, "arrowStart");
  makeDraggable(arrowHandleEnd, "arrowEnd");
  makePointDraggable(rulerHandleStart, drawConnectors);
  makePointDraggable(rulerHandleEnd, drawConnectors);
  CP_LIST.forEach((cp) => makeEditableDraggable(cpBoxes[cp], cp, { onEditEnd: () => { textEdited[cp] = true; } }));

  document.getElementById("applyBtn").addEventListener("click", applyAll);
  document.getElementById("resetPosBtn").addEventListener("click", resetPositions);
  document.getElementById("resetFormBtn").addEventListener("click", resetForm);
  document.getElementById("showVesselBtn").addEventListener("click", showVessel);
  document.getElementById("autoPassageBtn").addEventListener("click", autoPassageArrow);
  document.getElementById("clearPassageBtn").addEventListener("click", clearPassageArrow);
  document.getElementById("addManualArrowBtn").addEventListener("click", addManualArrow);
  document.getElementById("clearManualArrowsBtn").addEventListener("click", clearManualArrows);
  document.getElementById("addTextBoxBtn").addEventListener("click", addTextBox);
  document.getElementById("clearTextBoxesBtn").addEventListener("click", clearTextBoxes);
  document.getElementById("addRulerBtn").addEventListener("click", addRuler);
  document.getElementById("clearRulerBtn").addEventListener("click", clearRuler);
  document.getElementById("arrowTarget").addEventListener("change", applyAll);
  arrowWidthInput.addEventListener("input", drawConnectors);

  // ---- cursor lat/lon readout, fixed at bottom-center of the map stage ----
  stage.addEventListener("pointermove", (e) => {
    const rect = stage.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (x < 0 || y < 0 || x > STAGE_W || y > STAGE_H) {
      coordReadout.style.visibility = "hidden";
      return;
    }
    const { lat, lon } = unproject(x, y);
    coordReadout.textContent = `${formatDMS(lat, "N", "S")}   ${formatDMS(lon, "E", "W")}`;
    coordReadout.style.visibility = "visible";
  });
  stage.addEventListener("pointerleave", () => { coordReadout.style.visibility = "hidden"; });

  CP_LIST.forEach((cp) => {
    ["month", "day", "hour", "min"].forEach((field) => {
      document.getElementById(field + "-" + cp).addEventListener("change", () => {
        if (cp === currentChainConfig().anchor) fillChain();
      });
    });
  });
  SEGMENTS.forEach((seg) => {
    document.getElementById("durH-" + seg.id).addEventListener("change", fillChain);
    document.getElementById("durM-" + seg.id).addEventListener("change", fillChain);
  });
  document.querySelectorAll('input[name="direction"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      updateAnchorHighlight();
      fillChain();
    });
  });
  updateAnchorHighlight();

  // ---- input panel show/hide ----
  const inputPanel = document.getElementById("inputPanel");
  const toggleBtn = document.getElementById("togglePanelBtn");
  const showBtn = document.getElementById("showPanelBtn");
  toggleBtn.addEventListener("click", () => {
    inputPanel.classList.add("hidden");
    showBtn.hidden = false;
  });
  showBtn.addEventListener("click", () => {
    inputPanel.classList.remove("hidden");
    showBtn.hidden = true;
  });

  // ---- export map stage as PNG ----
  document.getElementById("exportBtn").addEventListener("click", async () => {
    const handles = document.querySelectorAll(".arrow-handle, .no-export");
    handles.forEach((el) => el.classList.add("export-hide"));
    const canvas = await html2canvas(stage, { backgroundColor: null, scale: 2 });
    handles.forEach((el) => el.classList.remove("export-hide"));
    const blob = await new Promise((resolve) => canvas.toBlob(resolve));
    const vesselName = (document.getElementById("vesselName").value || "VESSEL").trim().replace(/\s+/g, "_");
    const filename = `${vesselName}_SOH_TRANSIT_PLAN_TEST.png`;

    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: "PNG Image", accept: { "image/png": [".png"] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });

  // initial paint
  window.addEventListener("load", applyAll);
})();
