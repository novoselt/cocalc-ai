import getListing from "./get-listing";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("it gets a directory listing", async () => {
  const listing = await getListing(".");
  // we just check that each entry has name, mtime and size properties.
  // it's getting $HOME so there's not much more we can do in general.
  for (const entry of listing) {
    // check properties
    expect(entry).toHaveProperty("name");
    expect(entry).toHaveProperty("mtime");
    expect(entry).toHaveProperty("size");

    // check something about types
    expect(typeof entry.name).toBe("string");
    expect(typeof entry.mtime).toBe("number");
    expect(typeof entry.size).toBe("number");
  }
});

test("it does not prefix an absolute directory with home", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cocalc-listing-"));
  try {
    await writeFile(join(directory, "marker.txt"), "test");
    const listing = await getListing(directory, false, {
      home: join(directory, "wrong-home"),
    });
    expect(listing.map(({ name }) => name)).toContain("marker.txt");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
