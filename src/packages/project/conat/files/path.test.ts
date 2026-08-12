import { projectFilePath } from "./path";

describe("project file paths", () => {
  it("maps project-visible Windows paths into the workspace", () => {
    const options = {
      home: "C:\\Users\\Ada\\CoCalc",
      platform: "win32" as const,
    };
    expect(projectFilePath("notes\\todo.txt", options)).toBe(
      "C:\\Users\\Ada\\CoCalc\\notes\\todo.txt",
    );
    expect(projectFilePath("/home/user/notes/todo.txt", options)).toBe(
      "C:\\Users\\Ada\\CoCalc\\notes\\todo.txt",
    );
  });

  it("preserves native absolute Windows paths", () => {
    expect(
      projectFilePath("D:\\Shared\\file.txt", {
        home: "C:\\Users\\Ada\\CoCalc",
        platform: "win32",
      }),
    ).toBe("D:\\Shared\\file.txt");
  });

  it("retains Unix behavior", () => {
    expect(
      projectFilePath("notes/todo.txt", {
        home: "/home/user",
        platform: "linux",
      }),
    ).toBe("/home/user/notes/todo.txt");
  });
});
