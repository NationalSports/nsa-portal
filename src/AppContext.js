// Shared app-state context — the stable interface pages extracted out of App()
// consume instead of closing over App()'s scope (see FABLE_SYSTEM_AUDIT_2026-07-03.md,
// Rebuild 1 step 2). App() builds the value object each render from its live state;
// extracted pages read it via useAppData(). Pages render only when active (pg switch),
// so the per-render value identity costs nothing extra.
import { createContext, useContext } from 'react';

const AppDataContext = createContext(null);

export const AppDataProvider = AppDataContext.Provider;

export function useAppData() {
  const v = useContext(AppDataContext);
  if (!v) throw new Error('useAppData() must be used inside <AppDataProvider> (rendered by App)');
  return v;
}
