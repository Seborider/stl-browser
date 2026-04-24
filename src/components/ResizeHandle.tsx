import { useDragHandle } from "../hooks/useResizablePanes";

interface Props {
  onDelta: (deltaPx: number) => void;
}

export function ResizeHandle({ onDelta }: Props) {
  const onMouseDown = useDragHandle(onDelta);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onMouseDown={onMouseDown}
      className="group relative h-full w-[6px] shrink-0 cursor-col-resize select-none bg-neutral-50 dark:bg-neutral-900"
    >
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent group-hover:bg-indigo-500/60 group-active:bg-indigo-400" />
    </div>
  );
}
