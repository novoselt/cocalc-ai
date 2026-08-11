/*
 *  This file is part of CoCalc: Copyright (C) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

export function javascriptOutputFilenames(prodMode: boolean): {
  filename: string;
  chunkFilename: string;
} {
  return prodMode
    ? {
        filename: "[name]-[contenthash].js",
        chunkFilename: "[contenthash].js",
      }
    : {
        filename: "[id]-[contenthash].js",
        chunkFilename: "[id]-[contenthash].js",
      };
}
