import {
  DEFAULT_PROJECT_RUNTIME_HOME,
  PROJECT_RUNTIME_CAPABILITY_KEYS,
  isProjectRuntimeHomeAliasPath,
  projectRuntimeCapabilityError,
  projectRuntimeConfiguration,
  projectRuntimeHomeRelativePath,
  projectRuntimePathForClient,
  projectRuntimePathForProcess,
  projectRuntimeRootfsContractLabels,
  rootfsLabelsSatisfyCurrentProjectRuntimeContract,
} from "./project-runtime";

describe("project runtime home helpers", () => {
  it("maps the canonical runtime home to a relative path", () => {
    expect(projectRuntimeHomeRelativePath(DEFAULT_PROJECT_RUNTIME_HOME)).toBe(
      "",
    );
    expect(
      projectRuntimeHomeRelativePath(
        `${DEFAULT_PROJECT_RUNTIME_HOME}/work/file.txt`,
      ),
    ).toBe("work/file.txt");
  });

  it("normalizes path segments before checking runtime-home aliases", () => {
    expect(
      projectRuntimeHomeRelativePath("/home/user/projects/../demo/main.ts"),
    ).toBe("demo/main.ts");
  });

  it("does not treat unrelated absolute paths as runtime-home aliases", () => {
    expect(projectRuntimeHomeRelativePath("/root/work/file.txt")).toBe(
      "work/file.txt",
    );
    expect(isProjectRuntimeHomeAliasPath("/root/work/file.txt")).toBe(true);
    expect(isProjectRuntimeHomeAliasPath("/root")).toBe(true);
    expect(
      projectRuntimeHomeRelativePath("/opt/work/file.txt"),
    ).toBeUndefined();
    expect(projectRuntimeHomeRelativePath("/etc/passwd")).toBeUndefined();
    expect(isProjectRuntimeHomeAliasPath("/scratch/data.txt")).toBe(false);
  });

  it("maps canonical client paths to a workspace process home", () => {
    const env = {
      COCALC_RUNTIME_HOME: "/home/user",
      HOME: "/srv/workspaces/project-id",
    };
    expect(projectRuntimePathForProcess("/home/user", env)).toBe(
      "/srv/workspaces/project-id",
    );
    expect(projectRuntimePathForProcess("/home/user/src/index.ts", env)).toBe(
      "/srv/workspaces/project-id/src/index.ts",
    );
    expect(projectRuntimePathForProcess("src/index.ts", env)).toBe(
      "src/index.ts",
    );
  });

  it("maps canonical client paths to and from a native Windows workspace", () => {
    const env = {
      COCALC_RUNTIME_HOME: "/home/user",
      HOME: "C:\\Users\\Ada\\CoCalc",
    };
    expect(projectRuntimePathForProcess("/home/user", env)).toBe(
      "C:\\Users\\Ada\\CoCalc",
    );
    expect(projectRuntimePathForProcess("/home/user/src/index.ts", env)).toBe(
      "C:\\Users\\Ada\\CoCalc\\src\\index.ts",
    );
    expect(
      projectRuntimePathForClient("C:\\Users\\Ada\\CoCalc\\src\\index.ts", env),
    ).toBe("/home/user/src/index.ts");
    expect(
      projectRuntimePathForClient("C:\\Windows\\System32\\cmd.exe", env),
    ).toBe("C:\\Windows\\System32\\cmd.exe");
  });

  it("does not map paths outside the configured runtime home", () => {
    const env = {
      COCALC_RUNTIME_HOME: "/home/user",
      HOME: "/srv/workspaces/project-id",
    };
    expect(projectRuntimePathForProcess("/home/user2/file", env)).toBe(
      "/home/user2/file",
    );
    expect(projectRuntimePathForProcess("/home/user/../shared", env)).toBe(
      "/home/user/../shared",
    );
    expect(projectRuntimePathForProcess("/tmp/file", env)).toBe("/tmp/file");
  });

  it("exposes stable RootFS runtime-contract labels", () => {
    const labels = projectRuntimeRootfsContractLabels();
    expect(labels).toMatchObject({
      "com.cocalc.rootfs.runtime_model": "launchpad-root-start-v1",
      "com.cocalc.rootfs.runtime_userns": "podman-keep-id-v1",
      "com.cocalc.rootfs.runtime_user": "user",
      "com.cocalc.rootfs.runtime_uid": "2001",
      "com.cocalc.rootfs.runtime_gid": "2001",
      "com.cocalc.rootfs.runtime_home": "/home/user",
      "com.cocalc.rootfs.runtime_bootstrap": "sudo,ca-certificates,libatomic1",
    });
    expect(rootfsLabelsSatisfyCurrentProjectRuntimeContract(labels)).toBe(true);
  });

  it("rejects incomplete or stale RootFS runtime-contract labels", () => {
    expect(rootfsLabelsSatisfyCurrentProjectRuntimeContract({})).toBe(false);
    expect(
      rootfsLabelsSatisfyCurrentProjectRuntimeContract({
        ...projectRuntimeRootfsContractLabels(),
        "com.cocalc.rootfs.runtime_uid": "1000",
      }),
    ).toBe(false);
  });
});

describe("project runtime capabilities", () => {
  it.each(["external", "podman"] as const)(
    "keeps every project-host feature enabled for %s",
    (mode) => {
      const runtime = projectRuntimeConfiguration(mode);
      expect(runtime.mode).toBe(mode);
      expect(runtime.trusted).toBe(false);
      for (const capability of PROJECT_RUNTIME_CAPABILITY_KEYS) {
        expect(runtime[capability]).toBe(true);
      }
    },
  );

  it("makes trusted workspace limitations explicit", () => {
    const runtime = projectRuntimeConfiguration("workspace");
    expect(runtime).toMatchObject({
      mode: "workspace",
      isolation: "trusted-workspace",
      trusted: true,
      label: "Trusted workspace",
    });
    for (const capability of PROJECT_RUNTIME_CAPABILITY_KEYS) {
      expect(runtime[capability]).toBe(false);
    }
    expect(projectRuntimeCapabilityError(runtime, "host_placement")).toBe(
      "host placement is unsupported by the trusted workspace runtime (workspace)",
    );
  });
});
