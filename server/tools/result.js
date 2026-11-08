// MCP tool results in the shape every wrangler tool returns: the JSON as text
// (what an agent reads) plus structuredContent; an error is plain text.
export function okResult(structuredContent, lead) {
  const json = JSON.stringify(structuredContent, null, 2);
  return { content: [{ type: 'text', text: lead ? `${lead}\n${json}` : json }], structuredContent };
}

export function errorResult(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export const NOT_ENROLLED = 'This session is not running in YOLO mode, so it has no repo to act on. Only a session launched with YOLO on (or spawned by one) can use this tool.';
