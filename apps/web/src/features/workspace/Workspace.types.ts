import type { ApplicationCapabilities } from "@motionprep/contracts";

import type { ProjectSummary } from "../../lib/api";
import type { ProjectMode } from "../../types";

export interface WorkspaceProps {
  mode: ProjectMode;
  capabilities: ApplicationCapabilities;
  onModeChange: (mode: ProjectMode) => void;
  onBack: () => void;
  onNavigationGuardChange: (
    guard: (() => Promise<boolean>) | null,
  ) => void;
  onNotify: (message: string) => void;
  authenticated: boolean;
  onRequireAuth: () => void;
  initialProject: Pick<
    ProjectSummary,
    | "id"
    | "name"
    | "currentSourceVersionId"
    | "currentSourceVersionNumber"
  > | null;
}
