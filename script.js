// script.js
// Requires <script src="https://d3js.org/d3.v7.min.js"></script> in index.html

// your colour palette (keeps same keys as your labels)
const colors = {
  "sexist": "#e41a1c",
  "religious": "#377eb8",
  "political": "#4daf4a",
  "communal": "#984ea3",
  "racist": "#ff7f00",
  "ableist": "#ffff33",
  "homophobic": "#a65628",
  "other": "#f781bf"
};

// Helpers
const safe = str => String(str).replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "");
const clear = sel => d3.select(sel).selectAll("*").remove();

// Main entry: sets up scroll observer and initial layout
document.addEventListener("DOMContentLoaded", () => {
  // Ensure each section has the layout: <section class="story-section" data-step="intro">...
  // and contains <div class="chart-wrap"><div class="chart" id="chart-intro"></div></div>
  // and <div class="story-text" id="text-intro">...</div>
  // (See HTML/CSS snippet below for exact markup.)

  // Load CSV once
  d3.csv("data/matrix.csv").then(data => {
    const labels = data.columns.slice(1);
    const matrix = data.map(d => labels.map(k => +d[k])); // NO preprocessing here (user asked to keep dataset)
    // keep total for percentage tooltips
    const total = d3.sum(matrix.flat());

    // Create an observer to render when section is visible
    const sections = document.querySelectorAll(".story-section");
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(en => {
        if (en.isIntersecting) {
          const step = en.target.dataset.step;
          const chartSel = en.target.querySelector(".chart");
          // render for this step
          clear(chartSel);
          renderChord(chartSel, labels, matrix, total, step);
        }
      });
    }, { root: null, rootMargin: "0px 0px -30% 0px", threshold: 0.3 });

    sections.forEach(s => observer.observe(s));
  }).catch(err => {
    console.error("Failed to load CSV:", err);
  });
});

function renderChord(containerNode, labels, matrix, total, step) {
  // containerNode is DOM element (e.g. a div.chart)
  const container = d3.select(containerNode);
  const width = 700;
  const height = 700;
  const outerRadius = Math.min(width, height) / 2 - 80;
  const innerRadius = outerRadius - 30;

  const color = d3.scaleOrdinal().domain(labels).range(Object.values(colors));

  // chord layout (use full chords — user said dataset is modified to remove zero rows if desired)
  const chords = d3.chord()
    .padAngle(0.05)
    .sortSubgroups(d3.descending)(matrix);

  // clear and build svg
  clear(containerNode);
  const svg = container.append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", [-width / 2, -height / 2, width, height]);

  // create defs for gradients (one gradient per chord)
  const defs = svg.append("defs");

  const gradients = defs.selectAll("linearGradient")
    .data(chords) // create gradients for every chord
    .join("linearGradient")
    .attr("id", d => `grad-${safe(labels[d.source.index])}-${safe(labels[d.target.index])}`)
    .attr("gradientUnits", "userSpaceOnUse") // important for coordinates in chart space
    .attr("x1", d => {
      const a = (d.source.startAngle + d.source.endAngle) / 2 - Math.PI / 2;
      return Math.cos(a) * innerRadius;
    })
    .attr("y1", d => {
      const a = (d.source.startAngle + d.source.endAngle) / 2 - Math.PI / 2;
      return Math.sin(a) * innerRadius;
    })
    .attr("x2", d => {
      const a = (d.target.startAngle + d.target.endAngle) / 2 - Math.PI / 2;
      return Math.cos(a) * innerRadius;
    })
    .attr("y2", d => {
      const a = (d.target.startAngle + d.target.endAngle) / 2 - Math.PI / 2;
      return Math.sin(a) * innerRadius;
    });

  gradients.append("stop")
    .attr("offset", "0%")
    .attr("stop-color", d => color(labels[d.source.index]));

  gradients.append("stop")
    .attr("offset", "100%")
    .attr("stop-color", d => color(labels[d.target.index]));

  // groups (outer arcs + labels)
  const group = svg.append("g")
    .selectAll("g")
    .data(chords.groups)
    .join("g");

  group.append("path")
    .attr("d", d3.arc().innerRadius(innerRadius).outerRadius(outerRadius))
    .attr("fill", d => color(labels[d.index]))
    .attr("stroke", d => d3.rgb(color(labels[d.index])).darker());

  // labels: horizontal-ish placement, fallback to rotated if cramped
  group.append("text")
    .each(d => d.angle = (d.startAngle + d.endAngle) / 2)
    .attr("dy", "0.35em")
    .attr("transform", d => {
      const angle = (d.angle * 180 / Math.PI) - 90;
      return `rotate(${angle}) translate(${outerRadius + 8}) ${d.angle > Math.PI ? "rotate(180)" : ""}`;
    })
    .attr("text-anchor", d => d.angle > Math.PI ? "end" : "start")
    .text(d => labels[d.index])
    .style("font-size", "13px");

  // Ribbons (use chords data)
  const ribbonPaths = svg.append("g")
    .attr("fill-opacity", 0.8)
    .selectAll("path")
    .data(chords)
    .join("path")
    .attr("d", d3.ribbon().radius(innerRadius))
    .attr("fill", d => `url(#grad-${safe(labels[d.source.index])}-${safe(labels[d.target.index])})`)
    .attr("stroke", "none");

  // Tooltips: percentages (raw number -> percent of total)
  ribbonPaths.append("title")
    .text(d => {
      const pct = (d.source.value / total) * 100;
      return `${labels[d.source.index]} → ${labels[d.target.index]}: ${pct.toFixed(2)}%`;
    });

  // Apply step-specific styling
  if (step === "intro") {
    // hide ribbons, fade arcs
    ribbonPaths.attr("fill-opacity", 0);
    group.selectAll("path").attr("fill-opacity", 0.35);

    // center image (intro only) - leave image placeholder for you to replace file
    svg.append("image")
      .attr("href", "images/intersections_of_hate.png")
      .attr("width", 220)
      .attr("height", 220)
      .attr("x", -110)
      .attr("y", -110);
  } else if (step === "sexist") {
    // highlight sexist; dim others to grey 50% opacity
    const idx = labels.indexOf("sexist");
    ribbonPaths
      .attr("fill-opacity", d => (d.source.index === idx || d.target.index === idx ? 0.95 : 0.5))
      .attr("fill", d => (d.source.index === idx || d.target.index === idx ? `url(#grad-${safe(labels[d.source.index])}-${safe(labels[d.target.index])})` : "#ccc"))
      .attr("stroke", "none");

    group.selectAll("path")
      .attr("fill", d => (d.index === idx ? color(labels[d.index]) : "#ccc"))
      .attr("fill-opacity", d => (d.index === idx ? 0.95 : 0.5));
  } else if (step === "political") {
    const idx1 = labels.indexOf("political");
    const idx2 = labels.indexOf("communal");
    ribbonPaths
      .attr("fill-opacity", d => ([idx1, idx2].includes(d.source.index) || [idx1, idx2].includes(d.target.index) ? 0.95 : 0.5))
      .attr("fill", d => ([idx1, idx2].includes(d.source.index) || [idx1, idx2].includes(d.target.index) ? `url(#grad-${safe(labels[d.source.index])}-${safe(labels[d.target.index])})` : "#ccc"))
      .attr("stroke", "none");

    group.selectAll("path")
      .attr("fill", d => ([idx1, idx2].includes(d.index) ? color(labels[d.index]) : "#ccc"))
      .attr("fill-opacity", d => ([idx1, idx2].includes(d.index) ? 0.95 : 0.5));
  } else if (step === "full") {
    // full chart: all colourful, hover interaction enabled
    ribbonPaths.attr("fill-opacity", 0.9);
    group.selectAll("path").attr("fill-opacity", 1);

    // hover only in 'full'
    group.on("mouseover", (event, d) => {
      ribbonPaths.attr("fill-opacity", r => (r.source.index === d.index || r.target.index === d.index ? 0.95 : 0.08));
    }).on("mouseout", () => {
      ribbonPaths.attr("fill-opacity", 0.9);
    });
  }
}
