import React, { useMemo, useState, useEffect, useRef } from "react";
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { Zap, BatteryCharging, MapPin, TrendingDown, TrendingUp, Building2, Gauge } from "lucide-react";

/* ============================================================================
   BACKEND CLIENT
   Location, operator (ISO), and tariff data is fetched from the real-API-
   shaped /ecservice/* routes (see backend/app/routers/real_api.py) — the
   same route shapes and response fields as the actual Clarity Grid Solutions
   API this prototype is modeled on. The main bill/usage calculation still
   goes through the purpose-built /api/bill and /api/compare routes
   (app_api.py), since /ecservice/calculate_custom_economy only accepts
   monthly usage totals (no hourly shape), so it can't drive the battery
   sample-day chart or give TOU/demand tariffs anything to work with. It's
   still genuinely exercised, though: once /api/bill returns, its real
   hourly usage is summed into monthly totals and cross-checked against
   POST /ecservice/calculate_custom_economy, shown in its own panel.
   This file generates none of that data itself.
   ========================================================================== */

const API_BASE =
  import.meta.env.VITE_API_BASE_URL ||
  (typeof window !== "undefined" && window.__CLARITYGRID_API_BASE__) ||
  "http://localhost:8000";

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      /* response wasn't JSON */
    }
    throw new Error(`${options.method || "GET"} ${path} failed (${res.status}): ${detail}`);
  }
  return res.json();
}

// Map-layout coordinates only -- purely decorative SVG placement, not part
// of the real API's distributor shape (which has no notion of "where on a
// map"). Values match the prototype's original fixed 8-location dataset.
const MAP_COORDS = {
  hou: { x: 47, y: 78 }, aus: { x: 42, y: 75 }, nyc: { x: 82, y: 30 }, phl: { x: 79, y: 34 },
  chi: { x: 60, y: 30 }, lax: { x: 10, y: 55 }, mci: { x: 50, y: 48 }, bos: { x: 87, y: 24 },
};

const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Mirrors the backend's calendar layout (2025, Jan 1 = Wednesday) so the UI can
// index into the flat hourly usage/price arrays the API returns (e.g. to pull
// out one representative day). No usage/price values are generated here.
function buildCalendar() {
  const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const cal = [];
  let dow = 4;
  for (let m = 0; m < 12; m++) {
    for (let d = 1; d <= daysInMonth[m]; d++) {
      for (let h = 0; h < 24; h++) cal.push({ month: m, dow, hour: h });
      dow = (dow % 7) + 1;
    }
  }
  return cal;
}
const CAL = buildCalendar();

const fmtUSD = (n) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtUSD2 = (n) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const fmtKwh = (n) => n.toLocaleString("en-US", { maximumFractionDigits: 0 }) + " kWh";

function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

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
        border: `1px solid ${checked ? "#F0A23A" : "rgba(15,27,45,0.12)"}`,
        borderRadius: 8, padding: "12px 14px", cursor: "pointer", textAlign: "left",
        transition: "background 180ms ease, border-color 180ms ease",
      }}
    >
      <span style={{
        position: "relative", width: 36, height: 20, borderRadius: 999, flexShrink: 0,
        background: checked ? "#F0A23A" : "rgba(15,27,45,0.18)",
        transition: "background 180ms ease",
      }}>
        <span style={{
          position: "absolute", top: 2, left: checked ? 18 : 2, width: 16, height: 16,
          borderRadius: "50%", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(15,27,45,0.25)",
          transition: "left 180ms ease",
        }} />
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "#0F1B2D" }}>{label}</span>
        {sub && <span style={{ fontSize: 12.5, color: "#64748B" }}>{sub}</span>}
      </span>
    </button>
  );
}

function Panel({ title, icon, children, style }) {
  return (
    <div style={{
      background: "#FFFFFF", border: "1px solid rgba(15,27,45,0.08)",
      boxShadow: "0 1px 2px rgba(15,27,45,0.04), 0 2px 8px rgba(15,27,45,0.04)",
      borderRadius: 10, padding: 20, ...style,
    }}>
      {title && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          {icon}
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#0F1B2D" }}>{title}</h3>
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
      background: "#FFFFFF", border: "1px solid rgba(15,27,45,0.08)",
      boxShadow: "0 1px 2px rgba(15,27,45,0.04), 0 2px 8px rgba(15,27,45,0.04)",
      borderTop: `2px solid ${accent || "#F0A23A"}`, borderRadius: 10, padding: "18px 20px",
      minWidth: 0,
    }}>
      <div style={{ fontSize: 12.5, color: "#64748B", marginBottom: 8 }}>{label}</div>
      <div style={{
        fontFamily: "'IBM Plex Mono', monospace", fontSize: 26, fontWeight: 600,
        color: "#0F1B2D", letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums",
      }}>
        {fmtUSD(shown)}
      </div>
      {sub && <div style={{ fontSize: 12.5, color: "#64748B", marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{
      background: "#0F1B2D", borderRadius: 6, boxShadow: "0 4px 12px rgba(15,27,45,0.18)",
      padding: "8px 12px", fontSize: 12.5,
    }}>
      <div style={{ color: "#64748B", marginBottom: 4 }}>{label}</div>
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
    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, color: "#64748B" }}>
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: "#FFFFFF", color: "#0F1B2D", border: "1px solid rgba(15,27,45,0.15)",
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
    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, color: "#64748B" }}>
      <span style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{label}</span>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#0F1B2D" }}>
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

function GridMap({ locations, selectedId, secondaryId, onSelect }) {
  return (
    <svg viewBox="0 0 100 90" style={{ width: "100%", height: "100%", display: "block" }}>
      <defs>
        <pattern id="lp-grid" width="6" height="6" patternUnits="userSpaceOnUse">
          <path d="M 6 0 L 0 0 0 6" fill="none" stroke="rgba(15,27,45,0.05)" strokeWidth="0.3" />
        </pattern>
      </defs>
      <rect width="100" height="90" fill="url(#lp-grid)" />
      {locations.map((a) =>
        locations.filter((b) => b.id > a.id).map((b) => (
          <line key={a.id + b.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke="rgba(20,184,166,0.08)" strokeWidth="0.3" />
        ))
      )}
      {locations.map((loc) => {
        const isSel = loc.id === selectedId;
        const isSec = loc.id === secondaryId;
        const r = isSel ? 2.6 : isSec ? 2.3 : 1.6;
        return (
          <g key={loc.id} onClick={() => onSelect(loc.id)} style={{ cursor: "pointer" }}>
            {(isSel || isSec) && (
              <circle cx={loc.x} cy={loc.y} r={r + 2.2} fill="none"
                stroke={isSel ? "#F0A23A" : "#14B8A6"} strokeWidth="0.4" opacity="0.5" />
            )}
            <circle cx={loc.x} cy={loc.y} r={r}
              fill={isSel ? "#F0A23A" : isSec ? "#14B8A6" : "#64748B"} />
            <text x={loc.x} y={loc.y - r - 1.6} textAnchor="middle"
              fontSize="3" fill={isSel ? "#F0A23A" : isSec ? "#14B8A6" : "#64748B"}
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

  const debouncedMonthlyKwh = useDebouncedValue(monthlyKwh, 300);
  const debouncedFixedRate = useDebouncedValue(fixedRate, 300);
  const debouncedBattPower = useDebouncedValue(battPower, 300);
  const debouncedBattDuration = useDebouncedValue(battDuration, 300);

  const [apiError, setApiError] = useState(null);

  // Reference data
  const [locations, setLocations] = useState(null);
  const [isoNames, setIsoNames] = useState({});
  const [buildingTypes, setBuildingTypes] = useState(null);
  const [tariffs, setTariffs] = useState([]);
  const [tariffEstimates, setTariffEstimates] = useState({});

  // Bill data
  const [billData, setBillData] = useState(null);
  const [baselineBill, setBaselineBill] = useState(null);
  const [compareData, setCompareData] = useState(null);
  const [realApiCheck, setRealApiCheck] = useState(null);

  // POST /ecservice/login (matches the real API's documented login-first
  // flow, even though this prototype doesn't enforce the resulting session),
  // then GET /ecservice/api/operators + /ecservice/api/distributors for the
  // real ISO/location data, plus GET /api/building-types (a UI-only input
  // the real API has no concept of -- see header comment).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await api("/ecservice/login", { method: "POST" });
        const [opRes, distRes, btRes] = await Promise.all([
          api("/ecservice/api/operators"),
          api("/ecservice/api/distributors"),
          api("/api/building-types"),
        ]);
        if (cancelled) return;
        setIsoNames(Object.fromEntries(opRes.operators.map((o) => [o.code, o.name])));
        setLocations(distRes.distributors.map((d) => ({
          id: d.id, city: d.city, state: d.state, iso: d.operator_id, utility: d.name,
          x: MAP_COORDS[d.id]?.x ?? 50, y: MAP_COORDS[d.id]?.y ?? 50,
        })));
        setBuildingTypes(btRes.building_types);
      } catch (err) {
        if (!cancelled) setApiError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // GET /ecservice/api/distributors/tariffs?id= whenever the location changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api(`/ecservice/api/distributors/tariffs?id=${locationId}`);
        if (cancelled) return;
        const list = res.tariffs.map((t) => ({ id: t.id, name: t.name, blurb: t.blurb }));
        setTariffs(list);
        setTariffId((prev) => (list.some((t) => t.id === prev) ? prev : list[0]?.id ?? prev));
        setApiError(null);
      } catch (err) {
        if (!cancelled) setApiError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [locationId]);

  // POST /api/bill for the current selections (battery + fixed-rate applied server-side).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api("/api/bill", {
          method: "POST",
          body: JSON.stringify({
            location_id: locationId,
            building_type: buildingType,
            monthly_kwh: debouncedMonthlyKwh,
            tariff_id: tariffId,
            battery: battOn ? { power_kw: debouncedBattPower, duration_hr: debouncedBattDuration } : null,
            fixed_rate: fixedOn ? debouncedFixedRate : null,
          }),
        });
        if (!cancelled) { setBillData(res); setApiError(null); }
      } catch (err) {
        if (!cancelled) setApiError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [locationId, buildingType, debouncedMonthlyKwh, tariffId, battOn, debouncedBattPower, debouncedBattDuration, fixedOn, debouncedFixedRate]);

  // No-battery baseline bill, only needed to show battery savings.
  useEffect(() => {
    if (!battOn) { setBaselineBill(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await api("/api/bill", {
          method: "POST",
          body: JSON.stringify({
            location_id: locationId, building_type: buildingType,
            monthly_kwh: debouncedMonthlyKwh, tariff_id: tariffId,
          }),
        });
        if (!cancelled) setBaselineBill(res);
      } catch (err) {
        if (!cancelled) setApiError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [battOn, locationId, buildingType, debouncedMonthlyKwh, tariffId]);

  // Cross-check against POST /ecservice/calculate_custom_economy: sum /api/bill's
  // real hourly usage into monthly totals (so this isn't blindly flattened) and
  // run them through the real API's own billing endpoint. Purely a visible demo
  // of that endpoint -- not used to drive anything else on the page.
  useEffect(() => {
    if (!billData) { setRealApiCheck(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const monthlyTotals = new Array(12).fill(0);
        for (let i = 0; i < CAL.length; i++) monthlyTotals[CAL[i].month] += billData.usage[i];
        const res = await api("/ecservice/calculate_custom_economy", {
          method: "POST",
          body: JSON.stringify({
            distributor_id: locationId,
            distributor_tariff_id: tariffId,
            usage_by_month: monthlyTotals,
            battery_duration: battOn ? String(debouncedBattDuration) : "",
            battery_id: 0,
          }),
        });
        if (!cancelled) setRealApiCheck(res);
      } catch {
        if (!cancelled) setRealApiCheck(null);
      }
    })();
    return () => { cancelled = true; };
  }, [billData, locationId, tariffId, battOn, debouncedBattDuration]);

  // Per-tariff annual estimates for the tariff picker buttons.
  useEffect(() => {
    if (!tariffs.length) return;
    let cancelled = false;
    (async () => {
      try {
        const pairs = await Promise.all(tariffs.map(async (t) => {
          const res = await api("/api/bill", {
            method: "POST",
            body: JSON.stringify({
              location_id: locationId, building_type: buildingType,
              monthly_kwh: debouncedMonthlyKwh, tariff_id: t.id,
            }),
          });
          return [t.id, res.bill.annual.total];
        }));
        if (!cancelled) setTariffEstimates(Object.fromEntries(pairs));
      } catch (err) {
        if (!cancelled) setApiError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [tariffs, locationId, buildingType, debouncedMonthlyKwh]);

  // POST /api/compare when the comparison toggle is on.
  useEffect(() => {
    if (!compareOn) { setCompareData(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await api("/api/compare", {
          method: "POST",
          body: JSON.stringify({
            left: { location_id: locationId, building_type: buildingType, monthly_kwh: debouncedMonthlyKwh, tariff_id: tariffId },
            right: { location_id: compareId, building_type: buildingType, monthly_kwh: debouncedMonthlyKwh, tariff_id: tariffId },
          }),
        });
        if (!cancelled) setCompareData(res);
      } catch (err) {
        if (!cancelled) setApiError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [compareOn, locationId, compareId, buildingType, debouncedMonthlyKwh, tariffId]);

  const location = locations?.find((l) => l.id === locationId);
  const compareLocation = locations?.find((l) => l.id === compareId);
  const tariff = tariffs.find((t) => t.id === tariffId) || tariffs[0];

  const batterySavings = battOn && baselineBill && billData
    ? baselineBill.bill.annual.total - billData.bill.annual.total
    : 0;
  const fixedDelta = fixedOn && billData?.fixed_bill
    ? billData.bill.annual.total - billData.fixed_bill.annual
    : 0;

  const monthlyChartData = billData?.bill.monthly.map((m, i) => ({
    month: MONTH_LABELS[i], Retail: m.total, Wholesale: m.wholesale,
  })) || [];

  // Representative sample day (mid-July, a weekday) for the battery chart.
  const sampleDayStart = useMemo(() => {
    let idx = 0;
    for (let i = 0; i < CAL.length; i++) {
      if (CAL[i].month === 6 && CAL[i].hour === 0) { idx = i; break; }
    }
    return idx;
  }, []);
  const sampleDayData = useMemo(() => {
    if (!billData) return [];
    const { usage, prices, billed_usage } = billData;
    const rows = [];
    for (let h = 0; h < 24; h++) {
      const i = sampleDayStart + h;
      rows.push({
        hour: `${h}:00`, Price: prices[i], "Usage (no battery)": usage[i],
        "Usage (with battery)": billed_usage[i],
      });
    }
    return rows;
  }, [billData, sampleDayStart]);

  if (!locations || !buildingTypes) {
    return (
      <div style={{
        minHeight: "100vh", background: "#F7F8FB", color: "#0F1B2D",
        fontFamily: "'IBM Plex Sans', sans-serif", display: "flex",
        alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center",
      }}>
        <div>
          <div style={{ marginBottom: 10 }}>Loading ClarityGrid…</div>
          {apiError && (
            <div style={{ fontSize: 13, color: "#DC2626", maxWidth: 420 }}>
              Could not reach the backend at {API_BASE}. Is it running?<br />{apiError}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: "100vh", background: "#F7F8FB", color: "#0F1B2D",
      fontFamily: "'IBM Plex Sans', sans-serif", padding: "0 0 64px",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        input[type=range] { -webkit-appearance: none; height: 4px; background: rgba(15,27,45,0.15); border-radius: 2px; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #F0A23A; cursor: pointer; }
        input[type=range]::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: #F0A23A; cursor: pointer; border: none; }
        ::selection { background: rgba(240,162,58,0.3); }
      `}</style>

      {/* HERO */}
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "40px 24px 28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
          <Zap size={20} color="#F0A23A" strokeWidth={2.5} />
          <span style={{ fontSize: 14, letterSpacing: "0.02em", color: "#64748B" }}>ClarityGrid Client</span>
          <span style={{
            fontSize: 11.5, fontWeight: 600, letterSpacing: "0.02em", color: "#F0A23A",
            background: "rgba(240,162,58,0.1)", border: "1px solid rgba(240,162,58,0.3)",
            borderRadius: 999, padding: "3px 9px",
          }}>
            Live via /ecservice — the real Clarity Grid API
          </span>
        </div>
        <h1 style={{
          fontSize: "clamp(28px, 4vw, 42px)", lineHeight: 1.15, fontWeight: 700,
          margin: "0 0 12px", maxWidth: 720, letterSpacing: "-0.01em",
        }}>
          What your power actually costs, wherever you plug in.
        </h1>
        <p style={{ fontSize: 15.5, color: "#64748B", maxWidth: 560, lineHeight: 1.6, margin: 0 }}>
          Pick a place on the grid, describe your building, and see a modeled retail and
          wholesale pricing summary — then try changing tariffs, going fixed-rate, adding a
          battery, or comparing a second location.
        </p>
        {apiError && (
          <div style={{
            marginTop: 16, fontSize: 13, color: "#DC2626", background: "rgba(220,38,38,0.06)",
            border: "1px solid rgba(220,38,38,0.3)", borderRadius: 8, padding: "10px 14px", maxWidth: 640,
          }}>
            Backend request failed: {apiError}
          </div>
        )}
      </div>

      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "0 24px", display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 20 }}>
        {/* MAP */}
        <Panel title="Select a location" icon={<MapPin size={16} color="#64748B" />} style={{ minHeight: 380 }}>
          <div style={{ height: 300, marginBottom: 12 }}>
            <GridMap locations={locations} selectedId={locationId} secondaryId={compareOn ? compareId : null} onSelect={setLocationId} />
          </div>
          {location && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 600 }}>{location.city}, {location.state}</div>
                <div style={{ fontSize: 13, color: "#64748B" }}>{location.utility} &middot; {isoNames[location.iso] || location.iso}</div>
              </div>
              {compareOn && compareLocation && (
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#14B8A6" }}>{compareLocation.city}, {compareLocation.state}</div>
                  <div style={{ fontSize: 12.5, color: "#64748B" }}>{isoNames[compareLocation.iso] || compareLocation.iso} (comparison)</div>
                </div>
              )}
            </div>
          )}
        </Panel>

        {/* CONTROLS */}
        <Panel title="Your building" icon={<Building2 size={16} color="#64748B" />}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <SelectField label="Building type" value={buildingType} onChange={setBuildingType}
              options={buildingTypes.map((b) => ({ value: b.key, label: b.label }))} />
            <SliderField label="Average monthly usage" value={monthlyKwh} onChange={setMonthlyKwh}
              min={500} max={20000} step={100} format={(v) => fmtKwh(v)} />
            <div>
              <div style={{ fontSize: 12.5, color: "#64748B", marginBottom: 8 }}>Tariff at this location</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {tariffs.map((t) => {
                  const est = tariffEstimates[t.id] || 0;
                  const active = t.id === tariffId;
                  return (
                    <button key={t.id} onClick={() => setTariffId(t.id)}
                      style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        background: active ? "rgba(240,162,58,0.08)" : "transparent",
                        border: `1px solid ${active ? "#F0A23A" : "rgba(15,27,45,0.12)"}`,
                        borderRadius: 8, padding: "10px 12px", cursor: "pointer", textAlign: "left",
                      }}>
                      <span>
                        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t.name}</div>
                        <div style={{ fontSize: 12, color: "#64748B" }}>{t.blurb}</div>
                      </span>
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: "#64748B", whiteSpace: "nowrap", paddingLeft: 10 }}>
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

      {billData && tariff && (
        <>
          {/* KPIs */}
          <div style={{ maxWidth: 1180, margin: "24px auto 0", padding: "0 24px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
            <KpiCard label="Modeled annual retail cost" value={billData.bill.annual.total} accent="#F0A23A"
              sub={`${(billData.bill.annual.total / billData.bill.annual.usage_kwh * 100).toFixed(1)}¢ effective / kWh`} />
            <KpiCard label="Wholesale-equivalent cost" value={billData.bill.annual.wholesale} accent="#14B8A6"
              sub={`${((billData.bill.annual.total - billData.bill.annual.wholesale) / billData.bill.annual.total * 100).toFixed(0)}% above wholesale`} />
            {battOn && baselineBill && (
              <KpiCard label="Battery impact vs. no battery" value={Math.abs(batterySavings)} accent={batterySavings >= 0 ? "#16A34A" : "#DC2626"}
                sub={batterySavings >= 0 ? "saved this way" : "costs more this way (flat-rate plans see little benefit)"} />
            )}
            {fixedOn && billData.fixed_bill && (
              <KpiCard label="Fixed-rate plan, annual" value={billData.fixed_bill.annual} accent="#14B8A6"
                sub={`${fixedDelta >= 0 ? "cheaper" : "pricier"} than ${tariff.name} by ${fmtUSD(Math.abs(fixedDelta))}`} />
            )}
          </div>

          {/* MONTHLY CHART */}
          <div style={{ maxWidth: 1180, margin: "20px auto 0", padding: "0 24px" }}>
            <Panel title="Retail vs. wholesale, by month" icon={<Gauge size={16} color="#64748B" />}>
              <div style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyChartData} margin={{ left: -10, right: 10 }}>
                    <CartesianGrid stroke="rgba(15,27,45,0.06)" vertical={false} />
                    <XAxis dataKey="month" stroke="#64748B" fontSize={12} tickLine={false} axisLine={{ stroke: "rgba(15,27,45,0.12)" }} />
                    <YAxis stroke="#64748B" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(15,27,45,0.04)" }} />
                    <Legend wrapperStyle={{ fontSize: 12.5, color: "#64748B" }} />
                    <Bar dataKey="Retail" fill="#F0A23A" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Wholesale" fill="#14B8A6" radius={[3, 3, 0, 0]} fillOpacity={0.55} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>

          {/* REAL API CROSS-CHECK */}
          {realApiCheck && (
            <div style={{ maxWidth: 1180, margin: "20px auto 0", padding: "0 24px" }}>
              <Panel title="Cross-checked against the real API" icon={<Zap size={16} color="#64748B" />}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 32, alignItems: "baseline" }}>
                  <div>
                    <div style={{ fontSize: 12.5, color: "#64748B", marginBottom: 6 }}>
                      POST /ecservice/calculate_custom_economy — annual retail cost
                    </div>
                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 22, fontWeight: 600, color: "#0F1B2D" }}>
                      {fmtUSD(realApiCheck.retailAnnualCosts)}
                    </div>
                  </div>
                  {battOn && realApiCheck.batteryNetSavings && (
                    <div>
                      <div style={{ fontSize: 12.5, color: "#64748B", marginBottom: 6 }}>Battery net savings (real API)</div>
                      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 22, fontWeight: 600, color: "#0F1B2D" }}>
                        {fmtUSD(realApiCheck.batteryNetSavings.reduce((a, b) => a + b, 0))}
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "#64748B", marginTop: 14, lineHeight: 1.6 }}>
                  Same location and tariff, run through the real Clarity Grid API's own billing
                  endpoint using this page's actual monthly usage totals. It can differ slightly
                  from the {fmtUSD(billData.bill.annual.total)} above — the real endpoint only
                  accepts monthly totals, not an hourly usage curve, so it can't see the
                  intraday peaks and off-peak windows this page's main calculation uses.
                  {realApiCheck.warning && <> <em>{realApiCheck.warning}</em></>}
                </div>
              </Panel>
            </div>
          )}
        </>
      )}

      {/* WHAT-IF TOGGLES */}
      <div style={{ maxWidth: 1180, margin: "20px auto 0", padding: "0 24px" }}>
        <div style={{ fontSize: 13, color: "#64748B", marginBottom: 10 }}>Run a what-if</div>
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
      {fixedOn && billData?.fixed_bill && tariff && (
        <div style={{ maxWidth: 1180, margin: "16px auto 0", padding: "0 24px" }}>
          <Panel title="Fixed-rate plan">
            <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 24, alignItems: "center" }}>
              <SliderField label="Fixed rate" value={fixedRate} onChange={setFixedRate}
                min={6} max={28} step={0.5} format={(v) => `${v.toFixed(1)}¢/kWh`} />
              <div style={{ height: 180 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={[
                      { name: tariff.name, value: billData.bill.annual.total },
                      { name: `Fixed @ ${fixedRate.toFixed(1)}¢`, value: billData.fixed_bill.annual },
                    ]}
                    layout="vertical" margin={{ left: 10, right: 30 }}
                  >
                    <CartesianGrid stroke="rgba(15,27,45,0.06)" horizontal={false} />
                    <XAxis type="number" stroke="#64748B" fontSize={12} tickFormatter={(v) => `$${v}`} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" stroke="#64748B" fontSize={12.5} width={140} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(15,27,45,0.04)" }} />
                    <Bar dataKey="value" fill="#F0A23A" radius={[0, 3, 3, 0]} barSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </Panel>
        </div>
      )}

      {/* BATTERY PANEL */}
      {battOn && billData && tariff && (
        <div style={{ maxWidth: 1180, margin: "16px auto 0", padding: "0 24px" }}>
          <Panel title="Battery storage" icon={<BatteryCharging size={16} color="#64748B" />}>
            <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 24 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <SliderField label="Power rating" value={battPower} onChange={setBattPower}
                  min={5} max={50} step={1} format={(v) => `${v} kW`} />
                <SliderField label="Duration" value={battDuration} onChange={setBattDuration}
                  min={1} max={8} step={1} format={(v) => `${v} hr (${v * battPower} kWh)`} />
                <div style={{
                  fontSize: 12.5, color: "#64748B", lineHeight: 1.6, background: "#F7F8FB",
                  border: "1px solid rgba(15,27,45,0.08)", borderRadius: 8, padding: 12,
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
                    <CartesianGrid stroke="rgba(15,27,45,0.06)" vertical={false} />
                    <XAxis dataKey="hour" stroke="#64748B" fontSize={11} interval={3} tickLine={false} axisLine={{ stroke: "rgba(15,27,45,0.12)" }} />
                    <YAxis yAxisId="kwh" stroke="#64748B" fontSize={11} tickLine={false} axisLine={false} label={{ value: "kWh", angle: -90, position: "insideLeft", fill: "#64748B", fontSize: 11 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12, color: "#64748B" }} />
                    <Area yAxisId="kwh" type="monotone" dataKey="Usage (no battery)" stroke="#64748B" fill="rgba(100,116,139,0.12)" strokeWidth={1.5} />
                    <Area yAxisId="kwh" type="monotone" dataKey="Usage (with battery)" stroke="#F0A23A" fill="rgba(240,162,58,0.18)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
            {baselineBill && (
              <div style={{ marginTop: 14, fontSize: 13, display: "flex", alignItems: "center", gap: 8, color: batterySavings >= 0 ? "#16A34A" : "#DC2626" }}>
                {batterySavings >= 0 ? <TrendingDown size={16} /> : <TrendingUp size={16} />}
                {batterySavings >= 0
                  ? `Modeled savings of ${fmtUSD(batterySavings)}/yr on the ${tariff.name} tariff`
                  : `Modeled cost increase of ${fmtUSD(Math.abs(batterySavings))}/yr on the ${tariff.name} tariff — try the Commercial Demand or Time-of-Use tariff instead`}
              </div>
            )}
          </Panel>
        </div>
      )}

      {/* COMPARE LOCATIONS PANEL */}
      {compareOn && compareData && billData && location && compareLocation && (
        <div style={{ maxWidth: 1180, margin: "16px auto 0", padding: "0 24px" }}>
          <Panel title="Location comparison" icon={<MapPin size={16} color="#64748B" />}>
            <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 24, alignItems: "center" }}>
              <SelectField label="Compare against" value={compareId} onChange={setCompareId}
                options={locations.filter((l) => l.id !== locationId).map((l) => ({ value: l.id, label: `${l.city}, ${l.state}` }))} />
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={[
                      { name: `${location.city} — Retail`, value: billData.bill.annual.total, fill: "#F0A23A" },
                      { name: `${location.city} — Wholesale`, value: billData.bill.annual.wholesale, fill: "#F0A23A" },
                      { name: `${compareLocation.city} — Retail`, value: compareData.right.bill.annual.total, fill: "#14B8A6" },
                      { name: `${compareLocation.city} — Wholesale`, value: compareData.right.bill.annual.wholesale, fill: "#14B8A6" },
                    ]}
                    layout="vertical" margin={{ left: 10, right: 30 }}
                  >
                    <CartesianGrid stroke="rgba(15,27,45,0.06)" horizontal={false} />
                    <XAxis type="number" stroke="#64748B" fontSize={12} tickFormatter={(v) => `$${v}`} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" stroke="#64748B" fontSize={12} width={150} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(15,27,45,0.04)" }} />
                    <Bar dataKey="value" radius={[0, 3, 3, 0]} barSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </Panel>
        </div>
      )}

      <div style={{ maxWidth: 1180, margin: "32px auto 0", padding: "0 24px", fontSize: 12, color: "#94A3B8", lineHeight: 1.6 }}>
        All prices, rates, and usage shapes on this page are synthetically generated for
        demonstration — not real utility tariffs or live market prices.
      </div>
    </div>
  );
}
