/**
 * Shadow Wrapper — Zero Side-Effects Enforcement
 *
 * Wraps all downstream write operations to enforce shadow mode.
 * When shadow mode is active, writes are logged as "intended"
 * in the decision log but never executed.
 *
 * Ticket: stabilizare/antigravity - Shadow Mode Enforcement
 */

import { logDecision } from './decisionLogger.mjs';

/**
 * Execution context for shadow mode
 */
export class ExecutionContext {
    constructor(traceId, mode = 'production') {
        this.traceId = traceId;
        this.mode = mode; // 'shadow' | 'canary' | 'production'
        this.intendedWrites = [];
        this.executedWrites = [];
    }

    isShadow() { return this.mode === 'shadow'; }
    isCanary() { return this.mode === 'canary'; }
    isProduction() { return this.mode === 'production'; }
}

/**
 * Create execution context from env + request headers
 */
export function createContext(req) {
    const traceId = req?.headers?.['x-trace-id'] || crypto.randomUUID();
    const headerMode = req?.headers?.['x-run-mode'];

    let mode = 'production';
    if (headerMode === 'shadow') mode = 'shadow';
    else if (headerMode === 'canary') mode = 'canary';
    else if (process.env.AI_SHADOW_MODE_ENABLED === 'true') mode = 'shadow';

    return new ExecutionContext(traceId, mode);
}

/**
 * Wrap a write operation with shadow mode enforcement
 *
 * @param {ExecutionContext} ctx - Current execution context
 * @param {string} operationName - Human-readable name (e.g., 'send_whatsapp_reply')
 * @param {Object} payload - The data that would be written
 * @param {Function} writeFn - The actual write function to execute
 * @returns {Object} Result of the write (real or simulated)
 */
export async function shadowWrite(ctx, operationName, payload, writeFn) {
    const writeRecord = {
        operation: operationName,
        payload_summary: summarizePayload(payload),
        timestamp: new Date().toISOString(),
        mode: ctx.mode,
        trace_id: ctx.traceId
    };

    if (ctx.isShadow()) {
        // Shadow mode: log intent, do NOT execute
        writeRecord.status = 'intended_only';
        writeRecord.executed = false;
        ctx.intendedWrites.push(writeRecord);

        await logDecision({
            traceId: ctx.traceId,
            action: 'shadow_write_blocked',
            operation: operationName,
            payload: redactSensitive(payload),
            result: { status: 'intended_only', reason: 'shadow_mode_active' },
            zone: ctx.mode
        });

        return { ok: true, shadow: true, intended: true, operation: operationName };
    }

    if (ctx.isCanary()) {
        // Canary mode: execute but log extensively
        try {
            const result = await writeFn(payload);
            writeRecord.status = 'executed_canary';
            writeRecord.executed = true;
            ctx.executedWrites.push(writeRecord);

            await logDecision({
                traceId: ctx.traceId,
                action: 'canary_write_executed',
                operation: operationName,
                payload: redactSensitive(payload),
                result: { status: 'executed', canary: true },
                zone: ctx.mode
            });

            return result;
        } catch (err) {
            writeRecord.status = 'failed_canary';
            writeRecord.error = err.message;

            await logDecision({
                traceId: ctx.traceId,
                action: 'canary_write_failed',
                operation: operationName,
                payload: redactSensitive(payload),
                result: { status: 'failed', error: err.message, canary: true },
                zone: ctx.mode
            });

            throw err;
        }
    }

    // Production mode: execute normally
    try {
        const result = await writeFn(payload);
        writeRecord.status = 'executed';
        writeRecord.executed = true;
        ctx.executedWrites.push(writeRecord);
        return result;
    } catch (err) {
        writeRecord.status = 'failed';
        writeRecord.error = err.message;
        throw err;
    }
}

/**
 * Redact sensitive fields from payload before logging
 */
function redactSensitive(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    const redacted = { ...payload };
    const sensitiveFields = ['phone', 'email', 'real_phone_e164', 'address', 'billing_details', 'token', 'password', 'secret'];
    for (const field of sensitiveFields) {
        if (redacted[field]) {
            const val = String(redacted[field]);
            redacted[field] = val.substring(0, 3) + '***' + val.substring(val.length - 2);
        }
    }
    // Redact nested objects
    if (redacted.client) redacted.client = redactSensitive(redacted.client);
    if (redacted.message?.content && typeof redacted.message.content === 'string') {
        redacted.message = { ...redacted.message, content: redacted.message.content.substring(0, 50) + '...[redacted]' };
    }
    return redacted;
}

/**
 * Summarize payload for compact logging
 */
function summarizePayload(payload) {
    if (!payload) return null;
    if (typeof payload === 'string') return payload.substring(0, 100);
    const keys = Object.keys(payload);
    return { keys, size: JSON.stringify(payload).length };
}

/**
 * Get shadow mode status from environment
 */
export function getShadowStatus() {
    return {
        enabled: process.env.AI_SHADOW_MODE_ENABLED === 'true',
        env_value: process.env.AI_SHADOW_MODE_ENABLED || 'not_set'
    };
}

export default { ExecutionContext, createContext, shadowWrite, getShadowStatus };
