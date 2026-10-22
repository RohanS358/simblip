// Flat config (ESLint 9) on Next's own presets. Rules that flag existing patterns across the codebase
// are warnings, so `npm run lint` fails only on real errors; tighten them as the code is cleaned up.
import next from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

export default [
  ...next,
  ...nextTs,
  {
    ignores: ['.next/**', 'node_modules/**', 'public/**', 'out/**', 'scratch/**', '**/*.test.mjs', 'scripts/**', 'app.js', 'third-party-licenses.txt'],
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/static-components': 'warn',
      'react/no-unescaped-entities': 'warn',
      '@next/next/no-img-element': 'warn',
      'prefer-const': 'warn',
      'react-hooks/use-memo': 'warn',
      'react/display-name': 'warn',
      '@typescript-eslint/no-namespace': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
    },
  },
]
