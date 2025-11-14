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
    const chartDiv = chartFixed.querySelector(".chart");

    renderChord(chartDiv, labels, matrix, "grayscale");

    const sections = document.querySelectorAll(".story-section");
    let currentStep = "grayscale";

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const step = entry.target.dataset.step;

          sections.forEach((s) => s.classList.remove("active"));
          entry.target.classList.add("active");

          if (step === "grayscale") {
            chartFixed.classList.remove("story-active");
            chartFixed.classList.add("intro-active");
          } else {
            chartFixed.classList.remove("intro-active");
            chartFixed.classList.add("story-active");
          }

          if (step !== currentStep) {
            updateChordTransition(chartDiv, labels, matrix, step);
            currentStep = step;
          }
        });
      },
      {
        root: null,
        rootMargin: "-25% 0px -25% 0px",
        threshold: 0.4,
      }
    );

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

  // select fresh elements each call
  const groups = svg.selectAll("g.chord-groups .chord-group");
  const ribbonPathsAll = svg.selectAll("g.chord-ribbons .chord-ribbon");
  const ribbonPaths = ribbonPathsAll.filter(d => d && d.source && d.target);

  // reset listeners
  groups.on("mouseover", null).on("mouseout", null);

  const safeFillGradient = d => {
    if (!d?.source || !d?.target) return "#ccc";
    return `url(#grad-${safe(labels[d.source.index])}-${safe(labels[d.target.index])})`;
  };

  if (step === "grayscale") {
    ribbonPaths.transition().duration(duration)
      .attr("fill-opacity", 0.3)
      .attr("fill", "#ccc")
      .attr("pointer-events", "none");

    groups.selectAll("path").transition().duration(duration)
      .attr("fill", "#ccc")
      .attr("fill-opacity", 0.4);

    groups.selectAll("text").transition().duration(duration)
      .style("fill", "#999");

  } else if (step === "intro") {
    // only color arcs; hide ribbons completely
    ribbonPaths.transition().duration(duration)
      .attr("fill-opacity", 0)
      .attr("pointer-events", "none");

    groups.selectAll("path").transition().duration(duration)
      .attr("fill", d => color(labels[d.index]))
      .attr("fill-opacity", 0.35);

    groups.selectAll("text").transition().duration(duration)
      .style("fill", "#222");

  } else if (step === "sexist") {
    const idx = labels.indexOf("sexist");
    if (idx === -1) return;

    ribbonPaths.transition().duration(duration)
      .attr("fill-opacity", d => (d.source.index === idx || d.target.index === idx ? 0.95 : 0.08))
      .attr("fill", d => (d.source.index === idx || d.target.index === idx ? safeFillGradient(d) : "#ccc"))
      .attr("pointer-events", d => (d.source.index === idx || d.target.index === idx ? "auto" : "none"));

    groups.selectAll("path").transition().duration(duration)
      .attr("fill", d => (d.index === idx ? color(labels[d.index]) : "#ccc"))
      .attr("fill-opacity", d => (d.index === idx ? 0.95 : 0.5));

    groups.selectAll("text").transition().duration(duration)
      .style("fill", d => (d.index === idx ? "#222" : "#999"));

  } else if (step === "political") {
    const idx1 = labels.indexOf("political");
    const idx2 = labels.indexOf("communal");

    ribbonPaths.transition().duration(duration)
      .attr("fill-opacity", d => ([idx1, idx2].includes(d.source.index) || [idx1, idx2].includes(d.target.index) ? 0.95 : 0.08))
      .attr("fill", d => ([idx1, idx2].includes(d.source.index) || [idx1, idx2].includes(d.target.index) ? safeFillGradient(d) : "#ccc"))
      .attr("pointer-events", d => ([idx1, idx2].includes(d.source.index) || [idx1, idx2].includes(d.target.index) ? "auto" : "none"));

    groups.selectAll("path").transition().duration(duration)
      .attr("fill", d => ([idx1, idx2].includes(d.index) ? color(labels[d.index]) : "#ccc"))
      .attr("fill-opacity", d => ([idx1, idx2].includes(d.index) ? 0.95 : 0.5));

    groups.selectAll("text").transition().duration(duration)
      .style("fill", d => ([idx1, idx2].includes(d.index) ? "#222" : "#999"));

  } else if (step === "full") {
    ribbonPathsAll.transition().duration(duration)
      .attr("fill-opacity", 0.9)
      .attr("fill", d => safeFillGradient(d))
      .attr("pointer-events", "auto");

    groups.selectAll("path").transition().duration(duration)
      .attr("fill", d => color(labels[d.index]))
      .attr("fill-opacity", 1);

    groups.selectAll("text").transition().duration(duration)
      .style("fill", "#222");

    // hover interactions — always re-select valid ribbons inside handler
    groups.on("mouseover", function (_, d) {
      svg.selectAll("g.chord-ribbons .chord-ribbon")
        .filter(r => r && r.source && r.target)
        .attr("fill-opacity", r => (r.source.index === d.index || r.target.index === d.index ? 0.95 : 0.08));
    }).on("mouseout", function () {
      svg.selectAll("g.chord-ribbons .chord-ribbon")
        .filter(r => r && r.source && r.target)
        .attr("fill-opacity", 0.9);
    });
  }
}
