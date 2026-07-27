const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  allocatePortPair,
  appSpec,
  assertProjectScopedAuthFresh,
  environmentExports,
  initSite,
  launchpadEnvironment,
  normalizeProjectId,
  normalizeSiteName,
  ordinaryAppUrl,
  parseArgs,
  parseCliJson,
  readConfig,
} = require("./workspace-site.js");

test("workspace site names and outer project ids are strict", () => {
  assert.equal(normalizeSiteName("feature-a"), "feature-a");
  assert.throws(() => normalizeSiteName("Feature A"), /lowercase letter/);
  assert.equal(
    normalizeProjectId("12345678-1234-4123-8123-123456789abc"),
    "12345678-1234-4123-8123-123456789abc",
  );
  assert.throws(() => normalizeProjectId("project-one"), /invalid outer/);
});

test("argument parsing supports value, equals, and explicit action flags", () => {
  assert.deepEqual(
    parseArgs([
      "hostname",
      "--name=feature-a",
      "--sites-root",
      "/tmp/sites",
      "--site-url=https://dev.example.test",
      "--reserve",
      "--json",
    ]),
    {
      command: "hostname",
      opts: {
        name: "feature-a",
        sites_root: "/tmp/sites",
        site_url: "https://dev.example.test",
        reserve: true,
        json: true,
      },
    },
  );
});

test("port allocation rejects persisted collisions before checking sockets", async () => {
  let checks = 0;
  await assert.rejects(
    allocatePortPair({
      name: "feature-a",
      configuredPort: 14_000,
      configs: [{ base_port: 14_000, sshd_port: 14_001 }],
      check: async () => {
        checks += 1;
        return { ok: true };
      },
    }),
    /reserved by another workspace site/,
  );
  assert.equal(checks, 0);
});

test("named initialization creates isolated persistent layouts and app specs", async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cocalc-workspace-sites-"),
  );
  try {
    const first = await initSite({
      name: "feature-a",
      sites_root: root,
      local: true,
    });
    const second = await initSite({
      name: "feature-b",
      sites_root: root,
      local: true,
    });
    assert.equal(first.created, true);
    assert.equal(second.created, true);
    assert.notEqual(first.config.base_port, second.config.base_port);
    assert.notEqual(first.config.data_dir, second.config.data_dir);
    assert.equal(first.config.supervisor, "local");
    assert.ok(fs.existsSync(first.config.app_spec_path));

    const saved = readConfig(root, "feature-a");
    const spec = appSpec(saved);
    assert.equal(spec.id, "cocalc-dev-feature-a");
    assert.equal(spec.network.port, saved.base_port);
    assert.equal(spec.proxy.websocket, true);
    assert.deepEqual(spec.command.args.slice(1, 4), [
      "serve",
      "--name",
      "feature-a",
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("launchpad environment discards ambient project credentials", () => {
  const priorBearer = process.env.COCALC_BEARER_TOKEN;
  const priorConat = process.env.CONAT_SERVER;
  process.env.COCALC_BEARER_TOKEN = "secret";
  process.env.CONAT_SERVER = "wss://outer-project-host";
  try {
    const config = {
      data_dir: "/tmp/workspace-data",
      project_path: "/tmp/workspace-data/projects",
      runtime_state_dir: "/tmp/workspace-data/runtime",
      project_logs_dir: "/tmp/workspace-data/logs/projects",
      src_dir: "/checkout/src",
      node_bin: process.execPath,
      base_port: 14_000,
      sshd_port: 14_001,
    };
    const env = launchpadEnvironment(config);
    assert.equal(env.COCALC_BEARER_TOKEN, undefined);
    assert.equal(env.CONAT_SERVER, undefined);
    assert.equal(env.COCALC_PROJECT_RUNTIME, "workspace");
    assert.equal(env.COCALC_DATA_DIR, "/tmp/workspace-data");
    assert.equal(env.PORT, "14000");
  } finally {
    if (priorBearer == null) delete process.env.COCALC_BEARER_TOKEN;
    else process.env.COCALC_BEARER_TOKEN = priorBearer;
    if (priorConat == null) delete process.env.CONAT_SERVER;
    else process.env.CONAT_SERVER = priorConat;
  }
});

test("environment output contains no credentials", () => {
  const values = environmentExports({
    name: "feature-a",
    site_dir: "/sites/feature-a",
    data_dir: "/sites/feature-a/data",
    base_port: 14_000,
    app_id: "cocalc-dev-feature-a",
    private_url: null,
    api_url: "https://cocalc.ai",
    outer_project_id: "12345678-1234-4123-8123-123456789abc",
  });
  assert.equal(values.COCALC_WORKSPACE_SITE_PORT, "14000");
  assert.equal(
    values.COCALC_WORKSPACE_SITE_URL,
    "https://cocalc.ai/12345678-1234-4123-8123-123456789abc/apps/cocalc-dev-feature-a/",
  );
  assert.equal(values.COCALC_BEARER_TOKEN, undefined);
});

test("ordinary app URLs never expose an internal control-plane origin", () => {
  const config = {
    app_id: "cocalc-dev-feature-a",
    outer_project_id: "12345678-1234-4123-8123-123456789abc",
    api_url: "http://alpha.c.projecthosts.internal:9102",
  };
  assert.equal(ordinaryAppUrl(config), null);
  assert.equal(
    ordinaryAppUrl({ ...config, site_url: "https://cocalc.ai" }),
    "https://cocalc.ai/12345678-1234-4123-8123-123456789abc/apps/cocalc-dev-feature-a/",
  );
});

test("managed commands explain expired project-scoped authentication", () => {
  const expired = [
    Buffer.from("{}").toString("base64url"),
    Buffer.from(JSON.stringify({ exp: 100 })).toString("base64url"),
    "signature",
  ].join(".");
  assert.throws(
    () =>
      assertProjectScopedAuthFresh(
        {
          outer_project_id: "12345678-1234-4123-8123-123456789abc",
          profile: null,
        },
        { COCALC_BEARER_TOKEN: expired },
        101_000,
      ),
    /project token has expired/,
  );
  assert.doesNotThrow(() =>
    assertProjectScopedAuthFresh(
      {
        outer_project_id: "12345678-1234-4123-8123-123456789abc",
        profile: "staging",
      },
      { COCALC_BEARER_TOKEN: expired },
      101_000,
    ),
  );
});

test("CLI JSON parser rejects unsuccessful commands", () => {
  assert.deepEqual(parseCliJson('{"ok":true,"data":{"state":"running"}}\n'), {
    state: "running",
  });
  assert.throws(
    () => parseCliJson('{"ok":false,"error":{"message":"denied"}}\n'),
    /denied/,
  );
});
