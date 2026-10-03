/**
 * SQLite allows a single writer. With several pooled connections, a transaction
 * waiting for the write lock blocks the query engine and the transaction that
 * holds the lock can then never finish (both end in P1008 after the busy
 * timeout). One connection queues transactions in the pool instead.
 */
export function singleConnectionUrl(url: string): string {
  if (!url.startsWith("file:") || /[?&]connection_limit=/.test(url)) return url
  return `${url}${url.includes("?") ? "&" : "?"}connection_limit=1`
}
