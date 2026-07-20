/*
 * This test exercises the math inline edit toggle behavior by simulating a click
 * into the formula and then moving the selection away. It ensures the math node
 * switches its void state consistently as selection focus changes.
 */
import { useState } from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { createEditor, Transforms } from "slate";

import { Editable, RenderElementProps, Slate, withReact } from "../slate-react";
import { getRender } from "../elements/register";
import "../elements/types";
import { withIsVoid } from "../plugins";

const renderElement = ({
  attributes,
  children,
  element,
}: RenderElementProps) => {
  const Element = getRender(element.type as string);
  return (
    <Element attributes={attributes} element={element} children={children} />
  );
};

test("math inline toggles void state when selection enters/leaves", async () => {
  const editor = withReact(createEditor());
  editor.isInline = (el) => el.type === "math_inline";
  editor.isVoid = (el) => el.type === "math_inline";
  withIsVoid(editor);

  const initialValue = [
    {
      type: "paragraph",
      children: [
        { text: "x " },
        { type: "math_inline", value: "x^2", children: [{ text: "" }] },
        { text: " y" },
      ],
    },
  ];

  const TestEditor = () => {
    const [value, setValue] = useState(initialValue as any);
    return (
      <Slate editor={editor} value={value} onChange={setValue}>
        <Editable renderElement={renderElement} />
      </Slate>
    );
  };

  const { container, unmount } = render(<TestEditor />);
  const inlineMath = container.querySelector(
    '[data-slate-inline="true"]',
  ) as HTMLElement | null;
  expect(inlineMath?.style.display).toBe("inline-block");
  const editHandle = inlineMath?.querySelector(
    'span[contenteditable="false"]',
  ) as HTMLElement | null;

  const hasVoid = () =>
    container.querySelector('[data-slate-void="true"]') != null;

  await waitFor(() => expect(hasVoid()).toBe(true));

  act(() => {
    if (editHandle) {
      fireEvent.mouseDown(editHandle);
    }
  });
  await waitFor(() => expect(hasVoid()).toBe(false));

  act(() => {
    Transforms.select(editor, { path: [0, 0], offset: 1 });
  });
  await waitFor(() => expect(hasVoid()).toBe(true));

  unmount();
});

test("display-style inline math occupies a centered full-width line", () => {
  const editor = withReact(createEditor());
  editor.isInline = (el) => el.type === "math_inline";
  editor.isVoid = (el) => el.type === "math_inline";
  withIsVoid(editor);

  const value = [
    {
      type: "paragraph",
      children: [
        { text: "before" },
        {
          type: "math_inline",
          value: String.raw`\begin{pmatrix}x\\y\end{pmatrix}`,
          display: true,
          sourceDelimiter: "$$",
          children: [{ text: "" }],
        },
      ],
    },
  ];

  const { container, unmount } = render(
    <Slate editor={editor} value={value as any} onChange={() => undefined}>
      <Editable renderElement={renderElement} />
    </Slate>,
  );
  const displayMath = container.querySelector(
    '[data-slate-inline="true"]',
  ) as HTMLElement | null;

  expect(displayMath?.style.display).toBe("block");
  expect(displayMath?.style.textAlign).toBe("center");
  expect(displayMath?.style.width).toBe("100%");

  unmount();
});
