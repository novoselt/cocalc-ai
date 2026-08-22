/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

export function createLazyClient<T>(
  createClient: () => Promise<T>,
): () => Promise<T> {
  let client: Promise<T> | undefined;
  return () => (client ??= createClient());
}
