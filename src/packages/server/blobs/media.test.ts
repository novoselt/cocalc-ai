/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { detectRasterImage } from "./media";

function png(width = 2, height = 3): Buffer {
  const buffer = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function gif(): Buffer {
  const buffer = Buffer.from("GIF89a00000000", "ascii");
  buffer.writeUInt16LE(4, 6);
  buffer.writeUInt16LE(5, 8);
  return buffer;
}

function jpeg(): Buffer {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11,
    0x08, 0x00, 0x06, 0x00, 0x07, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00,
    0x03, 0x11, 0x00,
  ]);
}

describe("detectRasterImage", () => {
  it("detects supported raster images from bytes", () => {
    expect(detectRasterImage(png())).toMatchObject({
      contentType: "image/png",
      width: 2,
      height: 3,
    });
    expect(detectRasterImage(gif())).toMatchObject({
      contentType: "image/gif",
      width: 4,
      height: 5,
    });
    expect(detectRasterImage(jpeg())).toMatchObject({
      contentType: "image/jpeg",
      width: 7,
      height: 6,
    });
  });

  it("rejects unsafe and oversized data", () => {
    expect(detectRasterImage(Buffer.from("<svg></svg>"))).toBeUndefined();
    expect(detectRasterImage(png(200_000, 1))).toBeUndefined();
    expect(detectRasterImage(png(20_000, 20_000))).toBeUndefined();
  });
});
