import tseslint from '@electron-toolkit/eslint-config-ts'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  {
    ignores: ['dist/**', 'out/**', 'release/**', 'node_modules/**']
  },
  ...tseslint.configs.recommended,
  {
    plugins: {
      'react-hooks': reactHooks
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  }
)
