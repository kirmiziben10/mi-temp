import { useEffect, useRef, useState } from 'react';
import type { DeviceController } from '../hooks/useDevice';
import { cls } from './styles';

const HEX32 = /^[0-9a-f]{32}$/i;

export function ConsolePanel({ device, onClose }: { device: DeviceController; onClose: () => void }) {
  const connected = device.status === 'connected';
  const logRef = useRef<HTMLDivElement>(null);
  const [confirmActivate, setConfirmActivate] = useState(false);
  const keyValid = !device.bindKey || HEX32.test(device.bindKey);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [device.log]);

  return (
    <div
      id="dev-console"
      className={`${cls.card} pt-6 px-4 sm:px-6 pb-0 text-[0.8125rem] flex flex-col max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] lg:max-h-[calc(100dvh-4rem)] w-full lg:min-w-[600px] lg:w-[600px] overflow-hidden relative`}
    >
      <div className="flex lg:hidden mb-4 justify-end">
        <button
          id="console-back-btn"
          type="button"
          className="px-4 py-2 rounded-md border border-border-primary bg-bg-tertiary text-text-primary cursor-pointer text-sm font-medium transition-all duration-300 hover:bg-border-primary"
          onClick={onClose}
          aria-label="Close developer console"
        >
          Close ✕
        </button>
      </div>

      <div id="console-header" className="font-semibold mb-4 text-text-primary border-b border-border-secondary pb-2 text-base">
        Developer Console
      </div>

      <div className="shrink-0 flex flex-col">
        <div id="tools-section" className="mb-6">
          <div className={cls.sectionLabel}>Tools & Settings</div>
          <div className="flex flex-col items-start p-3 bg-bg-tertiary rounded-md mb-2 gap-2.5">
            <label htmlFor="bind-key-input" className="text-text-secondary font-medium shrink-0">
              Bind Key <span className="font-normal text-text-tertiary">(decrypts the sensor's encrypted adverts, e.g. in Home Assistant)</span>
            </label>
            <input
              id="bind-key-input"
              type="text"
              value={device.bindKey}
              onChange={(e) => device.setBindKey(e.target.value.trim())}
              placeholder="Enter 32-char hex key"
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              className={`w-full p-2 rounded border bg-bg-tertiary text-text-primary text-[0.8125rem] font-mono placeholder:text-text-tertiary ${
                keyValid ? 'border-border-primary' : 'border-error-border'
              }`}
              aria-invalid={!keyValid}
            />
            {!keyValid && <small className="text-xs text-error-text">A bind key is 32 hexadecimal characters.</small>}

            {confirmActivate ? (
              <div className="w-full p-3 rounded-md border border-error-border bg-error-bg text-error-text text-xs flex flex-col gap-2">
                <p className="m-0">
                  This registers the thermometer to this app with a new key. If it is paired with the Mi Home app, that pairing stops
                  working. Continue?
                </p>
                <div className="flex gap-2">
                  <button
                    id="activate-confirm-btn"
                    type="button"
                    className={`${cls.smallButton} flex-1 bg-text-primary text-bg-secondary border-text-primary hover:opacity-80`}
                    onClick={() => {
                      setConfirmActivate(false);
                      void device.activate();
                    }}
                  >
                    Get new key
                  </button>
                  <button
                    type="button"
                    className={`${cls.smallButton} flex-1 bg-bg-tertiary text-text-primary border-border-primary hover:bg-border-primary`}
                    onClick={() => setConfirmActivate(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                id="get-key-btn"
                type="button"
                className={`${cls.smallButton} w-full mt-1.5 bg-text-primary text-bg-secondary border-text-primary hover:not-disabled:opacity-80`}
                onClick={() => setConfirmActivate(true)}
                disabled={!connected || device.activating || !device.supportsActivation}
              >
                {device.activating ? 'Getting Key...' : 'Get Key from Device'}
              </button>
            )}
            {!connected ? (
              <small className="opacity-70 text-xs text-text-secondary">Connect device to get key</small>
            ) : (
              !device.supportsActivation && (
                <small className="opacity-70 text-xs text-text-secondary">
                  {device.firmware === 'pvvx' ? 'Custom firmware does not use a bind key.' : 'This device has no Mi activation service.'}
                </small>
              )
            )}
          </div>

          <div className="flex gap-2">
            <button
              id="clear-local-btn"
              type="button"
              className={`${cls.smallButton} flex-1 bg-bg-tertiary text-text-secondary border-border-primary hover:bg-border-primary`}
              onClick={device.clearLocalHistory}
              disabled={device.localHistory.length === 0}
            >
              Clear local history
            </button>
            <button
              id="clear-device-btn"
              type="button"
              className={`${cls.smallButton} flex-1 bg-bg-tertiary text-text-secondary border-border-primary hover:bg-border-primary`}
              onClick={device.clearDeviceHistory}
              disabled={device.deviceHistory.length === 0 || device.sync.running}
            >
              Clear device cache
            </button>
          </div>
        </div>

        {device.raw !== null && (
          <div id="raw-data-section" className="mb-6">
            <div className={cls.sectionLabel}>Latest Data</div>
            <div className={cls.row}>
              <span className="text-text-secondary font-medium shrink-0">Raw Bytes:</span>
              <span id="raw-bytes-value" className="text-text-primary font-mono text-xs break-all text-right">
                {device.raw}
              </span>
            </div>
            <div className={cls.row}>
              <span className="text-text-secondary font-medium shrink-0">Byte Count:</span>
              <span id="byte-count-value" className="text-text-primary font-mono text-xs break-all text-right">
                {device.raw ? device.raw.split(' ').length : 0}
              </span>
            </div>
            <div className={cls.row}>
              <span className="text-text-secondary font-medium shrink-0">Interpreted:</span>
              <span id="interpreted-value" className="text-text-primary font-mono text-xs break-all text-right">
                {device.reading
                  ? `${device.reading.temperature.toFixed(2)}°C, ${device.reading.humidity}%${
                      device.reading.voltage !== undefined ? `, ${device.reading.voltage.toFixed(3)} V` : ''
                    }`
                  : 'No data'}
              </span>
            </div>
          </div>
        )}
      </div>

      <div id="debug-log-section" className="flex-1 flex flex-col min-h-[160px] overflow-hidden">
        <div className={`${cls.sectionLabel} shrink-0`}>Debug Log</div>
        <div ref={logRef} id="debug-log" className="flex-1 overflow-y-auto bg-bg-tertiary rounded-md p-3 min-h-[100px] mb-4 sm:mb-6" role="log" aria-live="polite">
          {device.log.length === 0 ? (
            <div className="text-text-tertiary italic text-center py-8">No log entries yet</div>
          ) : (
            device.log.map((entry) => (
              <div key={entry.id} className="p-3 border-b border-border-secondary text-xs last:border-b-0">
                <span className="text-text-tertiary mr-2 font-mono">[{entry.time}]</span>
                <span className="text-text-primary">{entry.message}</span>
                {entry.data !== undefined && (
                  <pre className="mt-2 p-3 bg-bg-secondary rounded text-text-secondary text-[0.7rem] overflow-x-auto whitespace-pre-wrap break-all">
                    {typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data, null, 2)}
                  </pre>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
