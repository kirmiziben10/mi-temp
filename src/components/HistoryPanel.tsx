import { lazy, Suspense, useState } from 'react';
import type { DeviceController } from '../hooks/useDevice';
import { useNow } from '../hooks/useNow';
import { TIME_PERIODS, type PeriodValue } from '../lib/periods';
import { cls } from './styles';
import { Segmented, Spinner } from './ui';

// Recharts is most of the bundle; load it only when the history view opens.
const HistoryChart = lazy(() => import('./HistoryChart').then((m) => ({ default: m.HistoryChart })));

type Source = 'local' | 'device';

function relativeTime(ms: number, now: number): string {
  const s = Math.round((now - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}

export function HistoryPanel({ device }: { device: DeviceController }) {
  const [source, setSource] = useState<Source>('local');
  const [period, setPeriod] = useState<PeriodValue>('24h');
  const now = useNow(30_000);
  const { sync, status, firmware } = device;
  const connected = status === 'connected';

  const progress =
    sync.expected && sync.expected > 0
      ? `${Math.min(sync.received, sync.expected)} / ${sync.expected}`
      : sync.received > 0
        ? `${sync.received}`
        : '';

  return (
    <>
      <div id="history-controls" className="flex flex-col gap-2 mb-4">
        <div className="flex justify-between items-center gap-2 flex-wrap">
          <Segmented
            id="time-period-toggle"
            label="Time period"
            value={period}
            onChange={setPeriod}
            options={TIME_PERIODS.map((p) => ({ value: p.value, label: p.value }))}
          />
          <Segmented
            id="history-source-toggle"
            label="History source"
            value={source}
            onChange={setSource}
            options={[
              { value: 'local', label: `Local (${device.localHistory.length})`, title: 'Readings recorded by this app while connected' },
              { value: 'device', label: `Device (${device.deviceHistory.length})`, title: 'Log stored on the thermometer' },
            ]}
          />
        </div>

        {source === 'device' && (
          <div id="device-sync-bar" className="flex items-center gap-2 p-2 pl-3 bg-bg-tertiary rounded-md border border-border-secondary text-xs text-text-secondary">
            <span className="flex-1 min-w-0" aria-live="polite">
              {sync.running ? (
                <span className="inline-flex items-center gap-2 text-text-primary">
                  <Spinner /> Syncing from device{progress && ` · ${progress}`}
                </span>
              ) : device.syncMessage ? (
                device.syncMessage
              ) : device.lastSync ? (
                `Last synced ${relativeTime(device.lastSync, now)}`
              ) : connected ? (
                firmware === 'stock' ? 'Download the hourly log stored on the thermometer.' : 'Download the log stored on the thermometer.'
              ) : (
                'Connect to download the log stored on the thermometer.'
              )}
            </span>
            {sync.running ? (
              <button
                id="sync-cancel-btn"
                type="button"
                className={`${cls.smallButton} py-1.5 bg-bg-secondary text-text-primary border-border-primary hover:bg-border-primary`}
                onClick={device.cancelSync}
              >
                Cancel
              </button>
            ) : (
              <button
                id="sync-btn"
                type="button"
                className={`${cls.smallButton} py-1.5 bg-text-primary text-bg-secondary border-text-primary hover:not-disabled:opacity-80`}
                onClick={device.syncHistory}
                disabled={!connected}
                title={connected ? 'Download new records from the device' : 'Connect to the device first'}
              >
                ↻ Sync
              </button>
            )}
          </div>
        )}
      </div>

      <Suspense fallback={<div className="h-[448px] flex items-center justify-center text-text-tertiary"><Spinner /></div>}>
      <HistoryChart
        data={source === 'device' ? device.deviceHistory : device.localHistory}
        period={period}
        emptyHint={
          source === 'device'
            ? connected
              ? 'Tap Sync to download the log stored on the thermometer.'
              : 'Connect, then tap Sync to download the device log.'
            : 'Connect to device to start logging.'
        }
      />
      </Suspense>
    </>
  );
}
