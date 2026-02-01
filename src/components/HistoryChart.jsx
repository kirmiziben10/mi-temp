import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer
} from 'recharts';

export const HistoryChart = ({ data, theme = 'light' }) => {
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
            <div className="w-full">
                <h4 className="m-0 mb-3 text-[0.9rem] font-semibold text-text-secondary">Temperature History</h4>
                <div className="w-full h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data}>
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
                                formatter={(value, name) => [value.toFixed(2), name]}
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
                        <AreaChart data={data}>
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
                                formatter={(value, name) => [value.toFixed(2), name]}
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
