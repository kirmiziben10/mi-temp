import { useState, useEffect } from 'react';
import { useBluetoothDevice } from '../hooks/useBluetoothDevice';
import { HistoryChart } from './HistoryChart';
import './TemperatureDisplay.css';

export const TemperatureDisplay = () => {
    const {
        connect,
        disconnect,
        connected,
        isConnecting,
        temperature,
        humidity,
        battery,
        lastUpdate,
        error,
        isBluetoothAvailable,
        deviceName,
        rawData,
        debugLog,
        history,
        deviceHistory,
        bindKey,
        saveBindKey,
        activate,
        fetchDeviceHistory,
        isFetchingHistory
    } = useBluetoothDevice();

    // Load theme from localStorage or default to 'light'
    const [theme, setTheme] = useState(() => {
        const savedTheme = localStorage.getItem('miTempTheme');
        return savedTheme || 'light';
    });

    const [showConsole, setShowConsole] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [historySource, setHistorySource] = useState('local'); // 'local' or 'device'
    const [isClosing, setIsClosing] = useState(false);
    const [isActivating, setIsActivating] = useState(false);

    // Apply theme to document
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
    }, [theme]);

    const toggleTheme = () => {
        setTheme(prev => {
            const newTheme = prev === 'light' ? 'dark' : 'light';
            localStorage.setItem('miTempTheme', newTheme);
            return newTheme;
        });
    };

    const handleToggleConsole = () => {
        if (showConsole) {
            // Start closing animation
            setIsClosing(true);
            setTimeout(() => {
                setShowConsole(false);
                setIsClosing(false);
            }, 400); // Match animation duration
        } else {
            setShowConsole(true);
        }
    };

    const formatTime = (date) => {
        if (!date) return 'Never';
        return date.toLocaleTimeString();
    };

    const handleActivate = async () => {
        setIsActivating(true);
        await activate();
        setIsActivating(false);
    };

    if (!isBluetoothAvailable) {
        return (
            <div className="container">
                <div className="error-card">
                    <h2>Web Bluetooth Not Available</h2>
                    <p>
                        Your browser doesn't support Web Bluetooth API.
                        <br />
                        Please use Chrome, Edge, or Opera.
                    </p>
                </div>
            </div>
        );
    }

    const mainContent = (
        <>
            <div className="header">
                <h1>Mi Temperature Monitor</h1>
                <div className="header-controls">
                    <button
                        className="icon-btn"
                        onClick={toggleTheme}
                        title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
                    >
                        {theme === 'light' ? '🌙' : '☀️'}
                    </button>
                    <button
                        className="icon-btn"
                        onClick={handleToggleConsole}
                        title="Toggle developer console"
                    >
                        {showConsole ? '✕' : '⚙'}
                    </button>
                </div>
            </div>

            <div className={`status-row ${showHistory ? 'compact' : ''}`}>
                <div className={`status-badge ${connected ? 'connected' : 'disconnected'}`}>
                    <span className="status-dot"></span>
                    {connected ? 'Connected' : 'Disconnected'}
                </div>

                {showHistory && (
                    <div className="comfort-inline">
                        <span className="comfort-symbol-inline">
                            {temperature !== null && humidity !== null ? (
                                ((temperature >= 19 && temperature <= 27) && (humidity >= 20 && humidity <= 85))
                                    ? '(^_^)'
                                    : <span>(-<span className="lowered-caret">^</span>-)</span>
                            ) : '--'}
                        </span>
                        <span className="comfort-label-inline">
                            {temperature !== null && humidity !== null ? (
                                ((temperature >= 19 && temperature <= 27) && (humidity >= 20 && humidity <= 85))
                                    ? 'Comfortable'
                                    : 'Uncomfortable'
                            ) : 'Unknown'}
                        </span>
                    </div>
                )}
            </div>

            {deviceName && (
                <div className="device-name">
                    {deviceName}
                </div>
            )}

            <div className="readings-container">
                {showHistory ? (
                    <>
                        <div className="history-controls">
                            <div className="history-source-toggle">
                                <button
                                    className={`toggle-btn ${historySource === 'local' ? 'active' : ''}`}
                                    onClick={() => setHistorySource('local')}
                                >
                                    Local ({history.length})
                                </button>
                                <button
                                    className={`toggle-btn ${historySource === 'device' ? 'active' : ''}`}
                                    onClick={() => setHistorySource('device')}
                                >
                                    Device ({deviceHistory.length})
                                </button>
                            </div>
                            {historySource === 'device' && (
                                <button
                                    className="btn btn-sm btn-fetch"
                                    onClick={fetchDeviceHistory}
                                    disabled={!connected || isFetchingHistory}
                                >
                                    {isFetchingHistory ? 'Fetching...' : 'Fetch from Device'}
                                </button>
                            )}
                        </div>
                        <HistoryChart
                            data={historySource === 'device' ? deviceHistory : history}
                            theme={theme}
                        />
                    </>
                ) : (
                    <>
                        <div className="reading">
                            <div className="reading-content">
                                <div className="reading-label">Temperature</div>
                                <div className="reading-value">
                                    {temperature !== null ? (
                                        <>
                                            <span className="value-number">{temperature.toFixed(1)}</span>
                                            <span className="value-unit">°C</span>
                                        </>
                                    ) : (
                                        <span className="value-placeholder">--</span>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="reading">
                            <div className="reading-content">
                                <div className="reading-label">Humidity</div>
                                <div className="reading-value">
                                    {humidity !== null ? (
                                        <>
                                            <span className="value-number">{humidity}</span>
                                            <span className="value-unit">%</span>
                                        </>
                                    ) : (
                                        <span className="value-placeholder">--</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>

            {!showHistory && (
                <div className="comfort-section">
                    <div className="comfort-symbol">
                        {temperature !== null && humidity !== null ? (
                            ((temperature >= 19 && temperature <= 27) && (humidity >= 20 && humidity <= 85))
                                ? '(^_^)'
                                : <span>(-<span className="lowered-caret">^</span>-)</span>
                        ) : '--'}
                    </div>
                    <div className="comfort-label">
                        {temperature !== null && humidity !== null ? (
                            ((temperature >= 19 && temperature <= 27) && (humidity >= 20 && humidity <= 85))
                                ? 'Comfortable'
                                : 'Uncomfortable'
                        ) : 'Status Unknown'}
                    </div>
                </div>
            )}

            {battery !== null && (
                <div className="battery-indicator">
                    Battery: {battery}%
                </div>
            )}

            <div className="controls">
                <button
                    className={`btn ${connected ? 'btn-secondary' : 'btn-primary'}`}
                    onClick={connected ? disconnect : connect}
                    disabled={isConnecting}
                >
                    {isConnecting ? (
                        <>
                            <span className="spinner"></span>
                            Connecting...
                        </>
                    ) : connected ? (
                        'Disconnect'
                    ) : (
                        'Connect to Device'
                    )}
                </button>
                <button
                    className={`btn btn-history ${showHistory ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setShowHistory(!showHistory)}
                >
                    {showHistory ? 'Show Current' : 'Show History'}
                </button>
            </div>

            {error && (
                <div className="error-message">
                    {error}
                </div>
            )}

            {lastUpdate && (
                <div className="last-update">
                    Last updated: {formatTime(lastUpdate)}
                </div>
            )}

            <div className="info-footer">
                Make sure your device is nearby and turned on
            </div>
        </>
    );

    const consoleContent = (
        <div className="dev-console">
            {/* Mobile back button */}
            <div className="console-mobile-header">
                <button className="back-btn" onClick={handleToggleConsole}>
                    ← Back
                </button>
            </div>

            <div className="console-header">Developer Console</div>

            <div className="console-section">
                <div className="console-title">Tools & Settings</div>
                <div className="console-item console-item-column">
                    <span className="console-label">Bind Key (for stock firmware)</span>
                    <input
                        type="text"
                        value={bindKey || ''}
                        onChange={(e) => saveBindKey(e.target.value)}
                        placeholder="Enter 32-char hex key"
                        className="console-input"
                    />
                    <button
                        className="btn btn-sm btn-full-width"
                        onClick={handleActivate}
                        disabled={!connected || isActivating}
                    >
                        {isActivating ? 'Getting Key...' : 'Get Key from Device'}
                    </button>
                    {!connected && <small className="console-hint">Connect device to get key</small>}
                </div>
            </div>

            {rawData && (
                <div className="console-section">
                    <div className="console-title">Latest Data</div>
                    <div className="console-item">
                        <span className="console-label">Raw Bytes:</span>
                        <span className="console-value">{rawData.hex}</span>
                    </div>
                    <div className="console-item">
                        <span className="console-label">Byte Count:</span>
                        <span className="console-value">{rawData.bytes.length}</span>
                    </div>
                    <div className="console-item">
                        <span className="console-label">Interpreted:</span>
                        <span className="console-value">
                            {temperature !== null && humidity !== null
                                ? `${temperature.toFixed(1)}°C, ${humidity}%`
                                : 'No data'}
                        </span>
                    </div>
                </div>
            )}

            <div className="console-section">
                <div className="console-title">Debug Log</div>
                <div className="console-log">
                    {debugLog.length === 0 ? (
                        <div className="console-empty">No log entries yet</div>
                    ) : (
                        debugLog.map((entry, index) => (
                            <div key={index} className="log-entry">
                                <span className="log-time">[{entry.timestamp}]</span>
                                <span className="log-message">{entry.message}</span>
                                {entry.data && (
                                    <pre className="log-data">{JSON.stringify(entry.data, null, 2)}</pre>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );

    return (
        <div className="container">
            <div className={`layout ${showConsole ? 'console-open' : ''}`}>
                {/* Mobile: Toggle between main and console */}
                <div className={`mobile-view ${showConsole ? 'show-console' : 'show-main'}`}>
                    {!showConsole ? (
                        <div className="card">
                            {mainContent}
                        </div>
                    ) : (
                        <div className="console-wrapper">
                            {consoleContent}
                        </div>
                    )}
                </div>

                {/* Desktop: Side-by-side layout */}
                <div className="desktop-view">
                    <div className="card main-card">
                        {mainContent}
                    </div>
                    {showConsole && (
                        <div className={`console-wrapper ${isClosing ? 'closing' : ''}`}>
                            {consoleContent}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
