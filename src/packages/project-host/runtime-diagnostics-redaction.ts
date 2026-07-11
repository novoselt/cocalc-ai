export function redactRuntimeLogText(text: string): string {
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [REDACTED]")
    .replace(
      /\b(COCALC_(?:AGENT_TOKEN|API_KEY|BEARER_TOKEN|PROJECT_TOKEN|SECRET)\s*=\s*)\S+/g,
      "$1[REDACTED]",
    )
    .replace(/("(?:access_)?token"\s*:\s*")[^"]+"/gi, '$1[REDACTED]"')
    .replace(/("(?:api_)?key"\s*:\s*")[^"]+"/gi, '$1[REDACTED]"')
    .replace(/("(?:password|secret)"\s*:\s*")[^"]+"/gi, '$1[REDACTED]"');
}
