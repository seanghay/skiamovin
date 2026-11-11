/**
 * Imports a Node built-in at runtime. The specifier is hidden from bundlers so browser builds don't try to resolve
 * (or warn about) modules that only Node code paths use.
 */
export function importNode<T = any>(name: string): Promise<T> {
  return import(/* webpackIgnore: true */ /* @vite-ignore */ name) as Promise<T>;
}
