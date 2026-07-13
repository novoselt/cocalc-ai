import { createHash } from "crypto";
import type { ZendeskClient } from "node-zendesk";
import { createClient } from "node-zendesk";

import { getServerSettings } from "@cocalc/database/settings";

let client: ZendeskClient | undefined;
let configFingerprint: string | undefined;

export default async function getClient(): Promise<ZendeskClient> {
  const {
    zendesk_token: token,
    zendesk_username: username,
    zendesk_uri,
  } = await getServerSettings();

  const subdomain = extractSubdomain(zendesk_uri);
  if (!token) {
    throw Error(
      "Support not available -- admin must configure the Zendesk token",
    );
  }
  if (!username) {
    throw Error(
      "Support not available -- admin must configure the Zendesk username",
    );
  }
  if (!subdomain) {
    throw Error(
      "Support not available -- admin must configure the Zendesk subdomain",
    );
  }

  const nextFingerprint = createHash("sha256")
    .update(JSON.stringify([token, username, subdomain]))
    .digest("hex");
  if (client != null && configFingerprint === nextFingerprint) return client;

  client = createClient({ username, token, subdomain });
  configFingerprint = nextFingerprint;
  return client;
}

/** @internal */
export function resetZendeskClientForTesting(): void {
  client = undefined;
  configFingerprint = undefined;
}

// newer client just wants the subdomain.
// so, if the uri starts with "http", extract the subdomain – otherwise just return the uri.
export function extractSubdomain(uri: string): string {
  if (uri.startsWith("http")) {
    return uri.split(".")[0].split("//")[1];
  } else {
    return uri;
  }
}
