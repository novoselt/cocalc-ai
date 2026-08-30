/** @jest-environment jsdom */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { RootfsLineageModal } from "./rootfs-lineage-modal";

function Harness() {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("image-1");
  const [saved, setSaved] = useState("");
  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        Edit lineage
      </button>
      <output aria-label="Saved predecessor">{saved}</output>
      <RootfsLineageModal
        open={open}
        entryLabel="TeX Live"
        target={target}
        busy={false}
        onTargetChange={setTarget}
        onSave={() => {
          setSaved(target);
          setOpen(false);
        }}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

describe("RootfsLineageModal", () => {
  it("opens from the keyboard, focuses the field, and restores focus on Escape", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.tab();
    const trigger = screen.getByRole("button", { name: "Edit lineage" });
    expect(trigger).toHaveFocus();
    await user.keyboard("{Enter}");

    const dialog = await screen.findByRole("dialog", {
      name: 'Edit lineage for "TeX Live"',
    });
    const input = within(dialog).getByRole("textbox", {
      name: "Superseded RootFS image ID",
    });
    await waitFor(() => expect(input).toHaveFocus());

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("saves an edited predecessor from the keyboard", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const trigger = screen.getByRole("button", { name: "Edit lineage" });
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog", {
      name: 'Edit lineage for "TeX Live"',
    });
    const input = within(dialog).getByRole("textbox", {
      name: "Superseded RootFS image ID",
    });
    await waitFor(() => expect(input).toHaveFocus());
    await user.clear(input);
    await user.type(input, "image-0");

    const save = within(dialog).getByRole("button", { name: "Save lineage" });
    save.focus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      screen.getByRole("status", { name: "Saved predecessor" }),
    ).toHaveTextContent("image-0");
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
