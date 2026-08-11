/*
 *  This file is part of CoCalc: Copyright (C) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { javascriptOutputFilenames } from "./output-filenames";

describe("javascriptOutputFilenames", () => {
  it("keys production assets by their final emitted content", () => {
    expect(javascriptOutputFilenames(true)).toEqual({
      filename: "[name]-[contenthash].js",
      chunkFilename: "[contenthash].js",
    });
  });

  it("keeps chunk ids visible in development filenames", () => {
    expect(javascriptOutputFilenames(false)).toEqual({
      filename: "[id]-[contenthash].js",
      chunkFilename: "[id]-[contenthash].js",
    });
  });
});
