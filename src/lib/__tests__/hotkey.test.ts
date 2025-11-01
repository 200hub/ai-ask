import { describe, it, expect } from "vitest";
import { isDoublePress, createDoublePressDetector } from "$lib/utils/hotkey";

describe("hotkey utils", () => {
	describe("isDoublePress", () => {
		it("returns false when lastPressedAt is null", () => {
			expect(isDoublePress(null, Date.now())).toBe(false);
		});

		it("returns true when within threshold", () => {
			const first = 1000;
			const second = 1300; // 300ms later
			expect(isDoublePress(first, second, 400)).toBe(true);
		});

		it("returns true when exactly at threshold", () => {
			const first = 1000;
			const second = 1400; // exactly 400ms
			expect(isDoublePress(first, second, 400)).toBe(true);
		});

		it("returns false when beyond threshold", () => {
			const first = 1000;
			const second = 1401; // 401ms later
			expect(isDoublePress(first, second, 400)).toBe(false);
		});

		it("returns false when timestamp is in past (negative delta)", () => {
			const first = 1000;
			const second = 999;
			expect(isDoublePress(first, second, 400)).toBe(false);
		});

		it("handles custom threshold", () => {
			const first = 1000;
			const second = 1250; // 250ms later
			expect(isDoublePress(first, second, 300)).toBe(true);
			expect(isDoublePress(first, second, 200)).toBe(false);
		});
	});

	describe("createDoublePressDetector", () => {
		it("returns false on first press", () => {
			const detector = createDoublePressDetector();
			expect(detector(1000)).toBe(false);
		});

		it("returns true on second press within threshold", () => {
			const detector = createDoublePressDetector(400);
			detector(1000);
			expect(detector(1300)).toBe(true);
		});

		it("returns false on second press beyond threshold", () => {
			const detector = createDoublePressDetector(400);
			detector(1000);
			expect(detector(1500)).toBe(false);
		});

	it("updates lastPressedAt on each call", () => {
		const detector = createDoublePressDetector(400);
		expect(detector(1000)).toBe(false); // first
		expect(detector(1300)).toBe(true); // second (double) -> true
		// Third press within 400ms of second still counts as double
		expect(detector(1600)).toBe(true);
	});		it("supports triple-press sequence", () => {
			const detector = createDoublePressDetector(400);
			expect(detector(1000)).toBe(false); // first
			expect(detector(1200)).toBe(true); // double
			expect(detector(1400)).toBe(true); // triple (still within 400ms of second)
		});
	});
});
