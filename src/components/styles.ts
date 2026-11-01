/** Class recipes from the original design, shared across components. */
export const cls = {
  iconButton:
    'w-9 h-9 rounded-md border border-border-primary bg-bg-tertiary text-text-primary cursor-pointer flex items-center justify-center text-lg transition-all duration-300 hover:bg-border-primary',
  primaryButton:
    'w-full px-6 py-3.5 border rounded-md text-[0.9375rem] font-medium cursor-pointer transition-all duration-300 flex items-center justify-center gap-2 bg-text-primary text-bg-secondary border-text-primary hover:not-disabled:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed',
  dangerButton:
    'w-full px-6 py-3.5 border rounded-md text-[0.9375rem] font-medium cursor-pointer transition-all duration-300 flex items-center justify-center gap-2 bg-bg-tertiary text-error-text border-error-border hover:not-disabled:bg-error-bg disabled:opacity-50 disabled:cursor-not-allowed',
  secondaryButton:
    'w-full px-6 py-3.5 border rounded-md text-[0.9375rem] font-medium cursor-pointer transition-all duration-300 flex items-center justify-center gap-2 bg-bg-tertiary text-text-primary border-border-primary hover:not-disabled:bg-border-primary disabled:opacity-50 disabled:cursor-not-allowed',
  smallButton:
    'px-4 py-2 text-[0.8125rem] font-medium border rounded-md cursor-pointer transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed',
  card: 'bg-bg-secondary rounded-xl border border-border-primary shadow-(--shadow)',
  sectionLabel: 'font-medium mb-3 text-text-secondary text-xs uppercase tracking-wider',
  row: 'flex justify-between items-start p-3 bg-bg-tertiary rounded-md mb-2 gap-4',
};
