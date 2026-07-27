/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/*
LaTeX Editor Actions.
*/

// cSpell:ignore rtex cmdl ramdisk maketitle documentclass outdirflag latexer rescan

const MINIMAL = `\\documentclass{article}
\\title{Title}
\\author{Author}
\\begin{document}
\\maketitle
\\end{document}
`;

const HELP_SLUG = "latex/build-papers";

// NOTE: These names are the keys in EDITOR_SPEC in editor.ts, not the type field
const VIEWERS = ["pdfjs_canvas", "pdf_embed", "build", "output"] as const;

// CodeMirror gutter id for chat markers and bookmarks; must be listed in
// the cm frame's `gutters` in editor.ts and styled in styles/editor.css.
export const CHAT_GUTTER_ID = "CodeMirror-latex-chat";

import { delay } from "awaiting";
import { message as antdMessage } from "antd";
import * as CodeMirror from "codemirror";
import { fromJS, List, Map as IMap } from "immutable";
import { debounce, union } from "lodash";
import { normalize as path_normalize } from "path";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";

import { Store, TypedMap } from "@cocalc/frontend/app-framework";
import { openProjectDocs } from "@cocalc/frontend/docs/navigation";
import {
  Icon,
  TableOfContentsEntry,
  TableOfContentsEntryList,
} from "@cocalc/frontend/components";
import { saveToDiskWithFileServerRetry } from "@cocalc/frontend/frame-editors/base-editor/actions-base";
import {
  Actions as BaseActions,
  CodeEditorState,
} from "@cocalc/frontend/frame-editors/base-editor/actions-text";
import { print_html } from "@cocalc/frontend/frame-editors/frame-tree/print";
import { FrameTree } from "@cocalc/frontend/frame-editors/frame-tree/types";
import { raw_url } from "@cocalc/frontend/frame-editors/frame-tree/util";
import {
  exec,
  project_api,
  server_time,
} from "@cocalc/frontend/frame-editors/generic/client";
import { ExecOutput } from "@cocalc/util/db-schema/projects";
import {
  change_filename_extension,
  hash_string,
  path_split,
  separate_file_extension,
  sha1,
  splitlines,
  startswith,
} from "@cocalc/util/misc";
import { normalizeAbsolutePath } from "@cocalc/util/path-model";
import { reuseInFlight } from "@cocalc/util/reuse-in-flight";
import * as tree_ops from "../frame-tree/tree-ops";
import { bibtex } from "./bibtex";
import type {
  BookmarkMarker,
  ChatMarker,
  InvalidChatMarker,
} from "./chat-markers";
import {
  buildBookmarkLine,
  buildInlineInsertion,
  buildMarkerLine,
  generateBookmarkText,
  generateMarkerHash,
  lineHasTexContent,
  removeMarkersForHash,
  replacementMarkerHash,
  scanBookmarks,
  scanInvalidMarkers,
  scanMarkers,
} from "./chat-markers";
import {
  BookmarkGutter,
  ChatMarkerGutter,
  ChatMarkerInlineTail,
  InvalidChatMarkerTail,
} from "./chat-marker-gutter";
// Side-effect import: registers the Insert-menu chat marker/bookmark commands.
import "./chat-marker-command";
import {
  parseThreadAnchor,
  parseThreadResolved,
} from "@cocalc/frontend/chat/anchors";
import { ensureSideChatActions } from "@cocalc/frontend/chat/unread";
import { clean } from "./clean";
import { KNITR_EXTS } from "./constants";
import { count_words } from "./count_words";
import { update_gutters } from "./gutters";
import { knitr, knitr_errors, patch_synctex } from "./knitr";
import { IProcessedLatexLog, LatexParser } from "./latex-log-parser";
import {
  build_command,
  Engine,
  get_engine_from_config,
  latexmk,
} from "./latexmk";
import { PDFWatcher } from "./pdf-watcher";
import { pythontex, pythontex_errors } from "./pythontex";
import { sagetex, sagetex_errors, sagetex_hash } from "./sagetex";
import * as synctex from "./synctex";
import { parseTableOfContents } from "./table-of-contents";
import {
  BuildLog,
  BuildLogs,
  BuildSpecName,
  IBuildSpecs,
  ScrollIntoViewMap,
  ScrollIntoViewRecord,
} from "./types";
import { ensureTargetPathIsCorrect, pdf_path } from "./util";

interface LatexEditorState extends CodeEditorState {
  build_logs: BuildLogs;
  sync: string;
  scroll_pdf_into_view: ScrollIntoViewMap;
  word_count: string;
  zoom_page_width: string;
  zoom_page_height: string;
  build_command: string | List<string>;
  knitr: boolean;
  knitr_error: boolean; // true, if there is a knitr problem
  // pythontex_error: boolean;  // true, if pythontex processing had an issue
  includeError?: string;
  build_command_hardcoded?: boolean; // if true, an % !TeX cocalc = ... directive sets the command via the document itself
  contents?: TableOfContentsEntryList; // table of contents data.
  switch_output_to_pdf_tab?: boolean; // used for SyncTeX to switch output panel to PDF tab
  output_panel_id_for_sync?: string; // stores the output panel ID for SyncTeX operations
  // job_infos: JobInfos;
  autoSyncInProgress?: boolean; // unified flag to prevent sync loops - true when any auto sync operation is in progress
  // Chat anchor markers / bookmarks found in the master + open sub-files,
  // keyed by file path.
  chat_markers?: IMap<string, List<TypedMap<ChatMarker>>>;
  invalid_chat_markers?: IMap<string, List<TypedMap<InvalidChatMarker>>>;
  chat_bookmarks?: IMap<string, List<TypedMap<BookmarkMarker>>>;
}

export class Actions extends BaseActions<LatexEditorState> {
  public project_id: string;
  public store: Store<LatexEditorState>;
  private _last_sagetex_hash: string;
  private _last_syncstring_hash: number | undefined;
  private is_building: boolean = false;
  public word_count: (
    time: number,
    force: boolean,
    skipFramePopup?: boolean,
  ) => Promise<void>;
  private is_stopping: boolean = false; // if true, do not continue running any compile jobs
  private ext: string = "tex";
  private knitr: boolean = false; // true, if we deal with a knitr file
  private filename_knitr: string; // .rnw or .rtex
  private bad_filename: boolean; // true, if the <filename.tex> can't be processed -- see #3230
  // optional engine configuration string -- https://github.com/sagemathinc/cocalc/issues/2839
  private engine_config: Engine | null | undefined = undefined;

  // The output_directory that will be used if we are building
  // and using an output directory.  NOTE: this is a /tmp
  // directory, which we do not explicitly clean up.  However,
  // it gets cleaned up when the project stops (on managed project hosts it
  // is a ramdisk), or by whatever tmp cleaner should probably
  // be installed (say for docker...).  At least the size
  // should be relatively small.
  public output_directory: string | undefined;

  private relative_paths: { [path: string]: string } = {};
  private canonical_paths: { [path: string]: string } = {};
  private parsed_output_log?: IProcessedLatexLog;

  private _last_sync_time = 0;

  // PDF file watcher - watches directory for PDF file changes
  private pdf_watcher?: PDFWatcher;

  // Debounced version - initialized in _init2()
  update_pdf: (time: number, force: boolean) => void;

  // Auto-sync function for cursor position changes (forward sync: source → PDF)
  private async handle_cursor_sync_to_pdf(
    line: number,
    column: number,
    filename: string,
  ): Promise<void> {
    if (this.is_auto_sync_in_progress()) {
      return; // Prevent sync loops
    }

    this.set_auto_sync_in_progress(true);
    try {
      await this.synctex_tex_to_pdf(line, column, filename);

      // Fallback: Clear flag after timeout if viewport change doesn't happen
      setTimeout(() => {
        if (this.is_auto_sync_in_progress()) {
          this.set_auto_sync_in_progress(false);
        }
      }, 2000);

      // Note: The autoSyncInProgress flag will be cleared when PDF viewport actually changes
    } catch (error) {
      console.warn("Auto-sync forward search failed:", error);
      // Clear flag on error since viewport won't change
      this.set_auto_sync_in_progress(false);
    }
  }

  private output_directory_path(): string {
    return `/tmp/${sha1(this.path)}`;
  }

  private is_read_only_preview(): boolean {
    return this.store?.get("read_only") === true;
  }

  _init2(): void {
    this.set_gutter = this.set_gutter.bind(this);
    // Debounce update_pdf with 500ms delay, trailing only, has to work when PDF watcher fires during the build
    this.update_pdf = debounce(this._update_pdf.bind(this), 500, {
      leading: false,
      trailing: true,
    });
    this.init_bad_filename();
    this.init_ext_filename(); // safe to set before syncstring init
    this._init_syncstring_value();
    this.init_ext_path(); // must come after syncstring init
    if (this.is_read_only_preview()) {
      this.word_count = async () => {};
      this._syncstring.on(
        "change",
        debounce(this.updateTableOfContents.bind(this), 1500),
      );
      return;
    }
    this.init_latexmk();
    // This breaks browser spellcheck.
    // this._init_spellcheck();
    this.init_config();
    if (!this.knitr) {
      this.output_directory = this.output_directory_path();
    }
    this._syncstring.on(
      "change",
      debounce(this.updateTableOfContents.bind(this), 1500),
    );
    this._syncstring.on(
      "change",
      debounce(this.ensureNonempty.bind(this), 1500),
    );
    this._init_pdf_directory_watcher();
    this.word_count = reuseInFlight(this._word_count.bind(this));
    this._initChatMarkers();
  }

  // Watch the directory containing the PDF file for changes
  private async _init_pdf_directory_watcher(): Promise<void> {
    if (this.is_read_only_preview()) return;
    const pdfPath = pdf_path(this.path);
    this.pdf_watcher = new PDFWatcher(
      this.project_id,
      pdfPath,
      // We ignore the PDFs timestamp (mtime) and use last_save_time for consistency with build-triggered updates
      (_mtime: number, force: boolean) => {
        this.update_pdf(this.last_save_time(), force);
      },
    );
    await this.pdf_watcher.init();
  }

  // similar to jupyter, where an empty document is really
  // confusing, with latex we at least do something to
  // prevent having a truly empty document.
  private ensureNonempty() {
    if (this.is_read_only_preview()) return;
    if (this.store && !this.store.get("value")?.trim()) {
      this.set_value(MINIMAL);
      this.build();
    }
  }

  private init_bad_filename(): void {
    // #3230 two or more spaces
    // note: if there are additional reasons why a filename is bad, add it to the
    // alert msg in run_build.
    this.bad_filename = /\s\s+/.test(this.path);
  }

  private init_ext_filename(): void {
    /* number one reason to check is to detect .rnw/.rtex files */
    const ext = separate_file_extension(this.path).ext;
    if (ext) {
      this.ext = ext.toLowerCase();
      if (KNITR_EXTS.includes(this.ext)) {
        this.knitr = true;
        this.filename_knitr = this.path;
      }
    }
  }

  // conditionally overwrites parent Action class method
  get_spellcheck_path(): string {
    if (this.knitr) {
      return this.filename_knitr;
    } else {
      return super.get_spellcheck_path();
    }
  }

  private init_ext_path(): void {
    if (this.knitr) {
      // changing the path to the (to be generated) tex file makes everything else
      // here compatible with the latex commands
      this.path = change_filename_extension(this.path, "tex");
      this.setState({ knitr: this.knitr, knitr_error: false });
    }
  }

  private is_likely_master(): boolean {
    if (this.not_ready()) return false;
    const s = this._syncstring.to_str();
    return s != null && s.indexOf("\\document") != -1;
  }

  private init_latexmk(): void {
    if (this.is_read_only_preview()) return;
    const handlePersistedSourceChange = reuseInFlight(async () => {
      await this.maybeBuildAfterPersistedSourceChange();
    });
    this._syncstring.on("save-to-disk", handlePersistedSourceChange);
    this._syncstring.on("filesystem-change", handlePersistedSourceChange);
  }

  private async maybeBuildAfterPersistedSourceChange(): Promise<void> {
    if (this.is_read_only_preview()) return;
    if (this.not_ready()) return;
    const account: any = this.redux.getStore("account");
    if (!account?.getIn(["editor_settings", "build_on_save"])) {
      return;
    }
    const value = this._syncstring.to_str();
    if (value == null) return;
    const hash = hash_string(value);
    if (this._last_syncstring_hash === hash) {
      return;
    }
    this._last_syncstring_hash = hash;
    // there are two cases: the parent "master" file triggers the build (usual case)
    // or an included dependency – i.e. where parent_file is set
    if (this.parent_file != null && this.parent_file != this.path) {
      const parent_actions = this.redux.getEditorActions(
        this.project_id,
        this.parent_file,
      ) as Actions;
      // we're careful, maybe getEditorActions returns something else ...
      await parent_actions?.build?.("", false);
    } else if (this.parent_file == null && this.is_likely_master()) {
      // also check is_likely_master, b/c there must be a \\document* command.
      await this.build("", false);
    }
  }

  public async rescan_latex_directive(): Promise<void> {
    // make this false since this is only called when user explicitly requests it, so it
    // should scan for all options.
    await this.init_build_directive(false);
  }

  /**
   * we check the first ~1000 lines for
   * % !TeX program = xelatex | pdflatex | ...
   * % !TeX cocalc = the exact command line
   */
  public async init_build_directive(cocalcOnly = false): Promise<void> {
    if (this.is_read_only_preview()) return;
    // check if there is an engine configured
    // https://github.com/sagemathinc/cocalc/issues/2839
    if (this.engine_config !== undefined) return;

    // Wait until the syncstring is loaded from disk. During fast-open and
    // reconnects it can be non-ready without being in the old "init" state.
    if (!(await this.wait_until_syncdoc_ready(this._syncstring))) {
      return;
    }

    let program = ""; // later, might contain the !TeX program build directive
    let cocalc_cmd = ""; // later, might contain the cocalc command

    const s = this._syncstring.to_str();
    let line: string;
    let lineNo = 0;
    for (line of splitlines(s)) {
      lineNo += 1;
      if (lineNo > 1000) break;
      if (!startswith(line, "%")) continue;
      const i = line.indexOf("=");
      if (i == -1) continue;
      // we match on lower case and normalize all spaces
      const directive = line
        .slice(0, i)
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
      if (
        !cocalcOnly &&
        (startswith(directive, "% !tex program") ||
          startswith(directive, "% !tex ts-program"))
      ) {
        program = line.slice(i + 1).trim();
      } else if (startswith(directive, "% !tex cocalc")) {
        cocalc_cmd = line.slice(i + 1).trim();
      }
      if (cocalc_cmd || (cocalc_cmd && program)) break;
    }

    // cocalc command takes precedence!
    if (cocalc_cmd) {
      // once set, it will be sanitized upon the next syncdb change event
      this.set_build_command(cocalc_cmd);
      this.setState({ build_command_hardcoded: true });
    } else if (program) {
      // get_engine_from_config picks an "Engine" we know of via lower-case match
      this.engine_config = get_engine_from_config(program);
      if (this.engine_config != null) {
        // Now set the build command to what is configured.
        this.set_build_command(
          build_command(
            this.engine_config,
            path_split(this.path).tail,
            this.knitr,
            this.output_directory,
          ),
        );
      }
      this.setState({ build_command_hardcoded: false });
    } else {
      this.setState({ build_command_hardcoded: false });
    }
  }

  private async init_config(): Promise<void> {
    this.setState({ build_command: "" }); // empty means not yet initialized

    // .rnw/.rtex files: we aux-syncdb them, not the autogenerated .tex file
    const path: string = this.knitr ? this.filename_knitr : this.path;
    this._init_syncdb(["key"], undefined, path);

    // Wait for the syncdb to be loaded and ready.
    if (this._syncdb == null) {
      throw Error("syncdb must be defined");
    }
    if (!(await this.wait_until_syncdoc_ready(this._syncdb))) return;

    // If the build command is NOT already
    // set in syncdb, we wait for file to load,
    // looks for "% !TeX program =", and if so
    // sets up the build command based on that:
    if (this._syncdb == null) {
      throw Error("syncdb must be defined");
    }
    if (this._syncdb.get_one({ key: "build_command" }) == null) {
      await this.init_build_directive();
      if (this._state == "closed") return;
    } else {
      // this scans for the "cocalc" directive, which hardcodes the build command
      await this.init_build_directive(true);
    }

    // Also, whenever the syncdb changes or loads, we load the build
    // command from there, if it is explicitly set there.  This takes
    // precedence over the "% !TeX program =".
    const set_cmd = (): void => {
      if (this._syncdb == null) throw Error("syncdb must be defined");
      const x = this._syncdb.get_one({ key: "build_command" });

      if (x !== undefined && x.get("value") !== undefined) {
        const cmd: List<string> | string = x.get("value");
        if (typeof cmd === "string") {
          // #3159
          if (cmd.length > 0) {
            const build_command = this.sanitize_build_cmd_str(cmd);
            this.setState({ build_command });
            this.set_build_command(build_command);
            return;
          }
          // https://github.com/sagemathinc/cocalc/issues/6397
        } else if (List.isList(cmd) && cmd.size > 0) {
          // It's an array so the output-directory option should be
          // set; however, it's possible it isn't in case this is
          // an old document that had the build_command set before
          // we implemented output directory support.
          const build_command: List<string> = this.sanitize_build_cmd(cmd);
          this.setState({ build_command });
          this.set_build_command(build_command.toJS());
          return;
        }
      }

      // fallback
      this.set_default_build_command();
    };

    set_cmd();
    this._syncdb.on("change", set_cmd);

    if (this.is_likely_master() && !this.is_read_only_preview()) {
      // We now definitely have the build command set and the document loaded,
      // and it is likely a master latex file, so let's kick off our initial build.
      this.force_build();
    }
  }

  private set_default_build_command(): string[] {
    const default_cmd = build_command(
      this.engine_config || "PDFLaTeX",
      path_split(this.path).tail,
      this.knitr,
      this.output_directory,
    );
    this.setState({ build_command: fromJS(default_cmd) });
    return default_cmd;
  }

  private output_directory_cmd_flag(output_dir?: string): string {
    // maybe at some point we want to wrap this in ''
    const dir = output_dir != null ? output_dir : this.output_directory;
    return `-output-directory=${dir}`;
  }

  public sanitize_build_cmd_str(cmd: string): string {
    if (cmd.indexOf(";") != -1) {
      // if there is a semicolon we allow anything...
      return cmd;
    }
    // This is when users manually set the command or possibly slightly edited it.
    // It's very important NOT to ignore the output directory part!!! See #5183,
    // where we see ignoring this leads to massive problems.

    // Make sure the output directory matches what we are actually using (the sha1 hash).
    const i = cmd.indexOf("-output-directory=");
    if (i != -1) {
      let j = cmd.indexOf(" ", i);
      if (j == -1) {
        // at the end
        j = cmd.length;
      }
      if (this.output_directory) {
        // ensure it is set properly
        if (
          cmd.slice(i + "-output-directory=".length, j) != this.output_directory
        ) {
          cmd =
            cmd.slice(0, i) +
            `-output-directory=${this.output_directory} ` +
            cmd.slice(j);
        }
      } else {
        // ensure it is NOT set since it will definitely break things
        cmd = cmd.slice(0, i) + cmd.slice(j);
      }
    }

    //console.log("before", { cmd });
    cmd = ensureTargetPathIsCorrect(cmd, path_split(this.path).tail);
    //console.log("after", { cmd });

    // We also focus on setting -deps for latexmk
    if (!cmd.trim().startsWith("latexmk")) return cmd;
    // -dependents- or -deps- ← don't shows the dependency list, we remove these
    // surrounded with spaces, to reduce changes of wrong matches
    for (const bad of [" -dependents- ", " -deps- "]) {
      if (cmd.indexOf(bad) !== -1) {
        cmd = cmd.replace(bad, " ");
      }
    }
    if (cmd.indexOf(" -deps ") !== -1) return cmd;
    const cmdl = cmd.split(" ");
    // assume latexmk -pdf [insert here] ...
    cmdl.splice(2, 0, "-deps");
    return cmdl.join(" ");
  }

  private sanitize_build_cmd(cmd: List<string>): List<string> {
    // special case "false", to disable processing
    if (cmd.get(0)?.startsWith("false")) {
      return cmd;
    }

    // Next, we ensure the output directory is correct.
    let outdir: string | undefined = undefined;
    let i: number = -1;
    for (const x of cmd) {
      i += 1;
      if (startswith(x, "-output-directory=")) {
        outdir = x;
        break;
      }
    }
    // only bother tweaking/adding the output directory, if it exists in the first place
    if (outdir != null) {
      if (this.output_directory != null) {
        // make sure it is right
        const should_be = this.output_directory_cmd_flag();
        if (outdir != should_be) {
          cmd = cmd.set(i, should_be);
        }
      } else {
        // remove it, if there is none set
        cmd = cmd.delete(i);
      }
    }

    // -dependents- or -deps- ← don't shows the dependency list, we remove these
    for (const bad of ["-dependents-", "-deps-"]) {
      const idx = cmd.indexOf(bad);
      if (idx !== -1) {
        cmd = cmd.delete(idx);
      }
    }
    // and then we make sure -deps or -dependents exists
    if (!cmd.some((x) => x === "-deps" || x === "-dependents")) {
      cmd = cmd.splice(3, 0, "-deps");
    }

    // Finally make sure the filename is right.
    const filename = path_split(this.path).tail;
    if (filename != cmd.get(cmd.size - 1)) {
      cmd = cmd.set(cmd.size - 1, filename);
    }

    return cmd;
  }

  // disable the output directory for pythontex and sagetex.
  // the main reason is that it is likely to process files, load py modules or generated images.
  // compiling tex in a tmp dir breaks all the paths. -- https://github.com/sagemathinc/cocalc/issues/4394
  // returns true, if it really made a change.
  private ensure_output_directory_disabled(): boolean {
    this.output_directory = undefined;

    // at this point we know that this.init_config already ran and set a build command
    if (this._syncdb == null) throw Error("syncdb must be defined");
    const x = this._syncdb.get_one({ key: "build_command" });
    if (x == null) return false; // should not happen

    const old_cmd: List<string> | string = x.get("value");
    let new_cmd: string[] | string =
      typeof old_cmd === "string" ? old_cmd : old_cmd.toJS();

    // fortunately, we know exactly what we have to remove
    const outdirflag = this.output_directory_cmd_flag(
      this.output_directory_path(),
    );

    let change = false;
    if (typeof old_cmd === "string") {
      const i = old_cmd.indexOf(outdirflag);
      if (i >= 0) {
        change = true;
        const before = old_cmd.slice(0, i);
        const after = old_cmd.slice(i + outdirflag.length);
        new_cmd = `${before}${after}`;
      }
    } else {
      const tmp = old_cmd.filter((x) => x != outdirflag);
      change = !tmp.equals(old_cmd);
      new_cmd = tmp.toJS();
    }

    //console.log("ensure_output_directory_disabled new_cmd", new_cmd, change);
    // don't wrap this in if-change, weird corner cases
    this.set_build_command(new_cmd);
    return change;
  }

  // this was the default until we made the new output.tsx one-stop-shop panel the default
  _classic_frame_tree_layout(): FrameTree {
    return {
      type: "node",
      direction: "col",
      first: {
        direction: "row",
        type: "node",
        first: { type: "cm" },
        second: {
          type: "node",
          direction: "col",
          first: { type: "latex_table_of_contents" },
          second: { type: "error" },
          pos: 0.3,
        },
        pos: 0.7,
      },
      second: {
        direction: "row",
        type: "node",
        first: { type: "pdfjs_canvas" },
        second: { type: "build" },
        pos: 0.7,
      },
      pos: 0.5,
    };
  }

  _new_frame_tree_layout(): FrameTree {
    return {
      type: "node",
      direction: "col",
      first: { type: "cm" },
      second: { type: "output" },
      pos: 0.5,
    };
  }

  // Override to make new layout the default
  _raw_default_frame_tree(): FrameTree {
    return this._new_frame_tree_layout();
  }

  check_for_fatal_error(): void {
    const build_logs: BuildLogs = this.store.get("build_logs");
    if (!build_logs) return;
    const errors = build_logs.getIn(["latex", "parse", "errors"]) as any;
    if (errors === undefined || errors.size < 1) return;
    const last_error = errors.get(errors.size - 1);
    let s = last_error.get("message") + last_error.get("content");
    if (s.indexOf("no output PDF") != -1) {
      // parse out the most relevant part of message...
      let i = s.indexOf("Fatal error");
      if (i !== -1) {
        s = s.slice(i);
      }
      i = s.indexOf("!");
      if (i != -1) {
        s = s.slice(0, i + 1);
      }
      const err =
        "WARNING: It is not possible to generate a useful PDF file.\n" +
        s.trim();
      console.warn(err);
      this.set_error(err);
    }
  }

  private get_streamed_latex_output(): BuildLog | undefined {
    const log = this.store.getIn(["build_logs", "latex"]) as any;
    const output = typeof log?.toJS === "function" ? log.toJS() : log;
    if (output == null || typeof output !== "object") return;
    if (!`${output.stdout ?? ""}`.trim() && !`${output.stderr ?? ""}`.trim()) {
      return;
    }
    return {
      ...output,
      time: typeof output.time === "number" ? output.time : Date.now(),
    } as BuildLog;
  }

  private is_generic_latex_transport_error(err: unknown): boolean {
    let message =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : `${(err as any)?.message ?? err ?? ""}`;
    message = message
      .replace(/^unable to run the compilation\.?\s*/i, "")
      .replace(/^error\s*:?\s*/i, "")
      .replace(/\.+$/, "")
      .trim()
      .toLowerCase();
    return (
      !message ||
      message === "an error occurred" ||
      message === "error occurred"
    );
  }

  _forget_pdf_document(): void {
    void import("./pdfjs-doc-cache").then(({ forgetDocument, url_to_pdf }) => {
      forgetDocument(
        url_to_pdf(
          this.project_id,
          this.path,
          this.store.unsafe_getIn(["reload", VIEWERS[0]]),
        ),
      );
    });
  }

  close(): void {
    this._forget_pdf_document();
    if (this.pdf_watcher != null) {
      this.pdf_watcher.close();
      this.pdf_watcher = undefined;
    }
    for (const handle of Object.values(this._chatMarkerScanners)) {
      handle.dispose();
    }
    this._chatMarkerScanners = {};
    this._disposeChatGutterUI();
    this._chatStoreDispose?.();
    this._chatStoreDispose = undefined;
    super.close();
  }

  private _disposeChatGutterUI(): void {
    for (const cache of [this._chatGutterHosts, this._bookmarkGutterHosts]) {
      for (const perCm of Object.values(cache)) {
        for (const [cm, entries] of perCm) {
          for (const entry of entries) {
            try {
              cm.setGutterMarker(entry.line, CHAT_GUTTER_ID, null);
              entry.root.unmount();
            } catch {
              // The CodeMirror pane may already be gone.
            }
          }
        }
      }
    }
    for (const perCm of Object.values(this._cursorInsertHosts)) {
      for (const [cm, entry] of perCm) {
        try {
          if (entry.currentHandle != null) {
            cm.setGutterMarker(entry.currentHandle, CHAT_GUTTER_ID, null);
          }
          entry.chatRoot.unmount();
          entry.bookmarkRoot.unmount();
        } catch {
          // The CodeMirror pane may already be gone.
        }
      }
    }
    this._chatGutterHosts = {};
    this._bookmarkGutterHosts = {};
    this._cursorInsertHosts = {};
    this._bookmarkLines = {};
    for (const perCm of Object.values(this._chatTextMarkers)) {
      for (const markers of perCm.values()) {
        for (const marker of markers) {
          marker.clear();
        }
      }
    }
    this._chatTextMarkers = {};
    for (const perCm of Object.values(this._chatTailHosts)) {
      for (const tails of perCm.values()) {
        for (const tail of tails) {
          tail.bookmark.clear();
          tail.root.unmount();
        }
      }
    }
    this._chatTailHosts = {};
  }

  // supports the "Force Rebuild" button.
  async force_build(id?: string): Promise<void> {
    if (this.is_read_only_preview()) return;
    await this.build(id, true);
  }

  private all_actions(): BaseActions<CodeEditorState>[] {
    const files = this.store.get("switch_to_files");
    if (files == null || files.size <= 1) {
      return [this as BaseActions<CodeEditorState>];
    }
    const v: BaseActions<CodeEditorState>[] = [];
    for (const path of files) {
      const actions = this.redux.getEditorActions(
        this.project_id,
        path,
      ) as BaseActions<CodeEditorState>;
      if (actions == null) continue;
      // the parent (master) file is in the switch_to_files list!
      if (this.path != path) {
        actions.set_parent_file(this.path);
      }
      v.push(actions);
    }
    return v;
  }

  // Ensure that all files that are open on this client
  // and needed for building the main file are saved to disk.
  // TODO: this could get moved up to the base class, when
  // switch_to_files is moved.
  private async save_all(explicit: boolean): Promise<void> {
    if (this.is_read_only_preview()) return;
    for (const actions of this.all_actions()) {
      await actions.save(explicit);
    }
  }

  public async explicit_save() {
    if (this.is_read_only_preview()) return;
    const account = this.redux.getStore("account");
    if (
      !account?.getIn(["editor_settings", "build_on_save"]) ||
      !this.is_likely_master()
    ) {
      // kicks off a save of all relevant files
      // Obviously, do not make this save_all(true), because
      // that would end up calling this very function again
      // crashing the browser in an INFINITE RECURSION
      // (this was a bug for a while!).
      // Also, the save of the related files is NOT
      // explicit -- the user is only explicitly saving this
      // file.  Explicit save is mainly about deleting trailing
      // whitespace and launching builds.
      await this.save_all(false);
      return;
    }
    await this.build();
  }

  // used by generic framework – this is bound to the instance, otherwise "this" is undefined, hence
  // make sure to use an arrow function!
  build = async (id?: string, force: boolean = false): Promise<void> => {
    if (this.is_read_only_preview()) return;
    this.set_error("");
    this.set_status("");
    if (id) {
      const cm = this._get_cm(id);
      if (cm) {
        cm.focus();
      }
    }
    // initiating a build. if one is running & forced, we stop the build
    if (this.is_building) {
      if (force) {
        await this.stop_build();
      } else {
        return;
      }
    }
    this.is_building = true;
    try {
      await this.save_all(false);
      await this.run_build(this.last_save_time(), force);
    } catch (err) {
      this.set_error(`${err}`);
      // if there is an error, we issue a stop, but keep the build logs
      await this.stop_build();
    } finally {
      this.is_building = false;
    }
  };

  async clean(): Promise<void> {
    if (this.is_read_only_preview()) return;
    await this.build_action("clean");
  }

  private async kill(job: ExecOutput): Promise<ExecOutput> {
    if (job.type !== "async") return job;
    const { pid, status } = job;
    if (status === "running" && typeof pid === "number") {
      try {
        await exec(
          {
            project_id: this.project_id,
            // negative PID, to kill the entire process group
            command: `kill -9 -${pid}`,
            // bash:true is necessary. kill + array does not work. IDK why.
            bash: true,
            err_on_exit: false,
          },
          this.path,
        );
      } catch (err) {
        // likely "No such process", we just ignore it
      } finally {
        // set this build log to be no longer running
        job.status = "killed";
      }
    }
    return job;
  }

  // This stops all known jobs with a status "running" and resets the state.
  async stop_build(_id?: string) {
    const build_logs = this.store.get("build_logs");
    try {
      this.is_stopping = true;
      if (build_logs) {
        for (const [name, job] of build_logs) {
          // this.kill returns the job with a modified status, it's not the kill exec itself
          this.set_build_logs({ [name]: await this.kill(job.toJS()) });
        }
      }
    } finally {
      this.set_status("");
      this.is_building = false;
      this.is_stopping = false;
    }
  }

  private async run_build(time: number, force: boolean): Promise<void> {
    if (this.is_stopping) return;
    // reset state of build_logs, since it is a fresh start
    this.setState({ build_logs: IMap() });

    if (this.bad_filename) {
      const err = `ERROR: It is not possible to compile this LaTeX file with the name '${this.path}'.
        Please modify the filename, such that it does **not** contain two or more consecutive spaces.`;
      this.set_error(err);
      return;
    }

    // for knitr related documents, we have to first build the derived tex file ...
    if (this.knitr) {
      await this.run_knitr(time, force);
      if (this.store.get("knitr_error")) return;
    }
    // update word count asynchronously
    let run_word_count: any = null;
    if (this._has_frame_of_type("word_count")) {
      run_word_count = this.word_count(time, force);
    }
    // update_pdf=false, because it is deferred until the end
    await this.run_latex(time, force, false);
    // ... and then patch the synctex file to align the source line numberings
    if (this.knitr) {
      await this.run_patch_synctex(time, force);
    }

    const s = this.store.unsafe_getIn(["build_logs", "latex", "stdout"]);
    let update_pdf = true;
    if (typeof s == "string") {
      const is_sagetex = s.indexOf("sagetex.sty") != -1;
      const is_pythontex =
        s.indexOf("pythontex.sty") != -1 || s.indexOf("PythonTeX") != -1;
      if (is_sagetex || is_pythontex) {
        if (this.ensure_output_directory_disabled()) {
          // rebuild if build command changed
          await this.run_latex(time, true, false);
        }
        update_pdf = false;
        if (is_sagetex) {
          await this.run_sagetex(time, force);
        }
        // don't make this an else-if: audacious latexer might want to run both o_O
        if (is_pythontex) {
          await this.run_pythontex(time, force);
        }
      }
    }

    // we suppress a cycle of loading the PDF if sagetex or pythontex runs above
    // because these two trigger a rebuild and update_pdf on their own at the end
    if (update_pdf) {
      this.update_pdf(time, force);
    }

    if (run_word_count != null) {
      // and finally, wait for word count to finish -- to make clear the whole operation is done
      await run_word_count;
    }
  }

  private async run_knitr(time: number, force: boolean): Promise<void> {
    if (this.is_stopping) return;
    let output: BuildLog;
    const status = (s) => this.set_status(`Running Knitr... ${s}`);
    const set_job_info = (job) => this.set_build_logs({ knitr: job });
    status("");

    try {
      output = await knitr(
        this.project_id,
        this.filename_knitr,
        this.make_timestamp(time, force),
        status,
        set_job_info,
      );
    } catch (err) {
      this.set_error(err);
      this.setState({ knitr_error: true });
      return;
    } finally {
      this.set_status("");
    }
    output.parse = knitr_errors(output).toJS();
    this.merge_parsed_output_log(output.parse);
    this.set_build_logs({ knitr: output });
    this.update_gutters();
    this.setState({ knitr_error: output.parse?.errors?.length > 0 });
  }

  async run_patch_synctex(time: number, force: boolean): Promise<void> {
    // quotes around ${s} are just so codemirror doesn't syntax highlight the rest of this file:
    const status = (s) => this.set_status(`Running Knitr/Synctex... "${s}"`);
    status("");
    try {
      await patch_synctex(
        this.project_id,
        this.path,
        this.make_timestamp(time, force),
        status,
      );
    } catch (err) {
      this.set_error(err);
      return;
    } finally {
      this.set_status("");
    }
  }

  // Return the output directory that should actually be used
  // for latexmk, synctex, etc., commands.  This depends on
  // the configured build line.  This is NOT always just
  // this.output_directory.
  private get_output_directory(): string | undefined {
    if (this.knitr) return;
    const s: string | List<string> | undefined =
      this.store.get("build_command");
    if (!s) {
      return;
    }
    if (typeof s == "string") {
      if (s.indexOf("-output-directory") == -1) {
        // we aren't going to go so far as to
        // parse a changed output-directory option...
        // At least if there is no option, we just
        // assume no output directory.
        return;
      } else {
        return this.output_directory;
      }
    } else {
      // s is a List<string>
      for (const x of s.toJS()) {
        if (x.startsWith("-output-directory")) {
          return this.output_directory;
        }
      }
      return;
    }
  }

  private async run_latex(
    time: number,
    force: boolean,
    update_pdf: boolean = true,
  ): Promise<void> {
    if (this.is_stopping) return;
    let output: BuildLog;
    let build_command: string | string[];
    const timestamp = this.make_timestamp(time, force);
    const s: string | List<string> | undefined =
      this.store.get("build_command");
    if (!s) {
      return;
    }
    this.set_error("");
    this.set_build_logs({ latex: undefined });
    // this.set_job_infos({ latex: undefined });
    if (typeof s == "string") {
      build_command = s;
    } else {
      build_command = s.toJS();
    }
    const status = (s) => this.set_status(`Running Latex... ${s}`);
    const set_job_info = (job) => this.set_build_logs({ latex: job });

    status("");
    try {
      output = await latexmk(
        this.project_id,
        this.path,
        build_command,
        timestamp,
        status,
        this.get_output_directory(),
        set_job_info,
      );
      // console.log(output);
    } catch (err) {
      const streamedOutput = this.get_streamed_latex_output();
      if (
        streamedOutput != null &&
        this.is_generic_latex_transport_error(err)
      ) {
        output = streamedOutput;
      } else {
        //console.info("LaTeX Editor/actions/run_latex error=", err);
        this.set_error(err);
        return;
      }
    } finally {
      // In all cases, we want the status info to clear
      this.set_status("");
    }
    // resetting parsed_output_log is ok, even if we do two passes.
    // the reason is that in pythontex or sagetex there is a merge *after* this step.
    // therefore, resetting this here will get rid of then stale errors related to
    // missing tokens, because pythontex or sagetex just computed them.
    this.parsed_output_log = output.parse = new LatexParser(output.stdout, {
      ignoreDuplicates: true,
    }).parse();
    this.set_build_logs({ latex: output });
    // TODO: knitr complicates multi-file a lot, so we do
    // not support it yet.
    if (!this.knitr && this.parsed_output_log.deps != null) {
      this.set_switch_to_files(this.parsed_output_log.deps);
    }
    this.check_for_fatal_error();
    this.update_gutters();
    this.update_gutters_soon();
    // Explicit PDF reload after latex compilation
    if (update_pdf) {
      this.update_pdf(time, force);
    }
  }

  // this *merges* errors from log into an eventually already existing this.parsed_output_log
  // the whole point is to keep latex errors while we add additional errors from
  // pythontex, sagetex, etc.
  private merge_parsed_output_log(log: IProcessedLatexLog) {
    // easy case, never supposed to happen
    if (this.parsed_output_log == null) {
      this.parsed_output_log = log;
      return;
    }
    for (const key of ["errors", "warnings", "typesetting", "all"]) {
      const existing = this.parsed_output_log[key];
      log[key].forEach((error) => existing.push(error));
    }
    for (const key of ["files", "deps"]) {
      this.parsed_output_log[key] = union(
        this.parsed_output_log[key],
        log[key],
      );
    }
  }

  private async update_gutters_soon(): Promise<void> {
    await delay(500);
    if (this._state == "closed") return;
    this.update_gutters();
  }

  private update_gutters(): void {
    // Defer gutter updates to avoid React rendering conflicts
    setTimeout(() => {
      // if we pass in a parsed log, we don't clean the gutters
      // it is meant to add to what we already have, e.g. for PythonTeX
      if (this.parsed_output_log == null) return;
      this.clear_gutters();
      update_gutters({
        log: this.parsed_output_log,
        set_gutter: this.set_gutter,
        actions: this,
      });
    }, 0);
  }

  private clear_gutters(): void {
    for (const actions of this.all_actions()) {
      actions.clear_gutter("Codemirror-latex-errors");
    }
  }

  private set_gutter(path: string, line: number, component: any): void {
    const canon_path = this.get_canonical_path(path);
    if (canon_path != null) {
      path = canon_path;
    }
    const actions = this.redux.getEditorActions(
      this.project_id,
      path_normalize(path),
    );
    if (actions == null) {
      return; // file not open
    }

    (actions as BaseActions<LatexEditorState>).set_gutter_marker({
      line,
      component,
      gutter_id: "Codemirror-latex-errors",
    });
  }

  // transform a relative path like file.tex or ./x/name.tex
  // to the canonical path
  private get_canonical_path(path: string): string {
    const norm = path_normalize(path);
    return this.canonical_paths[norm];
  }

  private async set_switch_to_files(files: string[]): Promise<void> {
    let switch_to_files: string[];
    const cur = this.store.get("switch_to_files");
    if (cur != null) {
      // If there's anything already there during this session
      // we keep it...
      switch_to_files = cur.toJS();
    } else {
      switch_to_files = [];
    }

    // if we're not in the home directory, prefix it to all relative paths
    let files1: string[];
    const dir = path_split(this.path).head;
    if (dir == "") {
      files1 = files;
    } else {
      files1 = [];
      for (let i = 0; i < files.length; i++) {
        if (!files[i].startsWith("/")) {
          files1.push(dir + "/" + files[i]);
        } else {
          files1.push(files[i]);
        }
      }
    }

    // Resolve dependency paths to absolute paths (prefer realpath for existing
    // files, lexical absolute fallback otherwise).
    const api = await project_api(this.project_id);
    const home = normalizeAbsolutePath(await api.getHomeDirectory());
    const baseDir = normalizeAbsolutePath(
      path_split(this.path).head || home,
      home,
    );
    let files2: string[];
    try {
      files2 = await Promise.all(
        files1.map(async (path) => {
          const absolute = normalizeAbsolutePath(path, baseDir);
          try {
            return await api.realpath(absolute);
          } catch {
            return absolute;
          }
        }),
      );
      this.setState({ includeError: "" });
    } catch (err) {
      // Safely convert error to string, handling undefined/null cases
      const errorMessage = err
        ? String(err)
        : "Unknown error checking included files";
      this.setState({ includeError: errorMessage });
      return;
    }

    // Record mappings from relative dependency names from build output logs to
    // resolved absolute paths.
    for (let i = 0; i < files2.length; i++) {
      const canon_path = files2[i];
      switch_to_files.push(canon_path);
      const norm_path = path_normalize(files[i]);
      this.relative_paths[canon_path] = norm_path;
      this.canonical_paths[norm_path] = canon_path;
    }
    // sort and make unique.
    this.setState({
      switch_to_files: Array.from(new Set(switch_to_files)).sort(),
    });
  }

  private _update_pdf(time: number, force: boolean): void {
    const timestamp = this.make_timestamp(time, force);
    // forget currently cached pdf
    this._forget_pdf_document();
    // ... before setting a new one for all the viewers,
    // which causes them to reload.
    for (const x of VIEWERS) {
      this.set_reload(x, timestamp);
    }
  }

  async run_bibtex(time: number, force: boolean): Promise<void> {
    this.set_status("Running BibTeX...");
    try {
      const output: BuildLog = await bibtex(
        this.project_id,
        this.path,
        this.make_timestamp(time, force),
        this.get_output_directory(),
      );
      this.set_build_logs({ bibtex: output });
    } catch (err) {
      this.set_error(err);
    }
    this.set_status("");
  }

  async run_sagetex(time: number, force: boolean): Promise<void> {
    if (this.is_stopping) return;
    const status = (s) => this.set_status(`Running SageTeX... ${s}`);
    const set_job_info = (job) => this.set_build_logs({ sagetex: job });
    status("");
    // First compute hash of sagetex file.
    let hash: string = "";
    if (!force) {
      try {
        hash = await sagetex_hash(
          this.project_id,
          this.path,
          time,
          status,
          this.get_output_directory(),
        );
        if (hash === this._last_sagetex_hash) {
          // no change - nothing to do except updating the pdf preview
          this.update_pdf(time, force);
          return;
        }
      } catch (err) {
        this.set_error(err);
        this.update_pdf(time, force);
        return;
      } finally {
        this.set_status("");
      }
    }

    let output: BuildLog | undefined;
    try {
      // Next run Sage.
      output = await sagetex(
        this.project_id,
        this.path,
        hash,
        status,
        this.get_output_directory(),
        set_job_info,
      );
      if (!output) throw new Error("Unable to run SageTeX.");
      if (output.stderr.indexOf("sagetex.VersionError") != -1) {
        // See https://github.com/sagemathinc/cocalc/issues/4432
        throw Error(
          "SageTex in CoCalc currently only works with the default version of Sage.  Delete ~/bin/sage and try again.",
        );
      }
      // Now Run LaTeX, since we had to run sagetex, which changes the sage output.
      // This +1 forces re-running latex... but still deduplicates it in case of multiple users.
      await this.run_latex(time + 1, force);
    } catch (err) {
      this.set_error(err);
      this.update_pdf(time, force);
    } finally {
      this._last_sagetex_hash = hash;
      this.set_status("");
    }

    if (output != null) {
      // process any errors
      output.parse = sagetex_errors(path_split(this.path).tail, output).toJS();
      this.merge_parsed_output_log(output.parse);
      this.set_build_logs({ sagetex: output });
      // there is no line information in the sagetex errors (and no concordance info either),
      // hence we can't update the gutters.
    }
  }

  async run_pythontex(time: number, force: boolean): Promise<void> {
    if (this.is_stopping) return;
    let output: BuildLog;
    const status = (s) => this.set_status(`Running PythonTeX... ${s}`);
    const set_job_info = (job) => this.set_build_logs({ pythontex: job });
    status("");

    try {
      // Run PythonTeX
      output = await pythontex(
        this.project_id,
        this.path,
        time,
        force,
        status,
        this.get_output_directory(),
        set_job_info,
      );
      // Now run latex again, since we had to run pythontex, which changes the inserted snippets.
      // This +2 forces re-running latex... but still deduplicates it in case of multiple users. (+1 is for sagetex)
      await this.run_latex(time + 2, force);
    } catch (err) {
      this.set_error(err);
      // this.setState({ pythontex_error: true });
      this.update_pdf(time, force);
      return;
    } finally {
      this.set_status("");
    }
    // this is similar to how knitr errors are processed
    output.parse = pythontex_errors(path_split(this.path).tail, output).toJS();
    this.merge_parsed_output_log(output.parse);
    this.set_build_logs({ pythontex: output });
    this.update_gutters();
  }

  async synctex_pdf_to_tex(
    page: number,
    x: number,
    y: number,
    manual: boolean = false,
  ): Promise<void> {
    // Only check auto sync flag for automatic sync, not manual double-clicks
    if (!manual && this.is_auto_sync_in_progress()) {
      return; // Prevent sync loops
    }

    if (!manual) {
      this.set_auto_sync_in_progress(true);
    }
    this.set_status("Running SyncTex...");
    try {
      const info = await synctex.pdf_to_tex({
        x,
        y,
        page,
        pdf_path: pdf_path(this.path),
        project_id: this.project_id,
        output_directory: this.get_output_directory(),
        src: this.path,
      });
      const line = info.Line;
      if (typeof line != "number") {
        // TODO: would be nicer to handle this at the source...
        throw Error("invalid synctex output (Line must be a number).");
      }
      if (typeof info.Input != "string") {
        throw Error("unable to determine source file");
      }
      await this.goto_line_in_file(line, info.Input);
    } catch (err) {
      if (err.message.indexOf("ENOENT") != -1) {
        console.log("synctex_pdf_to_tex err:", err);
        // err is just a string exception, and I'm nervous trying
        // to JSON.parse it, so we'll do something less robust,
        // which should have a sufficiently vague message that
        // it is OK.  When you try to run synctex and the synctex
        // file is missing, you get an error with ENOENT in it...
        this.set_error(
          'Synctex failed to run.  Try "Force Rebuild" your project (use the Build frame) or retry once the build is complete.',
        );
        // Clear flag since sync failed (only for automatic sync)
        if (!manual) {
          this.set_auto_sync_in_progress(false);
        }
        return;
      }
      console.warn("ERROR ", err);
      this.set_error(err);
      // Clear flag since sync failed (only for automatic sync)
      if (!manual) {
        this.set_auto_sync_in_progress(false);
      }
    } finally {
      this.set_status("");
    }
  }

  public async goto_line_in_file(line: number, path: string): Promise<void> {
    if (path.indexOf("/.") != -1 || path.indexOf("./") != -1) {
      const api = await project_api(this.project_id);
      const baseDir = path_split(this.path).head || "/";
      const normalized = normalizeAbsolutePath(path, baseDir);
      try {
        path = await api.realpath(normalized);
      } catch {
        path = normalized;
      }
    }
    if (this.knitr) {
      // #v0 will not support multi-file knitr.
      this.programmatically_goto_line(line, true, true);
      this.clear_auto_sync_after_cursor_move();
      return;
    }
    // Focus a cm frame so that we split a code editor below.
    //this.show_focused_frame_of_type("cm");
    // focus/show/open the proper file, then go to the line.
    const id = await this.switch_to_file(path);
    // TODO: go to appropriate line in this editor.
    const actions = this.redux.getEditorActions(this.project_id, path);
    if (actions == null) {
      throw Error(`actions for "${path}" must be defined`);
    }
    (actions as BaseActions).programmatically_goto_line(line, true, true, id);

    this.clear_auto_sync_after_cursor_move();
  }

  // Clear auto sync flag after cursor has moved (backward sync completion)
  private clear_auto_sync_after_cursor_move(): void {
    // Only for automatic sync - manual sync doesn't set the flag
    if (this.is_auto_sync_in_progress()) {
      setTimeout(() => {
        this.set_auto_sync_in_progress(false);
      }, 200); // Give time for cursor to actually move
    }
  }

  // Check if forward auto-sync (CM → PDF) is enabled for any output panel
  private is_auto_sync_forward_enabled(): boolean {
    const local_view_state = this.store.get("local_view_state");
    if (!local_view_state) return false;

    // Check all output panels for forward auto-sync enabled
    for (const [key, value] of local_view_state.entrySeq()) {
      // Only check output panels
      if (this._is_output_panel(key) && value) {
        const autoSyncForward =
          typeof value.get === "function"
            ? value.get("autoSyncForward")
            : value.autoSyncForward;
        if (autoSyncForward) {
          return true;
        }
      }
    }
    return false;
  }

  // Set auto sync in progress flag in state
  private set_auto_sync_in_progress(inProgress: boolean): void {
    this.setState({ autoSyncInProgress: inProgress });
  }

  // Check if auto sync is currently in progress
  private is_auto_sync_in_progress(): boolean {
    return this.store.get("autoSyncInProgress") ?? false;
  }

  // Handle cursor movement - called by BaseActions.set_cursor_locs
  public handle_cursor_move(locs: any[]): void {
    if (!this.is_auto_sync_forward_enabled() || locs.length === 0) return;

    // Prevent duplicate sync operations
    if (this.is_auto_sync_in_progress()) return;

    // Throttle sync operations to prevent excessive calls (max once every 500ms)
    const now = Date.now();
    if (now - this._last_sync_time < 500) return;
    this._last_sync_time = now;

    // Get the primary cursor position (first in the array)
    const cursor = locs[0];
    if (typeof cursor?.y === "number" && typeof cursor?.x === "number") {
      // Trigger forward sync (source → PDF)
      this.handle_cursor_sync_to_pdf(cursor.y + 1, cursor.x, this.path); // y is 0-based, synctex expects 1-based
    }
  }

  _get_most_recent_pdfjs(): string | undefined {
    return this._get_most_recent_active_frame_id(
      (node) => node.get("type").indexOf("pdfjs") != -1,
    );
  }

  _get_most_recent_output_panel(): string | undefined {
    let result = this._get_most_recent_active_frame_id_of_type("output");
    // console.log(
    //   "LaTeX: _get_most_recent_output_panel() via active history returning",
    //   result,
    // );

    // If no recently active output panel found, look for any output panel
    if (!result) {
      result = this._get_any_frame_id_of_type("output");
      //console.log("LaTeX: _get_any_frame_id_of_type() returning", result);
    }

    return result;
  }

  // Helper method to find any frame of the given type, regardless of activity history
  _get_any_frame_id_of_type(type: string): string | undefined {
    const tree = this._get_tree();
    const leaf_ids = tree_ops.get_leaf_ids(tree);

    for (const id in leaf_ids) {
      const node = tree_ops.get_node(tree, id);
      if (node && node.get("type") === type) {
        return id;
      }
    }
    return undefined;
  }

  // Switch output panel to PDF tab for SyncTeX
  _switch_output_panel_to_pdf(output_panel_id: string): void {
    // This will be handled by the output panel component
    // We set a state that the output panel can react to
    this.setState({
      switch_output_to_pdf_tab: true,
      output_panel_id_for_sync: output_panel_id,
    });
  }

  async synctex_tex_to_pdf(
    line: number,
    column: number,
    filename: string,
  ): Promise<void> {
    // First figure out where to jump to in the PDF.
    this.set_status("Running SyncTex from tex to pdf...");
    let info;
    const source_dir: string = path_split(this.path).head;
    let dir: string | undefined = this.get_output_directory();
    if (dir === undefined) {
      dir = source_dir;
    }
    try {
      info = await synctex.tex_to_pdf({
        line,
        column,
        dir,
        tex_path: filename,
        pdf_path: pdf_path(this.path),
        project_id: this.project_id,
        knitr: this.knitr,
        source_dir,
      });
    } catch (err) {
      console.warn("ERROR ", err);
      this.set_error(err);
      return;
    } finally {
      this.set_status("");
    }
    // Next get a PDF to jump to.
    // First check if there's an output panel, which contains a PDF viewer
    let output_panel_id: string | undefined =
      this._get_most_recent_output_panel();
    let pdfjs_id: string | undefined;

    // console.log("LaTeX forward sync: output_panel_id =", output_panel_id);

    if (output_panel_id) {
      // There's an output panel - switch it to PDF tab and use it
      // console.log("LaTeX forward sync: Using output panel", output_panel_id);
      this._switch_output_panel_to_pdf(output_panel_id);
      pdfjs_id = output_panel_id;
    } else {
      // No output panel, look for standalone PDF viewer
      // console.log(
      //   "LaTeX forward sync: No output panel found, looking for standalone PDFJS",
      // );
      pdfjs_id = this._get_most_recent_pdfjs();
      if (!pdfjs_id) {
        // no pdfjs preview, so make one
        // console.log("LaTeX forward sync: Creating new PDFJS panel");
        this.split_frame("col", this._get_active_id(), "pdfjs_canvas");
        pdfjs_id = this._get_most_recent_pdfjs();
        if (!pdfjs_id) {
          throw Error("BUG -- there must be a pdfjs frame.");
        }
      }
    }
    const full_id: string | undefined = this.store.getIn([
      "local_view_state",
      "full_id",
    ]);
    if (full_id && full_id != pdfjs_id) {
      this.unset_frame_full();
    }
    // Now show the preview in the right place.
    this.scroll_pdf_into_view(info.Page as number, info.y as number, pdfjs_id);
  }

  // Scroll the pdf preview frame with given id into view.
  scroll_pdf_into_view(page: number, y: number, id: string): void {
    this.setState({
      scroll_pdf_into_view: new ScrollIntoViewRecord({ page, y, id }),
    });
  }

  // Check if the given ID is an output panel
  _is_output_panel(id: string): boolean {
    const frame = this._get_frame_node(id);
    const frameType = frame?.get("type");
    return frameType === "output";
  }

  // Public method to save local view state (delegates to parent's debounced method)
  save_local_view_state(): void {
    (this as any)._save_local_view_state();
  }

  private set_build_logs(obj: { [K in keyof IBuildSpecs]?: BuildLog }): void {
    let build_logs: BuildLogs = this.store.get("build_logs") ?? IMap();
    let k: BuildSpecName;
    for (k in obj) {
      const v: BuildLog | undefined = obj[k];
      if (v) {
        build_logs = build_logs.set(k, fromJS(v) as any as TypedMap<BuildLog>);
      } else {
        build_logs = build_logs.delete(k);
      }
    }
    this.setState({ build_logs });
  }

  async run_clean(): Promise<void> {
    let log: string = "";
    this.setState({ build_logs: IMap() });

    const logger = (s: string): void => {
      log += s + "\n";
      const build_logs: BuildLogs = this.store.get("build_logs");
      this.setState({
        build_logs: build_logs.set(
          "clean",
          fromJS({ output: log }) as any as TypedMap<BuildLog>,
        ),
      });
    };

    this.set_status("Cleaning up auxiliary files...");
    try {
      await clean(
        this.project_id,
        this.path,
        this.knitr,
        logger,
        this.get_output_directory(),
      );
    } catch (err) {
      this.set_error(`Error cleaning auxiliary files -- ${err}`);
    }
    this.set_status("");
  }

  // TODO: is this used in any way besides build_action("clean") ?
  private async build_action(action: string, force?: boolean): Promise<void> {
    if (this.is_read_only_preview()) return;
    if (force === undefined) {
      force = false;
    }
    const now: number = server_time().valueOf();
    switch (action) {
      case "build":
        await this.run_build(now, false);
        return;
      case "latex":
        await this.run_latex(now, false);
        return;
      case "bibtex":
        await this.run_bibtex(now, false);
        return;
      case "sagetex":
        await this.run_sagetex(now, false);
        return;
      case "pythontex":
        await this.run_pythontex(now, false);
        return;
      case "clean":
        await this.run_clean();
        return;
      default:
        this.set_error(`unknown build action '${action}'`);
    }
  }

  // time 0 implies to take the last_save_time,
  make_timestamp(time: number, force: boolean): number {
    return force ? Date.now() : time || this.last_save_time();
  }

  private async _word_count(
    time: number,
    force: boolean,
    skipFramePopup: boolean = false,
  ): Promise<void> {
    // only run word count if at least one such panel exists or skipFramePopup is true
    if (!skipFramePopup) {
      this.show_recently_focused_frame_of_type("word_count");
    }

    try {
      const timestamp = this.make_timestamp(time, force);
      const output = await count_words(this.project_id, this.path, timestamp);
      if (output.stderr) {
        const err = `Error:\n${output.stderr}`;
        this.setState({ word_count: err });
      } else {
        this.setState({ word_count: output.stdout });
      }
    } catch (err) {
      this.setState({
        word_count: `Error running word count:\n${err instanceof Error ? err.message : `${err}`}`,
      });
    }
  }

  help(): void {
    openProjectDocs({ projectId: this.project_id, slug: HELP_SLUG });
  }

  zoom_page_width(id: string): void {
    this.setState({ zoom_page_width: id });
  }

  zoom_page_height(id: string): void {
    this.setState({ zoom_page_height: id });
  }

  sync(id: string, editor_actions: Actions): void {
    const cm = editor_actions._cm[id];
    if (cm != null) {
      // Clicked the sync button from within an editor
      this.forward_search(cm, editor_actions.path);
    } else {
      // Clicked button associated to a preview pane;
      // let the preview pane do the work.
      this.setState({ sync: id });
    }
  }

  private forward_search(cm: CodeMirror.Editor, path: string): void {
    const { line, ch } = cm.getDoc().getCursor();
    if (this.relative_paths[path] != null) {
      path = this.relative_paths[path];
    }
    this.synctex_tex_to_pdf(line, ch, path);
  }

  time_travel(opts: { path?: string; frame?: boolean }): void {
    // knitr case: point to editor file, not the generated tex
    // https://github.com/sagemathinc/cocalc/issues/3336
    if (this.knitr) {
      super.time_travel({ path: this.filename_knitr, frame: opts.frame });
    } else {
      super.time_travel(opts);
    }
  }

  download_pdf(): void {
    const path: string = pdf_path(this.path);

    // we use auto false and true, since the pdf may not exist, and we don't want
    // a **silent failure**.  With auto:false, the pdf appears in a new tab
    // and user has to click again to actually get it on their computer, but
    // auto:true makes it so it downloads automatically to avoid that click.
    // If there is an error, that is clear too.
    this.redux
      .getProjectActions(this.project_id)
      .download_file({ path, log: true, auto: false });
    this.redux
      .getProjectActions(this.project_id)
      .download_file({ path, log: false, auto: true });
  }

  print(id: string): void {
    const node = this._get_frame_node(id);
    if (node == null) {
      throw Error(`BUG -- no node with id ${id}`);
    }
    const type: string = node.get("type");

    if (type == "cm") {
      super.print(id);
      return;
    }
    if (type.indexOf("pdf") != -1 || type === "output") {
      this.print_pdf();
      return;
    }
    throw Error(`BUG -- printing not implement for node of type ${type}`);
  }

  print_pdf(): void {
    print_html({ src: raw_url(this.project_id, pdf_path(this.path)) });
  }

  set_build_command(command: string | string[]): void {
    if (this.is_read_only_preview()) {
      this.setState({ build_command: fromJS(command) });
      return;
    }
    if (this._syncdb == null) throw Error("syncdb must be defined");
    // I deleted the insane time:now in this syncdb set, since that
    // would seem to generate an insane amount of traffic (and I'm
    // surprised it wouldn't generate a feedback loop)!
    this._syncdb.set({ key: "build_command", value: command });
    this._syncdb.commit();
    this.save_build_command_config_to_disk();
    this.setState({ build_command: fromJS(command) });
  }

  private save_build_command_config_to_disk(): void {
    const syncdb = this._syncdb;
    if (syncdb == null) return;
    void saveToDiskWithFileServerRetry({
      save: () => syncdb.save_to_disk(),
      shouldRetry: () => this._state !== "closed" && !this.isClosed(),
    }).catch((err) => {
      if (this._state !== "closed") {
        this.set_error(
          `Error saving LaTeX build command for '${this.path}' -- ${err}`,
        );
      }
    });
  }

  // if id is given, switch that frame to edit the given path;
  // if not given, switch an existing cm editor (or find one if there
  // is already one pointed at this path.)
  public async switch_to_file(path: string, id?: string): Promise<string> {
    id = await super.switch_to_file(path, id);
    this.update_gutters_soon();
    return id;
  }

  public async show_table_of_contents(
    _id: string | undefined = undefined,
  ): Promise<void> {
    const id = this.show_focused_frame_of_type(
      "latex_table_of_contents",
      "col",
      true,
      1 / 3,
    );
    // the click to select TOC focuses the active id back on the notebook
    await delay(0);
    if (this._state === "closed") return;
    this.set_active_id(id, true);
  }

  public updateTableOfContents(force: boolean = false): void {
    if (
      this._state == "closed" ||
      this._syncstring == null ||
      this._syncstring.get_state?.() != "ready"
    ) {
      // no need since not initialized yet or already closed.
      return;
    }
    if (
      !force &&
      !this.get_matching_frame({ type: "latex_table_of_contents" }) &&
      !this.get_matching_frame({ type: "output" })
    ) {
      // There is no table of contents frame or output frame so don't update that info.
      return;
    }
    let value = "";
    try {
      value = this._syncstring.to_str() ?? "";
    } catch {
      // sync doc can race during startup/refresh.
      return;
    }
    const entries = parseTableOfContents(value, {
      includeBookmarks: true,
      includeChatMarkers: true,
    });
    this._appendSubfileTocEntries(entries);
    const contents = fromJS(entries) as any;
    this.setState({ contents });
  }

  // Append TOC content from *included* files: their section headings,
  // chat markers, and bookmarks (the master's are already overlaid by
  // parseTableOfContents).  We can't interleave across files by line
  // number, so each open sub-file contributes a group at the end,
  // introduced by a clickable file entry.  Markers/bookmarks are deduped
  // against the master (same hash / bookmark text).  Only files the
  // chat-marker scanner watches (i.e. open sub-files) are included.
  private _appendSubfileTocEntries(entries: TableOfContentsEntry[]): void {
    const chatMarkers = this.store.get("chat_markers");
    const chatBookmarks = this.store.get("chat_bookmarks");
    if (chatMarkers == null && chatBookmarks == null) return;
    const seenHashes = new Set<string>();
    for (const e of entries) {
      const extra = (e as any)?.extra;
      if (extra?.kind === "chat" && typeof extra.hash === "string") {
        seenHashes.add(extra.hash);
      }
    }
    const seenBookmarks = new Set<string>(
      ((chatBookmarks?.get(this.path)?.toJS() ?? []) as any[]).map(
        (b) => b.text,
      ),
    );
    const subPaths = new Set<string>([
      ...((chatMarkers?.keySeq().toJS() ?? []) as string[]),
      ...((chatBookmarks?.keySeq().toJS() ?? []) as string[]),
    ]);
    subPaths.delete(this.path);
    for (const path of [...subPaths].sort()) {
      const tail = path_split(path).tail;
      const group: TableOfContentsEntry[] = [];

      // Section headings from the sub-file's live syncstring.
      const subActions: any = this.redux.getEditorActions(
        this.project_id,
        path,
      );
      let subText: string | undefined;
      try {
        subText = subActions?._syncstring?.to_str();
      } catch {
        // not ready yet; headings will appear on a later rescan
      }
      if (subText) {
        for (const h of parseTableOfContents(subText)) {
          group.push({
            id: `sub:${path}:${h.id}-heading`,
            value: h.value,
            level: h.level,
            extra: { kind: "line", path, line: parseInt(h.id) - 1 },
          });
        }
      }

      const markers = (chatMarkers?.get(path)?.toJS() ??
        []) as unknown as ChatMarker[];
      for (const m of markers) {
        if (seenHashes.has(m.hash)) continue;
        seenHashes.add(m.hash);
        group.push({
          id: `sub:${path}:${m.line + 1}-chat-${m.hash}`,
          value: `Chat ${m.hash} (line ${m.line + 1})`,
          level: 6,
          icon: "comment",
          // line is only used for in-group ordering; jumping goes via
          // the hash (jumpToAnchor) so it survives marker moves.
          extra: { kind: "chat", hash: m.hash, path, line: m.line },
        });
      }
      const bookmarks = (chatBookmarks?.get(path)?.toJS() ??
        []) as unknown as BookmarkMarker[];
      for (const b of bookmarks) {
        if (seenBookmarks.has(b.text)) continue;
        seenBookmarks.add(b.text);
        group.push({
          id: `sub:${path}:${b.line + 1}-bookmark-${b.text}`,
          value: b.text,
          level: 6,
          icon: "tag-outlined",
          extra: { kind: "line", path, line: b.line },
        });
      }

      if (group.length === 0) continue;
      // Keep each file's entries in document order.
      group.sort(
        (a, b) =>
          (((a as any).extra?.line ?? 0) as number) -
          (((b as any).extra?.line ?? 0) as number),
      );
      entries.push({
        id: `sub:${path}:0-file`,
        value: `**${tail}**`,
        icon: "tex-file",
        extra: { kind: "line", path, line: 0 },
      });
      entries.push(...group);
    }
  }

  public async scrollToHeading(entry: TableOfContentsEntry): Promise<void> {
    const extra = (entry as any)?.extra;
    // Chat markers jump via the anchor adapter (handles sub-files and
    // markers that moved since the TOC was computed).
    if (extra?.kind === "chat" && typeof extra.hash === "string") {
      await this.jumpToAnchor(extra.hash);
      return;
    }
    // Entries from included files (file header, headings, bookmarks)
    // carry their own path + line.
    if (extra?.kind === "line" && typeof extra.path === "string") {
      const frameId = await this._switchFocusedSourceTo(extra.path);
      if (frameId == null) return;
      await this._gotoSourceLine(extra.path, (extra.line ?? 0) + 1, frameId);
      return;
    }
    // Plain entries come from the master document.  The last-focused
    // source pane may currently show an included file, so retarget that
    // pane before applying the master line number.
    const frameId = await this._switchFocusedSourceTo(this.path);
    if (frameId == null) return;
    await this._gotoSourceLine(this.path, parseInt(entry.id), frameId);
  }

  // ===== Chat anchors =======================================================
  //
  // A `% chat: <hash>` comment in the tex source anchors a thread in the
  // side chat.  We scan the master file (and each open sub-file) for
  // markers on every syncstring change, then render a gutter icon + badge
  // on each marker line.  The per-anchor threads live in the master
  // `.sage-chat`; their thread-config rows carry `anchor.id = <hash>` and
  // optionally `anchor.path = <sub-file>`.  See chat-markers.ts for the
  // marker format and @cocalc/frontend/chat/anchors for the thread side.

  private _chatMarkerScanners: {
    [path: string]: { dispose: () => void; rescan: () => void };
  } = {};

  // CodeMirror owns gutter DOM, so keep one persistent React root per
  // CodeMirror pane.  Going through the editor's Redux gutter state makes
  // split panes compete for the same host and causes visible flicker.
  private _chatGutterHosts: {
    [path: string]: Map<
      CodeMirror.Editor,
      Array<{ host: HTMLElement; root: Root; line: number }>
    >;
  } = {};

  private _bookmarkGutterHosts: {
    [path: string]: Map<
      CodeMirror.Editor,
      Array<{ host: HTMLElement; root: Root; line: number }>
    >;
  } = {};

  private _bookmarkLines: { [path: string]: Set<number> } = {};

  private _cursorInsertHosts: {
    [path: string]: Map<
      CodeMirror.Editor,
      {
        host: HTMLElement;
        chatRoot: Root;
        bookmarkRoot: Root;
        currentHandle: CodeMirror.LineHandle | null;
      }
    >;
  } = {};

  private _cursorInsertBound = new WeakSet<CodeMirror.Editor>();
  private _chatClickHandlerInstalled = new WeakSet<CodeMirror.Editor>();
  private _chatKeybindingInstalled = new WeakSet<CodeMirror.Editor>();
  private _chatTailTrackingInstalled = new WeakSet<CodeMirror.Editor>();

  private _chatTextMarkers: {
    [path: string]: Map<CodeMirror.Editor, CodeMirror.TextMarker[]>;
  } = {};

  private _chatTailHosts: {
    [path: string]: Map<
      CodeMirror.Editor,
      Array<{
        bookmark: CodeMirror.TextMarker;
        host: HTMLElement;
        root: Root;
      }>
    >;
  } = {};

  private _chatStoreDispose?: () => void;

  private _initChatMarkers(): void {
    this._attachChatMarkerScanner(this, this.path);
    this._initChatAnchorLockListener();
    // Sub-files get picked up whenever the build discovers dependencies
    // (set_switch_to_files) or the store otherwise changes.
    this.store.on(
      "change",
      debounce(
        () => {
          if (this._state === ("closed" as any)) return;
          this._refreshChatMarkerScanners();
        },
        1000,
        { leading: false, trailing: true },
      ),
    );
  }

  private _refreshChatMarkerScanners(): void {
    const wanted = new Set<string>();
    for (const actions of this.all_actions()) {
      const path = (actions as any).path;
      if (typeof path !== "string" || !path) continue;
      wanted.add(path);
      this._attachChatMarkerScanner(actions, path);
      this._ensureChatGutterUI(path);
    }
    for (const path of Object.keys(this._chatMarkerScanners)) {
      if (wanted.has(path)) continue;
      this._chatMarkerScanners[path].dispose();
      delete this._chatMarkerScanners[path];
      this._disposeChatStateForPath(path);
      const chatMarkers = this.store.get("chat_markers");
      const invalidChatMarkers = this.store.get("invalid_chat_markers");
      const chatBookmarks = this.store.get("chat_bookmarks");
      this.setState({
        chat_markers: chatMarkers?.delete(path),
        invalid_chat_markers: invalidChatMarkers?.delete(path),
        chat_bookmarks: chatBookmarks?.delete(path),
      });
    }
  }

  private _disposeChatStateForPath(path: string): void {
    for (const cache of [this._chatGutterHosts, this._bookmarkGutterHosts]) {
      const perCm = cache[path];
      if (perCm == null) continue;
      for (const [cm, entries] of perCm) {
        for (const entry of entries) {
          try {
            cm.setGutterMarker(entry.line, CHAT_GUTTER_ID, null);
            entry.root.unmount();
          } catch {
            // The CodeMirror pane may already be gone.
          }
        }
      }
      delete cache[path];
    }
    const cursorHosts = this._cursorInsertHosts[path];
    if (cursorHosts != null) {
      for (const [cm, entry] of cursorHosts) {
        try {
          if (entry.currentHandle != null) {
            cm.setGutterMarker(entry.currentHandle, CHAT_GUTTER_ID, null);
          }
          entry.chatRoot.unmount();
          entry.bookmarkRoot.unmount();
        } catch {
          // The CodeMirror pane may already be gone.
        }
      }
      delete this._cursorInsertHosts[path];
    }
    delete this._bookmarkLines[path];
    this._clearChatTextDecorations(path);
  }

  private _attachChatMarkerScanner(actions: any, path: string): void {
    if (this._chatMarkerScanners[path] != null) return;
    const syncstring = (actions as any)._syncstring;
    if (syncstring == null) return;
    const scan = (publishNewInvalidMarkers: boolean) => {
      if (this._state === ("closed" as any)) return;
      if (syncstring.get_state?.() !== "ready") return;
      let text: string;
      try {
        text = syncstring.to_str() ?? "";
      } catch {
        // syncstring not ready yet -- a later change event will rescan.
        return;
      }
      const markers = scanMarkers(text);
      const scannedInvalidMarkers = scanInvalidMarkers(text);
      const previousInvalidMarkers = (this.store
        .get("invalid_chat_markers")
        ?.get(path)
        ?.toJS() ?? []) as unknown as InvalidChatMarker[];
      // Invalid diagnostics are deliberately slower than valid marker
      // discovery. While the user is typing `% chat: subfile-123`, every
      // short prefix is temporarily invalid; rendering a widget at that
      // point interferes with the cursor. Existing diagnostics still clear
      // promptly once their exact source text is fixed or deleted.
      const invalidMarkers = publishNewInvalidMarkers
        ? scannedInvalidMarkers
        : scannedInvalidMarkers.filter((candidate) =>
            previousInvalidMarkers.some(
              (previous) =>
                previous.line === candidate.line &&
                previous.col === candidate.col &&
                previous.text === candidate.text,
            ),
          );
      const bookmarks = scanBookmarks(text);
      const previousMarkers = (this.store
        .get("chat_markers")
        ?.get(path)
        ?.toJS() ?? []) as unknown as ChatMarker[];
      this.setState({
        chat_markers: (
          this.store.get("chat_markers") ?? (fromJS({}) as any)
        ).set(path, fromJS(markers)),
        invalid_chat_markers: (
          this.store.get("invalid_chat_markers") ?? (fromJS({}) as any)
        ).set(path, fromJS(invalidMarkers)),
        chat_bookmarks: (
          this.store.get("chat_bookmarks") ?? (fromJS({}) as any)
        ).set(path, fromJS(bookmarks)),
      });
      this._reconcileEmptyAnchorThread(path, previousMarkers, markers);
      this._updateChatGutters(path, markers, bookmarks);
      this._refreshChatMarkerText(path);
      this._refreshCursorInsert(path);
      if (path !== this.path) {
        // master changes already refresh the TOC via their own listener
        this.updateTableOfContents();
      }
    };
    const debounced = debounce(() => scan(false), 300, {
      leading: false,
      trailing: true,
    });
    const debouncedInvalid = debounce(() => scan(true), 1200, {
      leading: false,
      trailing: true,
    });
    const onChange = () => {
      debounced();
      debouncedInvalid();
    };
    syncstring.on("change", onChange);
    const onReady = () => scan(true);
    syncstring.once("ready", onReady);
    this._chatMarkerScanners[path] = {
      dispose: () => {
        debounced.cancel();
        debouncedInvalid.cancel();
        syncstring.removeListener("change", onChange);
        syncstring.removeListener("ready", onReady);
      },
      rescan: () => scan(true),
    };
    scan(true);
    this._ensureChatGutterUI(path);
  }

  /**
   * cocalc-ai represents a not-yet-messaged anchor as a config-only thread,
   * whereas cocalc.com keeps a separate pending anchor.  Follow a direct
   * source edit of that marker id so the first eventual message is attached
   * to the id the document actually contains.
   */
  private _reconcileEmptyAnchorThread(
    path: string,
    previous: ChatMarker[],
    next: ChatMarker[],
  ): void {
    let chatActions;
    try {
      chatActions = ensureSideChatActions(this.project_id, this.path);
    } catch {
      return;
    }
    const selectedKey = `${chatActions.store?.get("selectedThreadKey") ?? ""}`;
    if (!selectedKey || selectedKey === "0") return;
    const row = chatActions
      .listThreadConfigRows()
      .find((candidate) => candidate?.thread_id === selectedKey);
    if (row == null || parseThreadResolved(row.resolved) != null) return;
    const anchor = parseThreadAnchor(row.anchor);
    if (anchor == null || (anchor.path ?? this.path) !== path) return;
    if (
      (chatActions.getThreadIndex().get(selectedKey)?.messageCount ?? 0) !== 0
    ) {
      return;
    }
    const replacement = replacementMarkerHash(previous, next, anchor.id);
    if (replacement == null) return;
    chatActions.setThreadAnchor(selectedKey, {
      id: replacement,
      ...(anchor.path ? { path: anchor.path } : undefined),
    });
    chatActions.renameThread(selectedKey, this.getAnchorLabel(replacement));
  }

  private _updateChatGutters(
    path: string,
    markers: ChatMarker[],
    bookmarks: BookmarkMarker[],
  ): void {
    const actions = this._actionsForChatPath(path);
    if (actions == null) return;
    const cms = Object.values(
      ((actions as any)._cm ?? {}) as Record<string, CodeMirror.Editor>,
    );
    if (cms.length === 0) return;

    const openAnchorChat = (hash: string, markerPath: string) => {
      void this.openAnchorChat(
        hash,
        markerPath === this.path ? undefined : markerPath,
      );
    };
    const openAnchorChatThread = (threadKey: string) => {
      void this.openAnchorChatThread(threadKey);
    };
    const removeStaleMarker = (hash: string, markerPath: string) => {
      this._removeChatMarkersForHash(markerPath, hash);
    };

    const chatTargets: Array<{ line: number; hash: string }> = [];
    const seenChatLines = new Set<number>();
    for (const marker of markers) {
      if (seenChatLines.has(marker.line)) continue;
      seenChatLines.add(marker.line);
      chatTargets.push({ line: marker.line, hash: marker.hash });
    }
    this._updateNativeGutterHosts({
      path,
      cms,
      targets: chatTargets,
      cache: this._chatGutterHosts,
      render: (root, target) => {
        root.render(
          React.createElement(ChatMarkerGutter, {
            hash: target.hash,
            path,
            masterPath: this.path,
            project_id: this.project_id,
            openAnchorChat,
            openAnchorChatThread,
            removeStaleMarker,
          }),
        );
      },
    });

    const seenBookmarkLines = new Set<number>();
    const bookmarkTargets: Array<{ line: number; text: string }> = [];
    for (const bookmark of bookmarks) {
      if (seenBookmarkLines.has(bookmark.line)) continue;
      seenBookmarkLines.add(bookmark.line);
      bookmarkTargets.push({ line: bookmark.line, text: bookmark.text });
    }
    this._bookmarkLines[path] = seenBookmarkLines;
    this._updateNativeGutterHosts({
      path,
      cms,
      targets: bookmarkTargets,
      cache: this._bookmarkGutterHosts,
      render: (root, target) => {
        root.render(React.createElement(BookmarkGutter, { text: target.text }));
      },
    });
  }

  private _actionsForChatPath(
    path: string,
  ): BaseActions<CodeEditorState> | undefined {
    const actions =
      path === this.path
        ? this
        : this.redux.getEditorActions(this.project_id, path_normalize(path));
    if (actions == null || (actions as any)._state === "closed") {
      return undefined;
    }
    return actions as BaseActions<CodeEditorState>;
  }

  private _updateNativeGutterHosts<T extends { line: number }>({
    path,
    cms,
    targets,
    cache,
    render,
  }: {
    path: string;
    cms: CodeMirror.Editor[];
    targets: T[];
    cache: {
      [path: string]: Map<
        CodeMirror.Editor,
        Array<{ host: HTMLElement; root: Root; line: number }>
      >;
    };
    render: (root: Root, target: T) => void;
  }): void {
    const perCm = cache[path] ?? (cache[path] = new globalThis.Map());
    const liveCms = new Set(cms);
    for (const staleCm of [...perCm.keys()]) {
      if (liveCms.has(staleCm)) continue;
      for (const entry of perCm.get(staleCm) ?? []) {
        entry.root.unmount();
      }
      perCm.delete(staleCm);
    }
    for (const cm of cms) {
      const existing = perCm.get(cm) ?? [];
      const fresh: Array<{ host: HTMLElement; root: Root; line: number }> = [];
      for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        const reused = existing[i];
        const host = reused?.host ?? document.createElement("span");
        const root = reused?.root ?? createRoot(host);
        render(root, target);
        if (reused != null && reused.line !== target.line) {
          cm.setGutterMarker(reused.line, CHAT_GUTTER_ID, null);
        }
        cm.setGutterMarker(target.line, CHAT_GUTTER_ID, host);
        fresh.push({ host, root, line: target.line });
      }
      for (let i = targets.length; i < existing.length; i++) {
        const entry = existing[i];
        cm.setGutterMarker(entry.line, CHAT_GUTTER_ID, null);
        entry.root.unmount();
      }
      perCm.set(cm, fresh);
    }
  }

  private _ensureChatGutterUI(path: string, retries = 8): void {
    if (this._state === ("closed" as any)) return;
    const actions = this._actionsForChatPath(path);
    const cms = Object.values(
      ((actions as any)?._cm ?? {}) as Record<string, CodeMirror.Editor>,
    );
    if (cms.length === 0) {
      if (retries > 0) {
        setTimeout(() => this._ensureChatGutterUI(path, retries - 1), 250);
      }
      return;
    }
    const perCm =
      this._cursorInsertHosts[path] ??
      (this._cursorInsertHosts[path] = new globalThis.Map());
    const liveCms = new Set(cms);
    for (const staleCm of [...perCm.keys()]) {
      if (liveCms.has(staleCm)) continue;
      const stale = perCm.get(staleCm);
      stale?.chatRoot.unmount();
      stale?.bookmarkRoot.unmount();
      perCm.delete(staleCm);
    }
    for (const cm of cms) {
      this._ensureChatMarkerClickHandler(cm, path);
      this._ensureChatKeybindings(cm, path);
      this._ensureChatTailTracking(cm, path);
      if (!perCm.has(cm)) {
        const host = document.createElement("span");
        host.className = "cc-chat-cursor-insert";
        host.addEventListener("mousedown", (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
        const makeIcon = (
          title: string,
          icon: "comment" | "tag-outlined",
          onClick: (line: number) => void,
        ): Root => {
          const child = document.createElement("span");
          child.title = title;
          child.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const entry = this._cursorInsertHosts[path]?.get(cm);
            if (entry?.currentHandle == null) return;
            const line = cm.getLineNumber(entry.currentHandle);
            if (line != null) onClick(line);
          });
          host.appendChild(child);
          const root = createRoot(child);
          root.render(React.createElement(Icon, { name: icon }));
          return root;
        };
        const chatRoot = makeIcon(
          "Insert chat anchor before this line",
          "comment",
          (line) => void this._insertChatMarkerBeforeLine(path, line, cm),
        );
        const bookmarkRoot = makeIcon(
          "Insert bookmark before this line",
          "tag-outlined",
          (line) => this._insertBookmarkBeforeLine(path, line, cm),
        );
        perCm.set(cm, {
          host,
          chatRoot,
          bookmarkRoot,
          currentHandle: null,
        });
      }
      if (!this._cursorInsertBound.has(cm)) {
        this._cursorInsertBound.add(cm);
        cm.on("cursorActivity", () => this._refreshCursorInsert(path, cm));
      }
    }

    const markers = (this.store.get("chat_markers")?.get(path)?.toJS() ??
      []) as unknown as ChatMarker[];
    const bookmarks = (this.store.get("chat_bookmarks")?.get(path)?.toJS() ??
      []) as unknown as BookmarkMarker[];
    this._updateChatGutters(path, markers, bookmarks);
    this._refreshChatMarkerText(path);
    this._refreshCursorInsert(path);
  }

  private _ensureChatMarkerClickHandler(
    cm: CodeMirror.Editor,
    path: string,
  ): void {
    if (this._chatClickHandlerInstalled.has(cm)) return;
    this._chatClickHandlerInstalled.add(cm);
    cm.on("mousedown", (_editor, event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey) return;
      const pos = cm.coordsChar(
        { left: event.clientX, top: event.clientY },
        "window",
      );
      for (const marker of cm.findMarksAt(pos)) {
        const hash = (marker as any).chatHash as string | undefined;
        if (typeof hash !== "string") continue;
        event.preventDefault();
        void this.openAnchorChat(hash, path === this.path ? undefined : path);
        return;
      }
    });
  }

  private _ensureChatKeybindings(cm: CodeMirror.Editor, path: string): void {
    if (this._chatKeybindingInstalled.has(cm)) return;
    this._chatKeybindingInstalled.add(cm);
    cm.addKeyMap({
      "Shift-Ctrl-M": () => void this.insertChatMarker({ path, cm }),
      "Shift-Cmd-M": () => void this.insertChatMarker({ path, cm }),
      "Shift-Ctrl-B": () => void this.insertBookmark({ path, cm }),
      "Shift-Cmd-B": () => void this.insertBookmark({ path, cm }),
    });
  }

  /**
   * CodeMirror normally tracks bookmark widgets through local edits, but a
   * rapid sequence of line splits can briefly leave an inline widget painted
   * at its previous visual line until the debounced source scan rebuilds it.
   * The marker TextMarker itself moves synchronously. Use the post-operation
   * `changes` event, after CodeMirror has finalized every marker position, to
   * realign the pill without a transient jump from the old visual line.
   */
  private _ensureChatTailTracking(cm: CodeMirror.Editor, path: string): void {
    if (this._chatTailTrackingInstalled.has(cm)) return;
    this._chatTailTrackingInstalled.add(cm);
    cm.on("changes", (_editor, changes) => {
      let forceFromLine: number | undefined;
      for (const change of changes) {
        const insertedLineCount = change.text.length - 1;
        const removedLineCount = change.to.line - change.from.line;
        if (insertedLineCount === removedLineCount) continue;
        forceFromLine =
          forceFromLine == null
            ? change.from.line
            : Math.min(forceFromLine, change.from.line);
      }
      this._syncChatTailPositions(path, cm, forceFromLine);
    });
  }

  private _syncChatTailPositions(
    path: string,
    cm: CodeMirror.Editor,
    forceFromLine?: number,
  ): void {
    const markers = this._chatTextMarkers[path]?.get(cm);
    const tails = this._chatTailHosts[path]?.get(cm);
    if (markers == null || tails == null) return;
    const count = Math.min(markers.length, tails.length);
    for (let i = 0; i < count; i++) {
      const range = markers[i].find() as
        | { from: CodeMirror.Position; to: CodeMirror.Position }
        | undefined;
      if (range == null || !("to" in range)) continue;
      const current = tails[i].bookmark.find() as
        | CodeMirror.Position
        | undefined;
      const force = forceFromLine != null && range.to.line >= forceFromLine;
      if (
        !force &&
        current != null &&
        current.line === range.to.line &&
        current.ch === range.to.ch
      ) {
        continue;
      }
      const { host } = tails[i];
      tails[i].bookmark.clear();
      host.parentNode?.removeChild(host);
      tails[i].bookmark = cm.setBookmark(range.to, {
        widget: host,
        insertLeft: false,
        handleMouseEvents: true,
      });
    }
  }

  private _refreshCursorInsert(path: string, onlyCm?: CodeMirror.Editor): void {
    const perCm = this._cursorInsertHosts[path];
    if (perCm == null) return;
    const markerLines = new Set<number>(
      ((this.store.get("chat_markers")?.get(path)?.toJS() ?? []) as any[]).map(
        (marker) => marker.line,
      ),
    );
    const invalidMarkerLines = new Set<number>(
      (
        (this.store.get("invalid_chat_markers")?.get(path)?.toJS() ??
          []) as any[]
      ).map((marker) => marker.line),
    );
    const occupied = new Set([
      ...markerLines,
      ...invalidMarkerLines,
      ...(this._bookmarkLines[path] ?? []),
    ]);
    for (const [cm, entry] of perCm) {
      if (onlyCm != null && cm !== onlyCm) continue;
      const line = cm.getCursor().line;
      const nextHandle = occupied.has(line) ? null : cm.getLineHandle(line);
      if (entry.currentHandle === nextHandle) continue;
      if (entry.currentHandle != null) {
        const oldLine = cm.getLineNumber(entry.currentHandle);
        if (oldLine != null && !occupied.has(oldLine)) {
          cm.setGutterMarker(entry.currentHandle, CHAT_GUTTER_ID, null);
        }
      }
      if (nextHandle != null) {
        cm.setGutterMarker(nextHandle, CHAT_GUTTER_ID, entry.host);
      }
      entry.currentHandle = nextHandle;
    }
  }

  private _anchorHasMessages(hash: string): boolean {
    try {
      const actions = ensureSideChatActions(this.project_id, this.path);
      const threadIndex = actions.getThreadIndex();
      return actions
        .listAnchoredThreadKeys(hash)
        .some(
          (threadKey) => (threadIndex.get(threadKey)?.messageCount ?? 0) > 0,
        );
    } catch {
      return false;
    }
  }

  private _createChatTextMarker({
    cm,
    hash,
    path,
    from,
    to,
    locked,
  }: {
    cm: CodeMirror.Editor;
    hash: string;
    path: string;
    from: CodeMirror.Position;
    to: CodeMirror.Position;
    locked: boolean;
  }): CodeMirror.TextMarker {
    const marker = cm.markText(from, to, {
      className: locked
        ? "cc-chat-marker cc-chat-marker-locked"
        : "cc-chat-marker",
      clearOnEnter: false,
      // Once a thread has messages, protect the marker boundaries too.
      // Otherwise Backspace from the next line can remove the newline and
      // typing at the old right edge can silently extend the hash outside
      // the read-only range, turning it into a new editable anchor.
      inclusiveLeft: locked,
      inclusiveRight: locked,
      handleMouseEvents: false,
      readOnly: locked,
      atomic: locked,
      attributes: {
        title: locked
          ? "Open chat thread (locked — remove the marker to edit)"
          : "Open chat thread",
      },
    });
    (marker as any).chatHash = hash;
    (marker as any).chatPath = path;
    (marker as any).chatLocked = locked;
    return marker;
  }

  private _createInvalidChatTextMarker({
    cm,
    text,
    from,
    to,
  }: {
    cm: CodeMirror.Editor;
    text: string;
    from: CodeMirror.Position;
    to: CodeMirror.Position;
  }): CodeMirror.TextMarker {
    const marker = cm.markText(from, to, {
      className: "cc-chat-marker-invalid",
      clearOnEnter: false,
      inclusiveLeft: false,
      inclusiveRight: false,
      attributes: {
        title: "Invalid chat ID — edit this comment to fix it",
      },
    });
    (marker as any).invalidChatMarker = true;
    (marker as any).invalidChatText = text;
    return marker;
  }

  private _canReuseChatTextDecorations({
    existing,
    markers,
    invalidMarkers,
    path,
  }: {
    existing: CodeMirror.TextMarker[];
    markers: ChatMarker[];
    invalidMarkers: InvalidChatMarker[];
    path: string;
  }): boolean {
    if (existing.length !== markers.length + invalidMarkers.length) {
      return false;
    }
    for (let i = 0; i < markers.length; i++) {
      const decoration: any = existing[i];
      const range = decoration.find?.();
      if (
        range == null ||
        !("from" in range) ||
        (range.from.line === range.to.line && range.from.ch === range.to.ch) ||
        decoration.chatHash !== markers[i].hash ||
        decoration.chatPath !== path ||
        decoration.chatLocked !== this._anchorHasMessages(markers[i].hash)
      ) {
        return false;
      }
    }
    for (let i = 0; i < invalidMarkers.length; i++) {
      const decoration: any = existing[markers.length + i];
      const range = decoration.find?.();
      if (
        range == null ||
        !("from" in range) ||
        (range.from.line === range.to.line && range.from.ch === range.to.ch) ||
        decoration.invalidChatMarker !== true ||
        decoration.invalidChatText !== invalidMarkers[i].text
      ) {
        return false;
      }
    }
    return true;
  }

  private _refreshChatMarkerText(path: string): void {
    const actions = this._actionsForChatPath(path);
    if (actions == null) return;
    const cms = Object.values(
      ((actions as any)._cm ?? {}) as Record<string, CodeMirror.Editor>,
    );
    if (cms.length === 0) return;
    const perCm =
      this._chatTextMarkers[path] ??
      (this._chatTextMarkers[path] = new globalThis.Map());
    const tailsPerCm =
      this._chatTailHosts[path] ??
      (this._chatTailHosts[path] = new globalThis.Map());
    const liveCms = new Set(cms);
    for (const staleCm of [...perCm.keys()]) {
      if (liveCms.has(staleCm)) continue;
      for (const marker of perCm.get(staleCm) ?? []) {
        marker.clear();
      }
      perCm.delete(staleCm);
    }
    for (const staleCm of [...tailsPerCm.keys()]) {
      if (liveCms.has(staleCm)) continue;
      for (const tail of tailsPerCm.get(staleCm) ?? []) {
        tail.bookmark.clear();
        tail.root.unmount();
      }
      tailsPerCm.delete(staleCm);
    }
    const markers = (this.store.get("chat_markers")?.get(path)?.toJS() ??
      []) as unknown as ChatMarker[];
    const invalidMarkers = (this.store
      .get("invalid_chat_markers")
      ?.get(path)
      ?.toJS() ?? []) as unknown as InvalidChatMarker[];
    for (const cm of cms) {
      const existing = perCm.get(cm) ?? [];
      const oldTails = tailsPerCm.get(cm) ?? [];
      if (
        oldTails.length === markers.length + invalidMarkers.length &&
        this._canReuseChatTextDecorations({
          existing,
          markers,
          invalidMarkers,
          path,
        })
      ) {
        // CodeMirror has already moved both TextMarkers and bookmarks with
        // the edit. Preserve their React roots and unread state rather than
        // detaching every inline control on each debounced source rescan.
        this._syncChatTailPositions(path, cm);
        continue;
      }
      for (const marker of existing) {
        marker.clear();
      }
      const fresh: CodeMirror.TextMarker[] = [];
      const freshTails: Array<{
        bookmark: CodeMirror.TextMarker;
        host: HTMLElement;
        root: Root;
      }> = [];
      for (const marker of markers) {
        const lineText = cm.getLine(marker.line) ?? "";
        fresh.push(
          this._createChatTextMarker({
            cm,
            hash: marker.hash,
            path,
            from: { line: marker.line, ch: marker.col },
            to: { line: marker.line, ch: lineText.length },
            locked: this._anchorHasMessages(marker.hash),
          }),
        );
        const reused = oldTails[freshTails.length];
        const host = reused?.host ?? document.createElement("span");
        host.className = "cc-chat-marker-tail-host";
        const root = reused?.root ?? createRoot(host);
        root.render(
          React.createElement(ChatMarkerInlineTail, {
            hash: marker.hash,
            masterPath: this.path,
            project_id: this.project_id,
            onOpen: () => {
              void this.openAnchorChat(
                marker.hash,
                path === this.path ? undefined : path,
              );
            },
            onConfirmResolve: (expectsThread) =>
              this.resolveChatMarker(marker.hash, expectsThread),
            onConfirmRemoveStale: () =>
              this._removeChatMarkersForHash(path, marker.hash),
          }),
        );
        reused?.bookmark.clear();
        host.parentNode?.removeChild(host);
        const bookmark = cm.setBookmark(
          { line: marker.line, ch: lineText.length },
          { widget: host, insertLeft: false, handleMouseEvents: true },
        );
        freshTails.push({ bookmark, host, root });
      }
      for (const marker of invalidMarkers) {
        const lineText = cm.getLine(marker.line) ?? "";
        fresh.push(
          this._createInvalidChatTextMarker({
            cm,
            text: marker.text,
            from: { line: marker.line, ch: marker.col },
            to: { line: marker.line, ch: lineText.length },
          }),
        );
        const reused = oldTails[freshTails.length];
        const host = reused?.host ?? document.createElement("span");
        host.className = "cc-chat-marker-tail-host";
        const root = reused?.root ?? createRoot(host);
        root.render(
          React.createElement(InvalidChatMarkerTail, { text: marker.text }),
        );
        reused?.bookmark.clear();
        host.parentNode?.removeChild(host);
        const bookmark = cm.setBookmark(
          { line: marker.line, ch: lineText.length },
          { widget: host, insertLeft: false, handleMouseEvents: true },
        );
        freshTails.push({ bookmark, host, root });
      }
      for (let i = freshTails.length; i < oldTails.length; i++) {
        oldTails[i].bookmark.clear();
        oldTails[i].root.unmount();
      }
      perCm.set(cm, fresh);
      tailsPerCm.set(cm, freshTails);

      // CodeMirror may leave a detached bookmark wrapper behind when a
      // marker changes identity during a rescan. Remove any tail host in
      // this pane that is not one of the hosts we just placed.
      const wrapper = cm.getWrapperElement?.();
      if (wrapper != null) {
        const liveHosts = new Set(freshTails.map(({ host }) => host));
        wrapper
          .querySelectorAll<HTMLElement>(".cc-chat-marker-tail-host")
          .forEach((host) => {
            if (!liveHosts.has(host)) {
              host.parentNode?.removeChild(host);
            }
          });
      }
    }
  }

  private _refreshChatMarkerLocks(): void {
    for (const [path, perCm] of Object.entries(this._chatTextMarkers)) {
      for (const [cm, existing] of perCm) {
        const fresh: CodeMirror.TextMarker[] = [];
        for (const marker of existing) {
          if ((marker as any).invalidChatMarker === true) {
            fresh.push(marker);
            continue;
          }
          const range = marker.find() as
            | { from: CodeMirror.Position; to: CodeMirror.Position }
            | undefined;
          const hash = (marker as any).chatHash as string | undefined;
          if (range == null || hash == null || !("from" in range)) {
            marker.clear();
            continue;
          }
          const locked = this._anchorHasMessages(hash);
          if ((marker as any).chatLocked === locked) {
            fresh.push(marker);
            continue;
          }
          marker.clear();
          fresh.push(
            this._createChatTextMarker({
              cm,
              hash,
              path,
              from: range.from,
              to: range.to,
              locked,
            }),
          );
        }
        perCm.set(cm, fresh);
      }
    }
  }

  private _initChatAnchorLockListener(retries = 40): void {
    if (this._state === ("closed" as any)) return;
    let chatActions;
    try {
      chatActions = ensureSideChatActions(this.project_id, this.path);
    } catch {
      if (retries > 0) {
        setTimeout(() => this._initChatAnchorLockListener(retries - 1), 250);
      }
      return;
    }
    const store = chatActions.store;
    if (store == null) {
      if (retries > 0) {
        setTimeout(() => this._initChatAnchorLockListener(retries - 1), 250);
      }
      return;
    }
    const refresh = debounce(
      () => {
        if (this._state === ("closed" as any)) return;
        this._refreshChatMarkerLocks();
      },
      150,
      { leading: true, trailing: true },
    );
    store.on("change", refresh);
    // Remote messages update the shared message cache without necessarily
    // changing the Redux chat store.  Lock marker text as soon as that cache
    // publishes its new thread count.
    chatActions.messageCache?.on?.("version", refresh);
    const reconnect = () => {
      this._chatStoreDispose?.();
      this._chatStoreDispose = undefined;
      this._initChatAnchorLockListener();
    };
    chatActions.syncdb?.once?.("close", reconnect);
    this._chatStoreDispose = () => {
      store.removeListener("change", refresh);
      chatActions.messageCache?.removeListener?.("version", refresh);
      chatActions.syncdb?.removeListener?.("close", reconnect);
      refresh.cancel();
    };
    refresh();
  }

  // All locations of a marker hash across the scanned files, in
  // (path, line) order with the master file first.
  public getAnchorLocations(hash: string): { path: string; line: number }[] {
    const chatMarkers = this.store.get("chat_markers");
    if (chatMarkers == null) return [];
    const locations: { path: string; line: number }[] = [];
    const paths = chatMarkers.keySeq().toJS() as string[];
    paths.sort((a, b) =>
      a === this.path ? -1 : b === this.path ? 1 : a.localeCompare(b),
    );
    for (const path of paths) {
      const markers = (chatMarkers.get(path)?.toJS() ??
        []) as unknown as ChatMarker[];
      for (const m of markers) {
        if (m.hash === hash) {
          locations.push({ path, line: m.line });
        }
      }
    }
    return locations;
  }

  public getAnchorJumpLabel = (
    hash: string,
    recordedPath?: string,
  ): string | undefined => {
    const locations = this.getAnchorLocations(hash);
    if (locations.length === 0) {
      const path = this._getUnloadedAnchorPath(hash, recordedPath);
      return path == null ? undefined : path_split(path).tail;
    }
    if (locations.length > 1) {
      return `${locations.length} locations`;
    }
    const { path, line } = locations[0];
    return `${path_split(path).tail}:${line + 1}`;
  };

  public getAnchorLabel = (hash: string): string | undefined => {
    const jumpLabel = this.getAnchorJumpLabel(hash);
    if (jumpLabel == null) return hash;
    return `${hash} (${jumpLabel})`;
  };

  public canJumpToAnchor = (hash: string, recordedPath?: string): boolean => {
    return this.getAnchorState(hash, recordedPath) !== "missing";
  };

  public getMissingAnchorMessage = (_hash: string): string => {
    return "This chat marker was removed";
  };

  public getAnchorState = (
    hash: string,
    recordedPath?: string,
  ): "available" | "missing" | "unloaded" => {
    if (this.getAnchorLocations(hash).length > 0) {
      return "available";
    }
    return this._getUnloadedAnchorPath(hash, recordedPath) == null
      ? "missing"
      : "unloaded";
  };

  private _getUnloadedAnchorPath(
    hash: string,
    recordedPath?: string,
  ): string | undefined {
    if (
      recordedPath != null &&
      recordedPath !== this.path &&
      !this.store.get("chat_markers")?.has(recordedPath)
    ) {
      return recordedPath;
    }
    let chatActions;
    try {
      chatActions = ensureSideChatActions(this.project_id, this.path);
    } catch {
      return;
    }
    for (const row of chatActions.listThreadConfigRows()) {
      if (parseThreadResolved(row?.resolved) != null) continue;
      const anchor = parseThreadAnchor(row?.anchor);
      if (
        anchor?.id === hash &&
        anchor.path != null &&
        anchor.path !== this.path &&
        !this.store.get("chat_markers")?.has(anchor.path)
      ) {
        return anchor.path;
      }
    }
  }

  public jumpToAnchor = async (
    hash: string,
    recordedPath?: string,
  ): Promise<void> => {
    const locations = this.getAnchorLocations(hash);
    if (locations.length === 0) {
      const path = this._getUnloadedAnchorPath(hash, recordedPath);
      if (path == null) return;
      const frameId = await this._switchFocusedSourceTo(path);
      if (frameId == null) return;
      for (let retries = 0; retries < 40; retries += 1) {
        this._refreshChatMarkerScanners();
        this._chatMarkerScanners[path]?.rescan();
        const loaded = this.getAnchorLocations(hash).find(
          (location) => location.path === path,
        );
        if (loaded != null) {
          await this._gotoSourceLine(path, loaded.line + 1, frameId);
          return;
        }
        await delay(100);
      }
      return;
    }
    const { path, line } = locations[0];
    const frameId = await this._switchFocusedSourceTo(path);
    if (frameId == null) return;
    await this._gotoSourceLine(path, line + 1, frameId);
  };

  private async _switchFocusedSourceTo(
    path: string,
  ): Promise<string | undefined> {
    const frameId =
      this._get_most_recent_active_frame_id_of_type("cm") ??
      this.show_focused_frame_of_type("cm");
    if (frameId == null) return;
    const currentPath = this._get_frame_node(frameId)?.get("path") ?? this.path;
    if (currentPath === path) {
      await this._waitForSourcePane(path, frameId);
      return frameId;
    }
    const switchedFrameId = await this.switch_to_file(path, frameId);
    await this._waitForSourcePane(path, switchedFrameId);
    return switchedFrameId;
  }

  private async _waitForSourcePane(
    path: string,
    frameId: string,
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start <= 15000) {
      if (this.isClosed()) return;
      const actions: any = this._actionsForChatPath(path);
      const cm: CodeMirror.Editor | undefined = actions?._cm?.[frameId];
      const wrapper = cm?.getWrapperElement?.();
      // CodeMirror keeps detached instances cached by frame id.  Wait for
      // React to register the newly mounted, connected instance after a
      // file switch instead of jumping in the stale document.
      if (cm != null && (wrapper == null || wrapper.isConnected)) {
        return;
      }
      await delay(50);
    }
  }

  private async _gotoSourceLine(
    path: string,
    line: number,
    frameId: string,
  ): Promise<void> {
    const actions = this._actionsForChatPath(path);
    if (actions == null) return;
    this.set_active_id(frameId, true);
    await actions.programmatically_goto_line(line, true, true, frameId);
  }

  // Resolve the most recently focused source pane in this frame tree:
  // the file path it shows (master or an included file), the owning
  // editor actions, and the live CM instance.  Frames showing included
  // files are cm frames with a path override; their CM is registered on
  // the included file's own editor actions.
  private _activeSourceTarget(requested?: {
    path: string;
    cm: CodeMirror.Editor;
  }):
    | { path: string; actions: any; cm: CodeMirror.Editor; frameId?: string }
    | undefined {
    if (requested != null) {
      const actions: any = this._actionsForChatPath(requested.path);
      if (actions == null) return undefined;
      const frameId = Object.entries(
        (actions._cm ?? {}) as Record<string, CodeMirror.Editor>,
      ).find(([, candidate]) => candidate === requested.cm)?.[0];
      return {
        path: requested.path,
        actions,
        cm: requested.cm,
        frameId,
      };
    }
    const frameId = this._get_most_recent_active_frame_id_of_type("cm");
    if (frameId == null) return undefined;
    const node = this._get_frame_node(frameId);
    const path = node?.get("path") ?? this.path;
    const actions: any =
      path === this.path
        ? this
        : this.redux.getEditorActions(this.project_id, path);
    if (actions == null) return undefined;
    let cm: CodeMirror.Editor | undefined = actions._cm?.[frameId];
    let cmFrameId: string | undefined = frameId;
    if (cm == null) {
      cm = actions._get_cm?.(undefined, true);
      cmFrameId = undefined;
    }
    if (cm == null) return undefined;
    return { path, actions, cm, frameId: cmFrameId };
  }

  // Insert a `% chat: <hash>` marker at the cursor of the most recently
  // active source pane (master or included file) and open a fresh
  // side-chat thread for it.
  public insertChatMarker = async (
    opts: {
      mode?: "inline" | "block";
      path?: string;
      cm?: CodeMirror.Editor;
    } = {},
  ): Promise<void> => {
    if (this.is_read_only_preview()) return;
    const hash = generateMarkerHash();
    const target = this._insertMarkerText(
      buildMarkerLine(hash),
      buildInlineInsertion(hash),
      opts.path != null && opts.cm != null
        ? { path: opts.path, cm: opts.cm }
        : undefined,
    );
    if (target == null) {
      return;
    }
    this._chatMarkerScanners[target.path]?.rescan();
    await this.openAnchorChatNewThread(
      hash,
      target.path === this.path ? undefined : target.path,
    );
  };

  // Insert a `% bookmark: <text>` comment at the cursor.  Bookmarks are
  // source-only: they show up in the table of contents but have no
  // chat thread.
  public insertBookmark = async (
    opts: { path?: string; cm?: CodeMirror.Editor } = {},
  ): Promise<void> => {
    if (this.is_read_only_preview()) return;
    const text = generateBookmarkText(new Date());
    const target = this._insertMarkerText(
      buildBookmarkLine(text),
      undefined,
      opts.path != null && opts.cm != null
        ? { path: opts.path, cm: opts.cm }
        : undefined,
    );
    if (target == null) {
      return;
    }
    this._chatMarkerScanners[target.path]?.rescan();
    this.updateTableOfContents(true);
  };

  // Insert a standalone comment line (or an inline tail when the cursor
  // line has tex content and `inline` is provided) at the cursor of the
  // focused source pane.  Returns the pane's file path, or undefined
  // when no editor is available.
  private _insertMarkerText(
    blockLine: string,
    inline?: string,
    requested?: { path: string; cm: CodeMirror.Editor },
  ): { path: string } | undefined {
    const target = this._activeSourceTarget(requested);
    if (target == null) return undefined;
    const { cm, actions, path, frameId } = target;
    const cur = cm.getCursor();
    const lineText = cm.getLine(cur.line) ?? "";
    if (inline != null && lineHasTexContent(lineText)) {
      cm.replaceRange(inline, { line: cur.line, ch: lineText.length });
    } else if (lineText.trim() === "") {
      cm.replaceRange(
        blockLine,
        { line: cur.line, ch: 0 },
        { line: cur.line, ch: lineText.length },
      );
    } else {
      // comment-only (or otherwise occupied) line: add a new line below.
      cm.replaceRange(`\n${blockLine}`, {
        line: cur.line,
        ch: lineText.length,
      });
    }
    actions.set_syncstring_to_codemirror(frameId);
    actions.syncstring_commit();
    return { path };
  }

  private _commitChatGutterEdit(
    actions: BaseActions<CodeEditorState>,
    cm: CodeMirror.Editor,
  ): void {
    const frameId = Object.entries(
      ((actions as any)._cm ?? {}) as Record<string, CodeMirror.Editor>,
    ).find(([, candidate]) => candidate === cm)?.[0];
    actions.set_syncstring_to_codemirror(frameId);
    actions.syncstring_commit();
  }

  private async _insertChatMarkerBeforeLine(
    path: string,
    line: number,
    cm: CodeMirror.Editor,
  ): Promise<void> {
    const actions = this._actionsForChatPath(path);
    if (actions == null) return;
    const hash = generateMarkerHash();
    cm.replaceRange(`${buildMarkerLine(hash)}\n\n`, { line, ch: 0 });
    this._commitChatGutterEdit(actions, cm);
    this._chatMarkerScanners[path]?.rescan();
    await this.openAnchorChatNewThread(
      hash,
      path === this.path ? undefined : path,
    );
  }

  private _insertBookmarkBeforeLine(
    path: string,
    line: number,
    cm: CodeMirror.Editor,
  ): void {
    const actions = this._actionsForChatPath(path);
    if (actions == null) return;
    const text = generateBookmarkText(new Date());
    const markerLine = buildBookmarkLine(text);
    cm.replaceRange(`${markerLine}\n\n`, { line, ch: 0 });
    this._commitChatGutterEdit(actions, cm);
    this._chatMarkerScanners[path]?.rescan();
    this.updateTableOfContents(true);
    const textStart = markerLine.length - text.length;
    cm.setSelection({ line, ch: textStart }, { line, ch: markerLine.length });
    cm.focus();
  }

  // Resolve every thread anchored to `hash` (collaborative-TODO flow)
  // and remove the marker comment(s) from all scanned files.  The
  // threads remain in the side chat as a read-only record.
  public async resolveChatMarker(
    hash: string,
    expectsThread = true,
  ): Promise<void> {
    const chatActions = await this._waitForReadyChatActions();
    if (chatActions == null) {
      console.warn("resolveChatMarker: side chat did not become ready", {
        project_id: this.project_id,
        path: this.path,
        hash,
      });
      antdMessage.warning(
        "Chat is still loading; the marker was not removed. Please try again.",
      );
      return;
    }
    const label = this.getAnchorLabel(hash);
    let resolved = false;
    const attempts = expectsThread ? 30 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const threadKeys = chatActions.listAnchoredThreadKeys(hash);
      for (const threadKey of threadKeys) {
        chatActions.resolveAnchoredThread(threadKey, { label });
      }
      const remaining = chatActions.listAnchoredThreadKeys(hash);
      const hasResolved = chatActions
        .listThreadConfigRows()
        .some((row) => parseThreadResolved(row?.resolved)?.anchorId === hash);
      if (remaining.length === 0 && hasResolved) {
        resolved = true;
        break;
      }
      if (!expectsThread) break;
      await delay(100);
    }
    // Never turn a known discussion into a marker-only deletion just because
    // this client has not received its thread-config row yet.
    if (expectsThread && !resolved) {
      console.warn("resolveChatMarker: anchored thread is still syncing", {
        project_id: this.project_id,
        path: this.path,
        hash,
      });
      antdMessage.warning(
        "Chat is still syncing; the marker was not removed. Please try again.",
      );
      return;
    }
    const chatMarkers = this.store.get("chat_markers");
    if (chatMarkers == null) return;
    for (const path of chatMarkers.keySeq().toJS() as string[]) {
      this._removeChatMarkersForHash(path, hash);
    }
  }

  private async _waitForReadyChatActions(): Promise<
    ReturnType<typeof ensureSideChatActions> | undefined
  > {
    for (const wait of [0, 25, 50, 100, 250, 500, 1000, 2000]) {
      if (wait > 0) await delay(wait);
      if (this._state === ("closed" as any)) return;
      try {
        const actions = ensureSideChatActions(this.project_id, this.path);
        if (actions.syncdb?.get_state?.() === "ready") {
          return actions;
        }
      } catch {
        // Side chat is still mounting; retry within the bounded window.
      }
    }
  }

  // Remove all `% chat: <hash>` markers for one hash from one file.
  private _clearChatTextDecorations(path: string): void {
    const markers = this._chatTextMarkers[path];
    if (markers != null) {
      for (const list of markers.values()) {
        for (const marker of list) marker.clear();
      }
      delete this._chatTextMarkers[path];
    }
    const tails = this._chatTailHosts[path];
    if (tails != null) {
      for (const list of tails.values()) {
        for (const tail of list) {
          tail.bookmark.clear();
          tail.root.unmount();
        }
      }
      delete this._chatTailHosts[path];
    }
  }

  private _removeChatMarkersForHash(path: string, hash: string): void {
    const actions: any =
      path === this.path
        ? this
        : this.redux.getEditorActions(this.project_id, path);
    const syncstring = actions?._syncstring;
    if (actions == null || syncstring == null) return;
    let text: string;
    try {
      text = syncstring.to_str() ?? "";
    } catch {
      return;
    }
    const newText = removeMarkersForHash(text, hash);
    if (newText === text) return;
    // CodeMirror read-only ranges intentionally reject overlapping edits.
    // Remove our transient UI markers before applying the source transform;
    // the scanner recreates any remaining markers immediately afterward.
    this._clearChatTextDecorations(path);
    actions.set_value(newText);
    actions.syncstring_commit();
    this._chatMarkerScanners[path]?.rescan();
  }

  languageModelExtraFileInfo() {
    return "LaTeX";
  }

  codexCodeDescription(): string {
    return "Put any LaTeX you generate in the answer in a fenced code block with info string 'tex'.";
  }

  set_font_size(id: string, font_size: number): void {
    if (this._is_output_panel(id)) {
      // This is for the output panel UI, not a regular frame.
      // We store its font size in the local_view_state.
      const local_view_state = this.store.get("local_view_state");
      this.setState({
        local_view_state: local_view_state.setIn([id, "font_size"], font_size),
      });
      // Save the state change
      this.save_local_view_state();
    } else {
      super.set_font_size(id, font_size);
      this.update_gutters_soon();
    }
  }

  increase_font_size(id: string): void {
    if (this._is_output_panel(id)) {
      const font_size = this.store.getIn(
        ["local_view_state", id, "font_size"],
        14,
      );
      this.set_font_size(id, font_size + 1);
    } else {
      super.increase_font_size(id);
    }
  }

  decrease_font_size(id: string): void {
    if (this._is_output_panel(id)) {
      const font_size = this.store.getIn(
        ["local_view_state", id, "font_size"],
        14,
      );
      this.set_font_size(id, Math.max(2, font_size - 1));
    } else {
      super.decrease_font_size(id);
    }
  }
}
