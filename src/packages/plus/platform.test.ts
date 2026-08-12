import { plusRuntimePaths } from "./platform";

describe("CoCalc Plus runtime paths", () => {
  it("uses dedicated Windows data and workspace directories", () => {
    const paths = plusRuntimePaths({
      platform: "win32",
      home: "C:\\Users\\Ada",
      env: {
        USERPROFILE: "C:\\Users\\Ada",
        LOCALAPPDATA: "C:\\Users\\Ada\\AppData\\Local",
      },
    });
    expect(paths).toEqual({
      root: "C:\\Users\\Ada\\AppData\\Local\\CoCalc\\Plus",
      data: "C:\\Users\\Ada\\AppData\\Local\\CoCalc\\Plus\\data",
      workspace: "C:\\Users\\Ada\\CoCalc",
    });
  });

  it("honors explicit Windows path overrides", () => {
    expect(
      plusRuntimePaths({
        platform: "win32",
        home: "ignored",
        env: {
          COCALC_PLUS_HOME: "D:\\Plus",
          COCALC_DATA_DIR: "D:\\PlusData",
          COCALC_PLUS_WORKSPACE: "D:\\Workspace",
        },
      }),
    ).toEqual({
      root: "D:\\Plus",
      data: "D:\\PlusData",
      workspace: "D:\\Workspace",
    });
  });
});
