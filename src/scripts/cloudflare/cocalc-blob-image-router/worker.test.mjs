/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import assert from "node:assert/strict";
import test from "node:test";

import { handleRequest } from "./worker.mjs";

const UUID = "12345678-1234-1234-1234-123456789abc";

function envForObject(object) {
  return {
    BLOBS: {
      async get(key) {
        assert.equal(key, "blobs/v1/12/12345678-1234-1234-1234-123456789abc");
        return object;
      },
    },
  };
}

function imageObject(body = "image-bytes") {
  return {
    body,
    customMetadata: { "cocalc-media-type": "image/png" },
    writeHttpMetadata(headers) {
      headers.set("content-type", "image/png");
    },
  };
}

test("serves canonical uuid path from deterministic R2 key", async () => {
  const response = await handleRequest(
    new Request(`https://blobs.example.com/${UUID}`),
    envForObject(imageObject()),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("etag"), `"${UUID}"`);
  assert.equal(await response.text(), "image-bytes");
});

test("supports HEAD and conditional requests", async () => {
  const head = await handleRequest(
    new Request(`https://blobs.example.com/${UUID}`, { method: "HEAD" }),
    envForObject(imageObject()),
  );
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");

  const cached = await handleRequest(
    new Request(`https://blobs.example.com/${UUID}`, {
      headers: { "if-none-match": `"${UUID}"` },
    }),
    envForObject(null),
  );
  assert.equal(cached.status, 304);
});

test("supports legacy query shape", async () => {
  const response = await handleRequest(
    new Request(`https://cocalc.ai/blobs/paste.png?uuid=${UUID}`),
    envForObject(imageObject()),
  );
  assert.equal(response.status, 200);
});

test("rejects invalid ids, missing objects, and non-images", async () => {
  const invalid = await handleRequest(
    new Request("https://blobs.example.com/not-a-uuid"),
    envForObject(imageObject()),
  );
  assert.equal(invalid.status, 404);

  const missing = await handleRequest(
    new Request(`https://blobs.example.com/${UUID}`),
    envForObject(null),
  );
  assert.equal(missing.status, 404);

  const nonImage = await handleRequest(
    new Request(`https://blobs.example.com/${UUID}`),
    envForObject({
      body: "html",
      customMetadata: { "cocalc-media-type": "text/html" },
    }),
  );
  assert.equal(nonImage.status, 404);
});

test("rejects unsupported methods", async () => {
  const response = await handleRequest(
    new Request(`https://blobs.example.com/${UUID}`, { method: "POST" }),
    envForObject(imageObject()),
  );
  assert.equal(response.status, 405);
});
