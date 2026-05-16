import tseslint from "typescript-eslint"

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

const noopRule = {
  meta: {
    type: "problem",
    schema: [],
  },
  create() {
    return {}
  },
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
      "artifacts/**",
      "node_modules/**",
      "test-results/**",
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
      "react-hooks": {
        rules: {
          "exhaustive-deps": noopRule,
        },
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "prefer-const": "off",
      "react-hooks/exhaustive-deps": "off",
    },
  },
)
