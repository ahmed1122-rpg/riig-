import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface VirtualLayerListProps<Item> {
  items: readonly Item[];
  itemKey: (item: Item) => string;
  renderItem: (item: Item) => ReactNode;
  rowHeight: number;
  activeKey?: string;
  className?: string;
  ariaLabel: string;
  overscan?: number;
}

export function VirtualLayerList<Item>({
  items,
  itemKey,
  renderItem,
  rowHeight,
  activeKey,
  className = "",
  ariaLabel,
  overscan = 6,
}: VirtualLayerListProps<Item>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(480);
  const activeIndex = activeKey
    ? items.findIndex((item) => itemKey(item) === activeKey)
    : -1;

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      const height = container.clientHeight;
      if (height > 0) setViewportHeight(height);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || activeIndex < 0) return;
    const itemTop = activeIndex * rowHeight;
    const itemBottom = itemTop + rowHeight;
    const visibleBottom = container.scrollTop + viewportHeight;
    if (itemTop >= container.scrollTop && itemBottom <= visibleBottom) return;
    const nextTop = Math.max(0, itemTop - Math.floor(viewportHeight / 2));
    container.scrollTop = nextTop;
    setScrollTop(nextTop);
  }, [activeIndex, rowHeight, viewportHeight]);

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const end = Math.min(items.length, start + visibleCount);
  const visibleItems = items.slice(start, end);

  return (
    <div
      ref={containerRef}
      className={`virtual-layer-list ${className}`.trim()}
      role="group"
      aria-label={ariaLabel}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div
        className="virtual-layer-list__spacer"
        style={{ height: items.length * rowHeight }}
      >
        {visibleItems.map((item, offset) => {
          const index = start + offset;
          return (
            <div
              className="virtual-layer-list__item"
              key={itemKey(item)}
              style={{ height: rowHeight, top: index * rowHeight }}
            >
              {renderItem(item)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
