/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import http from "node:http";
import { once } from "node:events";
import { connect } from "node:net";
import type { AddressInfo, Server } from "node:net";
import express from "express";
import { attachProjectProxy } from "./proxy";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

async function closeServer(server: Server | http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

describe("project proxy upstream boundary metering", () => {
  it("reports upstream HTTP response bytes", async () => {
    const payload = Buffer.from("hello over http");
    const upstream = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(payload);
    });
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    const upstreamPort = (upstream.address() as AddressInfo).port;

    const app = express();
    const server = http.createServer(app);
    const noteUpstreamHttpBytes = jest.fn();
    attachProjectProxy({
      httpServer: server,
      app,
      resolveTarget: async () => ({
        handled: true,
        target: { host: "127.0.0.1", port: upstreamPort },
      }),
      noteUpstreamHttpBytes,
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const proxyPort = (server.address() as AddressInfo).port;

    const body = await new Promise<Buffer>((resolve, reject) => {
      http
        .get(
          {
            host: "127.0.0.1",
            port: proxyPort,
            path: `/${PROJECT_ID}/port/9999/`,
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
            res.on("end", () => resolve(Buffer.concat(chunks)));
          },
        )
        .on("error", reject);
    });

    expect(body).toEqual(payload);
    expect(noteUpstreamHttpBytes).toHaveBeenCalledWith(
      expect.objectContaining({
        bytes: payload.length,
      }),
    );

    await closeServer(server);
    await closeServer(upstream);
  });

  it("reports upstream websocket bytes", async () => {
    const payload = Buffer.from("hello over websocket");
    const upstream = http.createServer();
    upstream.on("upgrade", (_req, socket) => {
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "\r\n",
      );
      socket.write(payload);
      socket.end();
    });
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    const upstreamPort = (upstream.address() as AddressInfo).port;

    const app = express();
    const server = http.createServer(app);
    const noteUpstreamWsBytes = jest.fn();
    attachProjectProxy({
      httpServer: server,
      app,
      resolveTarget: async () => ({
        handled: true,
        target: { host: "127.0.0.1", port: upstreamPort },
      }),
      noteUpstreamWsBytes,
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const proxyPort = (server.address() as AddressInfo).port;

    const client = connect({ host: "127.0.0.1", port: proxyPort });
    await once(client, "connect");
    const callbackDone = new Promise<void>((resolve) => {
      noteUpstreamWsBytes.mockImplementation(() => resolve());
    });
    client.write(
      `GET /${PROJECT_ID}/port/9999/ HTTP/1.1\r\n` +
        "Host: 127.0.0.1\r\n" +
        "Connection: Upgrade\r\n" +
        "Upgrade: websocket\r\n" +
        "Sec-WebSocket-Key: x3JJHMbDL1EzLkh9GBhXDw==\r\n" +
        "Sec-WebSocket-Version: 13\r\n" +
        "\r\n",
    );
    await once(client, "data");
    await callbackDone;
    client.destroy();
    await once(client, "close");

    expect(noteUpstreamWsBytes).toHaveBeenCalledWith(
      expect.objectContaining({
        bytes: payload.length,
      }),
    );

    await closeServer(server);
    await closeServer(upstream);
  });
});

describe("project proxy forwarded app redirects", () => {
  it("normalizes forwarded HTTPS host and port headers for upstream apps", async () => {
    const upstream = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          proto: req.headers["x-forwarded-proto"],
          host: req.headers["x-forwarded-host"],
          port: req.headers["x-forwarded-port"],
        }),
      );
    });
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    const upstreamPort = (upstream.address() as AddressInfo).port;

    const app = express();
    const server = http.createServer(app);
    attachProjectProxy({
      httpServer: server,
      app,
      resolveTarget: async () => ({
        handled: true,
        target: { host: "127.0.0.1", port: upstreamPort },
      }),
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const proxyPort = (server.address() as AddressInfo).port;

    const body = await new Promise<string>((resolve, reject) => {
      http
        .get(
          {
            host: "127.0.0.1",
            port: proxyPort,
            path: `/${PROJECT_ID}/proxy/6006/`,
            headers: {
              Host: "host-example.cocalc.ai:80",
              "X-Forwarded-Proto": "https",
              "X-Forwarded-Port": "80",
            },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
            res.on("end", () =>
              resolve(Buffer.concat(chunks).toString("utf8")),
            );
          },
        )
        .on("error", reject);
    });

    expect(JSON.parse(body)).toEqual({
      proto: "https",
      host: "host-example.cocalc.ai",
      port: "443",
    });

    await closeServer(server);
    await closeServer(upstream);
  });

  it("removes invalid https port 80 from upstream Location headers", async () => {
    const upstream = http.createServer((_req, res) => {
      res.writeHead(302, {
        Location:
          "https://host-example.cocalc.ai:80/11111111-1111-4111-8111-111111111111/proxy/6006/unsupported_browser.htm",
      });
      res.end("");
    });
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    const upstreamPort = (upstream.address() as AddressInfo).port;

    const app = express();
    const server = http.createServer(app);
    attachProjectProxy({
      httpServer: server,
      app,
      resolveTarget: async () => ({
        handled: true,
        target: { host: "127.0.0.1", port: upstreamPort },
      }),
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const proxyPort = (server.address() as AddressInfo).port;

    const location = await new Promise<string | undefined>(
      (resolve, reject) => {
        http
          .get(
            {
              host: "127.0.0.1",
              port: proxyPort,
              path: `/${PROJECT_ID}/proxy/6006/`,
            },
            (res) => {
              res.resume();
              res.on("end", () => resolve(res.headers.location));
            },
          )
          .on("error", reject);
      },
    );

    expect(location).toBe(
      "https://host-example.cocalc.ai/11111111-1111-4111-8111-111111111111/proxy/6006/unsupported_browser.htm",
    );

    await closeServer(server);
    await closeServer(upstream);
  });
});
