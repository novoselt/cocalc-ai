/** @jest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { RowEntryInner } from "./row-entry-inner";

describe("RowEntryInner", () => {
  it("keeps text edits local until blur commits the field", () => {
    const onDraftEntry = jest.fn();
    const onChangeEntry = jest.fn();
    const props = {
      name: "site_name",
      value: "CoCalc",
      password: false,
      isReadonly: {},
      onDraftEntry,
      onChangeEntry,
    };
    const { rerender } = render(<RowEntryInner {...props} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "My CoCalc" } });

    expect(input.value).toBe("My CoCalc");
    expect(onDraftEntry).toHaveBeenLastCalledWith("site_name", "My CoCalc");
    expect(onChangeEntry).not.toHaveBeenCalled();

    // A lightweight parent refresh must not replace the active local draft
    // with the last committed page value.
    rerender(<RowEntryInner {...props} />);
    expect(input.value).toBe("My CoCalc");

    fireEvent.blur(input);
    expect(onChangeEntry).toHaveBeenCalledTimes(1);
    expect(onChangeEntry).toHaveBeenCalledWith("site_name", "My CoCalc");
  });

  it("uses local drafts for multiline secret settings", () => {
    const onDraftEntry = jest.fn();
    const onChangeEntry = jest.fn();
    render(
      <RowEntryInner
        name="service_account_json"
        value=""
        password
        multiline={4}
        isReadonly={{}}
        onDraftEntry={onDraftEntry}
        onChangeEntry={onChangeEntry}
      />,
    );
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: '{"secret":true}' } });
    expect(input.value).toBe('{"secret":true}');
    expect(onDraftEntry).toHaveBeenCalledWith(
      "service_account_json",
      '{"secret":true}',
    );
    expect(onChangeEntry).not.toHaveBeenCalled();

    fireEvent.blur(input);
    expect(onChangeEntry).toHaveBeenCalledWith(
      "service_account_json",
      '{"secret":true}',
    );
  });
});
