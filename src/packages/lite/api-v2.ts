const TRUE = new Set(["1", "true", "yes", "on"]);
const FALSE = new Set(["0", "false", "no", "off"]);

export function isApiV2Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (`${env.COCALC_PRODUCT ?? ""}`.trim().toLowerCase() === "plus") {
    return false;
  }
  const configured = `${env.COCALC_LITE_API_V2 ?? ""}`.trim().toLowerCase();
  if (TRUE.has(configured)) return true;
  if (FALSE.has(configured)) return false;
  return `${env.COCALC_LAUNCHPAD_API_V2_ROUTES ?? ""}`.trim() === "1";
}
