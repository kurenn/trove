/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Dev: force the onboarding flow to show on boot, regardless of saved state. */
  readonly VITE_FORCE_ONBOARDING?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "occt-import-js" {
  const factory: () => Promise<any>;
  export default factory;
}
