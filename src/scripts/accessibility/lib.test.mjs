import assert from "node:assert/strict";
import test from "node:test";

import {
  createAxeSummary,
  createPageSummary,
  failedAccessibilityAudits,
  normalizeMinimumScore,
  parseArgs,
  renderMarkdownSummary,
  resolvePageUrl,
  selectPages,
} from "./lib.mjs";

test("normalizes percentage and fractional score thresholds", () => {
  assert.equal(normalizeMinimumScore("90"), 0.9);
  assert.equal(normalizeMinimumScore("0.95"), 0.95);
  assert.throws(() => normalizeMinimumScore("101"), /between 0 and 1/);
});

test("parses page and threshold options", () => {
  const options = parseArgs([
    "--",
    "--pages",
    "landing,project-files",
    "--min-score",
    "95",
    "--no-fail",
  ]);
  assert.deepEqual(options.pageIds, ["landing", "project-files"]);
  assert.equal(options.minimumScore, 0.95);
  assert.equal(options.failOnThreshold, false);
});

test("selects public pages and validates explicit ids", () => {
  const pages = [
    {
      id: "landing",
      authentication: "none",
      minimumScore: 1,
    },
    {
      id: "account",
      authentication: "account",
      minimumScore: 0.9,
    },
  ];
  assert.deepEqual(
    selectPages(pages, { pageIds: [], publicOnly: true }).map(({ id }) => id),
    ["landing"],
  );
  assert.throws(
    () => selectPages(pages, { pageIds: ["missing"], publicOnly: false }),
    /unknown page id/,
  );
});

test("resolves project route templates", () => {
  assert.equal(
    resolvePageUrl(
      {
        id: "project-files",
        path: "/projects/{project_id}/files/",
        requiresProject: true,
      },
      "https://example.test",
      "project-1",
    ),
    "https://example.test/projects/project-1/files/",
  );
});

test("summarizes only failing accessibility audits", () => {
  const lhr = {
    categories: {
      accessibility: {
        score: 0.87,
        auditRefs: [
          { id: "label", weight: 10 },
          { id: "html-has-lang", weight: 7 },
        ],
      },
    },
    audits: {
      label: {
        score: 0,
        scoreDisplayMode: "binary",
        title: "Form controls have labels",
        description: "Label controls.",
        details: {
          type: "table",
          items: [
            {
              node: {
                selector: "input",
                snippet: "<input>",
                explanation: "Missing label",
              },
            },
          ],
        },
      },
      "html-has-lang": {
        score: 1,
        scoreDisplayMode: "binary",
        title: "HTML has a language",
      },
    },
  };
  assert.deepEqual(
    failedAccessibilityAudits(lhr).map(({ id }) => id),
    ["label"],
  );

  const page = createPageSummary(
    {
      id: "account",
      title: "Account",
      minimumScore: 0.9,
    },
    "https://example.test/settings",
    lhr,
  );
  assert.equal(page.passed, false);
  assert.match(
    renderMarkdownSummary({
      generatedAt: "2026-07-26T00:00:00.000Z",
      pages: [page],
    }),
    /`label`/,
  );
});

test("includes page runtime errors in the markdown summary", () => {
  const markdown = renderMarkdownSummary({
    generatedAt: "2026-07-26T00:00:00.000Z",
    pages: [
      {
        title: "Broken page",
        minimumScore: 0.9,
        passed: false,
        audits: [],
        error: "Timed out waiting for main",
      },
    ],
  });
  assert.match(markdown, /## Broken page/);
  assert.match(markdown, /Timed out waiting for main/);
});

test("summarizes axe violations and affected nodes", () => {
  const page = createAxeSummary(
    {
      id: "dialog",
      title: "Dialog",
      minimumScore: 1,
    },
    "https://example.test/settings",
    {
      violations: [
        {
          id: "aria-dialog-name",
          impact: "serious",
          help: "ARIA dialog nodes should have an accessible name",
          description: "Ensure dialogs have an accessible name.",
          nodes: [
            {
              target: [".ant-modal"],
              html: '<div role="dialog">',
              failureSummary: "Fix the dialog name.",
            },
          ],
        },
      ],
    },
  );
  assert.equal(page.engine, "axe");
  assert.equal(page.passed, false);
  assert.equal(page.violationCount, 1);
  assert.equal(page.affectedNodeCount, 1);
  assert.match(
    renderMarkdownSummary({
      generatedAt: "2026-07-27T00:00:00.000Z",
      pages: [page],
    }),
    /1 violations/,
  );
});
