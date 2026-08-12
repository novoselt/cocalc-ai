/*

DEVELOPMENT:


1. Setup the project environment variables. Then start the server in node:


    ~/cocalc/src/packages/project/conat$ . project-env.sh
    $ node
    Welcome to Node.js v18.17.1.
    Type ".help" for more information.

    require('@cocalc/project/conat/files/read').init()


*/

import "@cocalc/project/conat/env"; // ensure conat env available

import { createReadStream as fs_createReadStream } from "fs";
import {
  createServer,
  close as closeReadServer,
} from "@cocalc/conat/files/read";
import { getIdentity } from "../connection";
import { projectFilePath } from "./path";

function createReadStream(path: string) {
  return fs_createReadStream(projectFilePath(path));
}

// the project should call this on startup:
export async function init(opts?) {
  await createServer({ ...getIdentity(opts), createReadStream });
}

export async function close(opts?) {
  await closeReadServer(getIdentity(opts));
}
