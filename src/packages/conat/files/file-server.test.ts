import { server } from "./file-server";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID = "22222222-2222-4222-8222-222222222222";

describe("file-server management service", () => {
  let implementation: Record<string, (...args: any[]) => Promise<any>>;
  let mount: jest.Mock;
  let clone: jest.Mock;
  let cp: jest.Mock;

  beforeEach(async () => {
    mount = jest.fn(async () => ({ path: "/project" }));
    clone = jest.fn(async () => undefined);
    cp = jest.fn(async () => undefined);
    const client = {
      service: jest.fn(async (_subject, impl) => {
        implementation = impl;
        return { close: jest.fn() };
      }),
    };
    await server({ client, mount, clone, cp } as any);
  });

  it("allows a request whose project matches the routed subject", async () => {
    await expect(
      implementation.mount.call(
        { subject: `file-server.${PROJECT_ID}` },
        { project_id: PROJECT_ID },
      ),
    ).resolves.toEqual({ path: "/project" });
    expect(mount).toHaveBeenCalledWith({ project_id: PROJECT_ID });
  });

  it("rejects a request whose project differs from the routed subject", async () => {
    await expect(
      implementation.mount.call(
        { subject: `file-server.${PROJECT_ID}` },
        { project_id: OTHER_PROJECT_ID },
      ),
    ).rejects.toMatchObject({ code: 403 });
    expect(mount).not.toHaveBeenCalled();
  });

  it("rejects a project-bound request that omits its project", async () => {
    await expect(
      implementation.mount.call({ subject: `file-server.${PROJECT_ID}` }, {}),
    ).rejects.toMatchObject({ code: 403 });
    expect(mount).not.toHaveBeenCalled();
  });

  it("binds cross-project clone and copy to their source project", async () => {
    await expect(
      implementation.clone.call(
        { subject: `file-server.${PROJECT_ID}` },
        { project_id: OTHER_PROJECT_ID, src_project_id: PROJECT_ID },
      ),
    ).resolves.toBeUndefined();
    await expect(
      implementation.cp.call(
        { subject: `file-server.${PROJECT_ID}` },
        {
          src: { project_id: OTHER_PROJECT_ID, path: "src" },
          dest: { project_id: PROJECT_ID, path: "dest" },
        },
      ),
    ).rejects.toMatchObject({ code: 403 });
    expect(clone).toHaveBeenCalled();
    expect(cp).not.toHaveBeenCalled();
  });

  it("retains the trusted host-local unbound subject", async () => {
    await expect(
      implementation.mount.call(
        { subject: "file-server.api" },
        { project_id: OTHER_PROJECT_ID },
      ),
    ).resolves.toEqual({ path: "/project" });
  });
});
