import rspack, { type WebpackPluginInstance } from "@rspack/core";

export const FRONTEND_BUILD_MANIFEST = "frontend-build.json";

type FrontendBuildManifest = {
  schema: 1;
  git_revision: string;
  build_timestamp: number;
  build_date: string;
  fingerprint: string;
};

class FrontendBuildManifestPlugin implements WebpackPluginInstance {
  name = "FrontendBuildManifestPlugin";

  constructor(private readonly manifest: FrontendBuildManifest) {}

  apply(compiler: any): void {
    compiler.hooks.thisCompilation.tap(this.name, (compilation: any) => {
      compilation.hooks.processAssets.tap(
        {
          name: this.name,
          stage: rspack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
        },
        () => {
          compilation.emitAsset(
            FRONTEND_BUILD_MANIFEST,
            new rspack.sources.RawSource(
              `${JSON.stringify(this.manifest, null, 2)}\n`,
            ),
          );
        },
      );
    });
  }
}

export default function frontendBuildManifestPlugin(
  registerPlugin,
  manifest: FrontendBuildManifest,
): void {
  registerPlugin(
    "FrontendBuildManifestPlugin -- emit current frontend build identity",
    new FrontendBuildManifestPlugin(manifest),
  );
}
