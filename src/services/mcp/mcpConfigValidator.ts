import { z } from "zod"

// Base configuration schema for common settings
const BaseConfigSchema = z.object({
	disabled: z.boolean().optional(),
	timeout: z.number().min(1).max(3600).optional().default(60),
	alwaysAllow: z.array(z.string()).default([]),
	watchPaths: z.array(z.string()).optional(),
	disabledTools: z.array(z.string()).default([]),
})

// Custom error messages for better user feedback
const typeErrorMessage = "Server type must be 'stdio', 'sse', or 'streamable-http'"
const stdioFieldsErrorMessage =
	"For 'stdio' type servers, you must provide a 'command' field and can optionally include 'args' and 'env'"
const sseFieldsErrorMessage =
	"For 'sse' type servers, you must provide a 'url' field and can optionally include 'headers'"
const streamableHttpFieldsErrorMessage =
	"For 'streamable-http' type servers, you must provide a 'url' field and can optionally include 'headers'"
const mixedFieldsErrorMessage =
	"Cannot mix 'stdio' and ('sse' or 'streamable-http') fields. For 'stdio' use 'command', 'args', and 'env'. For 'sse'/'streamable-http' use 'url' and 'headers'"
const missingFieldsErrorMessage =
	"Server configuration must include either 'command' (for stdio) or 'url' (for sse/streamable-http) and a corresponding 'type' if 'url' is used."

// Helper function to create a refined schema with better error messages
const createServerTypeSchema = () => {
	return z.union([
		// Stdio config (has command field)
		BaseConfigSchema.extend({
			type: z.enum(["stdio"]).optional(),
			command: z.string().min(1, "Command cannot be empty"),
			args: z.array(z.string()).optional(),
			cwd: z.string().default(() => ""),
			env: z.record(z.string()).optional(),
			// Ensure no SSE fields are present
			url: z.undefined().optional(),
			headers: z.undefined().optional(),
		})
			.transform((data) => ({
				...data,
				type: "stdio" as const,
			}))
			.refine((data) => data.type === undefined || data.type === "stdio", { message: typeErrorMessage }),
		// SSE config (has url field)
		BaseConfigSchema.extend({
			type: z.enum(["sse"]).optional(),
			url: z.string().url("URL must be a valid URL format"),
			headers: z.record(z.string()).optional(),
			// Ensure no stdio fields are present
			command: z.undefined().optional(),
			args: z.undefined().optional(),
			env: z.undefined().optional(),
		})
			.transform((data) => ({
				...data,
				type: "sse" as const,
			}))
			.refine((data) => data.type === undefined || data.type === "sse", { message: typeErrorMessage }),
		// StreamableHTTP config (has url field)
		BaseConfigSchema.extend({
			type: z.enum(["streamable-http"]).optional(),
			url: z.string().url("URL must be a valid URL format"),
			headers: z.record(z.string()).optional(),
			// Ensure no stdio fields are present
			command: z.undefined().optional(),
			args: z.undefined().optional(),
			env: z.undefined().optional(),
		})
			.transform((data) => ({
				...data,
				type: "streamable-http" as const,
			}))
			.refine((data) => data.type === undefined || data.type === "streamable-http", {
				message: typeErrorMessage,
			}),
	])
}

// Server configuration schema with automatic type inference and validation
export const ServerConfigSchema = createServerTypeSchema()

// Settings schema
export const McpSettingsSchema = z.object({
	mcpServers: z.record(ServerConfigSchema),
})

/**
 * Validates and normalizes server configuration
 * @param config The server configuration to validate
 * @param serverName Optional server name for error messages
 * @returns The validated configuration
 * @throws Error if the configuration is invalid
 */
export function validateServerConfig(config: any, serverName?: string): z.infer<typeof ServerConfigSchema> {
	// Detect configuration issues before validation
	const hasStdioFields = config.command !== undefined
	const hasUrlFields = config.url !== undefined // Covers sse and streamable-http

	// Check for mixed fields (stdio vs url-based)
	if (hasStdioFields && hasUrlFields) {
		throw new Error(mixedFieldsErrorMessage)
	}

	// Infer type for stdio if not provided
	if (!config.type && hasStdioFields) {
		config.type = "stdio"
	}

	// For url-based configs, auto-infer type from URL if not provided
	if (hasUrlFields && !config.type) {
		try {
			const url = new URL(config.url)
			if (url.pathname.includes("/sse")) {
				config.type = "sse"
			} else {
				config.type = "streamable-http"
			}
		} catch {
			throw new Error("Configuration with 'url' must explicitly specify 'type' as 'sse' or 'streamable-http'.")
		}
	}

	// Validate type if provided
	if (config.type && !["stdio", "sse", "streamable-http"].includes(config.type)) {
		throw new Error(typeErrorMessage)
	}

	// Check for type/field mismatch
	if (config.type === "stdio" && !hasStdioFields) {
		throw new Error(stdioFieldsErrorMessage)
	}
	if (config.type === "sse" && !hasUrlFields) {
		throw new Error(sseFieldsErrorMessage)
	}
	if (config.type === "streamable-http" && !hasUrlFields) {
		throw new Error(streamableHttpFieldsErrorMessage)
	}

	// If neither command nor url is present (type alone is not enough)
	if (!hasStdioFields && !hasUrlFields) {
		throw new Error(missingFieldsErrorMessage)
	}

	// Validate the config against the schema
	try {
		return ServerConfigSchema.parse(config)
	} catch (validationError) {
		if (validationError instanceof z.ZodError) {
			// Extract and format validation errors
			const errorMessages = validationError.errors
				.map((err) => `${err.path.join(".")}: ${err.message}`)
				.join("; ")
			throw new Error(
				serverName
					? `Invalid configuration for server "${serverName}": ${errorMessages}`
					: `Invalid server configuration: ${errorMessages}`,
			)
		}
		throw validationError
	}
}