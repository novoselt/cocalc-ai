/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  highlightSelectionMatches,
  search,
  searchKeymap,
} from "@codemirror/search";
import {
  Compartment,
  EditorState,
  type Extension,
  type Text,
} from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { loadCodeMirrorLanguage } from "./codemirror-languages";
import type { UltraliteLanguage } from "./prism-languages";

export interface CodeMirrorEditorHandle {
  focus(): void;
  getValue(): string;
  markClean(): void;
  replaceValue(value: string): void;
}

interface Props {
  ariaLabel: string;
  initialValue: string;
  language?: UltraliteLanguage;
  onDirtyChange: (dirty: boolean) => void;
  onCursorChange: (position: string) => void;
  onLanguageError: (message?: string) => void;
  onSave: () => void;
  path: string;
  wrap: boolean;
}

function cursorPosition(view: EditorView): string {
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  return `Ln ${line.number}, Col ${head - line.from + 1}`;
}

const CodeMirrorEditor = forwardRef<CodeMirrorEditorHandle, Props>(
  function CodeMirrorEditor(
    {
      ariaLabel,
      initialValue,
      language,
      onDirtyChange,
      onCursorChange,
      onLanguageError,
      onSave,
      path,
      wrap,
    },
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | undefined>(undefined);
    const initialValueRef = useRef(initialValue);
    const cleanDocumentRef = useRef<Text | undefined>(undefined);
    const languageCompartmentRef = useRef(new Compartment());
    const wrapCompartmentRef = useRef(new Compartment());
    const callbacksRef = useRef({
      onDirtyChange,
      onCursorChange,
      onLanguageError,
      onSave,
    });
    callbacksRef.current = {
      onDirtyChange,
      onCursorChange,
      onLanguageError,
      onSave,
    };

    useImperativeHandle(
      ref,
      () => ({
        focus: () => viewRef.current?.focus(),
        getValue: () =>
          viewRef.current?.state.doc.toString() ?? initialValueRef.current,
        markClean: () => {
          const view = viewRef.current;
          if (!view) return;
          cleanDocumentRef.current = view.state.doc;
          callbacksRef.current.onDirtyChange(false);
        },
        replaceValue: (value) => {
          const view = viewRef.current;
          if (!view || view.state.doc.toString() === value) return;
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: value },
          });
        },
      }),
      [initialValue],
    );

    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;
      const saveBinding = {
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          callbacksRef.current.onSave();
          return true;
        },
      };
      const extensions: Extension[] = [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        search(),
        highlightSelectionMatches(),
        keymap.of([
          saveBinding,
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          indentWithTab,
        ]),
        EditorView.contentAttributes.of({
          "aria-label": ariaLabel,
          "aria-multiline": "true",
          autocapitalize: "off",
          autocomplete: "off",
          autocorrect: "off",
          spellcheck: "false",
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            callbacksRef.current.onDirtyChange(
              !cleanDocumentRef.current?.eq(update.state.doc),
            );
          }
          if (update.docChanged || update.selectionSet) {
            callbacksRef.current.onCursorChange(cursorPosition(update.view));
          }
        }),
        languageCompartmentRef.current.of([]),
        wrapCompartmentRef.current.of(wrap ? EditorView.lineWrapping : []),
      ];
      const view = new EditorView({
        parent: host,
        state: EditorState.create({
          doc: initialValueRef.current,
          extensions,
        }),
      });
      viewRef.current = view;
      cleanDocumentRef.current = view.state.doc;
      callbacksRef.current.onCursorChange(cursorPosition(view));
      view.focus();
      return () => {
        viewRef.current = undefined;
        view.destroy();
      };
    }, [ariaLabel]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: wrapCompartmentRef.current.reconfigure(
          wrap ? EditorView.lineWrapping : [],
        ),
      });
    }, [wrap]);

    useEffect(() => {
      initialValueRef.current = initialValue;
      const view = viewRef.current;
      if (!view) return;
      if (view.state.doc.toString() !== initialValue) {
        view.dispatch({
          changes: {
            from: 0,
            to: view.state.doc.length,
            insert: initialValue,
          },
        });
      }
      cleanDocumentRef.current = view.state.doc;
      callbacksRef.current.onDirtyChange(false);
    }, [initialValue, path]);

    useEffect(() => {
      let cancelled = false;
      callbacksRef.current.onLanguageError(undefined);
      void loadCodeMirrorLanguage(language, path)
        .then((extension) => {
          const view = viewRef.current;
          if (cancelled || !view) return;
          view.dispatch({
            effects: languageCompartmentRef.current.reconfigure(extension),
          });
        })
        .catch((err) => {
          if (cancelled) return;
          callbacksRef.current.onLanguageError(
            `Syntax highlighting could not be loaded: ${err instanceof Error ? err.message : `${err}`}`,
          );
        });
      return () => {
        cancelled = true;
      };
    }, [language, path]);

    return <div className="ul-cm-editor" ref={hostRef} />;
  },
);

export default CodeMirrorEditor;
