import type { Point } from "./GuidanceEditorShared";

export type ImagePrompt = "keep" | "exclude" | "separate" | "erase";

export interface GuidanceStroke {
  id: string;
  prompt: Exclude<ImagePrompt, "erase">;
  size: number;
  points: Point[];
}

export function imageStrokePath(points: readonly Point[]): string {
  return points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${point.x * 1000} ${point.y * 1000}`,
    )
    .join(" ");
}
