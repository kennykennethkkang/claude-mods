export function idGen(prefix: string) {
  let n = 0
  return () => `${prefix}${++n}`
}
