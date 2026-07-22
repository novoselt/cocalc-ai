#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

process.env.COCALC_BAY_FRONTDOOR_UNHEALTHY_THRESHOLD = "3";
process.env.COCALC_BAY_PUBLIC_INGRESS_MODE = "cloudflare-proxy";

const {
  formatHealthError,
  proxyRequestHeaders,
  recordWorkerHealth,
  serializeProxyRequest,
} = require("./bay-frontdoor.js");

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
