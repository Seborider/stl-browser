// Type-safe `t()` keys. We treat en.json as the source-of-truth resource
// shape; de.json is checked structurally against the same nested keys at
// runtime by i18next's missing-key warning, and visually by the user.
import "i18next";
import type en from "./locales/en.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: {
      translation: typeof en;
    };
    returnNull: false;
  }
}
