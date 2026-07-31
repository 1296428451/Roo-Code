import type { ModelInfo } from "../model.js"

export type VscodeLlmModelId = string

export const vscodeLlmDefaultModelId = "claude-3.5-sonnet"

export const vscodeLlmModels: Record<string, ModelInfo> = {}