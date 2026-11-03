/**
 * What a card reads, kept once per page: the same item on several cards, or the same card drawn again, asks once.
 * `refresh` asks again, and a failure is not kept.
 */
export function perPage<A, T>(read: (arg: A) => Promise<T>, keyOf: (arg: A) => string) {
  const cache = new Map<string, Promise<T>>()
  return (arg: A, { refresh = false } = {}): Promise<T> => {
    const key = keyOf(arg).toLowerCase()
    if (refresh) cache.delete(key)
    let p = cache.get(key)
    if (!p) {
      p = read(arg)
      cache.set(key, p)
      p.catch(() => cache.get(key) === p && cache.delete(key))
    }
    return p
  }
}
