import tseslint from "typescript-eslint"
import reactHooks from "eslint-plugin-react-hooks"

const browserGlobals = {
  Blob: "readonly",
  CanvasRenderingContext2D: "readonly",
  CustomEvent: "readonly",
  File: "readonly",
  FileReader: "readonly",
  HTMLCanvasElement: "readonly",
  HTMLElement: "readonly",
  Image: "readonly",
  ImageData: "readonly",
  KeyboardEvent: "readonly",
  MouseEvent: "readonly",
  React: "readonly",
  URL: "readonly",
  console: "readonly",
  createImageBitmap: "readonly",
  document: "readonly",
  localStorage: "readonly",
  navigator: "readonly",
  process: "readonly",
  requestAnimationFrame: "readonly",
  setTimeout: "readonly",
  window: "readonly",
}

export default tseslint.config(
  {
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
  },
  {
    ignores: [
      ".next/**",
      ".superpowers/**",
      ".tocodex/**",
      "artifacts/**",
      "gsap-public/**",
      "gsap-skills-main/**",
      "node_modules/**",
      "out/**",
      "public/vendor/**",
      "test-results/**",
      "tocodex-docs/**",
      "tsconfig.tsbuildinfo",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: browserGlobals,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      // The codebase review found explicit `any` usage low enough to track
      // as a warning. Current hits are mostly menu payload interop and
      // Paper.js integration boundaries; keep this visible while burn-down
      // happens without blocking normal local lint.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-require-imports": "off",

      // Re-enabled at WARN level after the codebase review:
      // - exhaustive-deps catches stale-closure bugs in the many
      //   useEffect/useCallback blocks across editor-context, canvas-view,
      //   and the panel components. Warn (not error) avoids blocking the
      //   build while the existing violations are burned down.
      // - no-unused-vars catches dead imports/parameters; ignore the
      //   leading-underscore convention so deliberately-unused-but-named
      //   destructures (e.g. `const [_first, ...rest]`) don't fire.
      // - prefer-const flags `let` declarations that are never reassigned;
      //   warn-only because there are some intentional `let` patterns
      //   used by the worker / filter machinery.
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "prefer-const": "warn",
    },
  },
)
