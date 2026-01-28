import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer
} from 'recharts';
import './HistoryChart.css';

export const HistoryChart = ({ data, theme = 'light' }) => {
    if (!data || data.length === 0) {
        return (
            <div className="chart-empty">
                <p>No history data available.</p>
                <small>Connect to device to start logging.</small>
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
        <div className="history-charts">
            <div className="chart-container">
                <h4 className="chart-title">Temperature History</h4>
                <div className="chart-wrapper">
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

            <div className="chart-container">
                <h4 className="chart-title">Humidity History</h4>
                <div className="chart-wrapper">
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
