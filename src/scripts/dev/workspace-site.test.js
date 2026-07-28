const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  allocatePortPair,
  appSpec,
  applyConnectionOverrides,
  attachLocalSiteToOuterProject,
  assertProjectScopedAuthFresh,
  browserUrl,
  environmentExports,
  extractBootstrapRegistrationUrl,
  initSite,
  isInternalControlPlaneUrl,
  launchpadEnvironment,
  localBootstrapRegistrationUrl,
  normalizeProjectId,
  normalizeSiteName,
  ordinaryAppUrl,
  parseArgs,
  parseCliJson,
  readConfig,
  rebaseBootstrapRegistrationUrl,
  selectProfileForAmbientAccount,
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

test("internal project-host API URLs are not used for account CLI operations", () => {
  assert.equal(
    isInternalControlPlaneUrl("http://alpha.c.projecthosts.internal:9102"),
    true,
  );
  assert.equal(isInternalControlPlaneUrl("https://staging.cocalc.ai"), false);
});

test("ambient account selects a unique matching CLI profile", () => {
  const profiles = [
    { profile: "_env", account_id: "account-a" },
    { profile: "alpha", account_id: "account-a" },
    { profile: "staging", account_id: "account-b" },
  ];
  assert.equal(selectProfileForAmbientAccount(profiles, "account-a"), "alpha");
  assert.equal(
    selectProfileForAmbientAccount(
      [...profiles, { profile: "alpha-debug", account_id: "account-a" }],
      "account-a",
    ),
    undefined,
  );
  assert.equal(selectProfileForAmbientAccount(profiles, "missing"), undefined);
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

test("local initialization retains ambient outer project for private proxying", async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cocalc-workspace-sites-"),
  );
  const projectId = "12345678-1234-4123-8123-123456789abc";
  const priorProjectId = process.env.COCALC_PROJECT_ID;
  process.env.COCALC_PROJECT_ID = projectId;
  try {
    const initialized = await initSite({
      name: "local-proxied",
      sites_root: root,
      local: true,
    });
    assert.equal(initialized.config.supervisor, "local");
    assert.equal(initialized.config.outer_project_id, projectId);
    const spec = appSpec(initialized.config);
    assert.equal(spec.lifecycle.mode, "unmanaged");
    assert.equal(spec.network.port, initialized.config.base_port);
    assert.equal(spec.wake.enabled, false);
  } finally {
    if (priorProjectId == null) delete process.env.COCALC_PROJECT_ID;
    else process.env.COCALC_PROJECT_ID = priorProjectId;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("hostname reservation can attach an existing local-only site in place", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cocalc-workspace-attach-"),
  );
  const config = {
    version: 1,
    name: "local-main",
    updated_at: new Date(0).toISOString(),
    site_dir: path.join(root, "local-main"),
    app_spec_path: path.join(root, "local-main", "app-spec.json"),
    src_dir: "/checkout/src",
    sites_root: root,
    app_id: "cocalc-dev-local-main",
    node_bin: process.execPath,
    base_port: 14_000,
    supervisor: "local",
    outer_project_id: null,
    api_url: "http://old.internal",
    site_url: null,
    profile: null,
  };
  try {
    const attached = attachLocalSiteToOuterProject(
      config,
      {},
      {
        COCALC_PROJECT_ID: "12345678-1234-4123-8123-123456789abc",
        COCALC_API_URL: "https://staging.cocalc.ai",
      },
    );
    assert.equal(attached, true);
    assert.equal(config.supervisor, "local");
    assert.equal(
      config.outer_project_id,
      "12345678-1234-4123-8123-123456789abc",
    );
    assert.equal(config.api_url, "https://staging.cocalc.ai");
    assert.equal(
      JSON.parse(fs.readFileSync(config.app_spec_path, "utf8")).lifecycle.mode,
      "unmanaged",
    );
    assert.equal(
      readConfig(root, "local-main").outer_project_id,
      config.outer_project_id,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("attaching a local site requires an explicit or ambient outer project", () => {
  assert.throws(
    () =>
      attachLocalSiteToOuterProject(
        {
          name: "local-main",
          supervisor: "local",
          outer_project_id: null,
        },
        {},
        {},
      ),
    /rerun with --project/,
  );
});

test("connection options update an existing site without reinitialization", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cocalc-workspace-connection-"),
  );
  const config = {
    version: 1,
    name: "local-main",
    updated_at: new Date(0).toISOString(),
    sites_root: root,
    site_dir: path.join(root, "local-main"),
    app_spec_path: path.join(root, "local-main", "app-spec.json"),
    src_dir: "/checkout/src",
    app_id: "cocalc-dev-local-main",
    node_bin: process.execPath,
    base_port: 14_000,
    supervisor: "local",
    profile: null,
    api_url: "http://alpha.c.projecthosts.internal:9102",
    site_url: null,
  };
  try {
    assert.equal(
      applyConnectionOverrides(config, {
        profile: "staging",
        site_url: "https://staging.cocalc.ai",
      }),
      true,
    );
    assert.equal(config.profile, "staging");
    assert.equal(config.site_url, "https://staging.cocalc.ai");
    assert.equal(readConfig(root, "local-main").profile, "staging");
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
    assert.equal(env.CONAT_CLUSTER_PORT, "14002");
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

test("bootstrap registration URLs are extracted and rebased for each access mode", () => {
  const logged =
    "Started HUB! http://127.0.0.1:14000/auth/sign-up?registrationToken=secret-token&bootstrap=1";
  const extracted = extractBootstrapRegistrationUrl("noise", logged);
  assert.equal(
    extracted,
    "http://127.0.0.1:14000/auth/sign-up?registrationToken=secret-token&bootstrap=1",
  );

  const config = {
    app_id: "cocalc-dev-feature-a",
    outer_project_id: "12345678-1234-4123-8123-123456789abc",
    site_url: "https://cocalc.ai",
    base_port: 14_000,
  };
  assert.equal(
    rebaseBootstrapRegistrationUrl(config, extracted),
    "https://cocalc.ai/12345678-1234-4123-8123-123456789abc/apps/cocalc-dev-feature-a/auth/sign-up?registrationToken=secret-token&bootstrap=1",
  );
  assert.equal(
    rebaseBootstrapRegistrationUrl(
      { ...config, private_url: "https://dev-example.cocalc.ai/" },
      extracted,
    ),
    "https://dev-example.cocalc.ai/auth/sign-up?registrationToken=secret-token&bootstrap=1",
  );
  assert.equal(
    browserUrl({
      app_id: "cocalc-dev-feature-a",
      outer_project_id: null,
      base_port: 14_000,
    }),
    "http://127.0.0.1:14000/",
  );
});

test("local bootstrap registration ignores tokens from earlier process runs", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cocalc-workspace-bootstrap-"),
  );
  const stdoutLog = path.join(root, "launchpad.log");
  const old =
    "http://127.0.0.1:14000/auth/sign-up?registrationToken=old&bootstrap=1\n";
  try {
    fs.writeFileSync(stdoutLog, `${old}new startup without a token\n`);
    assert.equal(
      localBootstrapRegistrationUrl({
        stdout_log: stdoutLog,
        local_log_start_bytes: Buffer.byteLength(old),
        base_port: 14_000,
        outer_project_id: null,
      }),
      null,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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
