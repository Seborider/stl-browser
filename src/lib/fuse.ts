import Fuse from "fuse.js";
import type { MockFile } from "../mocks/fixtures";

export function createFuse(files: MockFile[]): Fuse<MockFile> {
  return new Fuse(files, {
    keys: ["name"],
    threshold: 0.35,
    ignoreLocation: true,
    includeScore: false,
  });
}
