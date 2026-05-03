import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import * as ContextMenu from "@radix-ui/react-context-menu";
import type { FileEntry, Library } from "../generated";
import { deleteFile, revealInFinder } from "../ipc/commands";

interface Props {
  file: FileEntry;
  library: Library | undefined;
  onSelect: () => void;
  children: ReactNode;
}

export function GridTileContextMenu({ file, library, onSelect, children }: Props) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);

  const handleReveal = async () => {
    if (!library) return;
    setError(null);
    try {
      await revealInFinder(`${library.path}/${file.relPath}`);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleDelete = async () => {
    setError(null);
    try {
      await deleteFile(file.id);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        onContextMenu={onSelect}
        className="block h-full w-full"
      >
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className="z-50 min-w-[180px] rounded-md border border-neutral-200 bg-white/95 p-1 text-xs text-neutral-800 shadow-lg backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95 dark:text-neutral-100"
        >
          <ContextMenu.Item
            disabled={!library}
            onSelect={handleReveal}
            className="flex cursor-default select-none items-center rounded px-2 py-1.5 outline-none data-[highlighted]:bg-indigo-500/15 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
          >
            {t("contextMenu.revealInFinder")}
          </ContextMenu.Item>
          <ContextMenu.Separator className="my-1 h-px bg-neutral-200 dark:bg-neutral-800" />
          <ContextMenu.Item
            onSelect={handleDelete}
            className="flex cursor-default select-none items-center rounded px-2 py-1.5 text-red-600 outline-none data-[highlighted]:bg-red-500/15 dark:text-red-400"
          >
            {t("contextMenu.moveToTrash")}
          </ContextMenu.Item>
          {error && (
            <div className="mt-1 px-2 py-1 text-[11px] text-red-600 dark:text-red-400">
              {error}
            </div>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
