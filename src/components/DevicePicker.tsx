import type { FoundDevice } from '../ble';
import { cls } from './styles';
import { Spinner } from './ui';

interface Props {
  devices: FoundDevice[];
  error?: string;
  onChoose: (device: FoundDevice) => void;
  onCancel: () => void;
}

function SignalBars({ rssi }: { rssi?: number }) {
  const level = rssi === undefined ? 0 : rssi > -60 ? 4 : rssi > -70 ? 3 : rssi > -80 ? 2 : 1;
  return (
    <span className="inline-flex items-end gap-0.5 h-3.5" aria-label={rssi !== undefined ? `${rssi} dBm` : 'unknown signal'}>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className={`w-1 rounded-sm ${i <= level ? 'bg-text-primary' : 'bg-border-primary'}`} style={{ height: `${i * 25}%` }} />
      ))}
    </span>
  );
}

/** In-app device chooser for the Android app (the browser shows its own). */
export function DevicePicker({ devices, error, onChoose, onCancel }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-2 sm:p-4" role="dialog" aria-modal aria-labelledby="picker-title">
      <div className={`${cls.card} w-full max-w-[480px] p-6 flex flex-col max-h-[80dvh] mb-[env(safe-area-inset-bottom)]`}>
        <div className="flex items-center justify-between mb-4">
          <h2 id="picker-title" className="m-0 text-base font-semibold">
            Choose a device
          </h2>
          {!error && (
            <span className="inline-flex items-center gap-2 text-xs text-text-secondary">
              <Spinner /> Scanning
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto min-h-[120px] flex flex-col gap-2 mb-4">
          {error ? (
            <div className="p-3.5 bg-error-bg border border-error-border rounded-md text-error-text text-sm">{error}</div>
          ) : devices.length === 0 ? (
            <div className="text-text-tertiary text-sm text-center py-8">
              Looking for thermometers nearby…
              <br />
              <small>Keep the device close to your phone.</small>
            </div>
          ) : (
            devices.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => onChoose(d)}
                className="w-full flex items-center justify-between gap-3 p-3 bg-bg-tertiary rounded-md border border-border-secondary cursor-pointer text-left hover:bg-border-primary transition-all duration-200"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-text-primary truncate">{d.name}</span>
                  <span className="block text-xs text-text-tertiary font-mono truncate">{d.id}</span>
                </span>
                <SignalBars rssi={d.rssi} />
              </button>
            ))
          )}
        </div>

        <button type="button" className={cls.secondaryButton} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
