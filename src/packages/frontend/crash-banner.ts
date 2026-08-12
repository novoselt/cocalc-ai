import { ensureJqueryPluginsInitialized } from "./jquery-plugins/ensure-init";

export async function init(): Promise<void> {
  const crash = document.getElementById("cocalc-react-crash");
  if (crash == null) return;
  try {
    await ensureJqueryPluginsInitialized();
  } catch {
    return;
  }
  (globalThis as any).$?.(crash).processIcons?.();
}
