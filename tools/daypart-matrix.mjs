// Hour-by-hour audience priority matrix for a Pacific-anchored global internet station.
// Timezone math is fact; propensity curves are stated assumptions (see ASSUMPTIONS).
import { writeFileSync } from "node:fs";

// --- regions: UTC offset (summer), share of potential audience ---
const REGIONS = [
  { key: "ET", name: "US Eastern",  off: -4, w: 0.33 },
  { key: "CT", name: "US Central",  off: -5, w: 0.20 },
  { key: "MT", name: "US Mountain", off: -6, w: 0.05 },
  { key: "PT", name: "US Pacific",  off: -7, w: 0.14, home: true },
  { key: "CE", name: "Cent. Europe",off:  2, w: 0.16 },
  { key: "UK", name: "UK/Ireland",  off:  1, w: 0.12 },
];
const STATION_OFF = -7; // America/Los_Angeles, PDT

// --- listening propensity by LOCAL hour (0..1). Desk-listening shaped, not drive-shaped. ---
const WEEKDAY = [.10,.07,.05,.05,.07,.12,.25,.45,.65,.80,.88,.90,.85,.88,.88,.85,.78,.70,.60,.55,.52,.48,.38,.22];
const FRIDAY  = [.10,.07,.05,.05,.07,.12,.25,.45,.65,.80,.88,.90,.85,.88,.86,.82,.75,.70,.66,.66,.64,.60,.52,.34];
const WEEKEND = [.15,.12,.08,.06,.05,.06,.10,.16,.25,.35,.45,.52,.55,.58,.58,.55,.52,.50,.50,.52,.55,.52,.45,.30];

// --- session character by local hour: what KIND of listening is happening ---
function sessionKind(localHour, isWeekend) {
  if (localHour < 6) return "dead";
  if (isWeekend) return localHour < 10 ? "slow" : localHour < 19 ? "long" : "evening";
  if (localHour < 10) return "morning";     // short sessions, cume-driven
  if (localHour < 16) return "long";        // desk listening, TSL-driven
  if (localHour < 19) return "afternoon";   // short sessions, cume-driven
  return "evening";                          // long sessions, familiarity-driven
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const curveFor = (dow) => (dow === 0 || dow === 6 ? WEEKEND : dow === 5 ? FRIDAY : WEEKDAY);

const cells = [];
for (let dow = 0; dow < 7; dow++) {
  for (let hour = 0; hour < 24; hour++) {
    let index = 0;
    const kinds = {};
    const present = [];
    for (const r of REGIONS) {
      // station-local hour -> that region's local hour (and possibly adjacent day)
      const shifted = hour + (r.off - STATION_OFF);
      const rHour = ((shifted % 24) + 24) % 24;
      const dayShift = Math.floor(shifted / 24);
      const rDow = ((dow + dayShift) % 7 + 7) % 7;
      const isWknd = rDow === 0 || rDow === 6;
      const p = curveFor(rDow)[rHour];
      const contrib = r.w * p;
      index += contrib;
      const k = sessionKind(rHour, isWknd);
      kinds[k] = (kinds[k] ?? 0) + contrib;
      present.push({ key: r.key, rHour, contrib, home: !!r.home });
    }
    present.sort((a, b) => b.contrib - a.contrib);
    const topKind = Object.entries(kinds).sort((a, b) => b[1] - a[1])[0][0];
    const homeShare = present.filter((p) => p.home).reduce((s, p) => s + p.contrib, 0) / index;
    const usShare = present.filter((p) => ["ET","CT","MT","PT"].includes(p.key))
      .reduce((s, p) => s + p.contrib, 0) / index;
    cells.push({ dow, hour, index, topKind, kinds, present, homeShare, usShare });
  }
}

const max = Math.max(...cells.map((c) => c.index));
for (const c of cells) c.norm = c.index / max;

// --- orientation: what the hour should sound like ---
function orient(c) {
  const share = (k) => (c.kinds[k] ?? 0) / c.index;
  const cume = share("morning") + share("afternoon");
  const tsl = share("long") + share("evening");
  if (c.norm < 0.32) return "DEEP GOLD";
  if (cume >= 0.45) return "CURRENT-FORWARD";
  if (share("evening") >= 0.40) return "GOLD-LEAN";
  if (tsl >= 0.55) return "BALANCED-TSL";
  return "BALANCED";
}
for (const c of cells) c.orientation = orient(c);

// --- report ---
const off = (h, o) => String((((h + (o - STATION_OFF)) % 24) + 24) % 24).padStart(2, "0");
let out = "";
const table = (dow, label) => {
  out += `\n### ${label}\n\n`;
  out += "| PT | ET | CE | Index | Orientation | Top regions (local hr) |\n|---|---|---|---|---|---|\n";
  for (const c of cells.filter((x) => x.dow === dow)) {
    const top = c.present.slice(0, 3).map((p) => `${p.key}${p.rHour}`).join(" ");
    out += `| ${String(c.hour).padStart(2, "0")} | ${off(c.hour, -4)} | ${off(c.hour, 2)} | ${(c.norm * 100).toFixed(0)} | ${c.orientation} | ${top} |\n`;
  }
};
table(1, "Mon–Thu (identical)");
table(5, "Friday");
table(6, "Saturday");
table(0, "Sunday");

// --- clustering: distinct (orientation, index band) signatures ---
const band = (n) => (n < 0.32 ? "low" : n < 0.55 ? "mid" : n < 0.78 ? "high" : "peak");
const sig = new Map();
for (const c of cells) {
  const k = `${c.orientation}|${band(c.norm)}`;
  if (!sig.has(k)) sig.set(k, []);
  sig.get(k).push(c);
}
out += `\n### Clusters (${sig.size} distinct signatures across 168 hours)\n\n`;
out += "| Signature | Hours/wk | Where |\n|---|---|---|\n";
for (const [k, list] of [...sig].sort((a, b) => b[1].length - a[1].length)) {
  const byDay = {};
  for (const c of list) (byDay[DOW[c.dow]] ??= []).push(c.hour);
  const where = Object.entries(byDay)
    .map(([d, hs]) => `${d} ${hs.sort((a, b) => a - b).join(",")}`)
    .join("; ");
  out += `| ${k} | ${list.length} | ${where} |\n`;
}
writeFileSync("/tmp/claude-1000/-run-media-alden-Storage-a-rotavox-app/9831b76a-6dfe-4d75-8cc2-a9df25865810/scratchpad/matrix.md", out);
console.log(out.slice(0, 200));
console.log(`\n${sig.size} clusters; wrote matrix.md`);
