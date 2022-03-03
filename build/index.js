"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.InlineRequireWebpackPlugin = void 0;

var _webpackSources = require("webpack-sources");

var _processor = require("./processor");

var _lruCache = _interopRequireDefault(require("lru-cache"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

const PLUGIN_NAME = 'InlineRequireWebpackPlugin';

class InlineRequireWebpackPlugin {
  constructor(options = {}) {
    _defineProperty(this, "sideEffectFree", new Map());

    this.options = { ...options
    };
    this.cache = new _lruCache.default({
      max: 10000,
      ttl: 1000 * 60 * 5
    });
  }

  getCachedSource(moduleHash, source, sideEffectFree) {
    const shouldUseCache = this.options.cache && moduleHash;
    let cacheKey = null;

    if (shouldUseCache) {
      cacheKey = moduleHash + Object.entries(sideEffectFree).join('');
      const cachedSource = this.cache.get(cacheKey);

      if (cachedSource) {
        return cachedSource;
      }
    }

    const newSource = (0, _processor.processSource)(source, sideEffectFree);

    if (shouldUseCache && cacheKey) {
      this.cache.set(cacheKey, newSource);
    }

    return newSource;
  }

  collectSideEffects(compiler, compilation, modules) {
    for (const m of modules) {
      // @ts-expect-error v5 only id getter
      const id = compilation.chunkGraph ? compilation.chunkGraph.getModuleId(m) : m.id;

      if (id != null && !this.sideEffectFree.has(id) && 'libIdent' in m) {
        // @ts-expect-error libIdent missing in Module type
        const ident = m.libIdent({
          context: compiler.options.context
        }); // either the dependency has explicit sideEffect
        // or we assume only local js/ts modules being sideEffect free

        const isFree = m.factoryMeta && m.factoryMeta.sideEffectFree != null ? m.factoryMeta.sideEffectFree : !ident.includes('node_modules') && /\.[jt]sx?$/.test(ident);
        this.sideEffectFree.set(id, isFree);
      }
    }
  }

  apply(compiler) {
    compiler.hooks.compilation.tap(PLUGIN_NAME, compilation => {
      compilation.hooks.afterOptimizeModuleIds.tap(PLUGIN_NAME, this.collectSideEffects.bind(this, compiler, compilation));
      compilation.moduleTemplates.javascript.hooks.package.tap(PLUGIN_NAME, (moduleSource, module) => {
        var _this$options$sourceM;

        const sourceMap = (_this$options$sourceM = this.options.sourceMap) !== null && _this$options$sourceM !== void 0 ? _this$options$sourceM : !!compiler.options.devtool;
        const original = sourceMap && moduleSource.sourceAndMap ? moduleSource.sourceAndMap() : {
          source: moduleSource.source(),
          map: sourceMap && typeof moduleSource.map === 'function' ? moduleSource.map() : null
        };
        const newSource = this.getCachedSource(module.hash, original.source, this.sideEffectFree);

        if (newSource === null) {
          return moduleSource;
        }

        return original.map ? new _webpackSources.SourceMapSource(newSource, module.id, original.map, original.source, original.map) : new _webpackSources.RawSource(newSource);
      });
    });
  }

}

exports.InlineRequireWebpackPlugin = InlineRequireWebpackPlugin;