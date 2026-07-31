import { parseBtrfsSubvolumeIdentity } from "./subvolume";
import { parseBtrfsSubvolumeList } from "./subvolumes";

describe("Btrfs subvolume identity parsing", () => {
  it("parses stable identity from subvolume show", () => {
    expect(
      parseBtrfsSubvolumeIdentity(`
project-123
        Name:                   project-123
        UUID:                   aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee
        Subvolume ID:           256
        Generation:             987
`),
    ).toEqual({
      subvolume_id: 256,
      volume_uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      generation: 987,
    });
  });

  it("parses one-pass legacy inventory output", () => {
    expect(
      parseBtrfsSubvolumeList(`
ID 256 gen 100 top level 5 uuid aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee path project-11111111-2222-4333-8444-555555555555
ID 257 gen 101 top level 5 uuid bbbbbbbb-cccc-4ddd-8eee-ffffffffffff path project-11111111-2222-4333-8444-555555555555-scratch
`),
    ).toEqual([
      {
        subvolume_id: 256,
        generation: 100,
        volume_uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        path: "project-11111111-2222-4333-8444-555555555555",
      },
      {
        subvolume_id: 257,
        generation: 101,
        volume_uuid: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
        path: "project-11111111-2222-4333-8444-555555555555-scratch",
      },
    ]);
  });
});
