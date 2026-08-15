/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import { ChangeSet, Text } from "@codemirror/state";
import {
  compressPatch,
  patch_make,
  type CompressedPatch,
} from "@cocalc/util/dmp";

export interface CodeMirrorJournalBatch {
  base: string;
  value: string;
  patch: CompressedPatch;
}

export class CodeMirrorEditJournal {
  private base: string;
  private changes?: ChangeSet;

  constructor(value: string) {
    this.base = value;
  }

  record(changes: ChangeSet): void {
    if (changes.empty) return;
    this.changes = this.changes ? this.changes.compose(changes) : changes;
  }

  getBatch(): CodeMirrorJournalBatch | undefined {
    if (!this.changes || this.changes.empty) return;
    const diffs: Array<[-1 | 0 | 1, string]> = [];
    let cursor = 0;
    this.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      if (fromA > cursor) {
        diffs.push([0, this.base.slice(cursor, fromA)]);
      }
      if (toA > fromA) {
        diffs.push([-1, this.base.slice(fromA, toA)]);
      }
      const text = inserted.toString();
      if (text) diffs.push([1, text]);
      cursor = toA;
    });
    if (cursor < this.base.length) {
      diffs.push([0, this.base.slice(cursor)]);
    }
    const value = this.changes.apply(Text.of(this.base.split("\n"))).toString();
    const patch = compressPatch((patch_make as any)(this.base, diffs));
    return { base: this.base, value, patch };
  }

  reset(value: string): void {
    this.base = value;
    this.changes = undefined;
  }
}
