import { invoke, convertFileSrc } from "@tauri-apps/api/core";
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

export async function getMeshAssetUrl(id: number): Promise<string> {
  const absPath = await invoke<string>("get_mesh_asset_url", { id });
  return convertFileSrc(absPath);
}

// Thumbnail IPC — see src-tauri/src/ipc/thumbnails.rs.
//
// `save_thumbnail` is the one command that takes its payload as the raw
// request body (a Uint8Array) instead of a JSON arg map. Spike 3 measured
// ~74× speedup vs a JSON-encoded Vec<u8>. Scalars travel via `x-*` headers.
export function saveThumbnail(
  cacheKey: string,
  width: number,
  height: number,
  png: Uint8Array,
): Promise<void> {
  return invoke<void>("save_thumbnail", png, {
    headers: {
      "x-cache-key": cacheKey,
      "x-width": String(width),
      "x-height": String(height),
    },
  });
}

export function getThumbnailCacheDir(): Promise<string> {
  return invoke<string>("get_thumbnail_cache_dir");
}

export function listThumbnailKeys(): Promise<string[]> {
  return invoke<string[]>("list_thumbnail_keys");
}
