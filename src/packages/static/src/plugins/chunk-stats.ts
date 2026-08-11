import type { WebpackPluginInstance } from "@rspack/core";
import { writeFileSync } from "fs";
import { resolve } from "path";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "zlib";

const CENSUS_BROTLI_QUALITY = 5;

interface AssetStats {
  brotliBytes: number;
  file: string;
  gzipBytes: number;
  rawBytes: number;
}

interface ChunkStats {
  assets: AssetStats[];
  files: string[];
  importers: Record<string, string[]>;
  initial: boolean;
  moduleRawBytes: Record<string, number>;
  name?: string;
  modules: string[];
}

interface ChunkGroupStats {
  chunks: string[];
  initial: boolean;
  name?: string;
  origins: Array<{
    module?: string;
    request?: string;
  }>;
  parents: number[];
}

function normalizeModuleName(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const packagesRoot = resolve(process.cwd(), "..").replace(/\\/g, "/");
  if (normalized.startsWith(`${packagesRoot}/`)) {
    return normalized.slice(packagesRoot.length + 1);
  }
  return normalized;
}

function getModuleName(module: any): string | null {
  const resource =
    module?.nameForCondition?.() ??
    module?.resource ??
    module?.rootModule?.resource ??
    module?.userRequest;
  if (typeof resource === "string" && resource) {
    return normalizeModuleName(resource);
  }

  const identifier =
    typeof module?.identifier === "function" ? module.identifier() : null;
  if (typeof identifier !== "string" || !identifier) {
    return null;
  }

  const noLoaders = identifier.split("!").pop() ?? identifier;
  const candidate = noLoaders.split("|").pop() ?? noLoaders;
  return normalizeModuleName(candidate);
}

function getChunkFiles(chunk: any): string[] {
  return Array.from(chunk.files ?? [])
    .filter(
      (file): file is string =>
        typeof file === "string" && /\.(?:js|css)$/.test(file),
    )
    .sort();
}

function getLeafModules(module: any): any[] {
  const nested = Array.from(module?.modules ?? []);
  if (nested.length === 0) return [module];
  return nested.flatMap(getLeafModules);
}

function getModuleSize(module: any): number {
  const size = module?.size?.();
  return typeof size === "number" && Number.isFinite(size) ? size : 0;
}

class ChunkStatsPlugin implements WebpackPluginInstance {
  name = "ChunkStatsPlugin";

  apply(compiler: any): void {
    compiler.hooks.done.tap(this.name, (stats: any) => {
      const compilation = stats.compilation;
      const outputPath = compilation?.outputOptions?.path;
      if (typeof outputPath !== "string" || !outputPath) {
        return;
      }

      const chunkKeys = new Map<any, string>();
      for (const chunk of compilation.chunks ?? []) {
        const files = getChunkFiles(chunk);
        const name =
          typeof chunk?.name === "string" && chunk.name ? chunk.name : null;
        if (name == null && files.length === 0) continue;
        chunkKeys.set(chunk, name ?? `async:${files.join("+")}`);
      }

      const chunks: Record<string, ChunkStats> = {};
      for (const chunk of compilation.chunks ?? []) {
        const key = chunkKeys.get(chunk);
        if (key == null) continue;
        const files = getChunkFiles(chunk);
        const name =
          typeof chunk?.name === "string" && chunk.name ? chunk.name : null;

        const modules = new Set<string>();
        const moduleRawBytes: Record<string, number> = {};
        const importers: Record<string, string[]> = {};
        const chunkModuleNames = new Map<any, string>();
        const chunkModules =
          compilation.chunkGraph?.getChunkModulesIterable?.(chunk);
        if (chunkModules != null) {
          for (const rootModule of chunkModules) {
            for (const module of getLeafModules(rootModule)) {
              const name = getModuleName(module);
              if (name == null) continue;
              modules.add(name);
              chunkModuleNames.set(module, name);
              moduleRawBytes[name] = Math.max(
                moduleRawBytes[name] ?? 0,
                getModuleSize(module),
              );
            }
          }
          for (const [module, name] of chunkModuleNames) {
            const incoming =
              compilation.moduleGraph?.getIncomingConnections?.(module);
            if (incoming != null) {
              const names = new Set<string>();
              for (const connection of incoming) {
                const importer = chunkModuleNames.get(connection?.originModule);
                if (importer != null && importer !== name) {
                  names.add(importer);
                }
              }
              if (names.size > 0) {
                importers[name] = [...names].sort();
              }
            }
          }
        }

        const assets: AssetStats[] = [];
        for (const file of files) {
          const asset = compilation.getAsset?.(file);
          const source = asset?.source?.source?.();
          if (source == null) continue;
          const bytes = Buffer.isBuffer(source)
            ? source
            : Buffer.from(source.toString());
          assets.push({
            brotliBytes: brotliCompressSync(bytes, {
              params: {
                [zlibConstants.BROTLI_PARAM_QUALITY]: CENSUS_BROTLI_QUALITY,
              },
            }).length,
            file,
            gzipBytes: gzipSync(bytes).length,
            rawBytes: bytes.length,
          });
        }

        chunks[key] = {
          assets,
          files,
          importers,
          initial: chunk.canBeInitial?.() === true,
          moduleRawBytes,
          ...(name == null ? {} : { name }),
          modules: [...modules].sort(),
        };
      }

      const groupIndexes = new Map<any, number>();
      const rawGroups = Array.from(compilation.chunkGroups ?? []);
      rawGroups.forEach((group, index) => groupIndexes.set(group, index));
      const groups: ChunkGroupStats[] = rawGroups.map((group: any) => {
        const parents = Array.from(group.parentsIterable ?? group.parents ?? [])
          .map((parent) => groupIndexes.get(parent))
          .filter((index): index is number => index != null)
          .sort((a, b) => a - b);
        const origins = Array.from(group.origins ?? []).map((origin: any) => {
          const module = getModuleName(origin?.module);
          const request =
            typeof origin?.request === "string" ? origin.request : null;
          return {
            ...(module == null ? {} : { module }),
            ...(request == null ? {} : { request }),
          };
        });
        return {
          chunks: Array.from(group.chunks ?? [])
            .map((chunk) => chunkKeys.get(chunk))
            .filter((key): key is string => key != null),
          initial: group.isInitial?.() === true,
          ...(typeof group.name === "string" && group.name
            ? { name: group.name }
            : {}),
          origins,
          parents,
        };
      });

      writeFileSync(
        resolve(outputPath, "chunk-stats.json"),
        JSON.stringify({ chunks, groups }, null, 2),
      );
    });
  }
}

export default function chunkStatsPlugin(registerPlugin) {
  registerPlugin(
    "ChunkStatsPlugin -- generate compact chunk-stats.json",
    new ChunkStatsPlugin(),
  );
}
