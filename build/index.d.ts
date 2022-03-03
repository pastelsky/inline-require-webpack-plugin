import webpack from 'webpack';
import type { SideEffectFree, ProcessedSource } from './types';
export interface InlineRequireWebpackPluginOptions {
    sourceMap?: boolean;
    cache?: boolean;
}
declare class InlineRequireWebpackPlugin {
    private readonly options;
    private readonly cache;
    private readonly sideEffectFree;
    constructor(options?: Partial<InlineRequireWebpackPluginOptions>);
    getCachedSource(moduleHash: string | undefined, source: string, sideEffectFree: SideEffectFree): ProcessedSource;
    collectSideEffects(compiler: webpack.Compiler, compilation: webpack.compilation.Compilation, modules: webpack.compilation.Module[]): void;
    apply(compiler: webpack.Compiler): void;
}
export { InlineRequireWebpackPlugin };
