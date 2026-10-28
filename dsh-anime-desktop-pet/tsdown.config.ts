import type { UserConfig } from 'tsdown'

const PLUGIN_ID = '@dsh-external/dsh-anime-desktop-pet'

/** Client half: one self-contained CJS factory registered through __ModuleLoader__. */
const clientBundle: UserConfig = {
  entry: { client: 'src/client/index.mjs' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: [],
    alwaysBundle: () => true,
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: ' + JSON.stringify(PLUGIN_ID) + ', factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    codeSplitting: false,
  },
}

export default [clientBundle] satisfies UserConfig[]
