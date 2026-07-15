#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

process.env.COCALC_BAY_FRONTDOOR_UNHEALTHY_THRESHOLD = "3";

const { formatHealthError, recordWorkerHealth } = require("./bay-frontdoor.js");

test("includes a normalized readiness body in health errors", () => {
  assert.equal(
    formatHealthError(503, " conat routing\n round trip failed: timeout "),
    "health status 503: conat routing round trip failed: timeout",
  );
  assert.equal(formatHealthError(503, ""), "health status 503");
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
