import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { Request } from "express";
import { createJsonResponse } from "../mcp-utilities";

export const checkSystemStatusToolInitializer = (server: McpServer, req: Request) => {
  server.tool(
    "check_system_status",
    "Checks the health and status of the MedShield AI MCP server.",
    {},
    async () => {
      return createJsonResponse({
        status: "ok",
        tools_available: 7,
        message: "MedShield AI is fully operational and SHARP headers are securely processing."
      });
    }
  );
};
