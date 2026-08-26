(function () {
  "use strict";

  // ---- Calibration: real lat/lon (deg) -> pixel position on assets/map-bg.png (892x688) ----
  // Fitted by least squares from 5 known CP positions. px = AX*lon + AY*lat + AC ; py = BX*lon + BY*lat + BC
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

  const STAGE_W = 892, STAGE_H = 688;
  const CP_LIST = ["CP-A", "CP-S", "CP-D", "CP-H", "CP-Z"];

  // default date-box center offset from its CP tag center, measured directly off a
  // reference SOH Transit Plan screenshot (KakaoTalk_20260824_211545354.png)
  const CP_DATE_OFFSET = {
    "CP-A": { dx: -67, dy: -34 },
    "CP-S": { dx: -68, dy: -24 },
    "CP-D": { dx: 86, dy: -16 },
    "CP-H": { dx: 89, dy: 4 },
    "CP-Z": { dx: 88, dy: 0 },
  };

  function project(lat, lon) {
    return {
      x: CAL.AX * lon + CAL.AY * lat + CAL.AC,
      y: CAL.BX * lon + CAL.BY * lat + CAL.BC,
    };
  }

  // ---- lat/lon text parsing: accepts "26 2'45.29N", "26°2'45.29\"N", or plain decimal ----
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

  // No year in the UI or in the "M/D HHMMLT" output, so date math uses a fixed dummy year
  // internally (a leap year, so Feb 29 never breaks) purely to get correct month/day rollover.
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

  // The 4 CP-to-CP legs, each with a user-editable duration (default: the SOH schedule).
  // INBOUND transits CP-Z -> CP-A (time entered at CP-Z, added onward leg by leg); OUTBOUND
  // transits CP-A -> CP-Z (time entered at CP-A, added onward). Same legs, opposite order.
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
      return {
        anchor: "CP-A",
        steps: [["CP-S", "AS"], ["CP-D", "SD"], ["CP-H", "DH"], ["CP-Z", "HZ"]],
      };
    }
    return {
      anchor: "CP-Z",
      steps: [["CP-H", "HZ"], ["CP-D", "DH"], ["CP-S", "SD"], ["CP-A", "AS"]],
    };
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

  // 24-hour hour/minute and month/day <select> dropdowns.
  // Time uses selects (not <input type="time">) because the native time picker follows the
  // OS locale and can show AM/PM regardless of `lang`. Date uses selects (not <input
  // type="date">) so no year is ever shown or stored, matching the "M/D HHMMLT" output.
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
  const cpBoxes = {};
  CP_LIST.forEach((cp) => (cpBoxes[cp] = document.getElementById("box-" + cp)));

  const moved = { title: false, icon: false, name: false, arrowStart: false, arrowEnd: false };
  CP_LIST.forEach((cp) => (moved[cp] = false));

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

  // ---- leader line (icon -> name box) + arrow (vessel -> target CP, with draggable start/end handles) ----
  function drawConnectors() {
    // nothing to connect to until a valid vessel position has actually been applied --
    // without this, picking an arrow target before the first "지도에 반영" click would draw
    // the arrow from the icon's unset (0,0) default position instead of doing nothing.
    if (vesselIcon.style.visibility === "hidden") {
      arrowHandleStart.style.visibility = "hidden";
      arrowHandleEnd.style.visibility = "hidden";
      svg.innerHTML = "";
      return;
    }

    const iconC = centerOf(vesselIcon);
    const nameC = { x: vesselNameBox.offsetLeft, y: vesselNameBox.offsetTop + vesselNameBox.offsetHeight / 2 };
    const leaderLine = `<line x1="${iconC.x}" y1="${iconC.y}" x2="${nameC.x}" y2="${nameC.y}" stroke="#8a8f94" stroke-width="1.5" />`;

    const target = document.getElementById("arrowTarget").value;

    if (!target || !CP_PX[target]) {
      arrowHandleStart.style.visibility = "hidden";
      arrowHandleEnd.style.visibility = "hidden";
      svg.innerHTML = leaderLine;
      return;
    }

    const t = CP_PX[target];
    if (!moved.arrowStart) setCenterPos(arrowHandleStart, iconC.x, iconC.y);
    if (!moved.arrowEnd) {
      const dx0 = t.x - iconC.x, dy0 = t.y - iconC.y;
      const len0 = Math.hypot(dx0, dy0) || 1;
      setCenterPos(arrowHandleEnd, t.x - (dx0 / len0) * 4, t.y - (dy0 / len0) * 4);
    }
    arrowHandleStart.style.visibility = "visible";
    arrowHandleEnd.style.visibility = "visible";

    const start = centerOf(arrowHandleStart);
    const end = centerOf(arrowHandleEnd);
    const width = parseFloat(arrowWidthInput.value) || 5;
    const dx = end.x - start.x, dy = end.y - start.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const headLen = width * 3.2, headWidth = width * 1.4;
    const backX = end.x - ux * headLen, backY = end.y - uy * headLen;
    const leftX = backX - uy * headWidth, leftY = backY + ux * headWidth;
    const rightX = backX + uy * headWidth, rightY = backY - ux * headWidth;
    svg.innerHTML = leaderLine + `
      <line x1="${start.x}" y1="${start.y}" x2="${backX}" y2="${backY}"
            stroke="#ffd400" stroke-width="${width}" stroke-linecap="round" />
      <polygon points="${end.x},${end.y} ${leftX},${leftY} ${rightX},${rightY}" fill="#ffd400" />
    `;
  }

  // ---- main apply/render ----
  function applyAll() {
    const name = (document.getElementById("vesselName").value || "VESSEL NAME").trim().toUpperCase();

    titleBox.textContent = `${name} - SOH TRANSIT PLAN`;
    if (!moved.title) setCenterPos(titleBox, STAGE_W / 2, 24);

    CP_LIST.forEach((cp) => {
      const month = document.getElementById("month-" + cp).value;
      const day = document.getElementById("day-" + cp).value;
      const hh = document.getElementById("hour-" + cp).value;
      const mm = document.getElementById("min-" + cp).value;
      const text = formatCPDateTime(month, day, hh, mm);
      const box = cpBoxes[cp];
      box.textContent = text || cp + " 일시 미입력";
      box.style.visibility = text ? "visible" : "hidden";
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
      vesselNameBox.textContent = name;
      if (!moved.icon) {
        const p = project(lat, lon);
        setCenterPos(vesselIcon, p.x, p.y);
      }
      if (!moved.name) {
        const ic = centerOf(vesselIcon);
        // try a few candidate offsets and keep whichever lands farthest from every CP tag
        const candidates = [
          { dx: 80, dy: 28 }, { dx: -80, dy: 28 },
          { dx: 80, dy: -28 }, { dx: -80, dy: -28 },
        ];
        let best = candidates[0], bestScore = -Infinity;
        candidates.forEach((c) => {
          const cx = ic.x + c.dx, cy = ic.y + c.dy;
          const minDist = Math.min(...Object.values(CP_PX).map((p) => Math.hypot(p.x - cx, p.y - cy)));
          if (minDist > bestScore) { bestScore = minDist; best = c; }
        });
        setCenterPos(vesselNameBox, ic.x + best.dx, ic.y + best.dy);
      }
    } else {
      vesselIcon.style.visibility = "hidden";
      vesselNameBox.style.visibility = "hidden";
    }

    drawConnectors();
  }

  function resetPositions() {
    Object.keys(moved).forEach((k) => (moved[k] = false));
    applyAll();
  }

  populateTimeSelects();
  populateDurationSelects();

  // ---- wire up drag handlers ----
  makeDraggable(titleBox, "title");
  makeDraggable(vesselIcon, "icon");
  makeDraggable(vesselNameBox, "name");
  makeDraggable(arrowHandleStart, "arrowStart");
  makeDraggable(arrowHandleEnd, "arrowEnd");
  CP_LIST.forEach((cp) => makeDraggable(cpBoxes[cp], cp));

  document.getElementById("applyBtn").addEventListener("click", applyAll);
  document.getElementById("resetPosBtn").addEventListener("click", resetPositions);
  // applyAll (not just drawConnectors) so picking a target also applies any vessel
  // name/lat/lon typed in but not yet sent to the map with "지도에 반영"
  document.getElementById("arrowTarget").addEventListener("change", applyAll);
  arrowWidthInput.addEventListener("input", drawConnectors);

  // editing the direction's anchor CP, or any leg duration, auto-fills the rest of the chain
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

  // ---- input panel show/hide (kept out of exported/captured image) ----
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
    const canvas = await html2canvas(stage, { backgroundColor: null, scale: 2 });
    const blob = await new Promise((resolve) => canvas.toBlob(resolve));
    const vesselName = (document.getElementById("vesselName").value || "VESSEL").trim().replace(/\s+/g, "_");
    const filename = `${vesselName}_SOH_TRANSIT_PLAN.png`;

    // Chromium's File System Access API lets the user pick where to save, and remembers
    // that folder for next time -- the closest a web page can get to a fixed save path,
    // since a page can never silently write to an arbitrary path on disk (browser security).
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
        if (err && err.name === "AbortError") return; // user cancelled the save dialog
        // fall through to the plain download below on any other error
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
