/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import type { FilesystemClient } from "@cocalc/conat/files/fs";
import {
  Fragment,
  useEffect,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  languageForPath,
  loadLanguage,
  Prism,
  type UltraliteLanguage,
} from "./prism-languages";
import { ULTRALITE_BEFORE_NAVIGATE } from "./routes";
import {
  recordUltraliteOutcome,
  recordUltraliteSurfaceReady,
} from "./telemetry";
import { InlineAlert, LoadingState } from "./ui";

function tokenClass(token: Prism.Token): string {
  const aliases = Array.isArray(token.alias)
    ? token.alias
    : token.alias
      ? [token.alias]
      : [];
  return ["token", token.type, ...aliases].join(" ");
}

function renderTokens(tokens: Array<string | Prism.Token>, key = "t") {
  return tokens.map((token, index): ReactNode => {
    const tokenKey = `${key}-${index}`;
    if (typeof token === "string") {
      return <Fragment key={tokenKey}>{token}</Fragment>;
    }
    const content = Array.isArray(token.content)
      ? renderTokens(token.content, tokenKey)
      : token.content instanceof Prism.Token
        ? renderTokens([token.content], tokenKey)
        : token.content;
    return (
      <span className={tokenClass(token)} key={tokenKey}>
        {content}
      </span>
    );
  });
}

function HighlightedCode({
  contents,
  language,
  wrap,
}: {
  contents: string;
  language?: UltraliteLanguage;
  wrap: boolean;
}) {
  const [grammar, setGrammar] = useState<Prism.Grammar>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setGrammar(undefined);
    setFailed(false);
    void loadLanguage(language)
      .then((value) => {
        if (!cancelled) setGrammar(value);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [language]);

  let children: ReactNode = contents;
  if (grammar && language) {
    children = renderTokens(Prism.tokenize(contents, grammar));
  }
  return (
    <>
      {language && !grammar && !failed ? (
        <LoadingState label="Loading syntax highlighting" />
      ) : null}
      {failed ? (
        <InlineAlert kind="warning">
          Syntax highlighting could not be loaded. Plain text is still safe and
          available.
        </InlineAlert>
      ) : null}
      <pre className={`ul-code-view ${wrap ? "ul-code-wrap" : ""}`}>
        <code>{children}</code>
      </pre>
    </>
  );
}

function position(contents: string, offset: number): string {
  const before = contents.slice(0, offset);
  const lines = before.split("\n");
  return `Ln ${lines.length}, Col ${(lines.at(-1)?.length ?? 0) + 1}`;
}

export default function CodeView({
  contents,
  filesystem,
  onDirtyChange,
  onSaved,
  path,
  readOnly,
}: {
  contents: string;
  filesystem: FilesystemClient;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: (contents: string) => void;
  path: string;
  readOnly: boolean;
}) {
  const [base, setBase] = useState(contents);
  const [draft, setDraft] = useState(contents);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [cursor, setCursor] = useState("Ln 1, Col 1");
  const [wrap, setWrap] = useState(false);
  const language = languageForPath(path);
  const dirty = draft !== base;

  useEffect(() => {
    setBase(contents);
    setDraft(contents);
    setConflict(false);
    setError(undefined);
    setNotice(undefined);
  }, [contents, path]);

  useEffect(() => {
    onDirtyChange(dirty);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const beforeNavigate = (event: Event) => {
      if (dirty && !window.confirm("Discard unsaved changes?")) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener(ULTRALITE_BEFORE_NAVIGATE, beforeNavigate);
    return () => {
      onDirtyChange(false);
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener(ULTRALITE_BEFORE_NAVIGATE, beforeNavigate);
    };
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (editing) recordUltraliteSurfaceReady("editor");
  }, [editing]);

  const save = async () => {
    if (!dirty || saving || conflict || readOnly) return;
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await filesystem.writeFileIfUnchanged(path, draft, base, true);
      setBase(draft);
      onSaved(draft);
      setNotice("Saved.");
      recordUltraliteOutcome("editor", "file_save");
    } catch (err: any) {
      if (err?.code === "ETAG_MISMATCH") {
        recordUltraliteOutcome("editor", "save_conflict");
        setConflict(true);
        setError(
          "This file changed on the server after you opened it. Your draft was not written. Reload or resolve it in full CoCalc.",
        );
      } else {
        setError(err instanceof Error ? err.message : `${err}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void save();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const input = event.currentTarget;
      const start = input.selectionStart;
      const end = input.selectionEnd;
      const next = `${draft.slice(0, start)}  ${draft.slice(end)}`;
      setDraft(next);
      requestAnimationFrame(() => {
        input.selectionStart = input.selectionEnd = start + 2;
        setCursor(position(next, start + 2));
      });
    }
  };

  return (
    <div>
      <div className="ul-file-view-header">
        <div className="ul-toolbar">
          {!readOnly ? (
            <button
              className="ul-button ul-button-secondary"
              onClick={() => setEditing((value) => !value)}
              type="button"
            >
              {editing ? "Preview" : "Edit"}
            </button>
          ) : null}
          {editing ? (
            <>
              <button
                className="ul-button"
                disabled={!dirty || saving || conflict}
                onClick={() => void save()}
                type="button"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                className="ul-button ul-button-secondary"
                disabled={!dirty || saving}
                onClick={() => {
                  if (
                    !dirty ||
                    window.confirm("Revert your unsaved changes?")
                  ) {
                    setDraft(base);
                    setConflict(false);
                    setError(undefined);
                  }
                }}
                type="button"
              >
                Revert
              </button>
            </>
          ) : null}
          {!editing ? (
            <label className="ul-check-label">
              <input
                checked={wrap}
                onChange={(event) => setWrap(event.target.checked)}
                type="checkbox"
              />
              Wrap lines
            </label>
          ) : null}
        </div>
        <span aria-live="polite" className="ul-editor-status">
          {editing ? cursor : language || "plain text"}
          {dirty ? " · unsaved" : ""}
        </span>
      </div>
      {readOnly ? (
        <InlineAlert kind="info">
          This file is read-only in constrained CoCalc because you are a viewer
          or it exceeds the 2 MiB editing limit.
        </InlineAlert>
      ) : null}
      {notice ? <InlineAlert>{notice}</InlineAlert> : null}
      {error ? <InlineAlert kind="error">{error}</InlineAlert> : null}
      {editing ? (
        <textarea
          aria-label={`Edit ${path.split("/").pop() || "file"}`}
          className="ul-editor"
          onChange={(event) => {
            setDraft(event.target.value);
            setNotice(undefined);
          }}
          onClick={(event) =>
            setCursor(position(draft, event.currentTarget.selectionStart))
          }
          onKeyDown={handleKeyDown}
          onKeyUp={(event) =>
            setCursor(position(draft, event.currentTarget.selectionStart))
          }
          readOnly={readOnly}
          spellCheck={false}
          value={draft}
        />
      ) : (
        <HighlightedCode contents={draft} language={language} wrap={wrap} />
      )}
    </div>
  );
}
