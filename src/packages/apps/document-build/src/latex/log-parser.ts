/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/*
 * Derived from latex-log-parser-sharelatex commit
 * 7301857ac402ff5491cb219d9415ac41b19e7e43 (MIT), with CoCalc fixes.
 */

import { filename_extension } from "@cocalc/util/misc";

const LOG_WRAP_LIMIT = 79;
const LATEX_WARNING_REGEX = /^LaTeX Warning: (.*)$/;
const HBOX_WARNING_REGEX = /^(Over|Under)full \\(v|h)box/;
const PACKAGE_WARNING_REGEX = /^((?:Package|Class|Module) \b.+\b Warning:.*)$/;
const LINES_REGEX = /lines? ([0-9]+)/;
const PACKAGE_REGEX = /^(?:Package|Class|Module) (\b.+\b) Warning/;
const ALLOWED_DEP_EXTENSIONS = new Set([
  "bbx",
  "bib",
  "bst",
  "cbx",
  "cfg",
  "cls",
  "def",
  "lbx",
  "md",
  "pgf",
  "rnw",
  "rtex",
  "sty",
  "tex",
  "tikz",
  "txt",
]);

export interface LatexLogEntry {
  line: number | null;
  file: string;
  level: "error" | "warning" | "typesetting";
  message: string;
  content?: string;
  raw: string;
}

export interface ProcessedLatexLog {
  errors: LatexLogEntry[];
  warnings: LatexLogEntry[];
  typesetting: LatexLogEntry[];
  all: LatexLogEntry[];
  files: string[];
  deps: string[];
}

export function emptyProcessedLatexLog(): ProcessedLatexLog {
  return {
    errors: [],
    warnings: [],
    typesetting: [],
    all: [],
    files: [],
    deps: [],
  };
}

class LogText {
  private readonly lines: string[];
  private row = 0;

  constructor(text: string) {
    const wrapped = text.replace(/(\r\n)|\r/g, "\n").split("\n");
    this.lines = [wrapped[0] ?? ""];
    for (let i = 1; i < wrapped.length; i++) {
      if (
        wrapped[i - 1].length === LOG_WRAP_LIMIT &&
        !wrapped[i - 1].endsWith("...")
      ) {
        this.lines[this.lines.length - 1] += wrapped[i];
      } else {
        this.lines.push(wrapped[i]);
      }
    }
  }

  nextLine(): string | null {
    this.row += 1;
    return this.row >= this.lines.length ? null : this.lines[this.row];
  }

  linesUpToNextMatchingLine(pattern: RegExp): string[] {
    const lines: string[] = [];
    let line = this.nextLine();
    if (line != null) lines.push(line);
    while (line != null && !line.match(pattern)) {
      line = this.nextLine();
      if (line != null) lines.push(line);
    }
    return lines;
  }

  linesUpToNextWhitespaceLine(): string[] {
    return this.linesUpToNextMatchingLine(/^ *$/);
  }
}

interface OpenFile {
  path: string;
}

function normalizePath(path: string): string {
  const absolute = path.startsWith("/");
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
      else if (!absolute) parts.push(part);
    } else {
      parts.push(part);
    }
  }
  return `${absolute ? "/" : ""}${parts.join("/")}`;
}

export class LatexLogParser {
  private readonly log: LogText;
  private readonly ignoreDuplicates: boolean;
  private readonly data: LatexLogEntry[] = [];
  private readonly fileStack: OpenFile[] = [];
  private readonly files = new Set<string>();
  private readonly deps: string[] = [];
  private openParens = 0;
  private currentLine = "";
  private currentFilePath = "";

  constructor(text: string, options?: { ignoreDuplicates?: boolean }) {
    this.log = new LogText(text);
    this.ignoreDuplicates = options?.ignoreDuplicates ?? false;
  }

  parse(): ProcessedLatexLog {
    let line: string | null;
    while ((line = this.log.nextLine()) != null) {
      this.currentLine = line;
      if (this.currentLine.startsWith("!")) {
        this.parseError();
      } else if (/^Runaway argument/.test(this.currentLine)) {
        this.parseRunawayArgument();
      } else if (LATEX_WARNING_REGEX.test(this.currentLine)) {
        this.parseSingleWarning();
      } else if (HBOX_WARNING_REGEX.test(this.currentLine)) {
        this.parseHbox();
      } else if (PACKAGE_WARNING_REGEX.test(this.currentLine)) {
        this.parsePackageWarning();
      } else if (this.currentLine.startsWith("#===Dependents")) {
        this.parseDependencies();
      } else {
        this.parseParensForFilenames();
      }
    }
    return this.postProcess();
  }

  private parseError(): void {
    const entry: LatexLogEntry = {
      line: null,
      file: this.currentFilePath,
      level: "error",
      message: this.currentLine.slice(2),
      content: "",
      raw: `${this.currentLine}\n`,
    };
    entry.content = `${this.log.linesUpToNextMatchingLine(/^l\.[0-9]+/).join("\n")}\n`;
    entry.raw += entry.content;
    const line = entry.raw.match(/l\.([0-9]+)/);
    if (line != null) entry.line = parseInt(line[1], 10);
    this.data.push(entry);
  }

  private parseRunawayArgument(): void {
    const entry: LatexLogEntry = {
      line: null,
      file: this.currentFilePath,
      level: "error",
      message: this.currentLine,
      content: "",
      raw: `${this.currentLine}\n`,
    };
    entry.content = `${this.log.linesUpToNextWhitespaceLine().join("\n")}\n${this.log.linesUpToNextWhitespaceLine().join("\n")}`;
    entry.raw += entry.content;
    const line = entry.raw.match(/l\.([0-9]+)/);
    if (line != null) entry.line = parseInt(line[1], 10);
    this.data.push(entry);
  }

  private parseSingleWarning(): void {
    const match = this.currentLine.match(LATEX_WARNING_REGEX);
    if (match == null) return;
    const line = match[1].match(LINES_REGEX);
    this.data.push({
      line: line == null ? null : parseInt(line[1], 10),
      file: this.currentFilePath,
      level: "warning",
      message: match[1],
      raw: match[1],
    });
  }

  private parsePackageWarning(): void {
    const first = this.currentLine.match(PACKAGE_WARNING_REGEX);
    const packageMatch = this.currentLine.match(PACKAGE_REGEX);
    if (first == null || packageMatch == null) return;
    const warningLines = [first[1]];
    let lineMatch = this.currentLine.match(LINES_REGEX);
    let line = lineMatch == null ? null : parseInt(lineMatch[1], 10);
    const prefix = new RegExp(`(?:\\(${packageMatch[1]}\\))*[\\s]*(.*)`, "i");
    let next: string | null;
    while ((next = this.log.nextLine()) != null && next !== "") {
      lineMatch = next.match(LINES_REGEX);
      if (lineMatch != null) line = parseInt(lineMatch[1], 10);
      const warning = next.match(prefix);
      if (warning != null) warningLines.push(warning[1]);
    }
    const message = warningLines.join(" ");
    this.data.push({
      line,
      file: this.currentFilePath,
      level: "warning",
      message,
      raw: message,
    });
  }

  private parseHbox(): void {
    const match = this.currentLine.match(LINES_REGEX);
    this.data.push({
      line: match == null ? null : parseInt(match[1], 10),
      file: this.currentFilePath,
      level: "typesetting",
      message: this.currentLine,
      raw: this.currentLine,
    });
  }

  private parseDependencies(): void {
    let line: string | null;
    while ((line = this.log.nextLine()) != null) {
      if (line.startsWith("#===End dependents for")) return;
      line = line.trim().replace(/\\$/, "").trim();
      if (!line || line.startsWith("/") || line.includes(":")) continue;
      const extension = filename_extension(line).toLowerCase();
      if (extension && !ALLOWED_DEP_EXTENSIONS.has(extension)) continue;
      this.deps.push(line);
    }
  }

  private parseParensForFilenames(): void {
    if (this.currentLine.includes("\\")) return;
    const position = this.currentLine.search(/[()]/);
    if (position === -1) return;
    const token = this.currentLine[position];
    this.currentLine = this.currentLine.slice(position + 1);
    if (token === "(") {
      const path = this.consumeFilePath();
      if (path != null) {
        this.currentFilePath = path;
        this.fileStack.push({ path });
        this.files.add(path);
      } else {
        this.openParens += 1;
      }
    } else if (this.openParens > 0) {
      this.openParens -= 1;
    } else if (this.fileStack.length > 1) {
      this.fileStack.pop();
      this.currentFilePath = this.fileStack[this.fileStack.length - 1].path;
    }
    this.parseParensForFilenames();
  }

  private consumeFilePath(): string | undefined {
    if (!this.currentLine.match(/^\/?([^ )]+\/)+/)) return undefined;
    const end = this.currentLine.search(/$|\)| \[/);
    if (end === -1) return undefined;
    return normalizePath(this.currentLine.slice(0, end).trimEnd());
  }

  private postProcess(): ProcessedLatexLog {
    const result = emptyProcessedLatexLog();
    result.deps = this.deps.slice();
    result.files = [...this.files].filter((path) => {
      const lower = path.toLowerCase();
      return lower.endsWith(".tex") || lower.endsWith(".bib");
    });
    const seen = new Set<string>();
    for (const entry of this.data) {
      if (this.ignoreDuplicates && seen.has(entry.raw)) continue;
      if (entry.level === "error") result.errors.push(entry);
      else if (entry.level === "warning") result.warnings.push(entry);
      else result.typesetting.push(entry);
      result.all.push(entry);
      seen.add(entry.raw);
    }
    return result;
  }
}

export function parseLatexLog(text: string): ProcessedLatexLog {
  return new LatexLogParser(text, { ignoreDuplicates: true }).parse();
}
