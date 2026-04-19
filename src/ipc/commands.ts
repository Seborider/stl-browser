import { invoke } from "@tauri-apps/api/core";
import type {
  FileDetails,
  FileEntry,
  FileQuery,
  Library,
} from "../generated";

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

export function listFiles(query: FileQuery): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("list_files", { query });
}

export function getFileDetails(id: number): Promise<FileDetails> {
  return invoke<FileDetails>("get_file_details", { id });
}

export function rescanLibrary(id: number): Promise<void> {
  return invoke<void>("rescan_library", { id });
}
