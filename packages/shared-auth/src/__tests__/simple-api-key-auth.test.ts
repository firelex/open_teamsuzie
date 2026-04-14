import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SimpleApiKeyAuth } from '../middleware/simple-api-key-auth.js';
import type { Request, Response, NextFunction } from 'express';

function mockReq(overrides: Partial<Request> = {}): Request {
    return {
        headers: {},
        ip: '203.0.113.1',
        socket: { remoteAddress: '203.0.113.1' },
        ...overrides,
    } as unknown as Request;
}

function mockRes(): Response & { statusCode: number; body: unknown } {
    const res = {
        statusCode: 0,
        body: undefined as unknown,
        status(code: number) {
            res.statusCode = code;
            return res;
        },
        json(data: unknown) {
            res.body = data;
            return res;
        },
    };
    return res as unknown as Response & { statusCode: number; body: unknown };
}

describe('SimpleApiKeyAuth', () => {
    const logger = { warn: vi.fn() };

    beforeEach(() => {
        vi.restoreAllMocks();
        logger.warn.mockReset();
    });

    describe('fail-closed when no key configured', () => {
        it('returns 503 when no API key is configured', () => {
            const auth = new SimpleApiKeyAuth({ apiKey: undefined, logger });
            const req = mockReq({ headers: { 'x-api-key': 'some-key' } });
            const res = mockRes();
            const next = vi.fn();

            auth.checkApiKey(req, res, next);

            expect(res.statusCode).toBe(503);
            expect((res.body as any).error).toBe('Service Unavailable');
            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('key validation', () => {
        it('returns 401 when no key provided in request', () => {
            const auth = new SimpleApiKeyAuth({ apiKey: 'test-key-123', logger });
            const req = mockReq();
            const res = mockRes();
            const next = vi.fn();

            auth.checkApiKey(req, res, next);

            expect(res.statusCode).toBe(401);
            expect((res.body as any).error).toBe('Unauthorized');
            expect(next).not.toHaveBeenCalled();
        });

        it('returns 403 when wrong key provided', () => {
            const auth = new SimpleApiKeyAuth({ apiKey: 'test-key-123', logger });
            const req = mockReq({ headers: { 'x-api-key': 'wrong-key' } });
            const res = mockRes();
            const next = vi.fn();

            auth.checkApiKey(req, res, next);

            expect(res.statusCode).toBe(403);
            expect((res.body as any).error).toBe('Forbidden');
            expect(next).not.toHaveBeenCalled();
        });

        it('calls next() when correct X-API-Key provided', () => {
            const auth = new SimpleApiKeyAuth({ apiKey: 'test-key-123', logger });
            const req = mockReq({ headers: { 'x-api-key': 'test-key-123' } });
            const res = mockRes();
            const next = vi.fn();

            auth.checkApiKey(req, res, next);

            expect(next).toHaveBeenCalledOnce();
            expect(res.statusCode).toBe(0);
        });

        it('accepts key via Authorization Bearer header', () => {
            const auth = new SimpleApiKeyAuth({ apiKey: 'test-key-123', logger });
            const req = mockReq({ headers: { authorization: 'Bearer test-key-123' } });
            const res = mockRes();
            const next = vi.fn();

            auth.checkApiKey(req, res, next);

            expect(next).toHaveBeenCalledOnce();
        });
    });

    describe('localhost bypass', () => {
        it('bypasses auth for localhost in non-production', () => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'development';

            const auth = new SimpleApiKeyAuth({ apiKey: 'test-key-123', allowLocalhostBypass: true, logger });
            const req = mockReq({ ip: '127.0.0.1', headers: {} });
            const res = mockRes();
            const next = vi.fn();

            auth.checkApiKey(req, res, next);

            expect(next).toHaveBeenCalledOnce();

            process.env.NODE_ENV = originalEnv;
        });

        it('bypasses auth for IPv6 localhost', () => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'development';

            const auth = new SimpleApiKeyAuth({ apiKey: 'test-key-123', allowLocalhostBypass: true, logger });
            const req = mockReq({ ip: '::1', headers: {} });
            const res = mockRes();
            const next = vi.fn();

            auth.checkApiKey(req, res, next);

            expect(next).toHaveBeenCalledOnce();

            process.env.NODE_ENV = originalEnv;
        });

        it('does NOT bypass auth for localhost in production', () => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';

            const auth = new SimpleApiKeyAuth({ apiKey: 'test-key-123', allowLocalhostBypass: true, logger });
            const req = mockReq({ ip: '127.0.0.1', headers: {} });
            const res = mockRes();
            const next = vi.fn();

            auth.checkApiKey(req, res, next);

            expect(next).not.toHaveBeenCalled();
            expect(res.statusCode).toBe(401);

            process.env.NODE_ENV = originalEnv;
        });

        it('does NOT bypass when allowLocalhostBypass is false', () => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'development';

            const auth = new SimpleApiKeyAuth({ apiKey: 'test-key-123', allowLocalhostBypass: false, logger });
            const req = mockReq({ ip: '127.0.0.1', headers: {} });
            const res = mockRes();
            const next = vi.fn();

            auth.checkApiKey(req, res, next);

            expect(next).not.toHaveBeenCalled();
            expect(res.statusCode).toBe(401);

            process.env.NODE_ENV = originalEnv;
        });
    });
});
