import { set, get, del } from "@cocalc/frontend/misc/local-storage-typed";
import { getLogger } from "@cocalc/conat/logger";
import { isEqual } from "lodash";

const logger = getLogger("frontend:codemirror:fold-state");

export function getFoldedLines(cm): number[] {
  if (cm?.foldCode == null) {
    // not enabled
    return [];
  }
  return cm
    .getAllMarks()
    .filter((mark) => mark.__isFold)
    .map((mark) => mark.find().from.line);
}

export function setFoldedLines(cm, lines: number[]): boolean {
  if (cm?.foldCode == null) {
    // not enabled
    return true;
  }
  let restored = true;
  for (const n of [...lines].reverse()) {
    try {
      cm.foldCode(n);
    } catch (err) {
      restored = false;
      logger.warn(`Unable to restore code fold at line ${n}`, err);
    }
  }
  return restored;
}

function toKey(key: string): string {
  return `cmfold-${key}`;
}

export function initFold(cm, key: string) {
  const k = toKey(key);
  const lines = get<number[]>(k);
  if (lines != null) {
    try {
      if (!setFoldedLines(cm, lines)) {
        del(k);
      }
    } catch (err) {
      logger.warn(`Unable to restore code folding for ${key}`, err);
      del(k);
    }
  }
}

export function saveFold(cm, key: string) {
  const k = toKey(key);
  const lines = get<number[]>(k);
  const lines2 = getFoldedLines(cm);
  if (lines2.length == 0) {
    if (lines != null) {
      del(k);
    }
    return;
  }
  if (!isEqual(lines, lines2)) {
    set<number[]>(k, lines2);
  }
}
