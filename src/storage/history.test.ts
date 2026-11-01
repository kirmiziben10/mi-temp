import { beforeEach, describe, expect, it } from 'vitest';
import {
  LOCAL_MAX_POINTS,
  appendLocalSample,
  loadDeviceLog,
  loadLocalLog,
  mergeDeviceLog,
  saveDeviceLog,
} from './history';

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

beforeEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
});

describe('local log', () => {
  it('keeps at most one sample per minute and caps the size', () => {
    let pts = appendLocalSample([], { t: 0, temperature: 20, humidity: 50 });
    pts = appendLocalSample(pts, { t: 6_000, temperature: 21, humidity: 50 });
    pts = appendLocalSample(pts, { t: 60_000, temperature: 22, humidity: 50 });
    expect(pts.map((p) => p.temperature)).toEqual([20, 22]);

    let big = Array.from({ length: LOCAL_MAX_POINTS }, (_, i) => ({ t: i * 60_000, temperature: 1, humidity: 1 }));
    big = appendLocalSample(big, { t: LOCAL_MAX_POINTS * 60_000, temperature: 2, humidity: 2 });
    expect(big).toHaveLength(LOCAL_MAX_POINTS);
    expect(big.at(-1)!.temperature).toBe(2);
  });

  it('migrates the previous app format once and thins it', () => {
    const legacy = Array.from({ length: 30 }, (_, i) => ({ timestamp: 1_700_000_000_000 + i * 6000, temperature: 22, humidity: 40 }));
    localStorage.setItem('mi_temp_history', JSON.stringify(legacy));
    const pts = loadLocalLog();
    expect(pts).toHaveLength(3); // 30 samples * 6 s = 3 minutes
    expect(localStorage.getItem('mi_temp_history')).toBeNull();
    expect(loadLocalLog()).toHaveLength(3);
  });
});

describe('device log', () => {
  it('round-trips through storage', () => {
    saveDeviceLog('dev', {
      firmware: 'stock',
      lastIndex: 5,
      points: [{ t: 1, temperature: 2, humidity: 3, minTemperature: 1, maxTemperature: 3, minHumidity: 2, maxHumidity: 4, index: 5 }],
    });
    expect(loadDeviceLog('dev')).toEqual({
      firmware: 'stock',
      lastIndex: 5,
      lastSync: undefined,
      points: [{ t: 1, temperature: 2, humidity: 3, minTemperature: 1, maxTemperature: 3, minHumidity: 2, maxHumidity: 4, index: 5 }],
    });
  });

  it('merges stock records by index, keeping the cached copy', () => {
    const merged = mergeDeviceLog(
      [{ t: 1000, temperature: 20, humidity: 50, index: 1 }],
      [
        { t: 1500, temperature: 99, humidity: 50, index: 1 },
        { t: 3_601_000, temperature: 21, humidity: 50, index: 2 },
      ],
    );
    expect(merged.map((p) => p.temperature)).toEqual([20, 21]);
  });

  it('keeps old points but frees their indices after a device reset', () => {
    const merged = mergeDeviceLog(
      [{ t: 1000, temperature: 20, humidity: 50, index: 1 }],
      [{ t: 9_000_000, temperature: 30, humidity: 50, index: 1 }],
      { deviceReset: true },
    );
    expect(merged).toHaveLength(2);
    expect(merged[0]!.index).toBeUndefined();
  });

  it('merges pvvx records by time with a tolerance', () => {
    const merged = mergeDeviceLog(
      [{ t: 600_000, temperature: 20, humidity: 50 }],
      [
        { t: 610_000, temperature: 20, humidity: 50 },
        { t: 1_200_000, temperature: 21, humidity: 50 },
      ],
    );
    expect(merged).toHaveLength(2);
  });
});
