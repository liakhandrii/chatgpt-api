/// <reference lib="dom" />

let _undici: any

// Use `undici` for node.js 16 and 17
// Use `fetch` for node.js >= 18
// Use `fetch` for all other environments, including browsers
// NOTE: The top-level await is removed in a `postbuild` npm script for the
// browser build
const fetch =
  globalThis.fetch ??
  async function undiciFetchWrapper(
    ...args: Parameters<typeof globalThis.fetch>
  ): Promise<Response> {
    if (!_undici) {
      _undici = await import('undici')
    }

    return _undici.fetch(...args)
  }

export { fetch }
