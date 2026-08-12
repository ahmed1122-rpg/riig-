export type DerivedAssetCategory = "processing" | "tool" | "guidance";

export interface DerivedAssetRegistry {
  register(
    projectId: string,
    objectKey: string,
    category: DerivedAssetCategory,
  ): Promise<void>;
}
