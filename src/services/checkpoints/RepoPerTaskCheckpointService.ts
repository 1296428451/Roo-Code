import { CheckpointServiceOptions } from "./types"
import { ShadowCheckpointService } from "./ShadowCheckpointService"

export class RepoPerTaskCheckpointService extends ShadowCheckpointService {
	public static create({ taskId, workspaceDir, shadowDir, log = console.log }: CheckpointServiceOptions) {
		return new RepoPerTaskCheckpointService(
			taskId,
			ShadowCheckpointService.workspaceRepoDir({ globalStorageDir: shadowDir, workspaceDir }),
			workspaceDir,
			log,
		)
	}
}