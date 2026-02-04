import { useState } from 'react';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer
} from 'recharts';

const TIME_PERIODS = [
    { label: '1h', value: 60 * 60 * 1000 },
    { label: '6h', value: 6 * 60 * 60 * 1000 },
    { label: '24h', value: 24 * 60 * 60 * 1000 },
    { label: '7d', value: 7 * 24 * 60 * 60 * 1000 },
    { label: 'All', value: null },
];

export const HistoryChart = ({ data, theme = 'light' }) => {
    const [selectedPeriod, setSelectedPeriod] = useState(null); // null = All

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

    // Filter data based on selected time period
    const filteredData = selectedPeriod
        ? data.filter(item => {
            const cutoff = Date.now() - selectedPeriod;
            const itemTime = new Date(item.timestamp).getTime();
            return itemTime >= cutoff;
        })
        : data;

    // Format timestamp for X-axis - show date if period is 7d or All
    const formatXAxis = (tickItem) => {
        const date = new Date(tickItem);
        if (selectedPeriod === null || selectedPeriod >= 7 * 24 * 60 * 60 * 1000) {
            return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
        }
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className="w-full flex flex-col gap-6">
            {/* Time Period Selector */}
            <div id="time-period-selector" className="flex gap-0 rounded-md overflow-hidden border border-border-primary self-start">
                {TIME_PERIODS.map((period) => (
                    <button
                        key={period.label}
                        className={`px-3 py-1.5 text-xs font-medium border-0 border-r border-border-primary last:border-r-0 cursor-pointer transition-all duration-200 ${selectedPeriod === period.value
                            ? 'bg-text-primary text-bg-secondary'
                            : 'bg-bg-tertiary text-text-secondary hover:bg-border-primary'
                            }`}
                        onClick={() => setSelectedPeriod(period.value)}
                    >
                        {period.label}
                    </button>
                ))}
            </div>

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
        </div>
    );
};
