import { readFile } from "node:fs/promises";

export function normalizeMinimumScore(value, label = "minimum score") {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error(`${label} must be between 0 and 1, or 0 and 100`);
  }
  return parsed > 1 ? parsed / 100 : parsed;
}

export function parseArgs(argv) {
  const options = {
    authenticate: true,
    failOnThreshold: true,
    headed: false,
    keepProfile: false,
    mode: process.env.COCALC_DEV_ENV_MODE?.trim() || "hub",
    pageIds: [],
    publicOnly: false,
    verbose: false,
  };

  const takeValue = (index, flag) => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value`);
    }
    return value;
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    switch (arg) {
      case "--":
        break;
      case "--base-url":
        options.baseUrl = takeValue(index, arg);
        index++;
        break;
      case "--chromium":
        options.chromiumPath = takeValue(index, arg);
        index++;
        break;
      case "--config":
        options.configPath = takeValue(index, arg);
        index++;
        break;
      case "--headed":
        options.headed = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--keep-profile":
        options.keepProfile = true;
        break;
      case "--login-url":
        options.loginUrl = takeValue(index, arg);
        index++;
        break;
      case "--min-score":
        options.minimumScore = normalizeMinimumScore(
          takeValue(index, arg),
          arg,
        );
        index++;
        break;
      case "--mode":
        options.mode = takeValue(index, arg);
        index++;
        break;
      case "--no-auth":
        options.authenticate = false;
        break;
      case "--no-fail":
        options.failOnThreshold = false;
        break;
      case "--output-dir":
        options.outputDir = takeValue(index, arg);
        index++;
        break;
      case "--pages":
        options.pageIds.push(
          ...takeValue(index, arg)
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        );
        index++;
        break;
      case "--profile-dir":
        options.profileDir = takeValue(index, arg);
        index++;
        break;
      case "--project-id":
        options.projectId = takeValue(index, arg);
        index++;
        break;
      case "--public":
        options.publicOnly = true;
        break;
      case "--verbose":
        options.verbose = true;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (options.mode !== "hub" && options.mode !== "lite") {
    throw new Error("--mode must be hub or lite");
  }
  return options;
}

export async function loadPageMatrix(path) {
  const parsed = JSON.parse(await readFile(path, "utf8"));
  if (parsed?.version !== 1 || !Array.isArray(parsed.pages)) {
    throw new Error(`invalid accessibility page matrix: ${path}`);
  }
  const ids = new Set();
  for (const page of parsed.pages) {
    if (!page?.id || !page?.path || !page?.title) {
      throw new Error(`every accessibility page needs id, title, and path`);
    }
    if (ids.has(page.id)) {
      throw new Error(`duplicate accessibility page id: ${page.id}`);
    }
    ids.add(page.id);
    page.minimumScore = normalizeMinimumScore(
      page.minimumScore ?? 0.9,
      `${page.id}.minimumScore`,
    );
  }
  return parsed.pages;
}

export function selectPages(pages, options) {
  const selectedIds = new Set(options.pageIds ?? []);
  if (selectedIds.size > 0) {
    const knownIds = new Set(pages.map(({ id }) => id));
    const unknown = [...selectedIds].filter((id) => !knownIds.has(id));
    if (unknown.length > 0) {
      throw new Error(`unknown page id(s): ${unknown.join(", ")}`);
    }
  }

  return pages
    .filter((page) => selectedIds.size === 0 || selectedIds.has(page.id))
    .filter((page) => !options.publicOnly || page.authentication === "none")
    .map((page) => ({
      ...page,
      minimumScore: options.minimumScore ?? page.minimumScore,
    }));
}

export function resolvePageUrl(page, baseUrl, projectId) {
  if (page.requiresProject && !projectId) {
    throw new Error(`${page.id} requires --project-id`);
  }
  const path = page.path.replaceAll("{project_id}", projectId ?? "");
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(path.replace(/^\//, ""), normalizedBase).toString();
}

export function failedAccessibilityAudits(lhr) {
  const accessibility = lhr?.categories?.accessibility;
  if (!accessibility?.auditRefs) return [];
  return accessibility.auditRefs.flatMap(({ id, weight }) => {
    const audit = lhr.audits?.[id];
    if (
      audit == null ||
      audit.score == null ||
      audit.score === 1 ||
      audit.scoreDisplayMode === "notApplicable" ||
      audit.scoreDisplayMode === "manual" ||
      audit.scoreDisplayMode === "informative"
    ) {
      return [];
    }
    const nodes =
      audit.details?.type === "table" && Array.isArray(audit.details.items)
        ? audit.details.items.slice(0, 25).map(({ node }) => ({
            selector: node?.selector,
            snippet: node?.snippet,
            explanation: node?.explanation,
          }))
        : [];
    return [
      {
        id,
        title: audit.title,
        description: audit.description,
        score: audit.score,
        weight,
        count:
          audit.details?.type === "table" && Array.isArray(audit.details.items)
            ? audit.details.items.length
            : undefined,
        nodes,
      },
    ];
  });
}

export function createPageSummary(page, url, lhr) {
  const score = lhr?.categories?.accessibility?.score;
  if (typeof score !== "number") {
    const runtimeError = lhr?.runtimeError;
    const detail = runtimeError?.message ?? runtimeError?.code;
    throw new Error(
      `Lighthouse did not return an accessibility score${detail ? `: ${detail}` : ""}`,
    );
  }
  return {
    id: page.id,
    title: page.title,
    url,
    score,
    minimumScore: page.minimumScore,
    passed: score >= page.minimumScore,
    audits: failedAccessibilityAudits(lhr),
  };
}

export function renderMarkdownSummary(summary) {
  const lines = [
    "# CoCalc accessibility audit",
    "",
    `Generated: ${summary.generatedAt}`,
    "",
    "| Page | Score | Minimum | Result |",
    "| --- | ---: | ---: | --- |",
  ];
  for (const page of summary.pages) {
    const score =
      typeof page.score === "number" ? Math.round(page.score * 100) : "ERROR";
    const minimum = Math.round(page.minimumScore * 100);
    lines.push(
      `| ${page.title} | ${score} | ${minimum} | ${page.passed ? "PASS" : "FAIL"} |`,
    );
  }
  for (const page of summary.pages) {
    if (page.passed) continue;
    lines.push("", `## ${page.title}`, "");
    if (page.error) {
      lines.push("```text", page.error, "```");
      continue;
    }
    for (const audit of page.audits) {
      lines.push(
        `- \`${audit.id}\`: ${audit.title}${audit.count == null ? "" : ` (${audit.count})`}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

export function helpText() {
  return `Run Lighthouse accessibility audits with system Chromium.

Usage:
  pnpm -C src accessibility:audit -- [options]

Options:
  --base-url URL       Site origin (defaults to the local dev environment)
  --pages IDS          Comma-separated page ids from pages.json
  --public             Audit only pages that do not require sign-in
  --project-id UUID    Project used by project routes
  --min-score N        Override minimum score (0-1 or 0-100)
  --output-dir PATH    Report directory
  --chromium PATH      Chromium executable
  --headed             Show the dedicated audit browser
  --login-url URL      Explicit one-time login URL
  --no-auth            Do not attempt local hub authentication
  --no-fail            Report regressions without a failing exit status
  --keep-profile       Keep the temporary Chromium profile
  --verbose            Show Lighthouse progress
`;
}
