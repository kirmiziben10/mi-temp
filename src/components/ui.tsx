import type { ReactNode } from 'react';

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin ${className}`}
    />
  );
}

interface SegmentedProps<T extends string> {
  id?: string;
  options: { value: T; label: ReactNode; title?: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}

/** The joined toggle-button group used for the time period and history source. */
export function Segmented<T extends string>({ id, options, value, onChange, label }: SegmentedProps<T>) {
  return (
    <div id={id} role="group" aria-label={label} className="flex gap-0 rounded-md overflow-hidden border border-border-primary shrink-0">
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`px-3 py-1.5 text-xs font-medium cursor-pointer transition-all duration-200 whitespace-nowrap border-0 ${
            i < options.length - 1 ? 'border-r border-border-primary' : ''
          } ${value === o.value ? 'bg-text-primary text-bg-secondary' : 'bg-bg-tertiary text-text-secondary hover:bg-border-primary'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
