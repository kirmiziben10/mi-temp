import { useMemo } from 'react';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer
} from 'recharts';

export const TIME_PERIODS = [
    { label: '1h', value: 1 * 60 * 60 * 1000 },
    { label: '6h', value: 6 * 60 * 60 * 1000 },
    { label: '24h', value: 24 * 60 * 60 * 1000 },
    { label: '7d', value: 7 * 24 * 60 * 60 * 1000 },
    { label: 'All', value: null }
];

export const TimePeriodToggle = ({ selectedPeriod, onPeriodChange }) => (
    <div id="time-period-toggle" className="flex gap-0 rounded-md overflow-hidden border border-border-primary">
        {TIME_PERIODS.map((period, index) => (
            <button
                key={period.label}
                onClick={() => onPeriodChange(period)}
                className={`px-3 py-1.5 text-xs font-medium cursor-pointer transition-all duration-200 ${index < TIME_PERIODS.length - 1 ? 'border-0 border-r border-border-primary' : 'border-0'
                    } ${selectedPeriod.label === period.label
                        ? 'bg-text-primary text-bg-secondary'
                        : 'bg-bg-tertiary text-text-secondary hover:bg-border-primary'
                    }`}
                aria-pressed={selectedPeriod.label === period.label}
            >
                {period.label}
            </button>
        ))}
    </div>
);

export const HistoryChart = ({ data, theme = 'light', selectedPeriod }) => {
    const filteredData = useMemo(() => {
        if (!data || data.length === 0) return [];
        if (!selectedPeriod || selectedPeriod.value === null) return data;

        const now = Date.now();
        const cutoff = now - selectedPeriod.value;
        return data.filter(item => {
            const timestamp = typeof item.timestamp === 'number'
                ? item.timestamp
                : new Date(item.timestamp).getTime();
            return timestamp >= cutoff;
        });
    }, [data, selectedPeriod]);

    if (!data || data.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-10 px-5 text-center text-text-secondary">
                <p className="m-0 mb-2 text-base">No history data available.</p>
                <small className="opacity-70 text-[0.85rem]">Connect to device to start logging.</small>
            </div>
        );
    }

    const isDark = theme === 'dark';
    const gridColor = isDark ? '#444' : '#e0e0e0';
    const textColor = isDark ? '#aaa' : '#666';
    const tempColor = '#ff6b6b';
    const humColor = '#4dabf7';

    // Format timestamp for X-axis
    const formatXAxis = (tickItem) => {
        const date = new Date(tickItem);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className="w-full flex flex-col gap-6">
            {filteredData.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 px-5 text-center text-text-secondary">
                    <p className="m-0 mb-2 text-base">No data for this time period.</p>
                    <small className="opacity-70 text-[0.85rem]">Try selecting a longer period.</small>
                </div>
            ) : (
                <>
                    <div className="w-full">
                        <h4 className="m-0 mb-3 text-[0.9rem] font-semibold text-text-secondary">Temperature History</h4>
                        <div className="w-full h-[200px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={filteredData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                                    <XAxis
                                        dataKey="timestamp"
                                        tickFormatter={formatXAxis}
                                        stroke={textColor}
                                        fontSize={12}
                                    />
                                    <YAxis
                                        stroke={textColor}
                                        unit="°C"
                                        domain={['auto', 'auto']}
                                        fontSize={12}
                                    />
                                    <Tooltip
                                        labelFormatter={(label) => new Date(label).toLocaleString()}
                                        contentStyle={{
                                            backgroundColor: isDark ? '#333' : '#fff',
                                            border: `1px solid ${gridColor}`,
                                            color: isDark ? '#eee' : '#333'
                                        }}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="temperature"
                                        stroke={tempColor}
                                        fill={tempColor}
                                        fillOpacity={0.2}
                                        name="Temperature"
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    <div className="w-full">
                        <h4 className="m-0 mb-3 text-[0.9rem] font-semibold text-text-secondary">Humidity History</h4>
                        <div className="w-full h-[200px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={filteredData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                                    <XAxis
                                        dataKey="timestamp"
                                        tickFormatter={formatXAxis}
                                        stroke={textColor}
                                        fontSize={12}
                                    />
                                    <YAxis
                                        stroke={textColor}
                                        unit="%"
                                        domain={[0, 100]}
                                        fontSize={12}
                                    />
                                    <Tooltip
                                        labelFormatter={(label) => new Date(label).toLocaleString()}
                                        contentStyle={{
                                            backgroundColor: isDark ? '#333' : '#fff',
                                            border: `1px solid ${gridColor}`,
                                            color: isDark ? '#eee' : '#333'
                                        }}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="humidity"
                                        stroke={humColor}
                                        fill={humColor}
                                        fillOpacity={0.2}
                                        name="Humidity"
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};
