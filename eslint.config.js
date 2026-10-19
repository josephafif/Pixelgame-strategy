// Lint configuration (ESLint flat config, no plugins required).
const shared = ['console', 'performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'structuredClone', 'URL', 'URLSearchParams', 'WebSocket', 'TextEncoder', 'TextDecoder', 'atob', 'btoa', 'globalThis', 'fetch', 'OffscreenCanvas'];
const browser = ['window', 'document', 'caches', 'Blob', 'ResizeObserver', 'Path2D', 'navigator', 'location', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'Worker', 'self', 'ImageData', 'HTMLCanvasElement', 'indexedDB'];
const node = ['process', 'Buffer'];
const globals = Object.fromEntries([...shared, ...browser, ...node].map((g) => [g, 'readonly']));

export default [
  { ignores: ['node_modules/**', 'artifacts/**'] },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'none', ignoreRestSiblings: true }],
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-redeclare': 'error',
      'no-self-assign': 'error',
      'no-self-compare': 'error',
      'no-unsafe-negation': 'error',
      'no-cond-assign': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      'no-fallthrough': 'error',
      'no-sparse-arrays': 'error',
      'no-unsafe-finally': 'error',
      'no-loss-of-precision': 'error',
      'no-constant-binary-expression': 'error',
    },
  },
];
