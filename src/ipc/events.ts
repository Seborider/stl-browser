import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  FilesAddedEvent,
  MetadataReadyEvent,
  ScanCompletedEvent,
  ScanErrorEvent,
  ScanProgressEvent,
  ScanStartedEvent,
} from "../generated";

// Event names are duplicated from src-tauri/src/events.rs. If you change one,
// change the other in the same commit.
export const SCAN_STARTED = "scan:started";
export const SCAN_PROGRESS = "scan:progress";
export const SCAN_COMPLETED = "scan:completed";
export const SCAN_ERROR = "scan:error";
export const FILES_ADDED = "files:added";
export const METADATA_READY = "metadata:ready";

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
export function onMetadataReady(cb: (e: MetadataReadyEvent) => void): Promise<UnlistenFn> {
  return listen<MetadataReadyEvent>(METADATA_READY, (ev) => cb(ev.payload));
}
