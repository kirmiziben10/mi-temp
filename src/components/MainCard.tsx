import type { DeviceController } from '../hooks/useDevice';
import type { Theme } from '../hooks/useTheme';
import { isComfortable } from '../lib/comfort';
import { HistoryPanel } from './HistoryPanel';
import { cls } from './styles';
import { Spinner } from './ui';

interface Props {
  device: DeviceController;
  theme: Theme;
  onToggleTheme: () => void;
  consoleOpen: boolean;
  onToggleConsole: () => void;
  showHistory: boolean;
  onToggleHistory: () => void;
}

export function MainCard({ device, theme, onToggleTheme, consoleOpen, onToggleConsole, showHistory, onToggleHistory }: Props) {
  const { status, reading, battery } = device;
  const connected = status === 'connected';
  const comfortable = reading ? isComfortable(reading.temperature, reading.humidity) : null;

  return (
    <>
      <div id="header" className="flex justify-between items-end mb-6 gap-4 flex-wrap">
        <div id="app-title-container" className="flex flex-col min-w-0">
          <h1 id="app-title" className="m-0 font-semibold text-text-primary text-[1.25rem] sm:text-[1.5rem]">
            Mi&nbsp;Temperature&nbsp;Monitor
          </h1>
          <span id="device-name" className="text-sm text-text-secondary truncate">
            {device.deviceName || '--'}
            {connected && device.firmware && (
              <span className="text-text-tertiary"> · {device.firmware === 'stock' ? 'stock firmware' : 'pvvx firmware'}</span>
            )}
          </span>
        </div>
        <div id="header-controls" className="flex gap-2 shrink-0 ml-auto">
          <button
            id="theme-toggle-btn"
            type="button"
            className={cls.iconButton}
            onClick={onToggleTheme}
            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          >
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
          <button
            id="console-toggle-btn"
            type="button"
            className={cls.iconButton}
            onClick={onToggleConsole}
            title="Toggle developer console"
            aria-label="Toggle developer console"
            aria-expanded={consoleOpen}
          >
            {consoleOpen ? '✕' : '⚙'}
          </button>
        </div>
      </div>

      <div id="status-row" className="flex items-center gap-4 mb-6 flex-wrap justify-between">
        <div
          id="connection-battery-status"
          title={connected && battery !== null ? (device.batteryEstimated ? 'Battery (estimated from voltage)' : 'Battery') : undefined}
          className={`relative inline-flex items-center gap-2 px-4 h-9 rounded-md text-sm font-medium overflow-hidden border ${
            connected ? 'border-success-border text-text-primary' : 'bg-error-bg text-error-text border-error-border'
          }`}
        >
          {connected && battery !== null && (
            <div className="absolute inset-0 bg-success-bg transition-all duration-300" style={{ width: `${battery}%` }} />
          )}
          <span className="relative z-10 w-1.5 h-1.5 rounded-full bg-current" />
          <span className="relative z-10">
            {status === 'connecting'
              ? 'Connecting'
              : connected
                ? battery !== null
                  ? `${battery}%`
                  : 'Connected'
                : 'Disconnected'}
          </span>
        </div>

        <div
          id="comfort-status"
          className="inline-flex items-center gap-2 px-4 h-9 bg-bg-tertiary rounded-md border border-border-secondary text-sm font-medium"
        >
          <span id="comfort-icon" className="font-mono text-base font-semibold text-text-primary leading-none">
            {comfortable === null ? (
              '--'
            ) : comfortable ? (
              '(^_^)'
            ) : (
              <span>
                (-<span className="relative top-[0.5em] inline-block">^</span>-)
              </span>
            )}
          </span>
          <span id="comfort-label" className="hidden sm:inline text-xs text-text-secondary font-medium">
            {comfortable === null ? 'Unknown' : comfortable ? 'Comfortable' : 'Uncomfortable'}
          </span>
        </div>
      </div>

      <div id="readings-container" className={showHistory ? 'mb-8' : 'grid gap-4 mb-8 grid-cols-1 sm:grid-cols-2'}>
        {showHistory ? (
          <HistoryPanel device={device} />
        ) : (
          <>
            <ReadingCard id="temperature" label="Temperature" value={reading?.temperature.toFixed(2)} unit="°C" />
            <ReadingCard
              id="humidity"
              label="Humidity"
              value={reading ? (Number.isInteger(reading.humidity) ? `${reading.humidity}` : reading.humidity.toFixed(1)) : undefined}
              unit="%"
            />
          </>
        )}
      </div>

      <div id="action-buttons" className="mb-6 flex gap-2.5">
        <button
          id="connect-btn"
          type="button"
          className={connected ? cls.dangerButton : cls.primaryButton}
          onClick={connected ? device.disconnect : device.connect}
          disabled={status === 'connecting'}
        >
          {status === 'connecting' ? (
            <>
              <Spinner /> Connecting...
            </>
          ) : connected ? (
            'Disconnect'
          ) : (
            'Connect to Device'
          )}
        </button>
        <button
          id="history-toggle-btn"
          type="button"
          className={showHistory ? cls.primaryButton : cls.secondaryButton}
          onClick={onToggleHistory}
          aria-pressed={showHistory}
        >
          {showHistory ? 'Show Current' : 'Show History'}
        </button>
      </div>

      {device.error && (
        <div id="error-message" role="alert" className="p-3.5 bg-error-bg border border-error-border rounded-md text-error-text text-sm mb-4">
          {device.error}
        </div>
      )}

      {device.lastUpdate && (
        <div id="last-update" className="text-center text-xs text-text-tertiary mb-4">
          Last updated: {device.lastUpdate.toLocaleTimeString()}
        </div>
      )}

      <div id="info-footer" className="text-center text-xs text-text-tertiary pt-4 border-t border-border-secondary mt-auto">
        Make sure your device is nearby and turned on
      </div>
    </>
  );
}

function ReadingCard({ id, label, value, unit }: { id: string; label: string; value?: string; unit: string }) {
  return (
    <div id={`${id}-card`} className="flex flex-col items-center p-6 bg-bg-tertiary rounded-lg border border-border-secondary">
      <div className="text-center w-full">
        <div className="text-xs text-text-secondary mb-2 font-medium uppercase tracking-wider">{label}</div>
        <div id={`${id}-value`} className="text-[2.5rem] sm:text-[2rem] font-semibold leading-none text-text-primary tabular-nums">
          {value !== undefined ? (
            <>
              <span className="text-text-primary">{value}</span>
              <span className="text-xl ml-1 text-text-secondary font-normal">{unit}</span>
            </>
          ) : (
            <span className="text-text-placeholder">--</span>
          )}
        </div>
      </div>
    </div>
  );
}
