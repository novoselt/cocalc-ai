/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import Prism from "prismjs/components/prism-core";

export type UltraliteLanguage =
  | "bash"
  | "c"
  | "cpp"
  | "css"
  | "javascript"
  | "json"
  | "latex"
  | "markdown"
  | "markup"
  | "python"
  | "rust"
  | "sql"
  | "typescript"
  | "yaml";

const EXTENSIONS: Record<string, UltraliteLanguage> = {
  bash: "bash",
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  css: "css",
  cxx: "cpp",
  h: "c",
  hh: "cpp",
  hpp: "cpp",
  htm: "markup",
  html: "markup",
  js: "javascript",
  json: "json",
  jsx: "javascript",
  latex: "latex",
  md: "markdown",
  py: "python",
  pyw: "python",
  rs: "rust",
  sh: "bash",
  sql: "sql",
  tex: "latex",
  ts: "typescript",
  tsx: "typescript",
  xhtml: "markup",
  xml: "markup",
  yaml: "yaml",
  yml: "yaml",
};

export function languageForPath(path: string): UltraliteLanguage | undefined {
  const name = path.split("/").pop()?.toLowerCase() ?? "";
  if (["bashrc", "profile", "zshrc"].includes(name.replace(/^\./, ""))) {
    return "bash";
  }
  return EXTENSIONS[name.split(".").pop() ?? ""];
}

function loadChunk(name: UltraliteLanguage): Promise<void> {
  return new Promise((resolve, reject) => {
    switch (name) {
      case "bash":
        require.ensure(
          [],
          () => {
            require("prismjs/components/prism-bash");
            resolve();
          },
          reject,
          "ultralite-prism-bash",
        );
        break;
      case "c":
        require.ensure(
          [],
          () => {
            require("prismjs/components/prism-c");
            resolve();
          },
          reject,
          "ultralite-prism-c",
        );
        break;
      case "cpp":
        require.ensure(
          [],
          () => {
            require("prismjs/components/prism-cpp");
            resolve();
          },
          reject,
          "ultralite-prism-cpp",
        );
        break;
      case "css":
        require.ensure(
          [],
          () => {
            require("prismjs/components/prism-css");
            resolve();
          },
          reject,
          "ultralite-prism-css",
        );
        break;
      case "javascript":
        require.ensure(
          [],
          () => {
            require("prismjs/components/prism-javascript");
            resolve();
          },
          reject,
          "ultralite-prism-javascript",
        );
        break;
      case "json":
        require.ensure(
          [],
          () => {
            require("prismjs/components/prism-json");
            resolve();
          },
          reject,
          "ultralite-prism-json",
        );
        break;
      case "latex":
        require.ensure(
          [],
          () => {
            require("prismjs/components/prism-latex");
            resolve();
          },
          reject,
          "ultralite-prism-latex",
        );
        break;
      case "markdown":
        require.ensure(
          [],
          () => {
            require("prismjs/components/prism-markdown");
            resolve();
          },
          reject,
          "ultralite-prism-markdown",
        );
        break;
      case "markup":
        require.ensure(
          [],
          () => {
            require("prismjs/components/prism-markup");
            resolve();
          },
          reject,
          "ultralite-prism-markup",
        );
        break;
      case "python":
        require.ensure(
          [],
          () => {
            require("prismjs/components/prism-python");
            resolve();
          },
          reject,
          "ultralite-prism-python",
        );
        break;
      case "rust":
        require.ensure(
          [],
          () => {
            require("prismjs/components/prism-rust");
            resolve();
          },
          reject,
          "ultralite-prism-rust",
        );
        break;
      case "sql":
        require.ensure(
          [],
          () => {
            require("prismjs/components/prism-sql");
            resolve();
          },
          reject,
          "ultralite-prism-sql",
        );
        break;
      case "typescript":
        require.ensure(
          [],
          () => {
            require("prismjs/components/prism-typescript");
            resolve();
          },
          reject,
          "ultralite-prism-typescript",
        );
        break;
      case "yaml":
        require.ensure(
          [],
          () => {
            require("prismjs/components/prism-yaml");
            resolve();
          },
          reject,
          "ultralite-prism-yaml",
        );
        break;
    }
  });
}

export async function loadLanguage(
  language?: UltraliteLanguage,
): Promise<Prism.Grammar | undefined> {
  if (!language) return;
  if (!Prism.languages[language]) await loadChunk(language);
  return Prism.languages[language];
}

export { Prism };
