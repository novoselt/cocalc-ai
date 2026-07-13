import { createClient } from "node-zendesk";

import { getServerSettings } from "@cocalc/database/settings";

import getClient, {
  extractSubdomain,
  resetZendeskClientForTesting,
} from "./zendesk-client";

jest.mock("node-zendesk", () => ({
  createClient: jest.fn(),
}));

jest.mock("@cocalc/database/settings", () => ({
  getServerSettings: jest.fn(),
}));

const mockCreateClient = jest.mocked(createClient);
const mockGetServerSettings = jest.mocked(getServerSettings);

beforeEach(() => {
  jest.clearAllMocks();
  resetZendeskClientForTesting();
});

test("zendesk/extractSubdomain/compatibility", () => {
  const uri = "https://sagemathcloud.zendesk.com/api/v2";
  const subdomain = extractSubdomain(uri);
  expect(subdomain).toBe("sagemathcloud");
});

test("zendesk/extractSubdomain/new", () => {
  const uri = "sagemathcloud";
  const subdomain = extractSubdomain(uri);
  expect(subdomain).toBe("sagemathcloud");
});

test("zendesk client is rebuilt when configuration changes", async () => {
  const clientA = { name: "client-a" };
  const clientB = { name: "client-b" };
  mockCreateClient
    .mockReturnValueOnce(clientA as any)
    .mockReturnValueOnce(clientB as any);
  mockGetServerSettings
    .mockResolvedValueOnce({
      zendesk_token: "token-a",
      zendesk_username: "support@example.com",
      zendesk_uri: "example",
    } as any)
    .mockResolvedValueOnce({
      zendesk_token: "token-a",
      zendesk_username: "support@example.com",
      zendesk_uri: "example",
    } as any)
    .mockResolvedValueOnce({
      zendesk_token: "token-b",
      zendesk_username: "support@example.com",
      zendesk_uri: "example",
    } as any);

  await expect(getClient()).resolves.toBe(clientA);
  await expect(getClient()).resolves.toBe(clientA);
  await expect(getClient()).resolves.toBe(clientB);
  expect(mockCreateClient).toHaveBeenCalledTimes(2);
  expect(mockCreateClient).toHaveBeenLastCalledWith({
    username: "support@example.com",
    token: "token-b",
    subdomain: "example",
  });
});
