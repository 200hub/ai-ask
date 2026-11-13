import antfu from '@antfu/eslint-config'

export default antfu(
  {
    svelte: true,
    ignores: [
      'build/',
      '.svelte-kit/',
      'dist/',
      'node_modules/',
      'src-tauri/',
      '.github/'
    ]
  },
  {
    rules: {
      'antfu/reasonable-newline': 'off',
      'svelte/indent': 'off'
    }
  }
)
