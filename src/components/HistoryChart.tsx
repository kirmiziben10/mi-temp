import { useMemo } from 'react';
import { Area, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { downsample } from '../lib/downsample';
import { TIME_PERIODS, type PeriodValue } from '../lib/periods';
import { useNow } from '../hooks/useNow';
import type { HistoryPoint } from '../protocol/types';

const TEMP_COLOR = '#ff6b6b';
const HUM_COLOR = '#4dabf7';
const MAX_RENDERED_POINTS = 600;

interface Props {
  data: HistoryPoint[];
  period: PeriodValue;
  emptyHint: string;
}

interface ChartRow extends HistoryPoint {
  tempRange?: [number, number];
  humRange?: [number, number];
}

export function HistoryChart({ data, period, emptyHint }: Props) {
  const now = useNow(60_000);
  const rows = useMemo<ChartRow[]>(() => {
    const ms = TIME_PERIODS.find((p) => p.value === period)?.ms ?? null;
    const cutoff = ms === null ? -Infinity : now - ms;
    return downsample(
      data.filter((p) => p.t >= cutoff),
      MAX_RENDERED_POINTS,
    ).map((p) => ({
      ...p,
      tempRange:
        p.minTemperature !== undefined && p.maxTemperature !== undefined && p.minTemperature !== p.maxTemperature
          ? [p.minTemperature, p.maxTemperature]
          : undefined,
      humRange:
        p.minHumidity !== undefined && p.maxHumidity !== undefined && p.minHumidity !== p.maxHumidity
          ? [p.minHumidity, p.maxHumidity]
          : undefined,
    }));
  }, [data, period, now]);

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 px-5 text-center text-text-secondary">
        <p className="m-0 mb-2 text-base">No history data available.</p>
        <small className="opacity-70 text-[0.85rem]">{emptyHint}</small>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 px-5 text-center text-text-secondary">
        <p className="m-0 mb-2 text-base">No data for this time period.</p>
        <small className="opacity-70 text-[0.85rem]">Try selecting a longer period.</small>
      </div>
    );
  }

  const first = rows[0]!.t;
  const last = rows[rows.length - 1]!.t;
  const multiDay = last - first > 36 * 3600_000;
  const formatTick = (t: number) =>
    multiDay
      ? new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' })
      : new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="w-full flex flex-col gap-6">
      <Series
        title="Temperature History"
        rows={rows}
        dataKey="temperature"
        rangeKey="tempRange"
        unit="°C"
        color={TEMP_COLOR}
        domain={['auto', 'auto']}
        formatTick={formatTick}
        domainX={[first, last]}
      />
      <Series
        title="Humidity History"
        rows={rows}
        dataKey="humidity"
        rangeKey="humRange"
        unit="%"
        color={HUM_COLOR}
        domain={[0, 100]}
        formatTick={formatTick}
        domainX={[first, last]}
      />
    </div>
  );
}

interface SeriesProps {
  title: string;
  rows: ChartRow[];
  dataKey: 'temperature' | 'humidity';
  rangeKey: 'tempRange' | 'humRange';
  unit: string;
  color: string;
  domain: [number | 'auto', number | 'auto'];
  domainX: [number, number];
  formatTick: (t: number) => string;
}

function Series({ title, rows, dataKey, rangeKey, unit, color, domain, domainX, formatTick }: SeriesProps) {
  const hasRange = rows.some((r) => r[rangeKey]);
  const single = domainX[0] === domainX[1];
  return (
    <div className="w-full">
      <h4 className="m-0 mb-3 text-[0.9rem] font-semibold text-text-secondary">
        {title}
        {hasRange && <span className="ml-2 font-normal text-text-tertiary text-xs">band = min–max</span>}
      </h4>
      <div className="w-full h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 5, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={single ? [domainX[0] - 1800_000, domainX[1] + 1800_000] : domainX}
              tickFormatter={formatTick}
              stroke="var(--chart-text)"
              fontSize={12}
              minTickGap={24}
            />
            <YAxis stroke="var(--chart-text)" unit={unit} domain={domain} fontSize={12} width={56} allowDecimals />
            <Tooltip
              labelFormatter={(t) => new Date(Number(t)).toLocaleString()}
              formatter={(value, name) => {
                if (Array.isArray(value)) return [`${value[0]}–${value[1]} ${unit}`, 'Range'];
                return [`${Number(value).toFixed(dataKey === 'temperature' ? 1 : 0)} ${unit}`, name];
              }}
              contentStyle={{
                backgroundColor: 'var(--chart-tooltip-bg)',
                border: '1px solid var(--chart-grid)',
                color: 'var(--chart-tooltip-text)',
                borderRadius: 6,
                fontSize: 12,
              }}
            />
            {hasRange && (
              <Area
                type="monotone"
                dataKey={rangeKey}
                stroke="none"
                fill={color}
                fillOpacity={0.15}
                isAnimationActive={false}
                connectNulls
                name="Range"
              />
            )}
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              fill={color}
              fillOpacity={hasRange ? 0.05 : 0.2}
              isAnimationActive={rows.length < 200}
              dot={rows.length === 1}
              name={dataKey === 'temperature' ? 'Temperature' : 'Humidity'}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
