import { getHome } from "./util";
import { move, pathExists } from "fs-extra";
import { stat } from "node:fs/promises";
import { move_file_variations } from "@cocalc/util/delete-files";
import { basename, isAbsolute, join } from "path";
import getLogger from "@cocalc/backend/logger";

const log = getLogger("move-files");

export async function move_files(
  paths: string[],
  dest: string, // assumed to be a directory
  set_deleted: (path: string) => Promise<void>,
  home?: string,
): Promise<void> {
  const HOME = getHome(home);
  log.debug({ paths, dest });
  if (dest == "") {
    dest = HOME;
  } else if (!isAbsolute(dest)) {
    dest = join(HOME, dest);
  }
  const to_move: { src: string; dest: string }[] = [];
  for (let path of paths) {
    if (!isAbsolute(path)) {
      path = join(HOME, path);
    }
    const target = join(dest, basename(path));
    log.debug({ path, target });
    await set_deleted(path);
    to_move.push({ src: path, dest: target });

    // and the aux files:
    try {
      const s = await stat(path);
      if (!s.isDirectory()) {
        for (const variation of move_file_variations(path, target)) {
          if (await pathExists(variation.src)) {
            await set_deleted(variation.src);
            to_move.push(variation);
          }
        }
      }
    } catch (_err) {}
  }

  for (const x of to_move) {
    await move(x.src, x.dest);
  }
}
