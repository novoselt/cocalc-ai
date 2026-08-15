import { normalizeProjectPath, parseRoute, routeHash } from "./routes";

const projectId = "af027aca-e308-41c2-b528-a3e73de50996";

test("parses and serializes file routes", () => {
  const route = {
    kind: "file" as const,
    projectId,
    path: "/home/user/a b.ipynb",
  };
  expect(parseRoute(routeHash(route))).toEqual(route);
});

test("parses and serializes Codex routes", () => {
  const route = {
    kind: "chat" as const,
    projectId,
    chatPath: "/home/user/a.chat",
    threadId: "thread-1",
  };
  expect(parseRoute(routeHash(route))).toEqual(route);
});

test("keeps ultralite file paths inside the project home", () => {
  expect(normalizeProjectPath("/home/user/a/../b")).toBe("/home/user/b");
  expect(normalizeProjectPath("/home/user/../../etc/passwd")).toBe(
    "/home/user",
  );
  expect(normalizeProjectPath("/etc/passwd")).toBe("/home/user");
});

test("rejects malformed project hashes", () => {
  expect(parseRoute("#/project/not-a-project/files?path=/home/user")).toEqual({
    kind: "projects",
  });
});
