import { invoke } from "@tauri-apps/api/core";
import type { FileEntry, Library, Sort } from "../generated";

// Thin, typed wrappers over Tauri's `invoke`. Keep these dumb so the hooks /
// stores have one place to mock for tests and one place to look when the IPC
// contract shifts.

export function listLibraries(): Promise<Library[]> {
  return invoke<Library[]>("list_libraries");
}

export function addLibrary(path: string): Promise<Library> {
  return invoke<Library>("add_library", { path });
}

export function removeLibrary(id: number): Promise<void> {
  return invoke<void>("remove_library", { id });
}

export function listFiles(
  libraryId: number | null,
  sort: Sort,
  search: string,
): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("list_files", { libraryId, sort, search });
}
