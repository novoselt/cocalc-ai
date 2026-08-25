/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const MAX_IMAGE_DIMENSION = 100_000;
const MAX_IMAGE_PIXELS = 100_000_000;

export interface RasterImageInfo {
  contentType: string;
  format: "png" | "jpeg" | "gif" | "webp" | "bmp" | "ico" | "avif";
  width?: number;
  height?: number;
}

function hasPrefix(buffer: Buffer, prefix: number[]): boolean {
  return prefix.every((value, index) => buffer[index] === value);
}

function hasAscii(buffer: Buffer, offset: number, value: string): boolean {
  return buffer.toString("ascii", offset, offset + value.length) === value;
}

function validDimensions(width?: number, height?: number): boolean {
  if (width == null || height == null) return true;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  if (width <= 0 || height <= 0) return false;
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    return false;
  }
  return width * height <= MAX_IMAGE_PIXELS;
}

function withDimensions(
  info: RasterImageInfo,
  width?: number,
  height?: number,
): RasterImageInfo | undefined {
  if (!validDimensions(width, height)) return undefined;
  return { ...info, width, height };
}

function jpegDimensions(buffer: Buffer): { width?: number; height?: number } {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    let marker = buffer[offset + 1];
    offset += 2;
    while (marker === 0xff && offset < buffer.length) {
      marker = buffer[offset];
      offset += 1;
    }
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 2 > buffer.length) break;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break;
    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isStartOfFrame && segmentLength >= 7) {
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5),
      };
    }
    offset += segmentLength;
  }
  return {};
}

function webpDimensions(buffer: Buffer): { width?: number; height?: number } {
  if (buffer.length < 30 || !hasAscii(buffer, 8, "WEBP")) return {};
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8X" && buffer.length >= 30) {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  if (chunk === "VP8L" && buffer.length >= 25 && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    return {
      width: 1 + (bits & 0x3fff),
      height: 1 + ((bits >> 14) & 0x3fff),
    };
  }
  if (
    chunk === "VP8 " &&
    buffer.length >= 30 &&
    hasPrefix(buffer.subarray(23), [0x9d, 0x01, 0x2a])
  ) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  return {};
}

function detectAvif(buffer: Buffer): RasterImageInfo | undefined {
  if (buffer.length < 16 || !hasAscii(buffer, 4, "ftyp")) return undefined;
  for (let offset = 8; offset + 4 <= Math.min(buffer.length, 64); offset += 4) {
    const brand = buffer.toString("ascii", offset, offset + 4);
    if (brand === "avif" || brand === "avis") {
      return { contentType: "image/avif", format: "avif" };
    }
  }
  return undefined;
}

export function detectRasterImage(buffer: Buffer): RasterImageInfo | undefined {
  if (buffer.length < 4) return undefined;

  if (hasPrefix(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    if (buffer.length < 24 || !hasAscii(buffer, 12, "IHDR")) return undefined;
    return withDimensions(
      { contentType: "image/png", format: "png" },
      buffer.readUInt32BE(16),
      buffer.readUInt32BE(20),
    );
  }

  if (hasPrefix(buffer, [0xff, 0xd8, 0xff])) {
    const dimensions = jpegDimensions(buffer);
    return withDimensions(
      { contentType: "image/jpeg", format: "jpeg" },
      dimensions.width,
      dimensions.height,
    );
  }

  if (hasAscii(buffer, 0, "GIF87a") || hasAscii(buffer, 0, "GIF89a")) {
    if (buffer.length < 10) return undefined;
    return withDimensions(
      { contentType: "image/gif", format: "gif" },
      buffer.readUInt16LE(6),
      buffer.readUInt16LE(8),
    );
  }

  if (
    buffer.length >= 16 &&
    hasAscii(buffer, 0, "RIFF") &&
    hasAscii(buffer, 8, "WEBP")
  ) {
    const dimensions = webpDimensions(buffer);
    return withDimensions(
      { contentType: "image/webp", format: "webp" },
      dimensions.width,
      dimensions.height,
    );
  }

  if (hasAscii(buffer, 0, "BM") && buffer.length >= 26) {
    return withDimensions(
      { contentType: "image/bmp", format: "bmp" },
      buffer.readInt32LE(18),
      Math.abs(buffer.readInt32LE(22)),
    );
  }

  if (
    buffer.length >= 8 &&
    buffer.readUInt16LE(0) === 0 &&
    buffer.readUInt16LE(2) === 1 &&
    buffer.readUInt16LE(4) > 0
  ) {
    const width = buffer[6] === 0 ? 256 : buffer[6];
    const height = buffer[7] === 0 ? 256 : buffer[7];
    return withDimensions(
      { contentType: "image/x-icon", format: "ico" },
      width,
      height,
    );
  }

  return detectAvif(buffer);
}

export function assertRasterImage(buffer: Buffer): RasterImageInfo {
  const info = detectRasterImage(buffer);
  if (!info) {
    throw new Error("blob is not a supported safe raster image");
  }
  return info;
}
