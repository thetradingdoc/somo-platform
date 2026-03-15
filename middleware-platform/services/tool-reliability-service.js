/**
 * ToolReliabilityService
 *
 * Wraps tool executions with timeouts, basic retries, and logging.
 */

const logger = require('./logger');

class ToolReliabilityService {
  /**
   * Execute a tool with timeout and optional retries.
   * @param {Object} params
   * @param {string} params.toolName
   * @param {string} [params.callId]
   * @param {number} [params.timeoutMs]
   * @param {number} [params.maxRetries]
   * @param {() => Promise<any>} params.fn
   */
  async execute({ toolName, callId, timeoutMs = 3000, maxRetries = 0, fn }) {
    let attempt = 0;
    const start = Date.now();

    const runOnce = async () => {
      attempt += 1;
      const timer = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Tool timeout')), timeoutMs)
      );
      return Promise.race([fn(), timer]);
    };

    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const result = await runOnce();
        const elapsed = Date.now() - start;
        logger.info('Tool executed', {
          toolName,
          callId,
          attempt,
          elapsedMs: elapsed
        });
        return { ok: true, result, attempts: attempt };
      } catch (error) {
        const elapsed = Date.now() - start;
        logger.warn('Tool execution failed', {
          toolName,
          callId,
          attempt,
          elapsedMs: elapsed,
          error: error.message
        });
        if (attempt > maxRetries) {
          return { ok: false, error, attempts: attempt };
        }
      }
    }
  }
}

module.exports = new ToolReliabilityService();

