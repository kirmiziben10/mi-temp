import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.kirmiziben10.mitemp',
  appName: 'Mi Temp',
  webDir: 'dist',
  android: {
    // Matches the light theme's page background so there is no white flash on launch.
    backgroundColor: '#f5f5f5',
  },
  plugins: {
    BluetoothLe: {
      displayStrings: {
        scanning: 'Scanning…',
        cancel: 'Cancel',
        availableDevices: 'Available devices',
        noDeviceFound: 'No device found',
      },
    },
  },
};

export default config;
