export interface LayerPreset {
  id: string;
  version: number;
  labelAr: string;
  projectKind: "image" | "book";
  namePrefix: "+";
  maxLayers: number | null;
  requiredLayerPatterns: readonly string[];
  exportFormats: readonly ("psd" | "png-json" | "txt" | "csv")[];
}

export const builtInPresets = {
  characterBasic: {
    id: "character-basic",
    version: 1,
    labelAr: "شخصية — إعداد أساسي",
    projectKind: "image",
    namePrefix: "+",
    maxLayers: 15,
    requiredLayerPatterns: ["head", "body"],
    exportFormats: ["psd", "png-json"],
  },
  kineticWords: {
    id: "kinetic-words",
    version: 1,
    labelAr: "كتاب متحرك — كلمات",
    projectKind: "book",
    namePrefix: "+",
    maxLayers: null,
    requiredLayerPatterns: [],
    exportFormats: ["psd", "png-json", "txt", "csv"],
  },
  kineticLines: {
    id: "kinetic-lines",
    version: 1,
    labelAr: "كتاب متحرك — أسطر",
    projectKind: "book",
    namePrefix: "+",
    maxLayers: null,
    requiredLayerPatterns: [],
    exportFormats: ["psd", "png-json", "txt", "csv"],
  },
} as const satisfies Record<string, LayerPreset>;

export * from "./motion-presets.js";
export {
  createPdfBackgroundLayerName,
  createPdfPageGroupName,
  createPdfTextLayerName,
  isPdfPageRootGroup,
  normalizeLayerName,
  validateProductionDocument,
} from "@motionprep/layer-domain";
