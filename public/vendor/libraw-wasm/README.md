Static runtime files copied from `libraw-wasm@1.1.2`.

The app loads `libraw.js` with `webpackIgnore` so its Emscripten pthread worker can resolve itself as a static asset. Bundling that self-referential worker through Next's webpack chunk graph creates a circular runtime chunk warning.
