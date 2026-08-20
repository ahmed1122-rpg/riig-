import { useCallback, useRef, useState, type DragEvent } from "react";

export function useWorkspaceFileDrop(
  onFile: (file: File) => void | Promise<void>,
  onReject: (message: string) => void,
) {
  const [dragActive, setDragActive] = useState(false);
  const depthRef = useRef(0);
  const isFileDrag = (event: DragEvent<HTMLElement>) =>
    Array.from(event.dataTransfer.types).includes("Files");

  const onDragEnter = useCallback((event: DragEvent<HTMLElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    depthRef.current += 1;
    setDragActive(true);
  }, []);

  const onDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    depthRef.current = Math.max(0, depthRef.current - 1);
    if (depthRef.current === 0) setDragActive(false);
  }, []);

  const onDrop = useCallback((event: DragEvent<HTMLElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    depthRef.current = 0;
    setDragActive(false);
    if (event.dataTransfer.files.length !== 1) {
      onReject("أسقط ملف مصدر واحدًا فقط في كل مرة.");
      return;
    }
    const file = event.dataTransfer.files[0];
    if (file) void onFile(file);
  }, [onFile, onReject]);

  return { dragActive, onDragEnter, onDragLeave, onDragOver, onDrop };
}
