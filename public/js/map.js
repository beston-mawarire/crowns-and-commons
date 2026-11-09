// The continent: a field of hexagonal "parishes" split into as many regions as there
// are players. No images and no engine, just SVG. Painting a region means colouring
// its parishes outward from the capital, like ink spreading on paper.

const COLS = 34;
const ROWS = 24;
const S = 10; // hex radius
const HW = Math.sqrt(3) * S; // hex width
export const MAP_W = (COLS + 0.5) * HW;
export const MAP_H = (ROWS - 1) * 1.5 * S + 2 * S;

// Where each region's capital sits, in coordinates where the continent spans about -1..1.
const SEEDS = {
  2: [[-0.47, 0.08], [0.47, -0.08]],
  3: [[-0.5, -0.22], [0.52, -0.2], [0.02, 0.52]],
  4: [[-0.5, -0.36], [0.5, -0.36], [-0.48, 0.42], [0.5, 0.42]],
  5: [[0.0, 0.02], [-0.6, -0.36], [0.6, -0.38], [-0.56, 0.46], [0.6, 0.44]],
};

function coast(theta) {
  return 0.81 * (1 + 0.13 * Math.sin(3 * theta + 0.6) + 0.09 * Math.sin(5 * theta + 2.1) + 0.06 * Math.sin(2 * theta + 4.0) + 0.04 * Math.sin(9 * theta + 1.0));
}

const NEIGHBOURS = [
  // even rows, then odd rows (pointy-top hexes, odd rows shifted right)
  [[-1, -1], [0, -1], [-1, 0], [1, 0], [-1, 1], [0, 1]],
  [[0, -1], [1, -1], [-1, 0], [1, 0], [0, 1], [1, 1]],
];

const centre = (c, r) => [(c + (r % 2) / 2) * HW + HW / 2, r * 1.5 * S + S];

export function buildMap(n) {
  const seeds = SEEDS[n];
  const grid = new Map();
  const cells = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const [x, y] = centre(c, r);
      const u = (x - MAP_W / 2) / (MAP_W * 0.47);
      const v = (y - MAP_H / 2) / (MAP_H * 0.47);
      if (Math.hypot(u, v) >= coast(Math.atan2(v, u))) continue;
      let region = 0;
      let best = Infinity;
      seeds.forEach(([su, sv], i) => {
        // A little wobble keeps the borders from being ruler-straight.
        const d = Math.hypot(u - su, v - sv) + 0.05 * Math.sin(6 * u + 4 * v + i * 2.3) + 0.04 * Math.cos(5 * v - 3 * u + i) + (n === 5 && i === 0 ? 0.07 : 0);
        if (d < best) [best, region] = [d, i];
      });
      const cell = { i: cells.length, c, r, x, y, u, v, region };
      grid.set(c + "," + r, cell);
      cells.push(cell);
    }

  const regions = seeds.map(([su, sv], i) => {
    const mine = cells.filter((cell) => cell.region === i);
    const capital = mine.reduce((a, b) => (Math.hypot(a.u - su, a.v - sv) < Math.hypot(b.u - su, b.v - sv) ? a : b));
    const order = mine.slice().sort((a, b) => Math.hypot(a.x - capital.x, a.y - capital.y) - Math.hypot(b.x - capital.x, b.y - capital.y));
    return {
      capital,
      order: order.map((cell) => cell.i),
      cx: mine.reduce((a, cell) => a + cell.x, 0) / mine.length,
      cy: mine.reduce((a, cell) => a + cell.y, 0) / mine.length,
      top: Math.min(...mine.map((cell) => cell.y)),
    };
  });

  // Edges: coastline where a hex meets the sea, borders where two regions meet.
  // Each region also gets an outline just inside its own edge, drawn in its party's colour.
  const coastEdges = [];
  const borderEdges = [];
  const outlines = seeds.map(() => []);
  const INSET = 2.6;
  for (const cell of cells) {
    for (const [dc, dr] of NEIGHBOURS[cell.r % 2]) {
      const other = grid.get(cell.c + dc + "," + (cell.r + dr));
      if (other && other.region === cell.region) continue;
      const [ox, oy] = centre(cell.c + dc, cell.r + dr);
      const mx = (cell.x + ox) / 2;
      const my = (cell.y + oy) / 2;
      const len = Math.hypot(ox - cell.x, oy - cell.y);
      const ux = (ox - cell.x) / len;
      const uy = (oy - cell.y) / len;
      const px = -uy * (S / 2);
      const py = ux * (S / 2);
      const seg = (sx, sy) => `M${(mx - px - sx).toFixed(1)} ${(my - py - sy).toFixed(1)}L${(mx + px - sx).toFixed(1)} ${(my + py - sy).toFixed(1)}`;
      outlines[cell.region].push(seg(ux * INSET, uy * INSET));
      if (other && other.i < cell.i) continue; // draw shared borders once
      (other ? borderEdges : coastEdges).push(seg(0, 0));
    }
  }
  return { n, cells, regions, coastPath: coastEdges.join(""), borderPath: borderEdges.join(""), outlines: outlines.map((o) => o.join("")) };
}

function hexPoints(x, y) {
  const pts = [];
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 180) * (60 * k - 30);
    pts.push((x + S * Math.cos(a)).toFixed(1) + "," + (y + S * Math.sin(a)).toFixed(1));
  }
  return pts.join(" ");
}

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

/** The inside of the <svg>. `names` are the region names, in region order. */
export function mapMarkup(map, names = []) {
  const cells = map.cells.map((cell) => `<polygon class="cell" data-i="${cell.i}" data-region="${cell.region}" points="${hexPoints(cell.x, cell.y)}"/>`).join("");
  const labels = map.regions
    .map((reg, i) => {
      const { x, y } = reg.capital;
      return (
        `<g class="capital"><rect x="${(x - 3.5).toFixed(1)}" y="${(y - 3.5).toFixed(1)}" width="7" height="7" transform="rotate(45 ${x.toFixed(1)} ${y.toFixed(1)})"/></g>` +
        `<text class="region-name" data-region="${i}" x="${x.toFixed(1)}" y="${(y - 12).toFixed(1)}">${esc(names[i] ?? "")}</text>`
      );
    })
    .join("");
  return (
    `<defs><pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
    `<rect width="5" height="5" class="hatch-bg"/><line x1="0" y1="0" x2="0" y2="5" class="hatch-line"/></pattern></defs>` +
    `<g class="cells">${cells}</g>` +
    map.outlines.map((d, i) => `<path class="outline" data-region="${i}" d="${d}"/>`).join("") +
    `<path class="border" d="${map.borderPath}"/><path class="coast" d="${map.coastPath}"/>` +
    `<g class="labels">${labels}</g>`
  );
}

/**
 * Work out a fill for every parish.
 * paint: one entry per region, { p: { partyId: fraction }, old: fraction }.
 * colors: partyId -> css colour. Returns an array of fills indexed by cell.
 */
export function fills(map, paint, colors) {
  const out = new Array(map.cells.length).fill("");
  if (!paint) return out;
  map.regions.forEach((reg, r) => {
    const snap = paint[r];
    if (!snap) return;
    const n = reg.order.length;
    let k = 0;
    const parties = Object.entries(snap.p).sort((a, b) => b[1] - a[1]);
    for (const [id, frac] of parties) for (let m = Math.round(frac * n); m > 0 && k < n; m--) out[reg.order[k++]] = colors[id] ?? "#888";
    for (let m = Math.round(snap.old * n); m > 0 && k < n; m--) out[reg.order[k++]] = "url(#hatch)";
  });
  return out;
}
