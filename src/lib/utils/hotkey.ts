/**
 * 判断两次按键是否在指定时间窗内
 */
export function isDoublePress(
	lastPressedAt: number | null,
	currentTimestamp: number,
	thresholdMs = 400,
): boolean {
	if (lastPressedAt === null) {
		return false;
	}

	const delta = currentTimestamp - lastPressedAt;
	return delta >= 0 && delta <= thresholdMs;
}

/**
 * 创建双击检测器，内部维护上一次触发时间
 */
export function createDoublePressDetector(thresholdMs = 400) {
	let lastPressedAt: number | null = null;

	return (timestamp = Date.now()) => {
		const isDouble = isDoublePress(lastPressedAt, timestamp, thresholdMs);
		lastPressedAt = timestamp;
		return isDouble;
	};
}
