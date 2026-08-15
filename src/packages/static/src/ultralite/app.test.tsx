import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { getAuthBootstrap } from "./api";
import { UltraliteApp } from "./app";

jest.mock("./api", () => ({ getAuthBootstrap: jest.fn() }));

const getAuthBootstrapMock = jest.mocked(getAuthBootstrap);

test("exposes the lightweight shell navigation before authentication", async () => {
  getAuthBootstrapMock.mockResolvedValue({ signed_in: false });
  render(<UltraliteApp />);

  expect(screen.getByRole("link", { name: "CoCalc projects" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Full CoCalc" })).toBeVisible();
  expect(
    await screen.findByRole("heading", { name: "Sign in to continue" }),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Open CoCalc to sign in" }),
  ).toBeVisible();
});

test("reports bootstrap failures and offers a retry", async () => {
  getAuthBootstrapMock.mockRejectedValue(new Error("offline"));
  render(<UltraliteApp />);

  expect(await screen.findByRole("alert")).toHaveTextContent("offline");
  expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
});
