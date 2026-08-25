/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function blobKey(uuid) {
  return `blobs/v1/${uuid.replace(/-/g, "").slice(0, 2)}/${uuid}`;
}

function uuidFromRequest(url) {
  const path = url.pathname.replace(/^\/+|\/+$/g, "");
  const canonical = decodeURIComponent(path);
  if (UUID_RE.test(canonical)) {
    return canonical.toLowerCase();
  }
  const queryUuid = url.searchParams.get("uuid");
  if (url.pathname.startsWith("/blobs/") && UUID_RE.test(queryUuid ?? "")) {
    return queryUuid.toLowerCase();
  }
}

function textResponse(body, status, cacheControl = "no-store") {
  return new Response(body, {
    status,
    headers: {
      "Cache-Control": cacheControl,
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function etagMatches(request, uuid) {
  const header = request.headers.get("if-none-match");
  if (!header) return false;
  return header
    .split(",")
    .map((value) => value.trim().replace(/^W\//, "").replace(/^"|"$/g, ""))
    .includes(uuid);
}

function objectContentType(object, headers) {
  return (
    headers.get("content-type") ||
    object.customMetadata?.["cocalc-media-type"] ||
    "application/octet-stream"
  );
}

export async function handleRequest(request, env) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return textResponse("method not allowed", 405);
  }
  const url = new URL(request.url);
  const uuid = uuidFromRequest(url);
  if (!uuid) {
    return textResponse("invalid blob id", 404, "public, max-age=60");
  }
  if (etagMatches(request, uuid)) {
    return new Response(null, {
      status: 304,
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        ETag: `"${uuid}"`,
      },
    });
  }
  const object = await env.BLOBS.get(blobKey(uuid));
  if (object == null) {
    return textResponse("blob not found", 404, "public, max-age=60");
  }
  const headers = new Headers();
  object.writeHttpMetadata?.(headers);
  const contentType = objectContentType(object, headers);
  if (!contentType.startsWith("image/")) {
    return textResponse(
      "blob is not a public image",
      404,
      "public, max-age=60",
    );
  }
  headers.set("Content-Type", contentType);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("ETag", `"${uuid}"`);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-CoCalc-Blob-Storage", "r2");
  return new Response(request.method === "HEAD" ? null : object.body, {
    status: 200,
    headers,
  });
}

export default {
  fetch: handleRequest,
};
