import { useEffect, useRef, useState } from 'react';
import { ConsolePanel } from './components/ConsolePanel';
import { DevicePicker } from './components/DevicePicker';
import { MainCard } from './components/MainCard';
import { cls } from './components/styles';
import { useDevice } from './hooks/useDevice';
import { useTheme } from './hooks/useTheme';

const CONSOLE_ANIMATION_MS = 400;

export default function App() {
  const device = useDevice();
  const { theme, toggleTheme } = useTheme();
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleClosing, setConsoleClosing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const toggleConsole = () => {
    if (consoleOpen) {
      setConsoleClosing(true);
      closeTimer.current = setTimeout(() => {
        setConsoleOpen(false);
        setConsoleClosing(false);
      }, CONSOLE_ANIMATION_MS);
    } else {
      setConsoleOpen(true);
    }
  };

  if (device.availability && !device.availability.available) {
    return (
      <div id="bluetooth-error-container" className="flex-1 flex items-center justify-center p-8 w-full">
        <div id="bluetooth-error-card" className={`${cls.card} p-12 text-center`}>
          <h2 className="text-text-primary my-4 text-xl font-semibold">Bluetooth Not Available</h2>
          <p className="text-text-secondary leading-relaxed text-[0.9375rem]">
            {device.availability.reason}
            {device.transportKind === 'web' && (
              <>
                <br />
                Please use Chrome, Edge, or Opera — or the Android app.
              </>
            )}
          </p>
        </div>
      </div>
    );
  }

  const main = (
    <MainCard
      device={device}
      theme={theme}
      onToggleTheme={toggleTheme}
      consoleOpen={consoleOpen && !consoleClosing}
      onToggleConsole={toggleConsole}
      showHistory={showHistory}
      onToggleHistory={() => setShowHistory((v) => !v)}
    />
  );
  const consolePanel = <ConsolePanel device={device} onClose={toggleConsole} />;

  return (
    <div id="app-container" className="flex-1 flex items-center justify-center p-2 sm:p-4 lg:p-8 w-full">
      <div id="layout-container" className="w-full max-w-[1200px] flex gap-6 items-start">
        {/* Mobile: main card and console are separate full-width screens. */}
        <div id="mobile-main-view" className={`w-full lg:hidden ${consoleOpen ? 'hidden' : 'block'}`}>
          <div id="main-card-mobile" className={`${cls.card} p-4 sm:p-6 w-full flex flex-col`}>
            {main}
          </div>
        </div>
        <div id="mobile-console-view" className={`w-full lg:hidden ${consoleOpen ? 'block' : 'hidden'}`}>
          {consolePanel}
        </div>

        {/* Desktop: the console slides out beside the main card. */}
        <div id="desktop-view" className="hidden lg:flex w-full items-center justify-center">
          <div id="main-card-desktop" className="transition-all duration-300 ease-out relative z-10 shrink-0 w-[480px]">
            <div className={`${cls.card} p-10 w-full flex flex-col`}>{main}</div>
          </div>
          {consoleOpen && (
            <div
              id="console-wrapper"
              className={`flex-initial relative z-0 overflow-hidden flex justify-end ${consoleClosing ? 'animate-slide-out' : 'animate-slide-in'}`}
            >
              {consolePanel}
            </div>
          )}
        </div>
      </div>

      {device.picker.open && (
        <DevicePicker devices={device.picker.devices} error={device.picker.error} onChoose={device.chooseDevice} onCancel={device.cancelPicker} />
      )}
    </div>
  );
}
