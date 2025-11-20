// CHART CONFIG (easy knobs)
const CFG = {
  WIDTH: 700,
  HEIGHT: 700,
  OUTER_PADDING: 80,
  ARC_THICK: 30,
  TRANSITION_MS: 800,
  OBS_ROOT_MARGIN: '-25% 0px -25% 0px', // smoother trigger
  OBS_THRESHOLD: 0.4
};

// Color palette — match these keys with your CSV header labels
const colors = {
  sexist: "#e52b50",
  political: "#4285f4",
  communal: "#fbbc04",
  casteist: "#34a853",
  racist: "#9c27b0",
  queerphobic: "#ff9800",
  ablelist: "#607d8b"
};

// small helpers
function safe(str = "") { return String(str).replace(/[^a-zA-Z0-9]/g, '_'); }
function clear(node) { d3.select(node).selectAll("*").remove(); }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

// Load data
import { SUPABASE_URL, SUPABASE_KEY, PRIVATE_BUCKET, PUBLIC_BUCKET } from "./config.js";

// =============== SUPABASE HELPERS ===============

async function getSignedUrl(filename) {
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/sign/${PRIVATE_BUCKET}/${filename}`,
    {
      method: "POST",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn: 3600 }),
    }
  );

  const text = await res.text();
  console.log("Signed URL raw response:", text);   // 🧪 debugging

  if (!res.ok) {
    throw new Error(`Signed URL request failed: ${res.status}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    console.error("JSON parse error:", e);
    throw new Error("Failed to decode Supabase JSON");
  }

  console.log("Signed URL object:", data);         // 🧪 debugging

  // Supabase sometimes returns absolute or relative URLs
  const signed = data.signedURL;

  if (!signed) throw new Error("No signed URL returned by Supabase");

  // If absolute URL, return directly
  if (signed.startsWith("http")) return signed;

  // If relative, prepend base URL
  return `${SUPABASE_URL}/storage/v1${signed}`;
}

async function loadPublicJSON(filename) {
  const url = `${SUPABASE_URL}/storage/v1/object/public/${PUBLIC_BUCKET}/${filename}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load public JSON: ${filename}`);
  }
  return res.json();
}


// =========================
// MAIN INITIALIZATION
// =========================

(async function init() {
  try {
    const signedCountsUrl = await getSignedUrl("counts.json");
    const countsData = await fetch(signedCountsUrl).then((r) => r.json());

    const pctColumn = await loadPublicJSON("percentage_column.json");
    const pctGlobal = await loadPublicJSON("percentage_global.json");

    const labels = countsData.columns;
    const matrix = countsData.data;

    window.pctColMatrix = pctColumn.data;
    window.pctGlobalMatrix = pctGlobal.data;

    const chartFixed = document.getElementById("chart-fixed");
    const textPanel = document.getElementById("text-panel");
    const chartDiv = chartFixed.querySelector(".chart");

    renderChord(chartDiv, labels, matrix, "grayscale");

    const sections = document.querySelectorAll(".story-section");
    let currentStep = "grayscale";


    // IntersectionObserver — improved but compatible with your existing logic
    const observer = new IntersectionObserver((entries) => {

      // pick the intersecting entry with the greatest intersectionRatio to avoid flicker
      const visible = entries.filter(e => e.isIntersecting);
      if (!visible.length) return;
      visible.sort((a,b) => b.intersectionRatio - a.intersectionRatio);
      const entry = visible[0];

      const step = entry.target.dataset.step;

      // update active class on sections (keeps existing styles predictable)
      sections.forEach((s) => s.classList.remove("active"));
      entry.target.classList.add("active");

     
      if (step === "grayscale") {
          chartFixed.classList.add("large");
          chartFixed.classList.remove("small");
      } else {
          chartFixed.classList.add("small");
          chartFixed.classList.remove("large");
      }


      // --- NEW: update/fade text panel ---
      // hide first for a short moment so updates don't flash
      if (step === "grayscale") {
        // hide panel on grayscale
        textPanel.classList.remove("visible");
      } else {
        // read the story-text HTML from the current section safely
        const storyEl = entry.target.querySelector(".story-text");
        const html = (storyEl && storyEl.innerHTML) ? storyEl.innerHTML : "";

        // first hide current panel (if visible) then update & show
        // this avoids a flash of empty content while the DOM update happens
        textPanel.classList.remove("visible");

        // small timeout to allow CSS opacity transition to complete (20-80ms)
        setTimeout(() => {
          textPanel.innerHTML = `<div id="text-panel-content">${html}</div>`;
          textPanel.classList.add("visible");
        }, 40);
      }

      // only update chart when actual step changed
      if (step !== currentStep) {
        updateChordTransition(chartDiv, labels, matrix, step);
        currentStep = step;
      }

    }, {
      root: null,
      rootMargin: "0px 0px -60% 0px",
      threshold: [0.25, 0.5, 0.75]   // multiple thresholds -> less noisy
    });

        sections.forEach((s) => observer.observe(s));
      } catch (err) {
        console.error("Failed to initialize:", err);
      }
    })();


/* -----------------------
   RENDER / STRUCTURE
   ----------------------- */
function renderChord(containerNode, labels, matrix,  step) {
  const container = d3.select(containerNode);
  const width = CFG.WIDTH;
  const height = CFG.HEIGHT;
  const outerRadius = Math.min(width, height) / 2 - CFG.OUTER_PADDING;
  const innerRadius = outerRadius - CFG.ARC_THICK;
  const color = d3.scaleOrdinal().domain(labels).range(labels.map(l => colors[l] || '#999'));

  const chords = d3.chord().padAngle(0.05).sortSubgroups(d3.descending)(matrix);

  clear(containerNode);

  const svg = container.append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", [-width/2, -height/2, width, height])
    .attr("class", "chord-svg");
  
  // Center text group
  const center = svg.append("g")
  .attr("class", "center-text")
  .attr("text-anchor", "middle")
  .attr("dominant-baseline", "middle")
  .style("opacity", 0);   // initially hidden

  center.append("text")
    .attr("y", -10)
    .attr("class", "center-main")
    .style("font-size", "22px")
    .style("font-weight", "600")
    .style("fill", "#444")
    .text("Shhor focuses on 8 types of hate");

  center.append("text")
    .attr("y", 25)
    .attr("class", "center-sub")
    .style("font-size", "14px")
    .style("fill", "#777")
    .style("cursor", "pointer")
    .text("See methodology for definitions");


  // defs for gradients
  const defs = svg.append("defs");
  createGradients(defs, chords, labels, color, innerRadius);

  // arcs (groups)
  const groupsG = svg.append("g").attr("class", "chord-groups");
  const group = groupsG.selectAll("g")
    .data(chords.groups)
    .join("g")
    .attr("class", "chord-group");

  group.append("path")
    .attr("d", d3.arc().innerRadius(innerRadius).outerRadius(outerRadius))
    .attr("fill", d => color(labels[d.index]))
    .attr("stroke", "none");

  group.append("text")
    .each(d => { d.angle = (d.startAngle + d.endAngle) / 2; })
    .attr("dy", "0.35em")
    .attr("transform", d => {
      const angle = (d.angle * 180 / Math.PI) - 90;
      return `rotate(${angle}) translate(${outerRadius + 8}) ${d.angle > Math.PI ? "rotate(180)" : ""}`;
    })
    .attr("text-anchor", d => d.angle > Math.PI ? "end" : "start")
    .text(d => labels[d.index])
    .style("font-size", "13px");

  // ribbons
  const ribbonsG = svg.append("g").attr("class", "chord-ribbons").attr("fill-opacity", 0.8);
  const ribbonPaths = ribbonsG.selectAll("path")
    .data(chords)
    .join("path")
    .attr("d", d3.ribbon().radius(innerRadius))
    .attr("fill", d => {
      if (!d?.source || !d?.target) return "#ccc";
      return `url(#grad-${safe(labels[d.source.index])}-${safe(labels[d.target.index])})`;
    })
    .attr("stroke", "none")
    .attr("class", "chord-ribbon");

  ribbonPaths.append("title")
  .text(d => {
    if (!d?.source || !d?.target) return "";

  // layer for static tooltips (added once)
  svg.append("g").attr("class", "static-tooltips");


    const i = d.source.index;
    const j = d.target.index;

    const colPct = window.pctColMatrix[i][j] || 0;
    const globalPct = window.pctGlobalMatrix[i][j] || 0;

    return `
${labels[i]} → ${labels[j]}
Column %: ${colPct.toFixed(2)}%
Global %: ${globalPct.toFixed(2)}%
`.trim();
  });


  // initial styling
  applyStepStyling(svg, labels, color, step, false);
}

/* -----------------------
   GRADIENTS
   ----------------------- */
function createGradients(defs, chords, labels, color, innerRadius) {
  // remove old gradients if any
  defs.selectAll("linearGradient").remove();

  const gradients = defs.selectAll("linearGradient")
    .data(chords)
    .join("linearGradient")
    .attr("id", d => `grad-${safe(labels[d.source.index])}-${safe(labels[d.target.index])}`)
    .attr("gradientUnits", "userSpaceOnUse")
    .attr("x1", d => {
      const a = (d.source.startAngle + d.source.endAngle)/2 - Math.PI/2;
      return Math.cos(a) * innerRadius;
    }).attr("y1", d => {
      const a = (d.source.startAngle + d.source.endAngle)/2 - Math.PI/2;
      return Math.sin(a) * innerRadius;
    }).attr("x2", d => {
      const a = (d.target.startAngle + d.target.endAngle)/2 - Math.PI/2;
      return Math.cos(a) * innerRadius;
    }).attr("y2", d => {
      const a = (d.target.startAngle + d.target.endAngle)/2 - Math.PI/2;
      return Math.sin(a) * innerRadius;
    });

  gradients.append("stop").attr("offset", "0%").attr("stop-color", d => color(labels[d.source.index]));
  gradients.append("stop").attr("offset", "100%").attr("stop-color", d => color(labels[d.target.index]));
}

/* -----------------------
   UPDATE (no re-render) — robust selectors by class
   ----------------------- */
function updateChordTransition(containerNode, labels, matrix,  step) {
  const container = d3.select(containerNode);
  const svg = container.select("svg");
  if (svg.empty()) {
    renderChord(containerNode, labels, matrix,  step);
    return;
  }

  const color = d3.scaleOrdinal().domain(labels).range(labels.map(l => colors[l] || '#999'));

  // re-create gradients (in case chords angles changed with layout)
  const chords = d3.chord().padAngle(0.05).sortSubgroups(d3.descending)(matrix);
  createGradients(svg.select("defs"), chords, labels, color, Math.min(CFG.WIDTH, CFG.HEIGHT)/2 - CFG.OUTER_PADDING - CFG.ARC_THICK);

  // select elements reliably by class
  const groups = svg.selectAll("g.chord-groups .chord-group");
  const ribbonPaths = svg.selectAll("g.chord-ribbons .chord-ribbon").filter(d => d && d.source && d.target);

  applyStepStyling(svg, labels, color, step, true);
}

/* -----------------------
   STYLING / SCENE FUNCTIONS (modular)
   ----------------------- */
function applyStepStyling(svg, labels, color, step, withTransition = false) {
  const duration = withTransition ? CFG.TRANSITION_MS : 0;

  const centerText = svg.select(".center-text");


  const groups = svg.selectAll("g.chord-groups .chord-group");
  const ribbonsAll = svg.selectAll("g.chord-ribbons .chord-ribbon");
  const ribbons = ribbonsAll.filter(d => d && d.source && d.target);

  const idxSexist = labels.indexOf("sexist");
  const idxPolitical = labels.indexOf("political");
  const idxCommunal = labels.indexOf("communal");

  const highSexist = [
    labels.indexOf("political"),
    labels.indexOf("communal"),
    labels.indexOf("casteist"),
    labels.indexOf("queerphobic")
  ];

  const lowSexist = [
    labels.indexOf("racist"),
    labels.indexOf("ablelist")
  ];

  if (step === "grayscale") {
    svg.select(".static-tooltips").selectAll("*").remove();

    ribbons.transition().duration(duration)
      .attr("fill", "#ccc")
      .attr("fill-opacity", 0.3)
      .attr("pointer-events", "none");

    groups.selectAll("path").transition().duration(duration)
      .attr("fill", "#ccc")
      .attr("fill-opacity", 0.4);

    groups.selectAll("text").transition().duration(duration)
      .style("fill", "#999");

    centerText.transition().duration(duration)
      .style("opacity", 0);


    return;
  }

  if (step === "intro") {
    svg.select(".static-tooltips").selectAll("*").remove();

    ribbons.transition().duration(duration)
      .attr("fill-opacity", 0)
      .attr("pointer-events", "none");

    groups.selectAll("path").transition().duration(duration)
      .attr("fill", d => color(labels[d.index]))
      .attr("fill-opacity", 0.35);

    groups.selectAll("text").transition().duration(duration)
      .style("fill", "#222");

    centerText.transition().duration(duration)
      .style("opacity", 1);

    return;
  }

  if (step === "sexist") {
    ribbons.transition().duration(duration)
      .attr("fill", d => `url(#grad-${safe(labels[d.source.index])}-${safe(labels[d.target.index])})`)
      .attr("fill-opacity", d => {
        const i = d.source.index;
        const j = d.target.index;

        const touchesSexist = (i === idxSexist || j === idxSexist);

        if (!touchesSexist) return 0.02;

        const otherSide = (i === idxSexist ? j : i);

        if (highSexist.includes(otherSide)) return 1.0;
        if (lowSexist.includes(otherSide)) return 0.4;

        return 0.1; // fallback
      })
      .attr("pointer-events", d => {
        const i = d.source.index;
        const j = d.target.index;
        return (i === idxSexist || j === idxSexist) ? "auto" : "none";
      });

    groups.selectAll("path").transition().duration(duration)
      .attr("fill", d => (d.index === idxSexist ? color(labels[d.index]) : "#ccc"))
      .attr("fill-opacity", d => (d.index === idxSexist ? 1 : 0.5));

    groups.selectAll("text").transition().duration(duration)
      .style("fill", d => (d.index === idxSexist ? "#222" : "#999"));


    centerText.transition().duration(duration)
      .style("opacity", 0);

    setTimeout(() => {
      drawStaticTooltips(svg, labels, color, step);
    }, duration + 30);
    return;
  }

  if (step === "political") {

    ribbons.transition().duration(duration)
      .attr("fill", d => `url(#grad-${safe(labels[d.source.index])}-${safe(labels[d.target.index])})`)
      .attr("fill-opacity", d => {
        const i = d.source.index;
        const j = d.target.index;

        const touchesP = (i === idxPolitical || j === idxPolitical);
        const touchesC = (i === idxCommunal || j === idxCommunal);

        if (touchesP && touchesC) return 1.0;   // direct P-C link
        if (touchesP || touchesC) return 0.4;   // touches P or C
        return 0.02;                            // neither
      })
      .attr("pointer-events", d => {
        const i = d.source.index;
        const j = d.target.index;
        return (i === idxPolitical || j === idxPolitical || i === idxCommunal || j === idxCommunal)
          ? "auto"
          : "none";
      });

    groups.selectAll("path").transition().duration(duration)
      .attr("fill", d => (
        d.index === idxPolitical || d.index === idxCommunal
          ? color(labels[d.index])
          : "#ccc"
      ))
      .attr("fill-opacity", d => (
        d.index === idxPolitical || d.index === idxCommunal ? 1 : 0.5
      ));

    groups.selectAll("text").transition().duration(duration)
      .style("fill", d =>
        (d.index === idxPolitical || d.index === idxCommunal ? "#222" : "#999")
      );

    centerText.transition().duration(duration)
      .style("opacity", 0);

    setTimeout(() => {
      drawStaticTooltips(svg, labels, color, step);
    }, duration + 30);

    return;
  }

  if (step === "full") {
    svg.select(".static-tooltips").selectAll("*").remove();

    ribbons.transition().duration(duration)
      .attr("fill", d => `url(#grad-${safe(labels[d.source.index])}-${safe(labels[d.target.index])})`)
      .attr("fill-opacity", 0.9)
      .attr("pointer-events", "auto");

    groups.selectAll("path").transition().duration(duration)
      .attr("fill", d => color(labels[d.index]))
      .attr("fill-opacity", 1);

    groups.selectAll("text").transition().duration(duration)
      .style("fill", "#222");

    groups.on("mouseover", function (_, d) {
      ribbons.filter(r => r && r.source && r.target)
        .attr("fill-opacity", r =>
          (r.source.index === d.index || r.target.index === d.index ? 1 : 0.08)
        );
    });

    groups.on("mouseout", function () {
      ribbons.filter(r => r && r.source && r.target)
        .attr("fill-opacity", 0.9);
    });

    centerText.transition().duration(duration)
      .style("opacity", 0);

    return;
  }
}

function drawStaticTooltips(svg, labels, color, step) {
  const tooltipLayer = svg.select(".static-tooltips");
  tooltipLayer.selectAll("*").remove();


  // Gather ribbons currently rendered
  const ribbons = svg.selectAll("g.chord-ribbons .chord-ribbon")
  .filter(function(d) {
    // read the computed fill-opacity from the browser, fallback to the attribute
    const comp = window.getComputedStyle(this).getPropertyValue("fill-opacity");
    const attr = d3.select(this).attr("fill-opacity");
    const op = parseFloat(comp || attr || 0);
    return op >= 0.9; // treat near-opaque as visible
  })
  .data();


  if (!ribbons.length) return;

  // Deduplicate pairs
  const uniquePairs = [];
  const seen = new Set();

  ribbons.forEach(d => {
    const i = d.source.index;
    const j = d.target.index;
    const key = i < j ? `${i}-${j}` : `${j}-${i}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniquePairs.push([i, j, d]);
    }
  });

  const outerRadius = Math.min(CFG.WIDTH, CFG.HEIGHT) / 2 - CFG.OUTER_PADDING;
  const offset = 40;

  // Compute positions
  const positioned = uniquePairs.map(([i, j, d]) => {
    const angle = (d.source.startAngle + d.source.endAngle) / 2;

    const x = Math.cos(angle - Math.PI/2) * (outerRadius + offset);
    const y = Math.sin(angle - Math.PI/2) * (outerRadius + offset);

    return {
      i, j, d, angle, x, y,
      side: (Math.cos(angle - Math.PI/2) > 0 ? "right" : "left")
    };
  });

  // Sort by X so collision logic is predictable
  positioned.sort((a, b) => a.y - b.y);

  // Collision avoidance
  const minGap = 22;
  for (let k = 1; k < positioned.length; k++) {
    if (Math.abs(positioned[k].y - positioned[k - 1].y) < minGap) {
      positioned[k].y = positioned[k - 1].y + minGap;
    }
  }

  // Draw each tooltip set
  positioned.forEach((p) => {
    const { i, j, x, y } = p;

    const A = labels[i];
    const B = labels[j];

    const pctAtoB = window.pctColMatrix[i][j] || 0;
    const pctBtoA = window.pctColMatrix[j][i] || 0;

    // Connector line
    tooltipLayer.append("line")
      .attr("x1", Math.cos(p.angle - Math.PI/2) * outerRadius)
      .attr("y1", Math.sin(p.angle - Math.PI/2) * outerRadius)
      .attr("x2", x)
      .attr("y2", y)
      .attr("stroke", color(labels[i]))
      .attr("stroke-width", 1.5)
      .attr("opacity", 0.8);

    const g = tooltipLayer.append("g")
      .attr("transform", `translate(${x}, ${y})`)
      .attr("class", "static-tooltip");

    // Tooltip block
    g.append("rect")
      .attr("x", 0)
      .attr("y", -28)
      .attr("rx", 3)
      .attr("width", 165)
      .attr("height", 56)
      .attr("fill", "white")
      .attr("stroke", color(labels[i]))
      .attr("stroke-width", 1)
      .attr("opacity", 0.95);

    // Title
    g.append("text")
      .attr("x", 6)
      .attr("y", -10)
      .attr("font-size", 12)
      .attr("font-weight", 600)
      .text(`${A} × ${B}`);

    // Line 2
    g.append("text")
      .attr("x", 6)
      .attr("y", 6)
      .attr("font-size", 11)
      .text(`${pctAtoB.toFixed(2)}% of ${A} is ${B}`);

    // Line 3
    g.append("text")
      .attr("x", 6)
      .attr("y", 20)
      .attr("font-size", 11)
      .text(`${pctBtoA.toFixed(2)}% of ${B} is ${A}`);
  });
}

