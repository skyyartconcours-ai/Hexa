/**
 * HTTP transport for the optional Python sidecar.
 *
 * Two failure classes are kept apart on purpose, because the client reacts to
 * them differently:
 *
 *   TRANSPORT  — nothing listening, DNS/socket error, timeout. The sidecar is
 *                *absent*: invalidate the health memo and degrade.
 *   PROTOCOL   — the sidecar answered with a structured error (no face, bad
 *                image, model download failed). The sidecar is *present* and
 *                said no; surface that to the caller.
 */

import type { Logger } from '@hexa/core';
import { HexaError } from '@hexa/core';

export interface SidecarErrorPayload {
  error?: { code?: string; message?: string; hint?: string };
}

export interface HealthResponse {
  status: string;
  version?: string;
  models?: Record<string, unknown>;
}

export class TransportError extends Error {
  readonly kind = 'transport';
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'TransportError';
  }
}

export class ProtocolError extends Error {
  readonly kind = 'protocol';
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'ProtocolError';
  }

  toHexaError(): HexaError {
    return new HexaError('PROVIDER_ERROR', `vision sidecar: ${this.message}`, {
      hint: this.hint,
      details: { status: this.status, sidecarCode: this.code },
    });
  }
}

export class Sidecar {
  constructor(
    readonly endpoint: string,
    private readonly timeoutMs: number,
    private readonly log?: Logger,
  ) {}

  private url(path: string): string {
    return `${this.endpoint.replace(/\/+$/, '')}${path}`;
  }

  /**
   * True when the sidecar is reachable over loopback, which means it shares our
   * filesystem and we can hand it a path instead of megabytes of base64.
   */
  get isLocal(): boolean {
    try {
      const host = new URL(this.endpoint).hostname.replace(/^\[|\]$/g, '');
      return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0';
    } catch {
      return false;
    }
  }

  async health(timeoutMs: number): Promise<HealthResponse> {
    return this.request<HealthResponse>('GET', '/health', undefined, timeoutMs);
  }

  async postJson<T>(path: string, body: unknown, timeoutMs?: number): Promise<T> {
    return this.request<T>('POST', path, body, timeoutMs ?? this.timeoutMs);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body: unknown, timeoutMs: number): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
    let res: Response;
    try {
      res = await fetch(this.url(path), {
        method,
        signal: controller.signal,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (cause) {
      const aborted = controller.signal.aborted;
      throw new TransportError(
        aborted ? `vision sidecar timed out after ${timeoutMs}ms` : `vision sidecar unreachable at ${this.endpoint}`,
        cause,
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text().catch(() => '');
    if (!res.ok) {
      let code = `HTTP_${res.status}`;
      let message = text.slice(0, 400) || res.statusText;
      let hint: string | undefined;
      try {
        const parsed = JSON.parse(text) as SidecarErrorPayload;
        if (parsed?.error) {
          code = parsed.error.code ?? code;
          message = parsed.error.message ?? message;
          hint = parsed.error.hint;
        }
      } catch {
        /* non-JSON error body — keep the raw text */
      }
      // 5xx from a *reachable* sidecar is still a protocol answer: the process
      // is up, so flipping to "unavailable" would wrongly disable the sidecar
      // for the rest of the run.
      throw new ProtocolError(message, res.status, code, hint);
    }

    try {
      return JSON.parse(text) as T;
    } catch (cause) {
      throw new ProtocolError('sidecar returned a non-JSON success body', res.status, 'BAD_RESPONSE');
    }
  }
}

export function isTransportError(err: unknown): err is TransportError {
  return err instanceof TransportError;
}

export function isProtocolError(err: unknown): err is ProtocolError {
  return err instanceof ProtocolError;
}

export function describeError(err: unknown): string {
  if (err instanceof ProtocolError) return `${err.code}: ${err.message}`;
  if (err instanceof TransportError) return err.message;
  return err instanceof Error ? err.message : String(err);
}
