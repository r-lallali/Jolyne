"use client";

import { useCallback, useRef, useState } from "react";

// usePhotoDrag : gère le drag-and-drop des photos de profil via pointer
// events (souris + tactile unifiés). Chaque slot de la grille reçoit
// les props retournées par `bindSlot(index)`. Le hook détecte quel slot
// est survolé en calculant la position du pointeur par rapport aux
// bounding rects enregistrées.

interface DragState {
  /** Index du slot actuellement dragué (0-based), -1 si rien */
  dragIndex: number;
  /** Index du slot survolé pendant le drag, -1 si rien */
  overIndex: number;
  /** Offset (px) du pointeur par rapport au point de départ */
  offsetX: number;
  offsetY: number;
}

export interface PhotoDragResult {
  dragIndex: number;
  overIndex: number;
  bindSlot: (index: number) => {
    onPointerDown: (e: React.PointerEvent) => void;
    style?: React.CSSProperties;
  };
  /** Ref callback à attacher au container de la grille */
  gridRef: React.RefCallback<HTMLDivElement>;
}

export function usePhotoDrag({
  itemCount,
  onReorder,
}: {
  /** Nombre total de slots (occupés ou vides) */
  itemCount: number;
  /** Appelé quand un drop valide est effectué : (fromIndex, toIndex) 0-based */
  onReorder: (fromIndex: number, toIndex: number) => void;
}): PhotoDragResult {
  const [state, setState] = useState<DragState>({
    dragIndex: -1,
    overIndex: -1,
    offsetX: 0,
    offsetY: 0,
  });

  const gridEl = useRef<HTMLDivElement | null>(null);
  const slotsRef = useRef<DOMRect[]>([]);
  const draggingRef = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const dragThreshold = 8; // px before drag starts
  const pendingDragIndex = useRef(-1);

  const gridRef = useCallback((el: HTMLDivElement | null) => {
    gridEl.current = el;
  }, []);

  const measureSlots = useCallback(() => {
    if (!gridEl.current) return;
    const children = gridEl.current.children;
    const rects: DOMRect[] = [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child) rects.push(child.getBoundingClientRect());
    }
    slotsRef.current = rects;
  }, []);

  const hitTest = useCallback(
    (clientX: number, clientY: number): number => {
      for (let i = 0; i < slotsRef.current.length; i++) {
        const r = slotsRef.current[i];
        if (
          r &&
          clientX >= r.left &&
          clientX <= r.right &&
          clientY >= r.top &&
          clientY <= r.bottom
        ) {
          return i;
        }
      }
      return -1;
    },
    [],
  );

  const onPointerDown = useCallback(
    (index: number, e: React.PointerEvent) => {
      // Ignore right-click and don't interfere with buttons inside slot
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest("button") || target.closest("input")) return;

      e.preventDefault();

      startPos.current = { x: e.clientX, y: e.clientY };
      pendingDragIndex.current = index;
      draggingRef.current = false;

      const onMove = (ev: PointerEvent) => {
        if (!draggingRef.current) {
          const dx = ev.clientX - startPos.current.x;
          const dy = ev.clientY - startPos.current.y;
          if (Math.abs(dx) < dragThreshold && Math.abs(dy) < dragThreshold) {
            return;
          }
          // Drag threshold exceeded — start drag
          draggingRef.current = true;
          measureSlots();
        }
        ev.preventDefault();
        const over = hitTest(ev.clientX, ev.clientY);
        const offsetX = ev.clientX - startPos.current.x;
        const offsetY = ev.clientY - startPos.current.y;
        setState({
          dragIndex: pendingDragIndex.current,
          overIndex: over,
          offsetX,
          offsetY,
        });
      };

      const onUp = (ev: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);

        if (draggingRef.current) {
          const over = hitTest(ev.clientX, ev.clientY);
          if (
            over !== -1 &&
            over !== pendingDragIndex.current &&
            over < itemCount
          ) {
            onReorder(pendingDragIndex.current, over);
          }
        }

        draggingRef.current = false;
        pendingDragIndex.current = -1;
        setState({ dragIndex: -1, overIndex: -1, offsetX: 0, offsetY: 0 });
      };

      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [hitTest, itemCount, measureSlots, onReorder],
  );

  const bindSlot = useCallback(
    (index: number) => {
      const isDragged = state.dragIndex === index;
      const style: React.CSSProperties = { touchAction: "none" };
      if (isDragged) {
        style.transform = `translate(${state.offsetX}px, ${state.offsetY}px)`;
        style.zIndex = 50;
        style.transition = "none";
      }
      return {
        onPointerDown: (e: React.PointerEvent) => onPointerDown(index, e),
        style,
      };
    },
    [onPointerDown, state.dragIndex, state.offsetX, state.offsetY],
  );

  return {
    dragIndex: state.dragIndex,
    overIndex: state.overIndex,
    bindSlot,
    gridRef,
  };
}
