export function applyReadingOrder<Layer extends { id: string }>(
  layers: readonly Layer[],
  options: {
    appliesTo: (layer: Layer) => boolean;
    compare: (left: Layer, right: Layer) => number;
    startAt: number;
  },
): Layer[] {
  const orderedIds = new Map(
    layers
      .filter(options.appliesTo)
      .sort(options.compare)
      .map((layer, index) => [layer.id, index + options.startAt]),
  );
  return layers.map((layer) => {
    const readingOrder = orderedIds.get(layer.id);
    return readingOrder === undefined ? layer : { ...layer, readingOrder };
  });
}
