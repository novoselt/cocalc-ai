describe("lro stream explicit routing", () => {
  it("requires an explicit client for publishLroEvent", async () => {
    const { publishLroEvent } = await import("./stream");

    await expect(
      publishLroEvent({
        scope_type: "project",
        scope_id: "proj-1",
        op_id: "op-1",
        event: { type: "summary", ts: 1, summary: { op_id: "op-1" } as any },
      } as any),
    ).rejects.toThrow("must provide an explicit Conat client");
  });

  it("publishes with the provided client", async () => {
    const { publishLroSummary } = await import("./stream");
    const publish = jest.fn();
    const close = jest.fn();
    const client = {
      sync: {
        astream: jest.fn(() => ({ publish, close })),
      },
    } as any;

    await publishLroSummary({
      client,
      scope_type: "project",
      scope_id: "proj-1",
      summary: { op_id: "op-1", status: "running" } as any,
    });

    expect(client.sync.astream).toHaveBeenCalledWith({
      project_id: "proj-1",
      name: "lro.op-1",
      ephemeral: true,
    });
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "summary",
        summary: expect.objectContaining({ op_id: "op-1" }),
      }),
      { ttl: 24 * 60 * 60 * 1000 },
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("releases the stream when publish fails", async () => {
    const { publishLroEvent } = await import("./stream");
    const close = jest.fn();
    const client = {
      sync: {
        astream: jest.fn(() => ({
          publish: jest.fn().mockRejectedValue(new Error("publish failed")),
          close,
        })),
      },
    } as any;

    await expect(
      publishLroEvent({
        client,
        scope_type: "project",
        scope_id: "proj-1",
        op_id: "op-1",
        event: { type: "summary", ts: 1, summary: {} as any },
      }),
    ).rejects.toThrow("publish failed");
    expect(close).toHaveBeenCalledTimes(1);
  });
});
