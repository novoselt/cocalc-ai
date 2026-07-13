/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { ProjectArchiveEntry } from "@cocalc/conat/files/file-server";

const C_ESCAPE_BYTES: Record<string, number> = {
  a: 0x07,
  b: 0x08,
  f: 0x0c,
  n: 0x0a,
  r: 0x0d,
  t: 0x09,
  v: 0x0b,
  '"': 0x22,
  "\\": 0x5c,
};

/** Decode one GNU tar --quoting-style=c string at the start of input. */
export function decodeTarCQuotedString(input: string): {
  value: string;
  remainder: string;
} {
  if (!input.startsWith('"')) {
    throw new Error("tar path is not C-quoted");
  }
  const bytes: number[] = [];
  for (let i = 1; i < input.length; i += 1) {
    const char = input[i];
    if (char === '"') {
      return {
        value: Buffer.from(bytes).toString("utf8"),
        remainder: input.slice(i + 1),
      };
    }
    if (char !== "\\") {
      const codePoint = input.codePointAt(i);
      if (codePoint == null) break;
      const literal = String.fromCodePoint(codePoint);
      bytes.push(...Buffer.from(literal, "utf8"));
      if (literal.length === 2) i += 1;
      continue;
    }

    i += 1;
    const escaped = input[i];
    if (escaped == null) {
      throw new Error("tar path ends with an incomplete escape");
    }
    const simple = C_ESCAPE_BYTES[escaped];
    if (simple != null) {
      bytes.push(simple);
      continue;
    }
    if (/[0-7]/.test(escaped)) {
      let octal = escaped;
      while (octal.length < 3 && /[0-7]/.test(input[i + 1] ?? "")) {
        i += 1;
        octal += input[i];
      }
      bytes.push(Number.parseInt(octal, 8));
      continue;
    }
    if (escaped === "x") {
      let hex = "";
      while (hex.length < 2 && /[0-9a-f]/i.test(input[i + 1] ?? "")) {
        i += 1;
        hex += input[i];
      }
      if (!hex) {
        throw new Error("tar path contains an invalid hexadecimal escape");
      }
      bytes.push(Number.parseInt(hex, 16));
      continue;
    }
    throw new Error(`tar path contains an unsupported escape: \\${escaped}`);
  }
  throw new Error("tar path has an unterminated C-quoted string");
}

export function parseTarVerboseLine(line: string):
  | {
      path: string;
      size: number;
      type: ProjectArchiveEntry["type"];
      mtime?: string;
    }
  | undefined {
  const match = line.match(
    /^(\S+)\s+\S+\s+(\d+)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)\s+(.+)$/,
  );
  if (!match) return;
  const size = Number(match[2]);
  if (!Number.isFinite(size) || size < 0) return;
  const { value: name } = decodeTarCQuotedString(match[5]);
  const mode = match[1];
  const kind = mode[0];
  const type =
    kind === "d"
      ? "directory"
      : kind === "l"
        ? "symlink"
        : kind === "-"
          ? "file"
          : "other";
  return { path: name, size, type, mtime: `${match[3]}T${match[4]}Z` };
}

export function parseTarExtractedLine(line: string): string {
  const { value, remainder } = decodeTarCQuotedString(line);
  if (remainder.trim()) {
    throw new Error(`unexpected output after extracted tar path: ${remainder}`);
  }
  return value;
}
