import React, { useMemo, useState, useEffect, useRef } from "react";
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { Zap, BatteryCharging, MapPin, TrendingDown, TrendingUp, Building2, Gauge } from "lucide-react";

/* ============================================================================
   BACKEND CLIENT
   All pricing, usage, tariff, and bill data comes from the ClarityGrid
   app_api backend (see backend/app/routers/app_api.py). This file no longer
   generates any of that data itself.
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

// Cosmetic ISO display names only (the backend's Location.iso is a bare code like "ercot").
const ISO_NAMES = {
  ercot: "ERCOT", nyiso: "NYISO", pjm: "PJM", miso: "MISO",
  caiso: "CAISO", spp: "SPP", neiso: "NEISO",
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

function GridMap({ locations, selectedId, secondaryId, onSelect }) {
  return (
    <svg viewBox="0 0 100 90" style={{ width: "100%", height: "100%", display: "block" }}>
      <defs>
        <pattern id="lp-grid" width="6" height="6" patternUnits="userSpaceOnUse">
          <path d="M 6 0 L 0 0 0 6" fill="none" stroke="rgba(234,240,246,0.05)" strokeWidth="0.3" />
        </pattern>
      </defs>
      <rect width="100" height="90" fill="url(#lp-grid)" />
      {locations.map((a) =>
        locations.filter((b) => b.id > a.id).map((b) => (
          <line key={a.id + b.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke="rgba(63,224,197,0.06)" strokeWidth="0.3" />
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

  const debouncedMonthlyKwh = useDebouncedValue(monthlyKwh, 300);
  const debouncedFixedRate = useDebouncedValue(fixedRate, 300);
  const debouncedBattPower = useDebouncedValue(battPower, 300);
  const debouncedBattDuration = useDebouncedValue(battDuration, 300);

  const [apiError, setApiError] = useState(null);

  // Reference data
  const [locations, setLocations] = useState(null);
  const [buildingTypes, setBuildingTypes] = useState(null);
  const [tariffs, setTariffs] = useState([]);
  const [tariffEstimates, setTariffEstimates] = useState({});

  // Bill data
  const [billData, setBillData] = useState(null);
  const [baselineBill, setBaselineBill] = useState(null);
  const [compareData, setCompareData] = useState(null);

  // GET /api/locations + GET /api/building-types, once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [locRes, btRes] = await Promise.all([
          api("/api/locations"),
          api("/api/building-types"),
        ]);
        if (cancelled) return;
        setLocations(locRes.locations.map((l) => ({
          id: l.id, city: l.city, state: l.state, iso: l.iso, utility: l.utility,
          priceLevel: l.price_level, x: l.map_x, y: l.map_y,
        })));
        setBuildingTypes(btRes.building_types);
      } catch (err) {
        if (!cancelled) setApiError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // GET /api/locations/{id}/tariffs whenever the location changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api(`/api/locations/${locationId}/tariffs`);
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
        minHeight: "100vh", background: "#0F1B2D", color: "#EAF0F6",
        fontFamily: "'IBM Plex Sans', sans-serif", display: "flex",
        alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center",
      }}>
        <div>
          <div style={{ marginBottom: 10 }}>Loading ClarityGrid…</div>
          {apiError && (
            <div style={{ fontSize: 13, color: "#FF6B5B", maxWidth: 420 }}>
              Could not reach the backend at {API_BASE}. Is it running?<br />{apiError}
            </div>
          )}
        </div>
      </div>
    );
  }

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
        {apiError && (
          <div style={{
            marginTop: 16, fontSize: 13, color: "#FF6B5B", background: "rgba(255,107,91,0.08)",
            border: "1px solid rgba(255,107,91,0.3)", borderRadius: 8, padding: "10px 14px", maxWidth: 640,
          }}>
            Backend request failed: {apiError}
          </div>
        )}
      </div>

      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "0 24px", display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 20 }}>
        {/* MAP */}
        <Panel title="Select a location" icon={<MapPin size={16} color="#8FA3BE" />} style={{ minHeight: 380 }}>
          <div style={{ height: 300, marginBottom: 12 }}>
            <GridMap locations={locations} selectedId={locationId} secondaryId={compareOn ? compareId : null} onSelect={setLocationId} />
          </div>
          {location && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 600 }}>{location.city}, {location.state}</div>
                <div style={{ fontSize: 13, color: "#8FA3BE" }}>{location.utility} &middot; {ISO_NAMES[location.iso] || location.iso}</div>
              </div>
              {compareOn && compareLocation && (
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#3FE0C5" }}>{compareLocation.city}, {compareLocation.state}</div>
                  <div style={{ fontSize: 12.5, color: "#8FA3BE" }}>{ISO_NAMES[compareLocation.iso] || compareLocation.iso} (comparison)</div>
                </div>
              )}
            </div>
          )}
        </Panel>

        {/* CONTROLS */}
        <Panel title="Your building" icon={<Building2 size={16} color="#8FA3BE" />}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <SelectField label="Building type" value={buildingType} onChange={setBuildingType}
              options={buildingTypes.map((b) => ({ value: b.key, label: b.label }))} />
            <SliderField label="Average monthly usage" value={monthlyKwh} onChange={setMonthlyKwh}
              min={500} max={20000} step={100} format={(v) => fmtKwh(v)} />
            <div>
              <div style={{ fontSize: 12.5, color: "#8FA3BE", marginBottom: 8 }}>Tariff at this location</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {tariffs.map((t) => {
                  const est = tariffEstimates[t.id] || 0;
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

      {billData && tariff && (
        <>
          {/* KPIs */}
          <div style={{ maxWidth: 1180, margin: "24px auto 0", padding: "0 24px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
            <KpiCard label="Modeled annual retail cost" value={billData.bill.annual.total} accent="#F0A23A"
              sub={`${(billData.bill.annual.total / billData.bill.annual.usage_kwh * 100).toFixed(1)}¢ effective / kWh`} />
            <KpiCard label="Wholesale-equivalent cost" value={billData.bill.annual.wholesale} accent="#3FE0C5"
              sub={`${((billData.bill.annual.total - billData.bill.annual.wholesale) / billData.bill.annual.total * 100).toFixed(0)}% above wholesale`} />
            {battOn && baselineBill && (
              <KpiCard label="Battery impact vs. no battery" value={Math.abs(batterySavings)} accent={batterySavings >= 0 ? "#6FCF97" : "#FF6B5B"}
                sub={batterySavings >= 0 ? "saved this way" : "costs more this way (flat-rate plans see little benefit)"} />
            )}
            {fixedOn && billData.fixed_bill && (
              <KpiCard label="Fixed-rate plan, annual" value={billData.fixed_bill.annual} accent="#3FE0C5"
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
        </>
      )}

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
      {battOn && billData && tariff && (
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
            {baselineBill && (
              <div style={{ marginTop: 14, fontSize: 13, display: "flex", alignItems: "center", gap: 8, color: batterySavings >= 0 ? "#6FCF97" : "#FF6B5B" }}>
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
          <Panel title="Location comparison" icon={<MapPin size={16} color="#8FA3BE" />}>
            <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 24, alignItems: "center" }}>
              <SelectField label="Compare against" value={compareId} onChange={setCompareId}
                options={locations.filter((l) => l.id !== locationId).map((l) => ({ value: l.id, label: `${l.city}, ${l.state}` }))} />
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={[
                      { name: `${location.city} — Retail`, value: billData.bill.annual.total, fill: "#F0A23A" },
                      { name: `${location.city} — Wholesale`, value: billData.bill.annual.wholesale, fill: "#F0A23A" },
                      { name: `${compareLocation.city} — Retail`, value: compareData.right.bill.annual.total, fill: "#3FE0C5" },
                      { name: `${compareLocation.city} — Wholesale`, value: compareData.right.bill.annual.wholesale, fill: "#3FE0C5" },
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
