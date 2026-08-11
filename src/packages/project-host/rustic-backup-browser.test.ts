import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "@jest/globals";

import {
  __test__,
  parseDavEntries,
  repositoryIdentityFromProfile,
  RusticFindOutputParser,
  RusticWebDavClient,
} from "./rustic-backup-browser";

function response({
  href,
  directory = false,
  size = 0,
  mtime = "Mon, 10 Aug 2026 05:10:36 GMT",
}: {
  href: string;
  directory?: boolean;
  size?: number;
  mtime?: string;
}): string {
  return [
    "<D:response>",
    `<D:href>${href}</D:href>`,
    "<D:propstat><D:prop>",
    directory ? "" : `<D:getcontentlength>${size}</D:getcontentlength>`,
    `<D:getlastmodified>${mtime}</D:getlastmodified>`,
    directory
      ? "<D:resourcetype><D:collection></D:collection></D:resourcetype>"
      : "<D:resourcetype></D:resourcetype>",
    "</D:prop></D:propstat>",
    "</D:response>",
  ].join("");
}

function multistatus(...responses: string[]): string {
  return `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">${responses.join("")}</D:multistatus>`;
}

describe("Rustic backup browser metadata", () => {
  it("derives repository identity without credentials", () => {
    const first = `
[repository]
repository = "opendal:s3"
password = "first-password"

[repository.options]
endpoint = "https://example.invalid"
bucket = "backups"
root = "shared-0001"
access_key_id = "first-access"
secret_access_key = "first-secret"
`;
    const rotated = first
      .replace("first-password", "rotated-password")
      .replace("first-access", "rotated-access")
      .replace("first-secret", "rotated-secret");
    expect(repositoryIdentityFromProfile(first)).toBe(
      repositoryIdentityFromProfile(rotated),
    );
    expect(repositoryIdentityFromProfile(first)).not.toContain("first-secret");
  });

  it("parses DAV metadata and decodes paths", () => {
    const entries = parseDavEntries(
      multistatus(
        response({ href: "/root/", directory: true }),
        response({ href: "/root/a%20file.txt", size: 42 }),
      ),
    );
    expect(entries).toEqual([
      expect.objectContaining({ pathname: "/root/", isDir: true, size: 0 }),
      expect.objectContaining({
        pathname: "/root/a file.txt",
        isDir: false,
        size: 42,
        mtime: Date.parse("Mon, 10 Aug 2026 05:10:36 GMT"),
      }),
    ]);
  });

  it("parses stable snapshot paths", () => {
    expect(
      __test__.parseSnapshotSegment(
        "20260810T053214+0000--SnapshotId(85b85e9688da026e4951c68d01b6edaac83068e3c85470f0728ec932272bf9b9)",
      ),
    ).toEqual(
      expect.objectContaining({
        id: "85b85e9688da026e4951c68d01b6edaac83068e3c85470f0728ec932272bf9b9",
        time: new Date("2026-08-10T05:32:14+00:00"),
      }),
    );
    expect(
      __test__.parseSnapshotSegment(
        "20260810T053214+0000--85b85e9688da026e4951c68d01b6edaac83068e3c85470f0728ec932272bf9b9",
      ),
    ).toEqual(
      expect.objectContaining({
        id: "85b85e9688da026e4951c68d01b6edaac83068e3c85470f0728ec932272bf9b9",
      }),
    );
  });

  it("parses native Rustic find groups and preserves changed metadata", () => {
    const first = {
      id: "a".repeat(64),
      time: new Date("2026-08-01T00:00:00Z"),
      summary: {},
    };
    const second = {
      id: "b".repeat(64),
      time: new Date("2026-08-02T00:00:00Z"),
      summary: {},
    };
    const third = {
      id: "c".repeat(64),
      time: new Date("2026-08-03T00:00:00Z"),
      summary: {},
    };
    const parser = new RusticFindOutputParser([first, second, third]);
    parser.push(
      Buffer.from(
        [
          "searching in snapshots group (...)...",
          `found in ${first.id.slice(0, 8)} from 2026-08-01 00:00:00+0000`,
          '-rw-r--r-- user group        49 23 Jul 2026 16:23 "docs/a file.txt" ',
          `found in ${second.id.slice(0, 8)} from 2026-08-02 00:00:00+0000`,
          `found in ${third.id.slice(0, 8)} from 2026-08-03 00:00:00+0000`,
          '-rw-r--r-- user group        72 24 Jul 2026 17:24 "docs/a file.txt" ',
          "",
        ].join("\n"),
      ),
    );
    expect(parser.finish()).toEqual([
      expect.objectContaining({
        id: first.id,
        path: "docs/a file.txt",
        size: 49,
        mtime: Date.UTC(2026, 6, 23, 16, 23),
      }),
      expect.objectContaining({
        id: second.id,
        path: "docs/a file.txt",
        size: 72,
      }),
      expect.objectContaining({
        id: third.id,
        path: "docs/a file.txt",
        size: 72,
      }),
    ]);
  });

  it("uses Rustic exact-path lookup when the glob has no metacharacters", () => {
    const snapshots = [
      {
        id: "d".repeat(64),
        time: new Date("2026-08-01T00:00:00Z"),
        summary: {},
      },
    ];
    expect(
      __test__.rusticFindArgs({
        profilePath: "/tmp/repo.toml",
        snapshots,
        glob: ["docs/file.tex"],
      }),
    ).toContain("--path=docs/file.tex");
    expect(
      __test__.rusticFindArgs({
        profilePath: "/tmp/repo.toml",
        snapshots,
        iglob: ["*file*"],
      }),
    ).toContain("--iglob=*file*");
  });

  it("parses directories and symlinks from Rustic find output", () => {
    expect(
      __test__.parseRusticFindEntry(
        'drwxr-xr-x user group         0 10 Aug 2026 05:10 "docs" ',
      ),
    ).toEqual(expect.objectContaining({ path: "docs", isDir: true, size: 0 }));
    expect(
      __test__.parseRusticFindEntry(
        'lrwxrwxrwx user group        15 10 Aug 2026 05:10 "latest notes" -> docs/notes.txt',
      ),
    ).toEqual(
      expect.objectContaining({
        path: "latest notes",
        isDir: false,
        size: 15,
      }),
    );
  });
});

describe("RusticWebDavClient", () => {
  let server: Server | undefined;

  afterEach(
    () =>
      new Promise<void>((resolve) => {
        if (!server) return resolve();
        server.close(() => resolve());
        server = undefined;
      }),
  );

  it("lists snapshots and browses directories", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const host = `project-${projectId}`;
    const id = "a".repeat(64);
    const segment = `20260810T053214+0000--SnapshotId(${id})`;
    const snapshotRoot = `/${host}/${encodeURIComponent(segment)}/`;
    const responses = new Map<string, string>([
      [
        `/${host}/`,
        multistatus(
          response({ href: `/${host}/`, directory: true }),
          response({
            href: snapshotRoot,
            directory: true,
          }),
          response({ href: `/${host}/latest/`, directory: true }),
        ),
      ],
      [
        snapshotRoot,
        multistatus(
          response({ href: snapshotRoot, directory: true }),
          response({ href: `${snapshotRoot}docs/`, directory: true }),
          response({ href: `${snapshotRoot}hello%20world.txt`, size: 12 }),
        ),
      ],
      [
        `${snapshotRoot}docs/`,
        multistatus(
          response({ href: `${snapshotRoot}docs/`, directory: true }),
          response({ href: `${snapshotRoot}docs/guide.md`, size: 99 }),
        ),
      ],
    ]);
    server = createServer((req, res) => {
      const body = responses.get(req.url ?? "");
      if (!body) {
        res.statusCode = 404;
        res.end("missing");
        return;
      }
      res.statusCode = 207;
      res.setHeader("content-type", "application/xml");
      res.end(body);
    });
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    const client = new RusticWebDavClient(`http://127.0.0.1:${address.port}`);

    expect(await client.listBackups(projectId)).toEqual([
      expect.objectContaining({ id, time: new Date("2026-08-10T05:32:14Z") }),
    ]);
    expect(await client.listDirectory({ projectId, id })).toEqual([
      expect.objectContaining({ name: "docs", isDir: true }),
      expect.objectContaining({
        name: "hello world.txt",
        isDir: false,
        size: 12,
      }),
    ]);
    expect(
      await client.getEntry({ projectId, id, path: "docs/guide.md" }),
    ).toEqual(expect.objectContaining({ name: "guide.md", size: 99 }));
  });
});
