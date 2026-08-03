export interface MotionDepthPreset {
  id: string;
  nameAr: string;
  descriptionAr: string;
  parallaxScale: number;
  depthLayers: {
    name: string;
    depthOffsetZ: number;
    blurRadius: number;
    scaleMultiplier: number;
  }[];
  afterEffectsKeyframes: {
    property: "position" | "scale" | "opacity" | "rotation";
    easing: "cubic-bezier" | "linear";
    durationSeconds: number;
  }[];
}

export const builtInMotionPresets: Record<string, MotionDepthPreset> = {
  cinematicParallax: {
    id: "cinematic-parallax",
    nameAr: "عمق سينمائي متدرج",
    descriptionAr: "فصل الخلفية والمجسمات وإضفاء حركة عمق سينمائية ثلاثية الأبعاد.",
    parallaxScale: 1.8,
    depthLayers: [
      { name: "الخلفية البعيدة", depthOffsetZ: -500, blurRadius: 4, scaleMultiplier: 1.4 },
      { name: "العناصر المتوسطة", depthOffsetZ: -150, blurRadius: 0, scaleMultiplier: 1.1 },
      { name: "الشخصية الرئيسية", depthOffsetZ: 0, blurRadius: 0, scaleMultiplier: 1.0 },
      { name: "عناصر المقدمة القريبة", depthOffsetZ: 250, blurRadius: 2, scaleMultiplier: 0.9 },
    ],
    afterEffectsKeyframes: [
      { property: "position", easing: "cubic-bezier", durationSeconds: 3.5 },
      { property: "scale", easing: "cubic-bezier", durationSeconds: 3.5 },
    ],
  },
  characterPuppet: {
    id: "character-puppet",
    nameAr: "تحريك الشخصيات المفصلية",
    descriptionAr: "تقسيم الرأس والطرفين العلويين والجذع لجهوزية التحريك بالـ Rigging.",
    parallaxScale: 1.0,
    depthLayers: [
      { name: "الرأس والوجه", depthOffsetZ: 20, blurRadius: 0, scaleMultiplier: 1.0 },
      { name: "الجذع والملابس", depthOffsetZ: 0, blurRadius: 0, scaleMultiplier: 1.0 },
      { name: "الأطراف", depthOffsetZ: -10, blurRadius: 0, scaleMultiplier: 1.0 },
    ],
    afterEffectsKeyframes: [
      { property: "rotation", easing: "cubic-bezier", durationSeconds: 2.0 },
    ],
  },
  bookPageFlip: {
    id: "book-page-flip",
    nameAr: "قلب صفحات الكتاب والمخطوطات",
    descriptionAr: "تنسيق أسطر وكلمات الكتب العربية للتحريك الكينيتيكي مع التصفح.",
    parallaxScale: 1.2,
    depthLayers: [
      { name: "ورقة الصفحة", depthOffsetZ: -50, blurRadius: 1, scaleMultiplier: 1.0 },
      { name: "النصوص والكلمات", depthOffsetZ: 10, blurRadius: 0, scaleMultiplier: 1.0 },
    ],
    afterEffectsKeyframes: [
      { property: "opacity", easing: "linear", durationSeconds: 1.2 },
      { property: "position", easing: "cubic-bezier", durationSeconds: 1.5 },
    ],
  },
};

export function getRecommendedPreset(kind: "image" | "book"): MotionDepthPreset {
  return kind === "image"
    ? builtInMotionPresets.cinematicParallax!
    : builtInMotionPresets.bookPageFlip!;
}
