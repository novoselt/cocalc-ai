/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import { validateNewEntryName } from "./file-surface";

test.each(["analysis.py", "data set", "spiral.ipynb"])(
  "accepts the leaf name %s",
  (name) => expect(validateNewEntryName(name)).toBe(name),
);

test.each(["", ".", "..", "nested/file", "nested\\file", "bad\0name"])(
  "rejects the unsafe leaf name %p",
  (name) => expect(() => validateNewEntryName(name)).toThrow(),
);
