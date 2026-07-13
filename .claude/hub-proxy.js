/*
Tiny HTTP + WebSocket proxy fronting the local dev hub (port 9100) on a
port the Claude Code browser pane can manage. Referenced by
.claude/launch.json ("hub-proxy") so agent sessions can open the hub via
preview_start even though the hub itself is a long-running process that
developers start separately (see `pnpm dev:hub:env` in src/).

The hub port 9100 is the repo-standard loopback hub port; PORT is set by
the launcher (autoPort) and falls back to 9199.
*/

const http = require("http");
const net = require("net");

const HUB_PORT = 9100;
const port = process.env.PORT || 9199;

const server = http.createServer((req, res) => {
  const p = http.request(
    {
      host: "127.0.0.1",
      port: HUB_PORT,
      path: req.url,
      method: req.method,
      headers: req.headers,
    },
    (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    },
  );
  req.pipe(p);
  p.on("error", () => {
    res.statusCode = 502;
    res.end("proxy error");
  });
});

server.on("upgrade", (req, sock, head) => {
  const up = net.connect(HUB_PORT, "127.0.0.1", () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    }
    up.write(lines.join("\r\n") + "\r\n\r\n");
    if (head && head.length) {
      up.write(head);
    }
    sock.pipe(up);
    up.pipe(sock);
  });
  up.on("error", () => sock.destroy());
  sock.on("error", () => up.destroy());
});

server.listen(port, () =>
  console.log(`proxying :${port} -> :${HUB_PORT} (with websocket upgrade)`),
);
