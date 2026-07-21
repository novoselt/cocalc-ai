import { join, parse } from "path";

export function parseTo(args: string[]): { to: string; j: number } {
  let j: number = 0;
  let to: string = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--to") {
      j = i;
      to = args[i + 1];
      break;
    }
  }
  return { to, j };
}

const OUTPUT_EXTENSIONS: Record<string, string> = {
  asciidoc: ".asciidoc",
  html: ".html",
  latex: ".tex",
  markdown: ".md",
  pdf: ".pdf",
  python: ".py",
  rst: ".rst",
  slides: ".slides.html",
  webpdf: ".pdf",
  "classic-pdf": ".pdf",
  "lab-pdf": ".pdf",
};

export function outputPath({
  directory,
  languageInfo,
  source,
  to,
}: {
  directory?: string;
  languageInfo?: { file_extension?: unknown };
  source: string;
  to: string;
}): string | undefined {
  let extension = OUTPUT_EXTENSIONS[to];
  if (to === "script") {
    const configured = languageInfo?.file_extension;
    extension = typeof configured === "string" ? configured.trim() : ".txt";
    if (!extension) {
      extension = ".txt";
    } else if (!extension.startsWith(".")) {
      extension = `.${extension}`;
    }
    if (extension.includes("/") || extension.includes("\\")) {
      extension = ".txt";
    }
  }
  if (!extension) return;

  const sourcePath = parse(source);
  const relativeOutput = join(sourcePath.dir, `${sourcePath.name}${extension}`);
  return directory ? join(directory, relativeOutput) : relativeOutput;
}

export function parseSource(args: string[]): string {
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      if (args[i] != "--" && !args[i].includes("=")) {
        // skip argument to --
        i += 1;
      }
      continue;
    }
    // doesn't start with -- or wasn't next arg skipped due to starting with --
    return args[i];
  }
  throw Error("no source");
}
