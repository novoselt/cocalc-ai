import { createEditor, Editor, Transforms } from "slate";
import { withHistory } from "slate-history";
import { handleLocalHistoryHotkey } from "../local-history";

function event(shiftKey = false) {
  return {
    altKey: false,
    ctrlKey: false,
    key: "z",
    metaKey: true,
    shiftKey,
  };
}

test("command-z and command-shift-z use Slate local history", () => {
  const editor = withHistory(createEditor());
  editor.children = [{ type: "paragraph", children: [{ text: "hello" }] }];
  Transforms.select(editor, Editor.end(editor, []));
  editor.insertText("!");

  expect(Editor.string(editor, [])).toBe("hello!");
  expect(handleLocalHistoryHotkey(event(), editor, true)).toBe(true);
  expect(Editor.string(editor, [])).toBe("hello");
  expect(handleLocalHistoryHotkey(event(true), editor, true)).toBe(true);
  expect(Editor.string(editor, [])).toBe("hello!");
});

test("local history does not claim unrelated shortcuts", () => {
  const editor = withHistory(createEditor());

  expect(handleLocalHistoryHotkey({ ...event(), key: "y" }, editor, true)).toBe(
    false,
  );
  expect(handleLocalHistoryHotkey(event(), editor, false)).toBe(false);
});
