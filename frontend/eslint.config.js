import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["build/", ".react-router/", "node_modules/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["app/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // TODO: enable once the API layer is typed (loaders currently return any[])
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // FastAPI-style @ts-ignore used for the fetch duplex option
      "@typescript-eslint/ban-ts-comment": ["error", { "ts-ignore": "allow-with-description" }],
      // TODO: refactor localStorage-init effects (SSR forbids reading
      // localStorage in useState initializers) before enabling this
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    // Proxy routes deliberately reject control characters in URL paths
    files: ["app/routes/api.$.tsx", "app/routes/media.$.tsx"],
    rules: {
      "no-control-regex": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
);
