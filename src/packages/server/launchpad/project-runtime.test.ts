describe("Launchpad project runtime mode", () => {
  const originalProduct = process.env.COCALC_PRODUCT;
  const originalRuntime = process.env.COCALC_PROJECT_RUNTIME;

  async function loadMode({
    product,
    runtime,
  }: {
    product?: string;
    runtime?: string;
  }) {
    jest.resetModules();
    if (product == null) {
      delete process.env.COCALC_PRODUCT;
    } else {
      process.env.COCALC_PRODUCT = product;
    }
    if (runtime == null) {
      delete process.env.COCALC_PROJECT_RUNTIME;
    } else {
      process.env.COCALC_PROJECT_RUNTIME = runtime;
    }
    return await import("./project-runtime");
  }

  afterAll(() => {
    if (originalProduct == null) {
      delete process.env.COCALC_PRODUCT;
    } else {
      process.env.COCALC_PRODUCT = originalProduct;
    }
    if (originalRuntime == null) {
      delete process.env.COCALC_PROJECT_RUNTIME;
    } else {
      process.env.COCALC_PROJECT_RUNTIME = originalRuntime;
    }
  });

  it("keeps Launchpad external by default", async () => {
    const { getProjectRuntimeMode } = await loadMode({
      product: "launchpad",
    });
    expect(getProjectRuntimeMode()).toBe("external");
  });

  it("keeps non-Launchpad runtimes on Podman by default", async () => {
    const { getProjectRuntimeMode } = await loadMode({ product: "plus" });
    expect(getProjectRuntimeMode()).toBe("podman");
  });

  it("allows an explicit Launchpad workspace runtime", async () => {
    const {
      assertProjectRuntimeCapability,
      getProjectRuntimeConfiguration,
      getProjectRuntimeMode,
      isWorkspaceProjectRuntime,
    } = await loadMode({
      product: "launchpad",
      runtime: "workspace",
    });
    expect(getProjectRuntimeMode()).toBe("workspace");
    expect(isWorkspaceProjectRuntime()).toBe(true);
    expect(getProjectRuntimeConfiguration()).toMatchObject({
      mode: "workspace",
      isolation: "trusted-workspace",
      trusted: true,
      rootfs: false,
      host_placement: false,
      ssh: false,
    });
    expect(() => assertProjectRuntimeCapability("rootfs")).toThrow(
      "rootfs is unsupported by the trusted workspace runtime (workspace)",
    );
  });

  it("rejects nested Podman inside Launchpad", async () => {
    const { getProjectRuntimeMode } = await loadMode({
      product: "launchpad",
      runtime: "podman",
    });
    expect(() => getProjectRuntimeMode()).toThrow(
      "podman is not supported inside Launchpad",
    );
  });

  it("rejects workspace mode outside Launchpad", async () => {
    const { getProjectRuntimeMode } = await loadMode({
      product: "plus",
      runtime: "workspace",
    });
    expect(() => getProjectRuntimeMode()).toThrow(
      "workspace is only supported by Launchpad",
    );
  });

  it("rejects unknown values", async () => {
    const { getProjectRuntimeMode } = await loadMode({
      product: "launchpad",
      runtime: "container-ish",
    });
    expect(() => getProjectRuntimeMode()).toThrow(
      "expected external, workspace, or podman",
    );
  });
});
