import type { SdkManagers } from "./sdk_types.ts";

const sdkManagersByInstance = new WeakMap<object, SdkManagers>();

export function setSdkManagers(sdk: object, managers: SdkManagers): void {
  sdkManagersByInstance.set(sdk, managers);
}

export function sdkManagers(sdk: object): SdkManagers {
  const managers = sdkManagersByInstance.get(sdk);
  if (managers === undefined) {
    throw new Error("SDK managers not initialized");
  }
  return managers;
}
