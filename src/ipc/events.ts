import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  FilesAddedEvent,
  FilesRemovedEvent,
  LanguageChangedEvent,
  MetadataReadyEvent,
  ScanCompletedEvent,
  ScanErrorEvent,
  ScanProgressEvent,
  ScanStartedEvent,
  ThemeChangedEvent,
  ThumbnailsNeededEvent,
  ThumbnailsReadyEvent,
} from "../generated";

// Event names are duplicated from src-tauri/src/events.rs. If you change one,
// change the other in the same commit.
export const SCAN_STARTED = "scan:started";
export const SCAN_PROGRESS = "scan:progress";
export const SCAN_COMPLETED = "scan:completed";
export const SCAN_ERROR = "scan:error";
export const FILES_ADDED = "files:added";
export const FILES_REMOVED = "files:removed";
export const METADATA_READY = "metadata:ready";
export const THUMBNAILS_NEEDED = "thumbnails:needed";
export const THUMBNAILS_READY = "thumbnails:ready";
export const THEME_CHANGED = "theme:changed";
export const LANGUAGE_CHANGED = "language:changed";

export function onScanStarted(cb: (e: ScanStartedEvent) => void): Promise<UnlistenFn> {
  return listen<ScanStartedEvent>(SCAN_STARTED, (ev) => cb(ev.payload));
}
export function onScanProgress(cb: (e: ScanProgressEvent) => void): Promise<UnlistenFn> {
  return listen<ScanProgressEvent>(SCAN_PROGRESS, (ev) => cb(ev.payload));
}
export function onScanCompleted(cb: (e: ScanCompletedEvent) => void): Promise<UnlistenFn> {
  return listen<ScanCompletedEvent>(SCAN_COMPLETED, (ev) => cb(ev.payload));
}
export function onScanError(cb: (e: ScanErrorEvent) => void): Promise<UnlistenFn> {
  return listen<ScanErrorEvent>(SCAN_ERROR, (ev) => cb(ev.payload));
}
export function onFilesAdded(cb: (e: FilesAddedEvent) => void): Promise<UnlistenFn> {
  return listen<FilesAddedEvent>(FILES_ADDED, (ev) => cb(ev.payload));
}
export function onFilesRemoved(cb: (e: FilesRemovedEvent) => void): Promise<UnlistenFn> {
  return listen<FilesRemovedEvent>(FILES_REMOVED, (ev) => cb(ev.payload));
}
export function onMetadataReady(cb: (e: MetadataReadyEvent) => void): Promise<UnlistenFn> {
  return listen<MetadataReadyEvent>(METADATA_READY, (ev) => cb(ev.payload));
}
export function onThumbnailsNeeded(cb: (e: ThumbnailsNeededEvent) => void): Promise<UnlistenFn> {
  return listen<ThumbnailsNeededEvent>(THUMBNAILS_NEEDED, (ev) => cb(ev.payload));
}
export function onThumbnailsReady(cb: (e: ThumbnailsReadyEvent) => void): Promise<UnlistenFn> {
  return listen<ThumbnailsReadyEvent>(THUMBNAILS_READY, (ev) => cb(ev.payload));
}
export function onThemeChanged(cb: (e: ThemeChangedEvent) => void): Promise<UnlistenFn> {
  return listen<ThemeChangedEvent>(THEME_CHANGED, (ev) => cb(ev.payload));
}
export function onLanguageChanged(cb: (e: LanguageChangedEvent) => void): Promise<UnlistenFn> {
  return listen<LanguageChangedEvent>(LANGUAGE_CHANGED, (ev) => cb(ev.payload));
}
