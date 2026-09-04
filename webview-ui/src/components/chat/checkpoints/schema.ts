import { z } from "zod"

export const checkpointSchema = z.object({
	from: z.string(),
	to: z.string(),
	isFileSnapshot: z.boolean().optional(),
	files: z.array(z.string()).optional(),
	tool: z.string().optional(),
	description: z.string().optional(),
})

export type Checkpoint = z.infer<typeof checkpointSchema>
