/**
 * Re-export from the canonical location.
 * The real ToolExecutor lives in src/agent/ToolExecutor.ts.
 * This file exists only for backwards compatibility.
 */
export { ToolExecutor, type ToolCall, type ToolResult } from '../agent/ToolExecutor';
