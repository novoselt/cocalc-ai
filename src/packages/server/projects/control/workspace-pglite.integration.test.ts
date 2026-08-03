export {};

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const BAY_ID = "22222222-2222-4222-8222-222222222222";

const runnerStart = jest.fn(async () => ({ state: "running" }));

jest.mock("@cocalc/conat/project/runner/run", () => ({
  __esModule: true,
  client: jest.fn(() => ({
    start: runnerStart,
    status: jest.fn(async () => ({ state: "running" })),
    stop: jest.fn(async () => ({ state: "opened" })),
  })),
}));

jest.mock("@cocalc/backend/conat", () => ({
  __esModule: true,
  conat: jest.fn(() => ({})),
}));

jest.mock("@cocalc/server/project-host/control", () => ({
  __esModule: true,
  startProjectOnHost: jest.fn(() => {
    throw new Error("workspace spike must not assign a project host");
  }),
  stopProjectOnHost: jest.fn(),
  updateProjectRunQuotaOnHost: jest.fn(),
}));

jest.mock("@cocalc/backend/logger", () => ({
  __esModule: true,
  default: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
  getLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

const describePglite =
  process.env.COCALC_TEST_USE_PGLITE === "1" ? describe : describe.skip;

describePglite("Launchpad workspace control with PGlite", () => {
  const originalEnv = {
    COCALC_BAY_ID: process.env.COCALC_BAY_ID,
    COCALC_DB: process.env.COCALC_DB,
    COCALC_PGLITE_DATA_DIR: process.env.COCALC_PGLITE_DATA_DIR,
    COCALC_PRODUCT: process.env.COCALC_PRODUCT,
    COCALC_PROJECT_RUNTIME: process.env.COCALC_PROJECT_RUNTIME,
  };

  beforeAll(async () => {
    process.env.COCALC_BAY_ID = BAY_ID;
    process.env.COCALC_DB = "pglite";
    process.env.COCALC_PGLITE_DATA_DIR = "memory://";
    process.env.COCALC_PRODUCT = "launchpad";
    process.env.COCALC_PROJECT_RUNTIME = "workspace";
    const getPool = (await import("@cocalc/database/pool")).default;
    const pool = getPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS projects (
        project_id UUID PRIMARY KEY,
        owning_bay_id UUID,
        host_id UUID
      )
    `);
    await pool.query(
      `
        INSERT INTO projects (project_id, owning_bay_id, host_id)
        VALUES ($1, $2, NULL)
        ON CONFLICT (project_id) DO UPDATE
        SET owning_bay_id=EXCLUDED.owning_bay_id, host_id=NULL
      `,
      [PROJECT_ID, BAY_ID],
    );
  });

  afterAll(async () => {
    const { closePglite } = await import("@cocalc/database/pglite");
    await closePglite();
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value == null) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  it("starts a hostless project through the injected runner", async () => {
    const { getProject } = await import("./base");
    await expect(getProject(PROJECT_ID).start()).resolves.toBeUndefined();
    expect(runnerStart).toHaveBeenCalledWith({ project_id: PROJECT_ID });

    const getPool = (await import("@cocalc/database/pool")).default;
    const { rows } = await getPool().query(
      "SELECT host_id FROM projects WHERE project_id=$1",
      [PROJECT_ID],
    );
    expect(rows).toEqual([{ host_id: null }]);
  });
});
