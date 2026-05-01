/**
 * Creates a standardized MCP text response.
 */
export function createTextResponse(
  text: string,
  options: { isError: boolean } = { isError: false }
): { content: { type: "text"; text: string }[]; isError?: boolean } {
  return {
    content: [{ type: "text", text }],
    isError: options.isError,
  };
}

/**
 * Creates a structured JSON response for MCP tools.
 */
export function createJsonResponse(
  data: any,
  options: { isError: boolean } = { isError: false }
): { content: { type: "text"; text: string }[]; isError?: boolean } {
  return createTextResponse(JSON.stringify(data, null, 2), options);
}
