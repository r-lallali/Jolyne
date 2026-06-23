"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TimePoint } from "@/lib/adminStats";

// Wrappers recharts pour l'admin : palette emerald unique, axes discrets,
// tooltip stylé en Tailwind (compatible thème clair/sombre).

const AXIS = { fontSize: 11, fill: "#a3a3a3" } as const;
const GRID = "#e5e5e5";
const EMERALD = "#10b981";

interface TipItem {
  value?: number | string;
}
interface TipProps {
  active?: boolean;
  payload?: TipItem[];
  label?: string | number;
}

function ChartTooltip({ active, payload, label }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
      <div className="text-neutral-400">{label}</div>
      <div className="font-semibold tabular-nums text-neutral-900 dark:text-neutral-50">
        {payload[0]?.value}
      </div>
    </div>
  );
}

function fmtDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

export function LineCard({ points }: { points: TimePoint[] }) {
  const data = points.map((p) => ({ x: fmtDay(p.bucket), value: p.value }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="emeraldFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={EMERALD} stopOpacity={0.3} />
            <stop offset="100%" stopColor={EMERALD} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} strokeOpacity={0.4} vertical={false} />
        <XAxis dataKey="x" tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={36} />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: GRID }} />
        <Area
          type="monotone"
          dataKey="value"
          stroke={EMERALD}
          strokeWidth={2}
          fill="url(#emeraldFill)"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function BarCard({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} strokeOpacity={0.4} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={36} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "#00000008" }} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {data.map((d, i) => (
            <Cell
              key={i}
              fill={EMERALD}
              fillOpacity={0.35 + 0.65 * (d.value / max)}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
