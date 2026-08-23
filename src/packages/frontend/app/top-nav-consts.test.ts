import { shouldHideProjectsLabel } from "./top-nav-consts";

describe("top navigation labels", () => {
  it("hides the Projects label once four projects are open", () => {
    expect(shouldHideProjectsLabel(3, false, true)).toBe(false);
    expect(shouldHideProjectsLabel(4, false, true)).toBe(true);
    expect(shouldHideProjectsLabel(8, false, true)).toBe(true);
  });

  it("keeps the Projects label in list mode", () => {
    expect(shouldHideProjectsLabel(8, false, false)).toBe(false);
  });

  it("always hides the Projects label in narrow navigation", () => {
    expect(shouldHideProjectsLabel(0, true, false)).toBe(true);
  });
});
