/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const lifecycleGenerations = new Map<string, number>();
const lifecycleTails = new Map<string, Promise<void>>();

export function currentProjectVolumeLifecycleGeneration(
  project_id: string,
): number {
  return lifecycleGenerations.get(project_id) ?? 0;
}

export function invalidateProjectVolumeLifecycle(project_id: string): number {
  const generation = currentProjectVolumeLifecycleGeneration(project_id) + 1;
  lifecycleGenerations.set(project_id, generation);
  return generation;
}

export function assertProjectVolumeLifecycleGeneration(
  project_id: string,
  expected_generation: number,
): void {
  const current = currentProjectVolumeLifecycleGeneration(project_id);
  if (current !== expected_generation) {
    throw new Error(
      `project volume lifecycle changed for ${project_id}: expected generation ${expected_generation}, current ${current}`,
    );
  }
}

export async function withProjectVolumeLifecycleLock<T>(
  project_id: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = lifecycleTails.get(project_id) ?? Promise.resolve();
  let release!: () => void;
  const tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  lifecycleTails.set(project_id, tail);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (lifecycleTails.get(project_id) === tail) {
      lifecycleTails.delete(project_id);
    }
  }
}

export async function withCurrentProjectVolumeLifecycleLock<T>(
  project_id: string,
  expected_generation: number,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  return await withProjectVolumeLifecycleLock(project_id, async () => {
    if (
      currentProjectVolumeLifecycleGeneration(project_id) !==
      expected_generation
    ) {
      return undefined;
    }
    return await fn();
  });
}

export function resetProjectVolumeLifecycleForTesting(): void {
  lifecycleGenerations.clear();
  lifecycleTails.clear();
}
