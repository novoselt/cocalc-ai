#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

process.env.COCALC_BAY_FRONTDOOR_UNHEALTHY_THRESHOLD = "3";
process.env.COCALC_BAY_PUBLIC_INGRESS_MODE = "cloudflare-proxy";

const {
  formatHealthError,
  isContentAddressedStaticRequest,
  isImmutableStaticStatus,
  prepareResponseHeaders,
  proxyRequestHeaders,
  recordWorkerHealth,
  serializeProxyRequest,
} = require("./bay-frontdoor.js");

test("recognizes content-addressed static assets only", () => {
  assert.equal(
    isContentAddressedStaticRequest({
      url: "/static/app-6e50741dfe558fe6.js",
    }),
    true,
  );
  assert.equal(
    isContentAddressedStaticRequest({
      url: "/base/static/7386645f80d6d0a6.wasm?cache=1",
    }),
    true,
  );
  assert.equal(
    isContentAddressedStaticRequest({ url: "/static/app.html" }),
    false,
  );
  assert.equal(
    isContentAddressedStaticRequest({ url: "/api/static/report-deadbeef" }),
    false,
  );
});

test("does not poison immutable static assets with the affinity cookie", () => {
  const headers = prepareResponseHeaders(
    { url: "/static/app-6e50741dfe558fe6.js" },
    {
      "cache-control": "public, max-age=864000, must-revalidate",
      etag: 'W/"asset"',
    },
    { id: 2 },
    true,
    200,
  );
  assert.equal(headers["set-cookie"], undefined);
  assert.equal(headers["cache-control"], "public, max-age=31536000, immutable");
  assert.equal(headers.etag, 'W/"asset"');
});

test("keeps the immutable policy on hashed asset revalidations", () => {
  const headers = prepareResponseHeaders(
    { url: "/static/app-6e50741dfe558fe6.js" },
    { etag: 'W/"asset"' },
    { id: 2 },
    true,
    304,
  );
  assert.equal(headers["cache-control"], "public, max-age=31536000, immutable");
});

test("never pins a failed hashed asset response", () => {
  for (const statusCode of [404, 500, 502, 503]) {
    const headers = prepareResponseHeaders(
      { url: "/static/app-6e50741dfe558fe6.js" },
      { "content-type": "text/plain; charset=utf-8" },
      { id: 2 },
      true,
      statusCode,
    );
    assert.equal(headers["cache-control"], "no-store", `status ${statusCode}`);
    assert.equal(headers["set-cookie"], undefined, `status ${statusCode}`);
  }
});

test("classifies which statuses may be pinned immutably", () => {
  assert.equal(isImmutableStaticStatus(200), true);
  assert.equal(isImmutableStaticStatus(203), true);
  assert.equal(isImmutableStaticStatus(304), true);
  assert.equal(isImmutableStaticStatus(206), false);
  assert.equal(isImmutableStaticStatus(302), false);
  assert.equal(isImmutableStaticStatus(404), false);
  assert.equal(isImmutableStaticStatus(502), false);
  assert.equal(isImmutableStaticStatus(undefined), false);
});

test("keeps affinity on mutable shells and dynamic responses", () => {
  const worker = { id: 2 };
  for (const url of ["/static/app.html", "/api/v2/projects"]) {
    const headers = prepareResponseHeaders(
      { url },
      { "cache-control": "no-store" },
      worker,
      true,
    );
    assert.match(
      headers["set-cookie"],
      /^cocalc_bay_frontdoor_worker=2(?:\.|;)/,
    );
  }
});

test("includes a normalized readiness body in health errors", () => {
  assert.equal(
    formatHealthError(503, " conat routing\n round trip failed: timeout "),
    "health status 503: conat routing round trip failed: timeout",
  );
  assert.equal(formatHealthError(503, ""), "health status 503");
});

test("replaces untrusted forwarding headers on a direct proxied route", () => {
  const req = {
    headers: {
      host: "staging.cocalc.ai",
      "cf-connecting-ip": "203.0.113.17",
      "x-forwarded-for": "192.0.2.1, 192.0.2.2",
      "x-forwarded-proto": "http",
      "x-real-ip": "192.0.2.3",
      forwarded: "for=192.0.2.4;proto=http",
    },
    socket: { remoteAddress: "130.211.0.10" },
  };
  const headers = proxyRequestHeaders(req, { id: 3 });
  assert.equal(headers["x-forwarded-for"], "203.0.113.17");
  assert.equal(headers["x-forwarded-proto"], "https");
  assert.equal(headers["x-forwarded-host"], "staging.cocalc.ai");
  assert.equal(headers["x-cocalc-bay-frontdoor-worker"], "3");
  assert.equal(headers["x-real-ip"], undefined);
  assert.equal(headers.forwarded, undefined);
});

test("falls back to the load balancer peer when Cloudflare sends no client IP", () => {
  const headers = proxyRequestHeaders(
    {
      headers: { host: "staging.cocalc.ai" },
      socket: { remoteAddress: "::ffff:35.191.4.9" },
    },
    { id: 1 },
  );
  assert.equal(headers["x-forwarded-for"], "35.191.4.9");
});

test("serializes normalized WebSocket upgrade headers", () => {
  const request = serializeProxyRequest(
    {
      method: "GET",
      url: "/socket.io/?transport=websocket",
      httpVersion: "1.1",
    },
    {
      host: "staging.cocalc.ai",
      upgrade: "websocket",
      "x-forwarded-for": "203.0.113.17",
      "set-cookie": ["a=1", "b=2"],
    },
  );
  assert.match(
    request,
    /^GET \/socket\.io\/\?transport=websocket HTTP\/1\.1\r\n/,
  );
  assert.match(request, /x-forwarded-for: 203\.0\.113\.17\r\n/);
  assert.match(request, /set-cookie: a=1\r\nset-cookie: b=2\r\n/);
  assert.match(request, /\r\n\r\n$/);
});

class MockSocket extends EventEmitter {
  destroyed = false;

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit("close");
  }
}

test("evicts upgraded sockets only after repeated worker health failures", () => {
  const socket = new MockSocket();
  const upstream = new MockSocket();
  const connection = { socket, upstream };
  const worker = {
    id: 2,
    healthy: true,
    consecutiveFailures: 0,
    lastOk: Date.now(),
    lastError: "",
    upgrades: new Set([connection]),
  };
  socket.once("close", () => worker.upgrades.delete(connection));
  upstream.once("close", () => worker.upgrades.delete(connection));

  recordWorkerHealth(worker, false, "failure 1");
  recordWorkerHealth(worker, false, "failure 2");
  assert.equal(worker.healthy, true);
  assert.equal(socket.destroyed, false);
  assert.equal(upstream.destroyed, false);

  recordWorkerHealth(worker, false, "failure 3");
  assert.equal(worker.healthy, false);
  assert.equal(socket.destroyed, true);
  assert.equal(upstream.destroyed, true);
  assert.equal(worker.upgrades.size, 0);

  recordWorkerHealth(worker, true);
  assert.equal(worker.healthy, true);
  assert.equal(worker.consecutiveFailures, 0);
  assert.equal(worker.lastError, "");
});
