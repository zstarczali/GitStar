// Renders one commit-graph row (lanes computed by the Rust backend) as SVG.

export const LANE_W = 14;
export const ROW_H = 26;
const MAX_LANES = 14;

export const COLORS = ['#4c8dff', '#e5534b', '#3fb950', '#d29922', '#a371f7', '#39c5cf', '#f778ba', '#e3793a', '#8ddb5a', '#6e7bff', '#db61a2', '#57ab5a'];
const AI_COLORS = ['#22d3ee', '#a855f7', '#ec4899', '#2ef2c4', '#f59e0b', '#818cf8', '#f472b6', '#34d399', '#c084fc', '#38bdf8', '#fb7185', '#facc15'];
export const laneColor = (i) => {
  const pal = document.documentElement.dataset.theme === 'ai' ? AI_COLORS : COLORS;
  return pal[i % pal.length];
};

const x = (c) => LANE_W / 2 + c * LANE_W + 2;

function seg(x1, y1, x2, y2, color) {
  if (x1 === x2) return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}"/>`;
  const my = (y1 + y2) / 2;
  return `<path d="M${x1} ${y1} C${x1} ${my} ${x2} ${my} ${x2} ${y2}" stroke="${color}" fill="none"/>`;
}

export function graphWidth(rows) {
  let w = 1;
  for (const r of rows) if (r.graph.width > w) w = r.graph.width;
  return Math.min(w, MAX_LANES) * LANE_W + 6;
}

export function graphSvg(commit, width, isHead) {
  const g = commit.graph;
  const mid = ROW_H / 2;
  let s = `<svg class="g" width="${width}" height="${ROW_H}" stroke-width="2" stroke-linecap="round">`;
  for (const [a, b, c] of g.top) s += seg(x(a), 0, x(b), mid, laneColor(c));
  for (const [a, b, c] of g.bottom) s += seg(x(a), mid, x(b), ROW_H, laneColor(c));
  const cx = x(g.col), col = laneColor(g.color);
  if (isHead) {
    s += `<circle cx="${cx}" cy="${mid}" r="6.5" fill="var(--bg)" stroke="${col}" stroke-width="2.5"/><circle cx="${cx}" cy="${mid}" r="3" fill="${col}" stroke="none"/>`;
  } else if (commit.parents.length > 1) {
    s += `<circle cx="${cx}" cy="${mid}" r="4.5" fill="var(--bg)" stroke="${col}" stroke-width="2.5"/>`;
  } else {
    s += `<circle cx="${cx}" cy="${mid}" r="5" fill="${col}" stroke="var(--bg)" stroke-width="1.5"/>`;
  }
  return s + '</svg>';
}
