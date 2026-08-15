/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

export interface NotebookOutput {
  output_type?: string;
  name?: string;
  text?: string | string[];
  traceback?: string[];
  data?: Record<string, string | string[]>;
  execution_count?: number | null;
  metadata?: Record<string, unknown>;
  ename?: string;
  evalue?: string;
}

export interface NotebookCell {
  id?: string;
  cell_type?: string;
  execution_count?: number | null;
  source?: string | string[];
  outputs?: NotebookOutput[];
  metadata?: Record<string, unknown>;
  attachments?: Record<string, unknown>;
}

export interface NotebookDocument {
  cells: NotebookCell[];
  nbformat?: number;
  nbformat_minor?: number;
  metadata?: Record<string, any>;
}

export function sourceText(source?: string | string[]): string {
  return Array.isArray(source) ? source.join("") : source || "";
}

export function parseNotebook(contents: string): NotebookDocument {
  const value = JSON.parse(contents) as Partial<NotebookDocument>;
  if (!Array.isArray(value.cells)) {
    throw new Error("This file is not a valid Jupyter notebook.");
  }
  return { ...value, cells: value.cells };
}

export function NotebookOutputView({
  output,
  index,
}: {
  output: NotebookOutput;
  index: number;
}) {
  const text =
    sourceText(output.text) || sourceText(output.data?.["text/plain"]);
  const traceback =
    sourceText(output.traceback) ||
    [output.ename, output.evalue].filter(Boolean).join(": ");
  const png = sourceText(output.data?.["image/png"]);
  const jpeg = sourceText(output.data?.["image/jpeg"]);
  const image = png || jpeg;
  const mime = png ? "image/png" : "image/jpeg";
  if (image) {
    return (
      <img
        alt={`Notebook output ${index + 1}`}
        className="ul-output-image"
        loading="lazy"
        src={`data:${mime};base64,${image.replace(/\s/g, "")}`}
      />
    );
  }
  if (traceback || text) {
    return <pre className="ul-output">{traceback || text}</pre>;
  }
  if (output.data?.["text/html"]) {
    return (
      <p className="ul-notice">
        Interactive HTML output is omitted in the safe read-only viewer. Open
        full CoCalc to render it.
      </p>
    );
  }
  return null;
}

export default function NotebookView({
  notebook,
}: {
  notebook: NotebookDocument;
}) {
  return (
    <div className="ul-notebook">
      {notebook.cells.map((cell, index) => {
        const source = sourceText(cell.source);
        if (cell.cell_type === "markdown" || cell.cell_type === "raw") {
          return (
            <section className="ul-cell" key={index}>
              <div className="ul-cell-label">
                {cell.cell_type || "text"} cell {index + 1}
              </div>
              <div className="ul-markdown-cell">{source}</div>
            </section>
          );
        }
        return (
          <section className="ul-cell" key={index}>
            <div className="ul-cell-label">
              Code cell {index + 1}
              {cell.execution_count != null
                ? ` - execution ${cell.execution_count}`
                : ""}
            </div>
            <pre className="ul-code">
              <code>{source}</code>
            </pre>
            {cell.outputs?.map((output, outputIndex) => (
              <NotebookOutputView
                index={outputIndex}
                key={outputIndex}
                output={output}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}
