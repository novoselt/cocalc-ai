/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { lstatSync, realpathSync, type Stats } from "node:fs";
import {
  dirname,
  isAbsolute,
  normalize,
  relative,
  resolve,
  sep,
} from "node:path";

const PLACEHOLDER = /\[[a-zA-Z0-9_]+\]/g;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function templateRegex(template: string): RegExp {
  let source = "";
  let index = 0;
  for (const match of template.matchAll(PLACEHOLDER)) {
    source += escapeRegex(template.slice(index, match.index));
    source += "[^/]+";
    index = (match.index ?? 0) + match[0].length;
  }
  source += escapeRegex(template.slice(index));
  return new RegExp(`^${source}(?:${escapeRegex(sep)}|$)`);
}

export class PersistMaintenancePathSafety {
  private readonly templates: string[];
  private readonly matchers: RegExp[];
  private readonly catalogPath: string;

  constructor({
    rootTemplates,
    catalogPath,
  }: {
    rootTemplates: string[];
    catalogPath: string;
  }) {
    this.templates = rootTemplates.map((root) => resolve(root));
    this.matchers = this.templates.map(templateRegex);
    this.catalogPath = resolve(catalogPath);
  }

  get rootTemplates(): string[] {
    return [...this.templates];
  }

  assertLexicallyAllowed(filename: string): string {
    if (!isAbsolute(filename)) {
      throw new Error(`persist maintenance path is not absolute: ${filename}`);
    }
    const path = resolve(normalize(filename));
    if (path === this.catalogPath || path.startsWith(`${this.catalogPath}-`)) {
      throw new Error("persist maintenance catalog cannot be a candidate");
    }
    if (!path.endsWith(".db")) {
      throw new Error(`persist maintenance path is not a .db file: ${path}`);
    }
    if (
      path.includes(".compact-") ||
      path.includes(".rollback-") ||
      path.endsWith("-wal") ||
      path.endsWith("-shm")
    ) {
      throw new Error(`persist maintenance temporary path rejected: ${path}`);
    }
    if (!this.matchers.some((matcher) => matcher.test(path))) {
      throw new Error(
        `persist maintenance path is outside configured roots: ${path}`,
      );
    }
    return path;
  }

  assertExistingRegularFile(filename: string): {
    path: string;
    stat: Stats;
  } {
    const path = this.assertLexicallyAllowed(filename);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(
        `persist maintenance candidate is not a regular file: ${path}`,
      );
    }
    const real = realpathSync(path);
    if (real !== path) {
      throw new Error(
        `persist maintenance candidate resolves elsewhere: ${path}`,
      );
    }
    this.assertNoSymlinkParents(path);
    return { path, stat };
  }

  private assertNoSymlinkParents(filename: string): void {
    let current = dirname(filename);
    while (current !== dirname(current)) {
      const matchingRoot = this.templates.find((template) => {
        const staticRoot = resolve(template.split(PLACEHOLDER)[0] || sep);
        const rel = relative(dirname(staticRoot), current);
        return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
      });
      const stat = lstatSync(current);
      if (stat.isSymbolicLink()) {
        throw new Error(
          `persist maintenance refuses symlink parent: ${current}`,
        );
      }
      if (
        matchingRoot &&
        current === resolve(matchingRoot.split(PLACEHOLDER)[0])
      ) {
        break;
      }
      current = dirname(current);
    }
  }
}

export function fileIdentity(stat: Stats, walSizeBytes = 0) {
  return {
    device: Number(stat.dev),
    inode: Number(stat.ino),
    sizeBytes: stat.size,
    mtimeMs: stat.mtimeMs,
    walSizeBytes,
  };
}
