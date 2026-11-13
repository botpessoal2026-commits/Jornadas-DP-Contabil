import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      ".vercel/**",
      "public/**",
      "downloads/**",
      "test-results/**",
      "playwright-report/**",
      "next-env.d.ts",
    ],
  },
  {
    files: [
      "src/**/*.{ts,tsx}",
      "tests/**/*.ts",
      "e2e/**/*.ts",
      "scripts/**/*.mjs",
      "*.{ts,mjs}",
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      // Declarações e sobrecargas TypeScript são conferidas pelo compilador.
      "no-undef": "off",
      "no-redeclare": "off",
      // Preserva o código legado; não exige uma limpeza de imports para distribuir a ferramenta.
      "no-unused-vars": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
];
