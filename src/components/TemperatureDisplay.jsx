import { useState } from 'react';
import { useBluetoothDevice } from '../hooks/useBluetoothDevice';
import { useTheme } from '../hooks/useTheme';
import { HistoryChart } from './HistoryChart';

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

    const { theme, toggleTheme } = useTheme();

    const [showConsole, setShowConsole] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [historySource, setHistorySource] = useState('local'); // 'local' or 'device'
    const [isClosing, setIsClosing] = useState(false);
    const [isActivating, setIsActivating] = useState(false);

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
            <div id="bluetooth-error-container" className="h-full flex items-center justify-center p-8 w-full">
                <div id="bluetooth-error-card" className="bg-bg-secondary p-12 rounded-xl border border-border-primary text-center shadow">
                    <h2 className="text-text-primary my-4 text-xl font-semibold">Web Bluetooth Not Available</h2>
                    <p className="text-text-secondary leading-relaxed text-[0.9375rem]">
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
            <div id="header" className="flex justify-between items-end mb-6 gap-4 flex-wrap">
                <div id="app-title-container" className="flex flex-col">
                    <h1 id="app-title" className="m-0 text-2xl font-semibold text-text-primary text-[1.5rem] sm:text-[1.25rem]">Mi&nbsp;Temperature&nbsp;Monitor</h1>
                    <span id="device-name" className="text-sm text-text-secondary">{deviceName || '--'}</span>
                </div>
                <div id="header-controls" className="flex gap-2 shrink-0 ml-auto">
                    <button
                        id="theme-toggle-btn"
                        className="w-9 h-9 rounded-md border border-border-primary bg-bg-tertiary text-text-primary cursor-pointer flex items-center justify-center text-lg transition-all duration-300 hover:bg-border-primary"
                        onClick={toggleTheme}
                        title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
                        aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
                    >
                        {theme === 'light' ? '🌙' : '☀️'}
                    </button>
                    <button
                        id="console-toggle-btn"
                        className="w-9 h-9 rounded-md border border-border-primary bg-bg-tertiary text-text-primary cursor-pointer flex items-center justify-center text-lg transition-all duration-300 hover:bg-border-primary"
                        onClick={handleToggleConsole}
                        title="Toggle developer console"
                        aria-label="Toggle developer console"
                    >
                        {showConsole ? '✕' : '⚙'}
                    </button>
                </div>
            </div>

            <div id="status-row" className="flex items-center gap-4 mb-6 flex-wrap justify-between">
                <div
                    id="connection-battery-status"
                    className={`relative inline-flex items-center gap-2 px-4 h-9 rounded-md text-sm font-medium overflow-hidden border ${connected
                        ? 'border-success-border text-text-primary'
                        : 'bg-error-bg text-error-text border-error-border'
                        }`}
                >
                    {connected && battery !== null && (
                        <div
                            className="absolute inset-0 bg-success-bg transition-all duration-300"
                            style={{ width: `${battery}%` }}
                        />
                    )}
                    <span className="relative z-10 w-1.5 h-1.5 rounded-full bg-current"></span>
                    <span className="relative z-10">
                        {connected ? (battery !== null ? `${battery}%` : 'Connected') : 'Disconnected'}
                    </span>
                </div>

                <div id="comfort-status" className="inline-flex items-center gap-2 px-4 h-9 bg-bg-tertiary rounded-md border border-border-secondary text-sm font-medium">
                    <span id="comfort-icon" className="font-mono text-base font-semibold text-text-primary leading-none">
                        {temperature !== null && humidity !== null ? (
                            ((temperature >= 19 && temperature <= 27) && (humidity >= 20 && humidity <= 85))
                                ? '(^_^)'
                                : <span>(-<span className="relative top-[0.5em] inline-block">^</span>-)</span>
                        ) : '--'}
                    </span>
                    <span id="comfort-label" className="hidden sm:inline text-xs text-text-secondary font-medium">
                        {temperature !== null && humidity !== null ? (
                            ((temperature >= 19 && temperature <= 27) && (humidity >= 20 && humidity <= 85))
                                ? 'Comfortable'
                                : 'Uncomfortable'
                        ) : 'Unknown'}
                    </span>
                </div>
            </div>

            <div id="readings-container" className={`grid gap-4 mb-8 ${showHistory ? 'block' : 'grid-cols-1 sm:grid-cols-2'}`}>
                {showHistory ? (
                    <>
                        <div id="history-controls" className="flex justify-between items-center gap-2 mb-4 flex-wrap">
                            <div id="history-source-toggle" className="flex gap-0 rounded-md overflow-hidden border border-border-primary">
                                <button
                                    id="history-source-local-btn"
                                    className={`px-3 py-1.5 text-xs font-medium border-0 border-r border-border-primary cursor-pointer transition-all duration-200 ${historySource === 'local'
                                        ? 'bg-text-primary text-bg-secondary'
                                        : 'bg-bg-tertiary text-text-secondary hover:bg-border-primary'
                                        }`}
                                    onClick={() => setHistorySource('local')}
                                    aria-pressed={historySource === 'local'}
                                >
                                    Local ({history.length})
                                </button>
                                <button
                                    id="history-source-device-btn"
                                    className={`px-3 py-1.5 text-xs font-medium border-0 cursor-pointer transition-all duration-200 ${historySource === 'device'
                                        ? 'bg-text-primary text-bg-secondary'
                                        : 'bg-bg-tertiary text-text-secondary hover:bg-border-primary'
                                        }`}
                                    onClick={() => setHistorySource('device')}
                                    aria-pressed={historySource === 'device'}
                                >
                                    Device ({deviceHistory.length})
                                </button>
                            </div>
                            {historySource === 'device' && (
                                <button
                                    id="fetch-history-btn"
                                    className="px-4 py-2 text-[0.8125rem] font-medium border border-border-primary rounded-md cursor-pointer transition-all duration-300 flex items-center justify-center gap-2 bg-text-primary text-bg-secondary border-text-primary hover:not-disabled:opacity-80 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
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
                        <div id="temperature-card" className="flex flex-col items-center p-6 bg-bg-tertiary rounded-lg border border-border-secondary">
                            <div className="text-center w-full">
                                <div className="text-xs text-text-secondary mb-2 font-medium uppercase tracking-wider">Temperature</div>
                                <div id="temperature-value" className="text-[2.5rem] sm:text-[2rem] font-semibold leading-none text-text-primary">
                                    {temperature !== null ? (
                                        <>
                                            <span className="text-text-primary">{temperature.toFixed(2)}</span>
                                            <span className="text-xl ml-1 text-text-secondary font-normal">°C</span>
                                        </>
                                    ) : (
                                        <span className="text-text-placeholder">--</span>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div id="humidity-card" className="flex flex-col items-center p-6 bg-bg-tertiary rounded-lg border border-border-secondary">
                            <div className="text-center w-full">
                                <div className="text-xs text-text-secondary mb-2 font-medium uppercase tracking-wider">Humidity</div>
                                <div id="humidity-value" className="text-[2.5rem] sm:text-[2rem] font-semibold leading-none text-text-primary">
                                    {humidity !== null ? (
                                        <>
                                            <span className="text-text-primary">{humidity}</span>
                                            <span className="text-xl ml-1 text-text-secondary font-normal">%</span>
                                        </>
                                    ) : (
                                        <span className="text-text-placeholder">--</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>



            <div id="action-buttons" className="mb-6 flex gap-0">
                <button
                    id="connect-btn"
                    className={`w-full px-6 py-3.5 border rounded-md text-[0.9375rem] font-medium cursor-pointer transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${connected
                        ? 'bg-bg-tertiary text-error-text border-error-border hover:not-disabled:bg-error-bg'
                        : 'bg-text-primary text-bg-secondary border-text-primary hover:not-disabled:opacity-80'
                        }`}
                    onClick={connected ? disconnect : connect}
                    disabled={isConnecting}
                >
                    {isConnecting ? (
                        <>
                            <span className="w-3.5 h-3.5 border-2 border-[rgba(255,255,255,0.3)] border-t-current rounded-full animate-spin"></span>
                            Connecting...
                        </>
                    ) : connected ? (
                        'Disconnect'
                    ) : (
                        'Connect to Device'
                    )}
                </button>
                <button
                    id="history-toggle-btn"
                    className={`btn-history ml-[10px] w-full px-6 py-3.5 border rounded-md text-[0.9375rem] font-medium cursor-pointer transition-all duration-300 flex items-center justify-center gap-2 ${showHistory
                        ? 'bg-text-primary text-bg-secondary border-text-primary hover:opacity-80'
                        : 'bg-bg-tertiary text-error-text border-error-border hover:bg-error-bg'
                        }`}
                    onClick={() => setShowHistory(!showHistory)}
                >
                    {showHistory ? 'Show Current' : 'Show History'}
                </button>
            </div>

            {error && (
                <div id="error-message" className="p-3.5 bg-error-bg border border-error-border rounded-md text-error-text text-sm mb-4">
                    {error}
                </div>
            )}

            {lastUpdate && (
                <div id="last-update" className="text-center text-xs text-text-tertiary mb-4">
                    Last updated: {formatTime(lastUpdate)}
                </div>
            )}

            <div id="info-footer" className="text-center text-xs text-text-tertiary pt-4 border-t border-border-secondary mt-auto">
                Make sure your device is nearby and turned on
            </div>
        </>
    );

    const consoleContent = (
        <div id="dev-console" className="bg-bg-secondary border border-border-primary rounded-xl pt-6 px-4 sm:px-6 pb-0 text-[0.8125rem] shadow flex flex-col h-auto max-h-[calc(100vh-1rem)] sm:max-h-[calc(100vh-2rem)] lg:max-h-[calc(100vh-4rem)] w-full lg:min-w-[600px] lg:w-[600px] overflow-hidden relative">
            {/* Mobile back button */}
            <div className="flex lg:hidden mb-4 justify-end">
                <button
                    id="console-back-btn"
                    className="px-4 py-2 rounded-md border border-border-primary bg-bg-tertiary text-text-primary cursor-pointer text-sm font-medium transition-all duration-300 hover:bg-border-primary"
                    onClick={handleToggleConsole}
                    aria-label="Close developer console"
                >
                    Close ✕
                </button>
            </div>

            <div id="console-header" className="font-semibold mb-4 text-text-primary border-b border-border-secondary pb-2 text-base">Developer Console</div>

            <div id="tools-section" className="mb-6 max-h-[30rem]">
                <div className="font-medium mb-3 text-text-secondary text-xs uppercase tracking-wider">Tools & Settings</div>
                <div className="flex flex-col items-start p-3 bg-bg-tertiary rounded-md mb-2 gap-2.5">
                    <span className="text-text-secondary font-medium shrink-0">Bind Key (for stock firmware)</span>
                    <input
                        id="bind-key-input"
                        type="text"
                        value={bindKey || ''}
                        onChange={(e) => saveBindKey(e.target.value)}
                        placeholder="Enter 32-char hex key"
                        className="w-full p-2 rounded border border-border-primary bg-bg-tertiary text-text-primary text-[0.8125rem] font-mono placeholder:text-text-tertiary"
                        aria-label="Bind Key"
                    />
                    <button
                        id="get-key-btn"
                        className="w-full mt-1.5 px-4 py-2 text-[0.8125rem] font-medium border border-border-primary rounded-md cursor-pointer transition-all duration-300 flex items-center justify-center gap-2 bg-text-primary text-bg-secondary border-text-primary hover:not-disabled:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={handleActivate}
                        disabled={!connected || isActivating}
                    >
                        {isActivating ? 'Getting Key...' : 'Get Key from Device'}
                    </button>
                    {!connected && <small className="opacity-70 text-xs text-text-secondary">Connect device to get key</small>}
                </div>
            </div>

            {rawData && (
                <div id="raw-data-section" className="mb-6 max-h-[30rem]">
                    <div className="font-medium mb-3 text-text-secondary text-xs uppercase tracking-wider">Latest Data</div>
                    <div className="flex justify-between items-start p-3 bg-bg-tertiary rounded-md mb-2 gap-4">
                        <span className="text-text-secondary font-medium shrink-0">Raw Bytes:</span>
                        <span id="raw-bytes-value" className="text-text-primary font-mono text-xs break-all text-right">{rawData.hex}</span>
                    </div>
                    <div className="flex justify-between items-start p-3 bg-bg-tertiary rounded-md mb-2 gap-4">
                        <span className="text-text-secondary font-medium shrink-0">Byte Count:</span>
                        <span id="byte-count-value" className="text-text-primary font-mono text-xs break-all text-right">{rawData.bytes.length}</span>
                    </div>
                    <div className="flex justify-between items-start p-3 bg-bg-tertiary rounded-md mb-2 gap-4">
                        <span className="text-text-secondary font-medium shrink-0">Interpreted:</span>
                        <span id="interpreted-value" className="text-text-primary font-mono text-xs break-all text-right">
                            {temperature !== null && humidity !== null
                                ? `${temperature.toFixed(2)}°C, ${humidity}%`
                                : 'No data'}
                        </span>
                    </div>
                </div>
            )}

            <div id="debug-log-section" className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <div className="font-medium mb-3 text-text-secondary text-xs uppercase tracking-wider shrink-0">Debug Log</div>
                <div id="debug-log" className="flex-1 overflow-y-auto bg-bg-tertiary rounded-md p-3 min-h-[100px]" role="log" aria-live="polite">
                    {debugLog.length === 0 ? (
                        <div className="text-text-tertiary italic text-center py-8">No log entries yet</div>
                    ) : (
                        debugLog.map((entry, index) => (
                            <div key={index} className="p-3 border-b border-border-secondary text-xs last:border-b-0">
                                <span className="text-text-tertiary mr-2 font-mono">[{entry.timestamp}]</span>
                                <span className="text-text-primary">{entry.message}</span>
                                {entry.data && (
                                    <pre className="mt-2 p-3 bg-bg-secondary rounded text-text-secondary text-[0.7rem] overflow-x-auto">{JSON.stringify(entry.data, null, 2)}</pre>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );

    return (
        <div id="app-container" className="h-screen flex items-center justify-center p-2 sm:p-4 lg:p-8 w-full">
            <div id="layout-container" className={`w-full max-w-[1200px] flex gap-6 items-start ${showConsole ? 'console-open' : ''}`}>
                {/* Mobile: Toggle between main and console */}
                <div id="mobile-main-view" className={`block w-full lg:hidden ${showConsole ? 'hidden' : 'block'}`}>
                    <div id="main-card-mobile" className="bg-bg-secondary rounded-xl border border-border-primary p-4 sm:p-6 w-full shadow transition-all duration-300 flex flex-col max-h-[calc(100vh-1rem)] sm:max-h-[calc(100vh-2rem)] overflow-hidden">
                        {mainContent}
                    </div>
                </div>
                <div id="mobile-console-view" className={`block w-full lg:hidden ${showConsole ? 'block' : 'hidden'}`}>
                    <div className="w-full h-full">
                        {consoleContent}
                    </div>
                </div>

                {/* Desktop: Side-by-side layout */}
                <div id="desktop-view" className="hidden lg:flex w-full items-center h-full justify-center">
                    <div id="main-card-desktop" className={`transition-all duration-300 ease-out relative z-10 ${showConsole ? 'flex-shrink-0 w-[480px]' : 'flex-initial w-[480px]'}`}>
                        <div className="bg-bg-secondary rounded-xl border border-border-primary p-10 w-full shadow flex flex-col">
                            {mainContent}
                        </div>
                    </div>
                    {showConsole && (
                        <div id="console-wrapper" className={`flex-initial h-full relative z-0 overflow-hidden flex justify-end ${isClosing ? 'animate-[slideOutToLeft_0.4s_ease-out_forwards]' : 'animate-[slideInFromLeft_0.4s_ease-out_forwards]'}`}>
                            {consoleContent}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
