import React, { useMemo, useState, useEffect, useRef } from "react";
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from "recharts";
import { Zap, BatteryCharging, MapPin, TrendingDown, TrendingUp, Building2, Gauge } from "lucide-react";

/* ============================================================================
   SYNTHETIC GRID DATA ENGINE
   Generates realistic-shaped (not real) hourly wholesale prices and building
   usage for a full year, then runs them through a tariff calc engine modeled
   on common utility rate structures (fixed / tiered / time-of-use / demand /
   index pricing) and a physically-consistent battery peak-shaving simulator.
   ========================================================================== */

function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function buildCalendar() {
  // 2025: non-leap, Jan 1 is a Wednesday. dow: 1=Sun ... 7=Sat (matches API docs convention)
  const cal = [];
  let dow = 4;
  for (let m = 0; m < 12; m++) {
    for (let d = 1; d <= DAYS_IN_MONTH[m]; d++) {
      for (let h = 0; h < 24; h++) cal.push({ month: m, dow, hour: h });
      dow = (dow % 7) + 1;
    }
  }
  return cal;
}
const CAL = buildCalendar();

const ISO_PROFILES = {
  ercot: { name: "ERCOT", base: 0.032, summerPeak: 3.2, winterPeak: 1.6, volatility: 0.55, peakHour: 17 },
  nyiso: { name: "NYISO", base: 0.045, summerPeak: 2.0, winterPeak: 1.8, volatility: 0.35, peakHour: 18 },
  pjm:   { name: "PJM",   base: 0.038, summerPeak: 1.9, winterPeak: 1.6, volatility: 0.30, peakHour: 17 },
  miso:  { name: "MISO",  base: 0.030, summerPeak: 1.7, winterPeak: 1.5, volatility: 0.30, peakHour: 17 },
  caiso: { name: "CAISO", base: 0.040, summerPeak: 2.4, winterPeak: 1.3, volatility: 0.40, peakHour: 19 },
  spp:   { name: "SPP",   base: 0.026, summerPeak: 1.6, winterPeak: 1.4, volatility: 0.30, peakHour: 17 },
  neiso: { name: "NEISO", base: 0.048, summerPeak: 1.8, winterPeak: 2.1, volatility: 0.35, peakHour: 18 },
};

function generateHourlyPrices(isoPrefix, seedStr) {
  const prof = ISO_PROFILES[isoPrefix];
  const rand = mulberry32(hashSeed(seedStr + isoPrefix));
  const out = new Float64Array(CAL.length);
  for (let i = 0; i < CAL.length; i++) {
    const { month, hour } = CAL[i];
    const isSummer = month >= 5 && month <= 8;
    const isWinter = month === 11 || month <= 1;
    const seasonal = isSummer ? prof.summerPeak : isWinter ? prof.winterPeak : 1.0;
    const dist = Math.abs(hour - prof.peakHour);
    const daily = 1 + 1.4 * Math.exp(-(dist * dist) / 18);
    const overnightDip = hour >= 1 && hour <= 5 ? 0.55 : 1;
    const noise = 1 + (rand() - 0.5) * prof.volatility;
    out[i] = Math.max(prof.base * seasonal * daily * overnightDip * noise, 0.005);
  }
  return out;
}

const BUILDING_SHAPES = {
  SmallOffice: {
    label: "Small Office",
    weekday: [.3,.3,.3,.3,.3,.4,.6,1,1.3,1.4,1.4,1.4,1.2,1.4,1.4,1.3,1.1,.8,.5,.4,.35,.3,.3,.3],
    weekend: [.3,.3,.3,.3,.3,.3,.35,.4,.45,.5,.5,.5,.5,.5,.45,.4,.4,.35,.3,.3,.3,.3,.3,.3],
    summerBump: 1.35, winterBump: 1.2,
  },
  Retail: {
    label: "Retail Store",
    weekday: [.2,.2,.2,.2,.2,.3,.4,.6,.9,1.1,1.2,1.3,1.3,1.3,1.3,1.3,1.3,1.2,1.0,.8,.6,.4,.3,.25],
    weekend: [.2,.2,.2,.2,.2,.3,.5,.8,1.1,1.3,1.4,1.5,1.5,1.5,1.5,1.4,1.3,1.1,.9,.6,.4,.3,.25,.2],
    summerBump: 1.3, winterBump: 1.1,
  },
  SmallHotel: {
    label: "Small Hotel",
    weekday: [.9,.85,.8,.8,.8,.85,.95,1,.95,.85,.8,.8,.8,.8,.85,.9,1,1.1,1.2,1.25,1.2,1.1,1,.95],
    weekend: [.9,.85,.8,.8,.8,.85,.9,.95,.95,.9,.85,.85,.85,.85,.9,.95,1.05,1.15,1.25,1.3,1.25,1.15,1.05,.95],
    summerBump: 1.4, winterBump: 1.25,
  },
  Warehouse: {
    label: "Warehouse",
    weekday: [.5,.5,.5,.5,.5,.6,.8,1,1.1,1.1,1.1,1.1,1,1.1,1.1,1.1,1,.8,.6,.5,.5,.5,.5,.5],
    weekend: [.45,.45,.45,.45,.45,.45,.5,.55,.6,.6,.6,.6,.6,.6,.6,.6,.55,.5,.48,.46,.45,.45,.45,.45],
    summerBump: 1.15, winterBump: 1.1,
  },
  MidriseApartment: {
    label: "Apartment Building",
    weekday: [.7,.65,.6,.6,.6,.7,.9,1,.85,.7,.65,.65,.65,.65,.7,.8,.95,1.15,1.3,1.25,1.1,1,.9,.8],
    weekend: [.75,.7,.65,.6,.6,.65,.75,.9,1,.95,.9,.9,.9,.9,.9,.95,1.05,1.2,1.3,1.25,1.15,1.05,.95,.85],
    summerBump: 1.3, winterBump: 1.2,
  },
};

function generateHourlyUsage(buildingType, monthlyAvgKwh, seedStr) {
  const shape = BUILDING_SHAPES[buildingType] || BUILDING_SHAPES.SmallOffice;
  const rand = mulberry32(hashSeed(seedStr + buildingType));
  const raw = new Float64Array(CAL.length);
  const monthSums = new Array(12).fill(0);
  for (let i = 0; i < CAL.length; i++) {
    const { month, dow, hour } = CAL[i];
    const isWeekend = dow === 1 || dow === 7;
    const base = isWeekend ? shape.weekend[hour] : shape.weekday[hour];
    const isSummer = month >= 5 && month <= 8;
    const isWinter = month === 11 || month <= 1;
    const seasonal = isSummer ? shape.summerBump : isWinter ? shape.winterBump : 1.0;
    const v = base * seasonal * (1 + (rand() - 0.5) * 0.08);
    raw[i] = v;
    monthSums[month] += v;
  }
  const out = new Float64Array(CAL.length);
  for (let i = 0; i < CAL.length; i++) {
    out[i] = (raw[i] / monthSums[CAL[i].month]) * monthlyAvgKwh;
  }
  return out;
}

/* ---------------- Tariff schema + calc engine ---------------- */
function evaluateTieredRange(range, x) {
  let applicable = range[0];
  for (const tier of range) if (x >= tier.from) applicable = tier;
  return applicable.cost;
}

function buildTariffs(location) {
  const p = location.priceLevel;
  return [
    {
      id: "standard", name: "Standard Flat", blurb: "One flat rate, every hour.",
      charges: {
        customer: { range: [{ cost: 12 * p, from: 0 }] },
        energy: [{ range: [{ cost: 0.11 * p, from: 0 }] }],
        demand: null,
      },
    },
    {
      id: "tou", name: "Time-of-Use", blurb: "Cheaper nights, pricier 2–8pm weekdays.",
      charges: {
        customer: { range: [{ cost: 10 * p, from: 0 }] },
        energy: [
          { range: [{ cost: 0.19 * p, from: 0 }], time_period: { hours: [14,15,16,17,18,19], days_of_week: [2,3,4,5,6] } },
          { range: [{ cost: 0.075 * p, from: 0 }], time_period: null },
        ],
        demand: null,
      },
    },
    {
      id: "demand", name: "Commercial Demand", blurb: "Lower energy rate, plus a monthly peak-kW charge.",
      charges: {
        customer: { range: [{ cost: 45 * p, from: 0 }] },
        energy: [{ range: [{ cost: 0.085 * p, from: 0 }] }],
        demand: { range: [{ cost: 16 * p, from: 0 }, { cost: 11 * p, from: 50 }] },
      },
    },
  ];
}

function calculateBill(tariff, usageArr, priceArr) {
  const monthly = Array.from({ length: 12 }, () => ({
    customer: 0, energy: 0, demand: 0, total: 0, wholesale: 0, usageKwh: 0, peakKw: 0,
  }));
  for (let i = 0; i < CAL.length; i++) {
    const { month, dow, hour } = CAL[i];
    const usage = usageArr[i], price = priceArr[i], m = monthly[month];
    m.usageKwh += usage;
    m.wholesale += usage * price;
    if (usage > m.peakKw) m.peakKw = usage;

    let matched = null, fallback = null;
    for (const line of tariff.charges.energy) {
      if (!line.time_period) { fallback = line; continue; }
      if (line.time_period.hours.includes(hour) && line.time_period.days_of_week.includes(dow)) { matched = line; break; }
    }
    const line = matched || fallback;
    if (line) m.energy += usage * evaluateTieredRange(line.range, m.usageKwh);
  }
  for (let m = 0; m < 12; m++) {
    monthly[m].customer = evaluateTieredRange(tariff.charges.customer.range, monthly[m].usageKwh);
    if (tariff.charges.demand) {
      const rate = evaluateTieredRange(tariff.charges.demand.range, monthly[m].peakKw);
      monthly[m].demand = rate * monthly[m].peakKw;
    }
    monthly[m].total = monthly[m].customer + monthly[m].energy + monthly[m].demand;
  }
  const annual = monthly.reduce((a, m) => ({
    customer: a.customer + m.customer, energy: a.energy + m.energy, demand: a.demand + m.demand,
    total: a.total + m.total, wholesale: a.wholesale + m.wholesale, usageKwh: a.usageKwh + m.usageKwh,
  }), { customer: 0, energy: 0, demand: 0, total: 0, wholesale: 0, usageKwh: 0 });
  return { monthly, annual };
}

function fixedPriceBill(usageArr, ratePerKwh, monthlyFee) {
  const monthly = Array.from({ length: 12 }, () => ({ total: 0, usageKwh: 0 }));
  for (let i = 0; i < CAL.length; i++) monthly[CAL[i].month].usageKwh += usageArr[i];
  for (let m = 0; m < 12; m++) monthly[m].total = monthlyFee + monthly[m].usageKwh * ratePerKwh;
  return { monthly, annual: monthly.reduce((a, m) => a + m.total, 0) };
}

function findShaveCeiling(dayUsage, powerKw, capacityKwh) {
  let lo = 0, hi = Math.max(...dayUsage);
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const need = dayUsage.reduce((s, u) => s + Math.min(powerKw, Math.max(0, u - mid)), 0);
    if (need > capacityKwh) lo = mid; else hi = mid;
  }
  return hi;
}

function simulateBattery(usageArr, priceArr, powerKw, durationHr) {
  const out = Float64Array.from(usageArr);
  const capacityKwh = powerKw * durationHr;
  let soc = capacityKwh;
  let dayStart = 0;
  for (let i = 0; i < CAL.length; i++) {
    if (CAL[i].hour === 23 || i === CAL.length - 1) {
      const idxs = [];
      for (let j = dayStart; j <= i; j++) idxs.push(j);
      const dayUsage = idxs.map((j) => usageArr[j]);
      const budget = Math.min(soc, capacityKwh);
      const ceiling = findShaveCeiling(dayUsage, powerKw, budget);
      let discharged = 0;
      for (const h of idxs) {
        const amt = Math.min(powerKw, Math.max(0, out[h] - ceiling));
        out[h] -= amt;
        discharged += amt;
      }
      soc -= discharged;
      let drawNeeded = (capacityKwh - soc) / 0.9;
      const byPriceAsc = [...idxs].sort((a, b) => priceArr[a] - priceArr[b]);
      for (const h of byPriceAsc) {
        if (drawNeeded <= 0) break;
        const headroom = Math.max(0, ceiling - out[h]);
        const draw = Math.min(powerKw, drawNeeded, headroom);
        out[h] += draw;
        soc += draw * 0.9;
        drawNeeded -= draw;
      }
      dayStart = i + 1;
    }
  }
  return out;
}

/* ---------------- Locations (synthetic) ---------------- */
const LOCATIONS = [
  { id: "hou", city: "Houston", state: "TX", iso: "ercot", utility: "Bayou City Electric Cooperative", priceLevel: 0.90, x: 47, y: 78 },
  { id: "aus", city: "Austin", state: "TX", iso: "ercot", utility: "Hill Country Electric Cooperative", priceLevel: 0.88, x: 42, y: 75 },
  { id: "nyc", city: "New York", state: "NY", iso: "nyiso", utility: "Gotham Edison Company", priceLevel: 1.30, x: 82, y: 30 },
  { id: "phl", city: "Philadelphia", state: "PA", iso: "pjm", utility: "Keystone Power & Light", priceLevel: 1.05, x: 79, y: 34 },
  { id: "chi", city: "Chicago", state: "IL", iso: "miso", utility: "Prairie Fork Electric", priceLevel: 0.95, x: 60, y: 30 },
  { id: "lax", city: "Los Angeles", state: "CA", iso: "caiso", utility: "Pacific Rim Utility Co.", priceLevel: 1.25, x: 10, y: 55 },
  { id: "mci", city: "Kansas City", state: "MO", iso: "spp", utility: "Heartland Public Power", priceLevel: 0.85, x: 50, y: 48 },
  { id: "bos", city: "Boston", state: "MA", iso: "neiso", utility: "Bay State Electric", priceLevel: 1.20, x: 87, y: 24 },
];

const BUILDING_TYPES = Object.keys(BUILDING_SHAPES);

const fmtUSD = (n) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtUSD2 = (n) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const fmtKwh = (n) => n.toLocaleString("en-US", { maximumFractionDigits: 0 }) + " kWh";

/* ============================================================================
   UI
   ========================================================================== */

function useCountUp(target, duration = 700) {
  const [val, setVal] = useState(0);
  const startRef = useRef(null);
  const fromRef = useRef(0);
  useEffect(() => {
    fromRef.current = val;
    startRef.current = null;
    let raf;
    const step = (ts) => {
      if (startRef.current === null) startRef.current = ts;
      const p = Math.min(1, (ts - startRef.current) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(fromRef.current + (target - fromRef.current) * eased);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return val;
}

function Toggle({ checked, onChange, label, sub }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        display: "flex", alignItems: "center", gap: 12, width: "100%",
        background: checked ? "rgba(240,162,58,0.08)" : "transparent",
        border: `1px solid ${checked ? "#F0A23A" : "rgba(234,240,246,0.12)"}`,
        borderRadius: 8, padding: "12px 14px", cursor: "pointer", textAlign: "left",
        transition: "background 180ms ease, border-color 180ms ease",
      }}
    >
      <span style={{
        position: "relative", width: 36, height: 20, borderRadius: 999, flexShrink: 0,
        background: checked ? "#F0A23A" : "rgba(234,240,246,0.18)",
        transition: "background 180ms ease",
      }}>
        <span style={{
          position: "absolute", top: 2, left: checked ? 18 : 2, width: 16, height: 16,
          borderRadius: "50%", background: "#0F1B2D", transition: "left 180ms ease",
        }} />
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "#EAF0F6" }}>{label}</span>
        {sub && <span style={{ fontSize: 12.5, color: "#8FA3BE" }}>{sub}</span>}
      </span>
    </button>
  );
}

function Panel({ title, icon, children, style }) {
  return (
    <div style={{
      background: "#16263D", border: "1px solid rgba(234,240,246,0.08)",
      borderRadius: 10, padding: 20, ...style,
    }}>
      {title && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          {icon}
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#EAF0F6" }}>{title}</h3>
        </div>
      )}
      {children}
    </div>
  );
}

function KpiCard({ label, value, sub, accent }) {
  const shown = useCountUp(value);
  return (
    <div style={{
      background: "#16263D", border: "1px solid rgba(234,240,246,0.08)",
      borderTop: `2px solid ${accent || "#F0A23A"}`, borderRadius: 10, padding: "18px 20px",
      minWidth: 0,
    }}>
      <div style={{ fontSize: 12.5, color: "#8FA3BE", marginBottom: 8 }}>{label}</div>
      <div style={{
        fontFamily: "'IBM Plex Mono', monospace", fontSize: 26, fontWeight: 600,
        color: "#EAF0F6", letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums",
      }}>
        {fmtUSD(shown)}
      </div>
      {sub && <div style={{ fontSize: 12.5, color: "#8FA3BE", marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{
      background: "#0C1626", border: "1px solid rgba(234,240,246,0.15)", borderRadius: 6,
      padding: "8px 12px", fontSize: 12.5,
    }}>
      <div style={{ color: "#8FA3BE", marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, fontFamily: "'IBM Plex Mono', monospace" }}>
          {p.name}: {typeof p.value === "number" ? fmtUSD2(p.value) : p.value}
        </div>
      ))}
    </div>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, color: "#8FA3BE" }}>
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: "#0F1B2D", color: "#EAF0F6", border: "1px solid rgba(234,240,246,0.15)",
          borderRadius: 6, padding: "9px 10px", fontSize: 13.5, fontFamily: "inherit",
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function SliderField({ label, value, onChange, min, max, step, format }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, color: "#8FA3BE" }}>
      <span style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{label}</span>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#EAF0F6" }}>
          {format ? format(value) : value}
        </span>
      </span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ accentColor: "#F0A23A" }}
      />
    </label>
  );
}

function GridMap({ selectedId, secondaryId, onSelect }) {
  return (
    <svg viewBox="0 0 100 90" style={{ width: "100%", height: "100%", display: "block" }}>
      <defs>
        <pattern id="lp-grid" width="6" height="6" patternUnits="userSpaceOnUse">
          <path d="M 6 0 L 0 0 0 6" fill="none" stroke="rgba(234,240,246,0.05)" strokeWidth="0.3" />
        </pattern>
      </defs>
      <rect width="100" height="90" fill="url(#lp-grid)" />
      {LOCATIONS.map((a) =>
        LOCATIONS.filter((b) => b.id > a.id).map((b) => (
          <line key={a.id + b.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke="rgba(63,224,197,0.06)" strokeWidth="0.3" />
        ))
      )}
      {LOCATIONS.map((loc) => {
        const isSel = loc.id === selectedId;
        const isSec = loc.id === secondaryId;
        const r = isSel ? 2.6 : isSec ? 2.3 : 1.6;
        return (
          <g key={loc.id} onClick={() => onSelect(loc.id)} style={{ cursor: "pointer" }}>
            {(isSel || isSec) && (
              <circle cx={loc.x} cy={loc.y} r={r + 2.2} fill="none"
                stroke={isSel ? "#F0A23A" : "#3FE0C5"} strokeWidth="0.4" opacity="0.5" />
            )}
            <circle cx={loc.x} cy={loc.y} r={r}
              fill={isSel ? "#F0A23A" : isSec ? "#3FE0C5" : "#8FA3BE"} />
            <text x={loc.x} y={loc.y - r - 1.6} textAnchor="middle"
              fontSize="3" fill={isSel ? "#F0A23A" : isSec ? "#3FE0C5" : "#8FA3BE"}
              fontFamily="'IBM Plex Sans', sans-serif" fontWeight={isSel || isSec ? 600 : 400}>
              {loc.city}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function ClarityGridClientApp() {
  const [locationId, setLocationId] = useState("nyc");
  const [buildingType, setBuildingType] = useState("SmallOffice");
  const [monthlyKwh, setMonthlyKwh] = useState(3000);
  const [tariffId, setTariffId] = useState("standard");

  const [fixedOn, setFixedOn] = useState(false);
  const [fixedRate, setFixedRate] = useState(13);
  const [battOn, setBattOn] = useState(false);
  const [battPower, setBattPower] = useState(15);
  const [battDuration, setBattDuration] = useState(4);
  const [compareOn, setCompareOn] = useState(false);
  const [compareId, setCompareId] = useState("lax");

  const location = LOCATIONS.find((l) => l.id === locationId);
  const compareLocation = LOCATIONS.find((l) => l.id === compareId);

  const prices = useMemo(() => generateHourlyPrices(location.iso, location.id), [location.iso, location.id]);
  const usage = useMemo(() => generateHourlyUsage(buildingType, monthlyKwh, location.id),
    [buildingType, monthlyKwh, location.id]);
  const tariffs = useMemo(() => buildTariffs(location), [location]);
  const tariff = tariffs.find((t) => t.id === tariffId) || tariffs[0];

  const battUsage = useMemo(() => battOn ? simulateBattery(usage, prices, battPower, battDuration) : usage,
    [battOn, usage, prices, battPower, battDuration]);

  const bill = useMemo(() => calculateBill(tariff, battUsage, prices), [tariff, battUsage, prices]);
  const baseBillNoBatt = useMemo(() => calculateBill(tariff, usage, prices), [tariff, usage, prices]);
  const fixed = useMemo(() => fixedPriceBill(battUsage, fixedRate / 100, 10), [battUsage, fixedRate]);

  const tariffCompare = useMemo(() => tariffs.map((t) => ({
    name: t.name, total: calculateBill(t, usage, prices).annual.total, id: t.id,
  })), [tariffs, usage, prices]);

  const compPrices = useMemo(() => compareOn ? generateHourlyPrices(compareLocation.iso, compareLocation.id) : null,
    [compareOn, compareLocation]);
  const compUsage = useMemo(() => compareOn ? generateHourlyUsage(buildingType, monthlyKwh, compareLocation.id) : null,
    [compareOn, buildingType, monthlyKwh, compareLocation]);
  const compTariffs = useMemo(() => compareOn ? buildTariffs(compareLocation) : null, [compareOn, compareLocation]);
  const compBill = useMemo(() => {
    if (!compareOn) return null;
    const t = compTariffs.find((x) => x.id === tariffId) || compTariffs[0];
    return calculateBill(t, compUsage, compPrices);
  }, [compareOn, compTariffs, tariffId, compUsage, compPrices]);

  const monthlyChartData = bill.monthly.map((m, i) => ({
    month: MONTH_LABELS[i], Retail: m.total, Wholesale: m.wholesale,
  }));

  const batterySavings = battOn ? baseBillNoBatt.annual.total - bill.annual.total : 0;
  const fixedDelta = fixedOn ? bill.annual.total - fixed.annual : 0;

  // representative sample day (mid-July, a weekday) for the battery chart
  const sampleDayStart = useMemo(() => {
    let idx = 0;
    for (let i = 0; i < CAL.length; i++) {
      if (CAL[i].month === 6 && CAL[i].hour === 0) { idx = i; break; }
    }
    return idx;
  }, []);
  const sampleDayData = useMemo(() => {
    const rows = [];
    for (let h = 0; h < 24; h++) {
      const i = sampleDayStart + h;
      rows.push({
        hour: h + ":00", Price: prices[i], "Usage (no battery)": usage[i],
        "Usage (with battery)": battUsage[i],
      });
    }
    return rows;
  }, [sampleDayStart, prices, usage, battUsage]);

  return (
    <div style={{
      minHeight: "100vh", background: "#0F1B2D", color: "#EAF0F6",
      fontFamily: "'IBM Plex Sans', sans-serif", padding: "0 0 64px",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        input[type=range] { -webkit-appearance: none; height: 4px; background: rgba(234,240,246,0.15); border-radius: 2px; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #F0A23A; cursor: pointer; }
        input[type=range]::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: #F0A23A; cursor: pointer; border: none; }
        ::selection { background: rgba(240,162,58,0.3); }
      `}</style>

      {/* HERO */}
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "40px 24px 28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <Zap size={20} color="#F0A23A" strokeWidth={2.5} />
          <span style={{ fontSize: 14, letterSpacing: "0.02em", color: "#8FA3BE" }}>ClarityGrid Client</span>
        </div>
        <h1 style={{
          fontSize: "clamp(28px, 4vw, 42px)", lineHeight: 1.15, fontWeight: 700,
          margin: "0 0 12px", maxWidth: 720, letterSpacing: "-0.01em",
        }}>
          What your power actually costs, wherever you plug in.
        </h1>
        <p style={{ fontSize: 15.5, color: "#8FA3BE", maxWidth: 560, lineHeight: 1.6, margin: 0 }}>
          Pick a place on the grid, describe your building, and see a modeled retail and
          wholesale pricing summary — then try changing tariffs, going fixed-rate, adding a
          battery, or comparing a second location.
        </p>
      </div>

      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "0 24px", display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 20 }}>
        {/* MAP */}
        <Panel title="Select a location" icon={<MapPin size={16} color="#8FA3BE" />} style={{ minHeight: 380 }}>
          <div style={{ height: 300, marginBottom: 12 }}>
            <GridMap selectedId={locationId} secondaryId={compareOn ? compareId : null} onSelect={setLocationId} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
            <div>
              <div style={{ fontSize: 17, fontWeight: 600 }}>{location.city}, {location.state}</div>
              <div style={{ fontSize: 13, color: "#8FA3BE" }}>{location.utility} &middot; {ISO_PROFILES[location.iso].name}</div>
            </div>
            {compareOn && (
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#3FE0C5" }}>{compareLocation.city}, {compareLocation.state}</div>
                <div style={{ fontSize: 12.5, color: "#8FA3BE" }}>{ISO_PROFILES[compareLocation.iso].name} (comparison)</div>
              </div>
            )}
          </div>
        </Panel>

        {/* CONTROLS */}
        <Panel title="Your building" icon={<Building2 size={16} color="#8FA3BE" />}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <SelectField label="Building type" value={buildingType} onChange={setBuildingType}
              options={BUILDING_TYPES.map((k) => ({ value: k, label: BUILDING_SHAPES[k].label }))} />
            <SliderField label="Average monthly usage" value={monthlyKwh} onChange={setMonthlyKwh}
              min={500} max={20000} step={100} format={(v) => fmtKwh(v)} />
            <div>
              <div style={{ fontSize: 12.5, color: "#8FA3BE", marginBottom: 8 }}>Tariff at this location</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {tariffs.map((t) => {
                  const est = tariffCompare.find((x) => x.id === t.id)?.total || 0;
                  const active = t.id === tariffId;
                  return (
                    <button key={t.id} onClick={() => setTariffId(t.id)}
                      style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        background: active ? "rgba(240,162,58,0.08)" : "transparent",
                        border: `1px solid ${active ? "#F0A23A" : "rgba(234,240,246,0.12)"}`,
                        borderRadius: 8, padding: "10px 12px", cursor: "pointer", textAlign: "left",
                      }}>
                      <span>
                        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t.name}</div>
                        <div style={{ fontSize: 12, color: "#8FA3BE" }}>{t.blurb}</div>
                      </span>
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: "#8FA3BE", whiteSpace: "nowrap", paddingLeft: 10 }}>
                        ~{fmtUSD(est)}/yr
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </Panel>
      </div>

      {/* KPIs */}
      <div style={{ maxWidth: 1180, margin: "24px auto 0", padding: "0 24px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        <KpiCard label="Modeled annual retail cost" value={bill.annual.total} accent="#F0A23A"
          sub={`${(bill.annual.total / bill.annual.usageKwh * 100).toFixed(1)}¢ effective / kWh`} />
        <KpiCard label="Wholesale-equivalent cost" value={bill.annual.wholesale} accent="#3FE0C5"
          sub={`${((bill.annual.total - bill.annual.wholesale) / bill.annual.total * 100).toFixed(0)}% above wholesale`} />
        {battOn && (
          <KpiCard label="Battery impact vs. no battery" value={Math.abs(batterySavings)} accent={batterySavings >= 0 ? "#6FCF97" : "#FF6B5B"}
            sub={batterySavings >= 0 ? "saved this way" : "costs more this way (flat-rate plans see little benefit)"} />
        )}
        {fixedOn && (
          <KpiCard label="Fixed-rate plan, annual" value={fixed.annual} accent="#3FE0C5"
            sub={`${fixedDelta >= 0 ? "cheaper" : "pricier"} than ${tariff.name} by ${fmtUSD(Math.abs(fixedDelta))}`} />
        )}
      </div>

      {/* MONTHLY CHART */}
      <div style={{ maxWidth: 1180, margin: "20px auto 0", padding: "0 24px" }}>
        <Panel title="Retail vs. wholesale, by month" icon={<Gauge size={16} color="#8FA3BE" />}>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyChartData} margin={{ left: -10, right: 10 }}>
                <CartesianGrid stroke="rgba(234,240,246,0.06)" vertical={false} />
                <XAxis dataKey="month" stroke="#8FA3BE" fontSize={12} tickLine={false} axisLine={{ stroke: "rgba(234,240,246,0.12)" }} />
                <YAxis stroke="#8FA3BE" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(234,240,246,0.04)" }} />
                <Legend wrapperStyle={{ fontSize: 12.5, color: "#8FA3BE" }} />
                <Bar dataKey="Retail" fill="#F0A23A" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Wholesale" fill="#3FE0C5" radius={[3, 3, 0, 0]} fillOpacity={0.55} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      {/* WHAT-IF TOGGLES */}
      <div style={{ maxWidth: 1180, margin: "20px auto 0", padding: "0 24px" }}>
        <div style={{ fontSize: 13, color: "#8FA3BE", marginBottom: 10 }}>Run a what-if</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
          <Toggle checked={fixedOn} onChange={setFixedOn} label="Move to a fixed-rate plan"
            sub="Flat ¢/kWh instead of your tariff" />
          <Toggle checked={battOn} onChange={setBattOn} label="Add battery storage"
            sub="Shift usage away from peak hours" />
          <Toggle checked={compareOn} onChange={setCompareOn} label="Compare a second location"
            sub="Same building, different place on the grid" />
        </div>
      </div>

      {/* FIXED PRICE PANEL */}
      {fixedOn && (
        <div style={{ maxWidth: 1180, margin: "16px auto 0", padding: "0 24px" }}>
          <Panel title="Fixed-rate plan">
            <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 24, alignItems: "center" }}>
              <SliderField label="Fixed rate" value={fixedRate} onChange={setFixedRate}
                min={6} max={28} step={0.5} format={(v) => `${v.toFixed(1)}¢/kWh`} />
              <div style={{ height: 180 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={[
                      { name: tariff.name, value: bill.annual.total },
                      { name: `Fixed @ ${fixedRate.toFixed(1)}¢`, value: fixed.annual },
                    ]}
                    layout="vertical" margin={{ left: 10, right: 30 }}
                  >
                    <CartesianGrid stroke="rgba(234,240,246,0.06)" horizontal={false} />
                    <XAxis type="number" stroke="#8FA3BE" fontSize={12} tickFormatter={(v) => `$${v}`} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" stroke="#8FA3BE" fontSize={12.5} width={140} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(234,240,246,0.04)" }} />
                    <Bar dataKey="value" fill="#F0A23A" radius={[0, 3, 3, 0]} barSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </Panel>
        </div>
      )}

      {/* BATTERY PANEL */}
      {battOn && (
        <div style={{ maxWidth: 1180, margin: "16px auto 0", padding: "0 24px" }}>
          <Panel title="Battery storage" icon={<BatteryCharging size={16} color="#8FA3BE" />}>
            <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 24 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <SliderField label="Power rating" value={battPower} onChange={setBattPower}
                  min={5} max={50} step={1} format={(v) => `${v} kW`} />
                <SliderField label="Duration" value={battDuration} onChange={setBattDuration}
                  min={1} max={8} step={1} format={(v) => `${v} hr (${v * battPower} kWh)`} />
                <div style={{
                  fontSize: 12.5, color: "#8FA3BE", lineHeight: 1.6, background: "#0F1B2D",
                  border: "1px solid rgba(234,240,246,0.08)", borderRadius: 8, padding: 12,
                }}>
                  Dispatch model: shaves each day's usage peak down using available charge,
                  then recharges from the cheapest hours without recreating that peak. Demand
                  and time-of-use tariffs benefit most; flat-rate plans see little upside since
                  the rate doesn't change hour to hour.
                </div>
              </div>
              <div style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={sampleDayData} margin={{ left: -10, right: 10 }}>
                    <CartesianGrid stroke="rgba(234,240,246,0.06)" vertical={false} />
                    <XAxis dataKey="hour" stroke="#8FA3BE" fontSize={11} interval={3} tickLine={false} axisLine={{ stroke: "rgba(234,240,246,0.12)" }} />
                    <YAxis yAxisId="kwh" stroke="#8FA3BE" fontSize={11} tickLine={false} axisLine={false} label={{ value: "kWh", angle: -90, position: "insideLeft", fill: "#8FA3BE", fontSize: 11 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12, color: "#8FA3BE" }} />
                    <Area yAxisId="kwh" type="monotone" dataKey="Usage (no battery)" stroke="#8FA3BE" fill="rgba(143,163,190,0.12)" strokeWidth={1.5} />
                    <Area yAxisId="kwh" type="monotone" dataKey="Usage (with battery)" stroke="#F0A23A" fill="rgba(240,162,58,0.18)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div style={{ marginTop: 14, fontSize: 13, display: "flex", alignItems: "center", gap: 8, color: batterySavings >= 0 ? "#6FCF97" : "#FF6B5B" }}>
              {batterySavings >= 0 ? <TrendingDown size={16} /> : <TrendingUp size={16} />}
              {batterySavings >= 0
                ? `Modeled savings of ${fmtUSD(batterySavings)}/yr on the ${tariff.name} tariff`
                : `Modeled cost increase of ${fmtUSD(Math.abs(batterySavings))}/yr on the ${tariff.name} tariff — try the Commercial Demand or Time-of-Use tariff instead`}
            </div>
          </Panel>
        </div>
      )}

      {/* COMPARE LOCATIONS PANEL */}
      {compareOn && compBill && (
        <div style={{ maxWidth: 1180, margin: "16px auto 0", padding: "0 24px" }}>
          <Panel title="Location comparison" icon={<MapPin size={16} color="#8FA3BE" />}>
            <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 24, alignItems: "center" }}>
              <SelectField label="Compare against" value={compareId} onChange={setCompareId}
                options={LOCATIONS.filter((l) => l.id !== locationId).map((l) => ({ value: l.id, label: `${l.city}, ${l.state}` }))} />
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={[
                      { name: `${location.city} — Retail`, value: bill.annual.total, fill: "#F0A23A" },
                      { name: `${location.city} — Wholesale`, value: bill.annual.wholesale, fill: "#F0A23A" },
                      { name: `${compareLocation.city} — Retail`, value: compBill.annual.total, fill: "#3FE0C5" },
                      { name: `${compareLocation.city} — Wholesale`, value: compBill.annual.wholesale, fill: "#3FE0C5" },
                    ]}
                    layout="vertical" margin={{ left: 10, right: 30 }}
                  >
                    <CartesianGrid stroke="rgba(234,240,246,0.06)" horizontal={false} />
                    <XAxis type="number" stroke="#8FA3BE" fontSize={12} tickFormatter={(v) => `$${v}`} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" stroke="#8FA3BE" fontSize={12} width={150} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(234,240,246,0.04)" }} />
                    <Bar dataKey="value" radius={[0, 3, 3, 0]} barSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </Panel>
        </div>
      )}

      <div style={{ maxWidth: 1180, margin: "32px auto 0", padding: "0 24px", fontSize: 12, color: "#5A7091", lineHeight: 1.6 }}>
        All prices, rates, and usage shapes on this page are synthetically generated for
        demonstration — not real utility tariffs or live market prices.
      </div>
    </div>
  );
}
