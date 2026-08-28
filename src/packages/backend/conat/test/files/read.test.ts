/*
Test async streaming read of files from projects using NATS.


DEVELOPMENT:

pnpm test ./read.test.ts

*/

import {
  before,
  after,
  connect,
  client as testClient,
} from "@cocalc/backend/conat/test/setup";

beforeAll(before);

import { close, createServer, readFile } from "@cocalc/conat/files/read";
import { createReadStream } from "fs";
import { file as tempFile } from "tmp-promise";
import { writeFile as fsWriteFile } from "fs/promises";
import { sha1 } from "@cocalc/backend/sha1";
import { PassThrough, Readable } from "node:stream";
import { delay } from "awaiting";

describe("do a basic test that the file read service works", () => {
  const project_id = "00000000-0000-4000-8000-000000000000";
  it("create the read server", async () => {
    await createServer({
      project_id,
      createReadStream,
      client: testClient,
    });
  });

  let cleanups: any[] = [];
  const CONTENT = "cocalc";
  let source;
  it("creates the file we will read", async () => {
    const { path, cleanup } = await tempFile();
    source = path;
    await fsWriteFile(path, CONTENT);
    cleanups.push(cleanup);
  });

  it("reads the file into memory", async () => {
    const r = await readFile({ project_id, path: source, client: testClient });
    // will get just one chunk
    for await (const chunk of r) {
      expect(chunk.toString()).toEqual(CONTENT);
    }
  });

  it("preserves filesystem error codes across the streamed read service", async () => {
    const consumeMissingFile = async () => {
      for await (const _chunk of await readFile({
        project_id,
        path: `${source}-missing`,
        client: testClient,
      })) {
        // The missing file must fail before yielding data.
      }
    };

    await expect(consumeMissingFile()).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("closes the write server", async () => {
    close({ project_id });
    for (const f of cleanups) {
      f();
    }
  });
});

describe("read service supports async stream factories", () => {
  const project_id = "00000000-0000-4000-8000-000000000001";
  const name = "async";
  let cleanups: any[] = [];
  let source;

  it("creates the async read server", async () => {
    await createServer({
      project_id,
      name,
      createReadStream: async (path, opts) => createReadStream(path, opts),
      client: testClient,
    });
  });

  it("creates the file we will read", async () => {
    const { path, cleanup } = await tempFile();
    source = path;
    await fsWriteFile(path, "async cocalc");
    cleanups.push(cleanup);
  });

  it("reads through the async stream factory", async () => {
    const r = await readFile({
      project_id,
      path: source,
      name,
      client: testClient,
    });
    const chunks: any[] = [];
    for await (const chunk of r) {
      chunks.push(chunk);
    }
    expect(Buffer.concat(chunks).toString()).toBe("async cocalc");
  });

  it("closes the async read server", async () => {
    close({ project_id, name });
    for (const f of cleanups) {
      f();
    }
  });
});

describe("read service supports byte ranges", () => {
  const project_id = "00000000-0000-4000-8000-000000000009";
  const name = "range";
  let source;
  let cleanup;

  it("creates a ranged reader and source file", async () => {
    await createServer({
      project_id,
      name,
      createReadStream,
      client: testClient,
    });
    ({ path: source, cleanup } = await tempFile());
    await fsWriteFile(source, "0123456789");
  });

  it("returns the inclusive requested range", async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of await readFile({
      project_id,
      path: source,
      name,
      client: testClient,
      start: 2,
      end: 5,
    })) {
      chunks.push(Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks).toString()).toBe("2345");
  });

  it("cleans up", async () => {
    await close({ project_id, name });
    cleanup?.();
  });
});

describe("read service concurrency is isolated per reader", () => {
  const blockedProject = "00000000-0000-4000-8000-00000000000a";
  const independentProject = "00000000-0000-4000-8000-00000000000b";
  const name = "concurrency";
  const blockedStream = new PassThrough();
  const openBlockedStream = jest.fn(() => blockedStream);

  it("starts one long-running read", async () => {
    await createServer({
      project_id: blockedProject,
      name,
      maxActiveStreams: 1,
      createReadStream: openBlockedStream,
      client: testClient,
    });
    await createServer({
      project_id: independentProject,
      name,
      maxActiveStreams: 1,
      createReadStream: () => Readable.from([Buffer.from("independent")]),
      client: testClient,
    });

    const firstRead = (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of await readFile({
        project_id: blockedProject,
        path: "blocked",
        name,
        client: testClient,
      })) {
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks).toString();
    })();
    while (openBlockedStream.mock.calls.length === 0) {
      await delay(10);
    }

    const independentChunks: Buffer[] = [];
    for await (const chunk of await readFile({
      project_id: independentProject,
      path: "independent",
      name,
      client: testClient,
    })) {
      independentChunks.push(Buffer.from(chunk));
    }
    expect(Buffer.concat(independentChunks).toString()).toBe("independent");

    const consumeRejectedRead = async () => {
      for await (const _chunk of await readFile({
        project_id: blockedProject,
        path: "also-blocked",
        name,
        client: testClient,
      })) {
        // The second read is rejected before a stream opens.
      }
    };
    await expect(consumeRejectedRead()).rejects.toThrow(
      "project file read service is busy",
    );
    expect(openBlockedStream).toHaveBeenCalledTimes(1);

    blockedStream.end("finished");
    await expect(firstRead).resolves.toBe("finished");
  });

  it("cleans up", async () => {
    await close({ project_id: blockedProject, name });
    await close({ project_id: independentProject, name });
  });
});

describe("do a larger test that involves multiple chunks and a different name", () => {
  const project_id = "00000000-0000-4000-8000-000000000000";
  const name = "b";
  it("create the read server", async () => {
    await createServer({
      project_id,
      createReadStream,
      name,
      client: testClient,
    });
  });

  let cleanups: any[] = [];
  let CONTENT = "";
  for (let i = 0; i < 1000000; i++) {
    CONTENT += `${i}`;
  }
  let source;
  it("creates the file we will read", async () => {
    const { path, cleanup } = await tempFile();
    source = path;
    await fsWriteFile(path, CONTENT);
    cleanups.push(cleanup);
  });

  it("reads the file into memory", async () => {
    const r = await readFile({
      project_id,
      path: source,
      name,
      client: testClient,
    });
    // will get many chunks.
    let chunks: any[] = [];
    for await (const chunk of r) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBeGreaterThan(1);
    const s = Buffer.concat(chunks).toString();
    expect(s.length).toBe(CONTENT.length);
    expect(sha1(s)).toEqual(sha1(CONTENT));
  });

  it("closes the write server", async () => {
    close({ project_id, name });
    for (const f of cleanups) {
      f();
    }
  });
});

describe("a queue group keeps duplicate read servers from both answering", () => {
  // Several processes can register the hub-side workspace reader for the same
  // project.  Without a shared queue group each registrant gets its own random
  // group, so every one of them receives the request and streams a full copy of
  // the file, interleaving duplicate chunk sequences into a single response.
  const project_id = "00000000-0000-4000-8000-000000000001";
  const name = ":workspace";
  const queue = "workspace-file-download-read";
  const CONTENT = "duplicate-reader-check";

  let source;
  let cleanups: any[] = [];
  const served: string[] = [];

  it("creates the file to read", async () => {
    const { path, cleanup } = await tempFile();
    source = path;
    await fsWriteFile(path, CONTENT);
    cleanups.push(cleanup);
  });

  it("registers two independent servers on the same subject and queue", async () => {
    for (const id of ["a", "b"]) {
      await createServer({
        project_id,
        name,
        queue,
        client: connect(),
        createReadStream: (path: string, opts?: any) => {
          served.push(id);
          return createReadStream(path, opts);
        },
      });
    }
  });

  it("has exactly one server answer, and returns the file intact", async () => {
    const chunks: string[] = [];
    for await (const chunk of await readFile({
      project_id,
      path: source,
      name,
      client: testClient,
    })) {
      chunks.push(chunk.toString());
    }
    expect(chunks.join("")).toEqual(CONTENT);
    expect(served).toHaveLength(1);
  });

  it("cleans up", async () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
  });
});

afterAll(after);
