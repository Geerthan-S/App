/**
 * Per-request context for the callable boundary.
 * `domainCall` opens a context for each request so code deep inside a handler
 * (the audit logger) can record who called from where without threading the
 * request through every function.
 */

import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  functionName: string;
  ipAddress?: string;
  /** Full X-Forwarded-For chain; the leftmost hop is client-supplied and can be spoofed. */
  forwardedFor?: string;
  userAgent?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const runWithRequestContext = <T>(context: RequestContext, fn: () => Promise<T>): Promise<T> =>
  storage.run(context, fn);

export const currentRequestContext = (): RequestContext | undefined => storage.getStore();

/** Client hints are bounded so a hostile header cannot bloat audit records. */
const bounded = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value.slice(0, max) : undefined;

interface RawRequestLike {
  ip?: unknown;
  headers?: Record<string, unknown>;
}

export const contextFromRawRequest = (functionName: string, raw: RawRequestLike | undefined): RequestContext => ({
  functionName,
  ipAddress: bounded(raw?.ip, 64) ?? bounded(String(raw?.headers?.['x-forwarded-for'] ?? '').split(',').pop()?.trim(), 64),
  forwardedFor: bounded(raw?.headers?.['x-forwarded-for'], 256),
  userAgent: bounded(raw?.headers?.['user-agent'], 256),
});
