import { useEffect, useMemo, useState } from "@cocalc/frontend/app-framework";
import { lite } from "@cocalc/frontend/lite";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import type { CodexPaymentSourceInfo } from "@cocalc/conat/hub/api/system";
import type { CodexPaymentSourcePreference } from "@cocalc/util/ai/codex";

export type CodexPaymentSourceOption = {
  value: CodexPaymentSourcePreference;
  label: string;
  description: string;
  disabled?: boolean;
};

export function getCodexPaymentSourceOptions(
  paymentSource?: CodexPaymentSourceInfo,
): CodexPaymentSourceOption[] {
  if (lite) {
    return [
      {
        value: "auto",
        label: "Automatic",
        description: "Use the first configured local Codex credential.",
      },
    ];
  }
  const includedAvailable =
    paymentSource?.hasSiteApiKey === true &&
    paymentSource.siteFundedCodex?.enabled === true &&
    paymentSource.siteAiUsageLimitPositive !== false;
  return [
    {
      value: "auto",
      label: "Automatic",
      description:
        "Prefer your ChatGPT Plan, then project or account API keys, then CoCalc's included allowance.",
    },
    {
      value: "site-api-key",
      label: "Included by CoCalc",
      description: includedAvailable
        ? "Use your membership allowance with the model and limits set by CoCalc."
        : "Included Codex usage is not currently available for this account.",
      disabled: !includedAvailable,
    },
    ...(paymentSource?.hasSubscription
      ? [
          {
            value: "subscription" as const,
            label: "ChatGPT Plan",
            description:
              "Use the ChatGPT subscription connected to your CoCalc account.",
          },
        ]
      : []),
    ...(paymentSource?.hasProjectApiKey
      ? [
          {
            value: "project-api-key" as const,
            label: "Project OpenAI API key",
            description: "Charge this project's configured OpenAI API key.",
          },
        ]
      : []),
    ...(paymentSource?.hasAccountApiKey
      ? [
          {
            value: "account-api-key" as const,
            label: "Account OpenAI API key",
            description: "Charge your account's configured OpenAI API key.",
          },
        ]
      : []),
  ];
}

const CACHE_TTL_MS = 15_000;
type PaymentSourceCacheEntry = {
  paymentSource?: CodexPaymentSourceInfo;
  error?: string;
  fetchedAt: number;
};

const paymentSourceCache = new Map<string, PaymentSourceCacheEntry>();
const paymentSourceInflight = new Map<
  string,
  Promise<PaymentSourceCacheEntry>
>();

function cacheKey(
  projectId?: string,
  preference: CodexPaymentSourcePreference = "auto",
): string {
  return `${projectId?.trim() || ""}:${preference}`;
}

function getCachedPaymentSource(
  projectId?: string,
  preference: CodexPaymentSourcePreference = "auto",
): PaymentSourceCacheEntry | undefined {
  return paymentSourceCache.get(cacheKey(projectId, preference));
}

async function fetchPaymentSourceCached({
  projectId,
  force = false,
  preference = "auto",
}: {
  projectId?: string;
  force?: boolean;
  preference?: CodexPaymentSourcePreference;
}): Promise<PaymentSourceCacheEntry> {
  const key = cacheKey(projectId, preference);
  const cached = paymentSourceCache.get(key);
  const now = Date.now();
  if (!force && cached && now - cached.fetchedAt <= CACHE_TTL_MS) {
    return cached;
  }
  const existing = paymentSourceInflight.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<PaymentSourceCacheEntry> => {
    try {
      const result =
        await webapp_client.conat_client.hub.system.getCodexPaymentSource({
          project_id: projectId?.trim() || undefined,
          preference,
        });
      const entry: PaymentSourceCacheEntry = {
        paymentSource: result as CodexPaymentSourceInfo,
        fetchedAt: Date.now(),
      };
      paymentSourceCache.set(key, entry);
      return entry;
    } catch (err) {
      const previousPaymentSource = paymentSourceCache.get(key)?.paymentSource;
      const entry: PaymentSourceCacheEntry = {
        paymentSource: previousPaymentSource,
        error: `${err}`,
        fetchedAt: Date.now(),
      };
      paymentSourceCache.set(key, entry);
      return entry;
    } finally {
      paymentSourceInflight.delete(key);
    }
  })();

  paymentSourceInflight.set(key, promise);
  return promise;
}

export function getCodexPaymentSourceShortLabel(
  source: CodexPaymentSourceInfo["source"] | undefined,
): string {
  if (source == null) {
    return "Unknown";
  }
  if (lite) {
    if (source === "subscription") return "ChatGPT Plan";
    if (
      source === "project-api-key" ||
      source === "account-api-key" ||
      source === "site-api-key"
    ) {
      return "OpenAI API Key";
    }
    if (source === "shared-home") {
      return "Local Codex auth";
    }
    return "Unconfigured";
  }
  switch (source) {
    case "subscription":
      return "ChatGPT Plan";
    case "project-api-key":
    case "account-api-key":
      return "API Key";
    case "site-api-key":
      return "Included";
    case "shared-home":
      return "Shared Home";
    case "none":
    default:
      return "Unconfigured";
  }
}

export function getCodexPaymentSourceLongLabel(
  source: CodexPaymentSourceInfo["source"] | undefined,
): string {
  if (source == null) {
    return "Unknown source";
  }
  if (lite) {
    if (source === "subscription") return "ChatGPT Plan";
    if (
      source === "project-api-key" ||
      source === "account-api-key" ||
      source === "site-api-key"
    ) {
      return "OpenAI API Key";
    }
    if (source === "shared-home") {
      return "Local Codex auth";
    }
    return "Not configured";
  }
  switch (source) {
    case "subscription":
      return "ChatGPT Plan";
    case "project-api-key":
      return "Project OpenAI API Key";
    case "account-api-key":
      return "Account OpenAI API Key";
    case "site-api-key":
      return "Included by CoCalc (site-funded Codex)";
    case "shared-home":
      return "Shared ~/.codex";
    case "none":
    default:
      return "No configured source";
  }
}

export function getCodexPaymentSourceTooltip(
  paymentSource?: CodexPaymentSourceInfo,
): string {
  if (lite) {
    if (!paymentSource) {
      return "Checking local Codex configuration...";
    }
    switch (paymentSource.source) {
      case "subscription":
        return "Codex will use your ChatGPT Plan. ChatGPT shows the exact plan and remaining Codex usage.";
      case "project-api-key":
      case "account-api-key":
      case "site-api-key":
        return "Codex will use your OpenAI API key.";
      case "shared-home":
        return "Codex will use local auth from ~/.codex.";
      case "none":
      default:
        return "Configure either a ChatGPT Plan or an OpenAI API key.";
    }
  }
  if (!paymentSource) {
    return "Checking likely payment source for the next Codex turn...";
  }
  const parts = [
    `Source for the next turn: ${getCodexPaymentSourceLongLabel(paymentSource.source)}.`,
  ];
  if ((paymentSource.preference ?? "auto") === "auto") {
    parts.push(
      "Automatic order: ChatGPT Plan → Project OpenAI API key → Account OpenAI API key → Included by CoCalc.",
    );
  }
  if (paymentSource.unavailableReason) {
    parts.push(paymentSource.unavailableReason);
  }
  if (paymentSource.hasSubscription) {
    parts.push(
      "A ChatGPT subscription is connected; ChatGPT shows the exact plan and remaining Codex usage.",
    );
  }
  if (paymentSource.source === "site-api-key") {
    const policy = paymentSource.siteFundedCodex?.policy;
    if (paymentSource.siteFundedCodex?.enabled && policy) {
      parts.push(
        `Included turns use ${policy.model}, ${policy.reasoning} reasoning, and ${policy.serviceTier} speed. Connect a personal ChatGPT plan or API key to choose other settings.`,
      );
    } else {
      parts.push("Included Codex usage is currently unavailable on this site.");
    }
  }
  return parts.join(" ");
}

export function useCodexPaymentSource({
  projectId,
  preference = "auto",
  enabled = true,
  pollMs = 60_000,
}: {
  projectId?: string;
  preference?: CodexPaymentSourcePreference;
  enabled?: boolean;
  pollMs?: number;
}) {
  const [paymentSource, setPaymentSource] = useState<
    CodexPaymentSourceInfo | undefined
  >(undefined);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [refreshToken, setRefreshToken] = useState<number>(0);

  const refresh = () => setRefreshToken((x) => x + 1);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const cached = getCachedPaymentSource(projectId, preference);
    if (cached?.paymentSource) {
      setPaymentSource(cached.paymentSource);
      setError(cached.error ?? "");
    } else if (cached?.error) {
      setPaymentSource(undefined);
      setError(cached.error);
    } else {
      setPaymentSource(undefined);
      setError("");
    }
    const load = async () => {
      setLoading(true);
      try {
        const entry = await fetchPaymentSourceCached({
          projectId,
          force: refreshToken > 0,
          preference,
        });
        if (cancelled) return;
        if (entry.paymentSource) {
          setPaymentSource(entry.paymentSource);
          setError(entry.error ?? "");
        } else {
          setPaymentSource(undefined);
          setError(entry.error ?? "");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled, preference, projectId, refreshToken]);

  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(
      () => {
        setRefreshToken((x) => x + 1);
      },
      Math.max(10_000, pollMs),
    );
    return () => clearInterval(interval);
  }, [enabled, pollMs]);

  const isSiteBilled = paymentSource?.source === "site-api-key";

  const shortLabel = useMemo(
    () => getCodexPaymentSourceShortLabel(paymentSource?.source),
    [paymentSource?.source],
  );

  const tooltip = useMemo(
    () => getCodexPaymentSourceTooltip(paymentSource),
    [paymentSource],
  );

  return {
    paymentSource,
    loading,
    error,
    refresh,
    isSiteBilled,
    shortLabel,
    tooltip,
  };
}
