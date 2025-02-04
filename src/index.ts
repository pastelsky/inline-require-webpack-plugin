import crypto from 'crypto';
import webpack from 'webpack';
import { RawSource, SourceMapSource, Source, SourceAndMapResult } from 'webpack-sources';
import { processSource } from './processor';
import type { SideEffectFree } from './types';

const PLUGIN_NAME = 'InlineRequireWebpackPlugin';

const excludeNull = Boolean as unknown as <T>(x: T | null) => x is T;
const md5 = (s: string) => crypto.createHash('md5').update(s, 'utf8').digest('hex');

export interface InlineRequireWebpackPluginOptions {
  sourceMap?: boolean;
  cache?: boolean;
}

class InlineRequireWebpackPlugin {
  private readonly options: InlineRequireWebpackPluginOptions;

  private readonly sideEffectFree: SideEffectFree = new Map();
  private readonly processedCache = new Map<string, { hash: string; source: string }>();
  private readonly chunkHashes = new Map<string | number, string>();

  constructor(options: Partial<InlineRequireWebpackPluginOptions> = {}) {
    this.options = { ...options };
  }

  collectSideEffects(
    compiler: webpack.Compiler,
    compilation: webpack.compilation.Compilation,
    modules: webpack.compilation.Module[]
  ) {
    for (const m of modules) {
      // @ts-expect-error v5 only id getter
      const id = compilation.chunkGraph ? compilation.chunkGraph.getModuleId(m) : m.id;
      if (id != null && !this.sideEffectFree.has(id) && 'libIdent' in m) {
        // @ts-expect-error libIdent missing in Module type
        const ident: string = m.libIdent({
          context: compiler.options.context,
        });

        // either the dependency has explicit sideEffect
        // or we assume only local js/ts modules being sideEffect free
        const isFree =
          m.factoryMeta && m.factoryMeta.sideEffectFree != null
            ? m.factoryMeta.sideEffectFree
            : !ident.includes('node_modules') && /\.[jt]sx?$/.test(ident);

        this.sideEffectFree.set(id, isFree);
      }
    }
  }

  retrieveCachedOrProcess(
    file: string,
    original: SourceAndMapResult,
    useCache: boolean
  ): SourceAndMapResult {
    const originalHash = useCache ? md5(original.source) : null;

    const cached = this.processedCache.get(file);
    let resultSource = cached?.hash === originalHash ? cached.source : null;

    if (resultSource == null) {
      resultSource = processSource(file, original, this.sideEffectFree);

      if (useCache && originalHash != null) {
        this.processedCache.set(file, { hash: originalHash, source: resultSource });
      }
    }

    return { source: resultSource, map: original.map };
  }

  async processFiles(
    compiler: webpack.Compiler,
    compilation: webpack.compilation.Compilation,
    chunkFiles: string[]
  ) {
    const sourceMap = this.options.sourceMap ?? !!compiler.options.devtool;
    // @ts-expect-error watchMode type missing
    const useCache = this.options.cache ?? !!compiler.watchMode;

    const chunkAssets: string[] = Array.from(compilation.additionalChunkAssets || []);
    const files = [...chunkFiles, ...chunkAssets];

    const processed = files.map((file) => {
      // skip non-JS files
      if (!file.match(/\.m?[jt]sx?$/i)) return null;

      const asset: Source = compilation.assets[file];

      const original =
        sourceMap && asset.sourceAndMap
          ? asset.sourceAndMap()
          : {
              source: asset.source() as string,
              map: sourceMap && typeof asset.map === 'function' ? asset.map() : null,
            };

      const result = this.retrieveCachedOrProcess(file, original, useCache);

      return {
        file,
        asset:
          result.map && original.map
            ? new SourceMapSource(result.source, file, result.map, original.source, original.map)
            : new RawSource(result.source),
      };
    });

    processed.filter(excludeNull).forEach(({ file, asset }) => {
      compilation.assets[file] = asset;
    });
  }

  apply(compiler: webpack.Compiler) {
    compiler.hooks.compilation.tap(PLUGIN_NAME, (compilation) => {
      compilation.hooks.afterOptimizeModuleIds.tap(
        PLUGIN_NAME,
        this.collectSideEffects.bind(this, compiler, compilation)
      );

      // Webpack v5 hook (as optimizeChunkAssets is deprecated)
      if ('processAssets' in compilation.hooks) {
        // @ts-expect-error v5 only hook
        compilation.hooks.processAssets.tapPromise(
          {
            name: PLUGIN_NAME,
            // @ts-expect-error v5 only const
            stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE,
          },
          (assets: Record<string, Source>) => {
            const chunkFiles = Object.keys(assets);
            return this.processFiles(compiler, compilation, chunkFiles);
          }
        );
      } else {
        // Webpack v4 hook
        compilation.hooks.optimizeChunkAssets.tapPromise(PLUGIN_NAME, (chunks) => {
          const chunkFiles = Array.from(chunks)
            .filter((chunk) => {
              const chunkIdent = chunk.name || chunk.id;
              const chunkHash = chunk.hash;
              // if chunk does not have id or name, or no hash we have to treat its entirety
              if (!chunkIdent || !chunkHash) {
                return true;
              }

              if (!this.chunkHashes.has(chunkIdent)) {
                this.chunkHashes.set(chunkIdent, chunkHash);
                return true;
              }

              return this.chunkHashes.get(chunkIdent) !== chunkHash;
            })
            .reduce((acc, chunk) => acc.concat(Array.from(chunk.files || [])), [] as string[]);
          return this.processFiles(compiler, compilation, chunkFiles);
        });
      }
    });
  }
}

export { InlineRequireWebpackPlugin };
