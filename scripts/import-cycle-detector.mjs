export function findDirectedCycles(graph) {
  const state = new Map();
  const stack = [];
  const stackPositions = new Map();
  const cycles = new Map();

  const visit = (node) => {
    state.set(node, "visiting");
    stackPositions.set(node, stack.length);
    stack.push(node);

    for (const target of graph.get(node) ?? []) {
      if (!graph.has(target)) continue;
      if (state.get(target) === "visiting") {
        const start = stackPositions.get(target);
        if (start !== undefined) {
          const cycle = [...stack.slice(start), target];
          cycles.set(canonicalCycleKey(cycle), cycle);
        }
      } else if (!state.has(target)) {
        visit(target);
      }
    }

    stack.pop();
    stackPositions.delete(node);
    state.set(node, "visited");
  };

  for (const node of [...graph.keys()].sort()) {
    if (!state.has(node)) visit(node);
  }
  return [...cycles.values()];
}

function canonicalCycleKey(cycle) {
  const nodes = cycle.slice(0, -1);
  const rotations = nodes.map((_, index) => [
    ...nodes.slice(index),
    ...nodes.slice(0, index),
  ].join(" -> "));
  return rotations.sort()[0] ?? "";
}
