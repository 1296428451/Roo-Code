import { useMemo, useRef, useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"

import { CheckpointMenu } from "./CheckpointMenu"
import { checkpointSchema } from "./schema"
import { GitCommitVertical } from "lucide-react"
import { StandardTooltip } from "@/components/ui"

/** How many words of the snapshot label are shown inline (the rest is revealed on hover). */
const MAX_SNAPSHOT_LABEL_WORDS = 8
/** Hard cap on characters so labels without spaces (e.g. long file paths) also stay short. */
const MAX_SNAPSHOT_LABEL_CHARS = 72
/** How much of the head/tail of a long unbreakable label (e.g. a path) is kept. */
const SNAPSHOT_LABEL_HEAD_CHARS = 20
const SNAPSHOT_LABEL_TAIL_CHARS = 26

/**
 * Builds the short version of a snapshot label (e.g. "Apply diff to: <path>") for the
 * timeline. Labels are usually long and path-heavy, so they are cut down to roughly
 * eight words; long unbreakable labels keep their tail as well, so the file name stays
 * readable. The full label is always available in the hover tooltip.
 */
const shortenSnapshotLabel = (label: string): string => {
	const normalized = label.replace(/\s+/g, " ").trim()

	if (!normalized || normalized.length <= MAX_SNAPSHOT_LABEL_CHARS) {
		return normalized
	}

	const words = normalized.split(" ")

	if (words.length > MAX_SNAPSHOT_LABEL_WORDS) {
		return `${words.slice(0, MAX_SNAPSHOT_LABEL_WORDS).join(" ")} ...`
	}

	// A single very long token (typically a Windows/Unix path).
	const head = normalized.slice(0, SNAPSHOT_LABEL_HEAD_CHARS).trimEnd()
	const tail = normalized.slice(-SNAPSHOT_LABEL_TAIL_CHARS)

	return `${head} ... ${tail}`
}

type CheckpointSavedProps = {
	ts: number
	commitHash: string
	currentHash?: string
	checkpoint?: Record<string, unknown>
	onJumpToPreviousCheckpoint?: () => void
}

export const CheckpointSaved = ({
	checkpoint,
	currentHash,
	onJumpToPreviousCheckpoint,
	...props
}: CheckpointSavedProps) => {
	const { t } = useTranslation()
	const isCurrent = currentHash === props.commitHash
	const [isPopoverOpen, setIsPopoverOpen] = useState(false)
	const [isClosing, setIsClosing] = useState(false)
	const [isHovering, setIsHovering] = useState(false)
	const closeTimer = useRef<number | null>(null)

	useEffect(() => {
		return () => {
			if (closeTimer.current) {
				window.clearTimeout(closeTimer.current)
				closeTimer.current = null
			}
		}
	}, [])

	const handlePopoverOpenChange = (open: boolean) => {
		setIsPopoverOpen(open)
		if (open) {
			setIsClosing(false)
			if (closeTimer.current) {
				window.clearTimeout(closeTimer.current)
				closeTimer.current = null
			}
		} else {
			setIsClosing(true)
			closeTimer.current = window.setTimeout(() => {
				setIsClosing(false)
				closeTimer.current = null
			}, 200) // keep menu visible briefly to avoid popover jump
		}
	}

	const handleMouseEnter = () => {
		setIsHovering(true)
	}

	const handleMouseLeave = () => {
		setIsHovering(false)
	}

	// Menu is visible when hovering, popover is open, or briefly after popover closes
	const menuVisible = isHovering || isPopoverOpen || isClosing

	const metadata = useMemo(() => {
		if (!checkpoint) {
			return undefined
		}

		const result = checkpointSchema.safeParse(checkpoint)

		if (!result.success) {
			return undefined
		}

		return result.data
	}, [checkpoint])

	// For file snapshots, show tool/description info
	const snapshotLabel = useMemo(() => {
		if (!metadata || metadata.isFileSnapshot !== true || !metadata.description) {
			return undefined
		}

		return metadata.description
	}, [metadata])

	// The snapshot label (e.g. "Apply diff to: <some/very/long/path>") is far too long to
	// render in the timeline, so only a short version is shown inline. The full text is
	// available on hover via the tooltip.
	const shortSnapshotLabel = useMemo(
		() => (snapshotLabel ? shortenSnapshotLabel(snapshotLabel) : undefined),
		[snapshotLabel],
	)

	if (!metadata) {
		return null
	}

	return (
		<div
			className="flex items-center justify-between gap-2 pt-2 pb-3"
			onMouseEnter={handleMouseEnter}
			onMouseLeave={handleMouseLeave}>
			<div className="flex items-center gap-2 text-blue-400 whitespace-nowrap min-w-0">
				<GitCommitVertical className="w-4 shrink-0" />
				<span className="font-semibold shrink-0">{t("chat:checkpoint.regular")}</span>
				{isCurrent && <span className="text-muted shrink-0">({t("chat:checkpoint.current")})</span>}
				{shortSnapshotLabel && (
					<StandardTooltip content={snapshotLabel} side="top" align="start" maxWidth={560}>
						<span
							data-testid="checkpoint-snapshot-label"
							className="text-muted text-xs truncate max-w-[300px] cursor-default">
							{shortSnapshotLabel}
						</span>
					</StandardTooltip>
				)}
			</div>
			<span
				className="block w-full h-[2px] mt-[2px] text-xs"
				style={{
					backgroundImage:
						"linear-gradient(90deg, rgba(0, 188, 255, .65), rgba(0, 188, 255, .65) 80%, rgba(0, 188, 255, 0) 99%)",
				}}></span>

			{/* Keep menu visible while hovering, popover is open, or briefly after close to prevent jump */}
			<div data-testid="checkpoint-menu-container" className={cn("h-4 -mt-2", menuVisible ? "block" : "hidden")}>
				<CheckpointMenu
					ts={props.ts}
					commitHash={props.commitHash}
					checkpoint={metadata}
					onOpenChange={handlePopoverOpenChange}
					onJumpToPreviousCheckpoint={onJumpToPreviousCheckpoint}
				/>
			</div>
		</div>
	)
}
