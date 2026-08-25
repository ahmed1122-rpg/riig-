import type { ApplicationCapabilities } from "@motionprep/contracts";
import type { Dispatch, SetStateAction } from "react";

import type { ProjectSummary } from "../../lib/api";
import type { ProjectMode } from "../../types";

export type WorkspaceSetState<Value> = Dispatch<SetStateAction<Value>>;

type WorkspaceProjectReference = Pick<
  ProjectSummary,
  | "id"
  | "name"
  | "currentSourceVersionId"
  | "currentSourceVersionNumber"
>;

export interface WorkspaceProps {
  mode: ProjectMode;
  capabilities: ApplicationCapabilities;
  onModeChange: (mode: ProjectMode) => Promise<boolean>;
  onBack: () => void;
  onNavigationGuardChange: (
    guard: (() => Promise<boolean>) | null,
  ) => void;
  onNotify: (message: string) => void;
  authenticated: boolean;
  onRequireAuth: () => void;
  initialProject: WorkspaceProjectReference | null;
  onProjectAdopted: (project: WorkspaceProjectReference) => void;
}
