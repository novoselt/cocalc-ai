import { getJupyterDataDirs, userDataDir } from "./kernelspecs";

describe("Python-free Jupyter data path discovery", () => {
  it("matches legacy and platformdirs user locations", () => {
    expect(userDataDir({ platform: "linux", home: "/home/ada", env: {} })).toBe(
      "/home/ada/.local/share/jupyter",
    );
    expect(
      userDataDir({
        platform: "linux",
        home: "/home/ada",
        env: { XDG_DATA_HOME: "/data/ada" },
      }),
    ).toBe("/data/ada/jupyter");
    expect(
      userDataDir({ platform: "darwin", home: "/Users/ada", env: {} }),
    ).toBe("/Users/ada/Library/Jupyter");
    expect(
      userDataDir({
        platform: "darwin",
        home: "/Users/ada",
        env: { JUPYTER_PLATFORM_DIRS: "1" },
      }),
    ).toBe("/Users/ada/Library/Application Support/jupyter");
    expect(
      userDataDir({
        platform: "win32",
        home: "C:\\Users\\Ada",
        env: { APPDATA: "C:\\Users\\Ada\\AppData\\Roaming" },
      }),
    ).toBe("C:\\Users\\Ada\\AppData\\Roaming\\jupyter");
    expect(
      userDataDir({
        platform: "win32",
        home: "C:\\Users\\Ada",
        env: {
          JUPYTER_PLATFORM_DIRS: "yes",
          LOCALAPPDATA: "C:\\Users\\Ada\\AppData\\Local",
        },
      }),
    ).toBe("C:\\Users\\Ada\\AppData\\Local\\jupyter");
  });

  it("honors explicit Jupyter, environment, and user path precedence", () => {
    expect(
      getJupyterDataDirs({
        platform: "linux",
        home: "/home/ada",
        env: {
          JUPYTER_PATH: "/explicit/one:/explicit/two",
          CONDA_PREFIX: "/opt/conda/envs/math",
          CONDA_DEFAULT_ENV: "math",
        },
      }),
    ).toEqual([
      "/explicit/one",
      "/explicit/two",
      "/opt/conda/envs/math/share/jupyter",
      "/home/ada/.local/share/jupyter",
      "/usr/local/share/jupyter",
      "/usr/share/jupyter",
    ]);
    expect(
      getJupyterDataDirs({
        platform: "linux",
        home: "/home/ada",
        env: {
          JUPYTER_PREFER_ENV_PATH: "0",
          VIRTUAL_ENV: "/opt/venv",
        },
      }).slice(0, 2),
    ).toEqual(["/home/ada/.local/share/jupyter", "/opt/venv/share/jupyter"]);
  });

  it("uses PROGRAMDATA on Windows only when Jupyter requests it", () => {
    const base = {
      platform: "win32" as const,
      home: "C:\\Users\\Ada",
    };
    expect(
      getJupyterDataDirs({
        ...base,
        env: {
          APPDATA: "C:\\Users\\Ada\\AppData\\Roaming",
          PROGRAMDATA: "C:\\ProgramData",
        },
      }),
    ).not.toContain("C:\\ProgramData\\jupyter");
    expect(
      getJupyterDataDirs({
        ...base,
        env: {
          APPDATA: "C:\\Users\\Ada\\AppData\\Roaming",
          PROGRAMDATA: "C:\\ProgramData",
          JUPYTER_USE_PROGRAMDATA: "1",
        },
      }),
    ).toContain("C:\\ProgramData\\jupyter");
  });
});
