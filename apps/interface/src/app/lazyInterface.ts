import { lazy, type ComponentType, type LazyExoticComponent } from "react";

export type InterfaceLoader = () => Promise<{ default: ComponentType }>;

export const loadInterface: InterfaceLoader = async () => import("./Interface.tsx");

export function reloadInterface(): void {
  globalThis.location.reload();
}

export function createInterface(
  loader: InterfaceLoader = loadInterface,
): LazyExoticComponent<ComponentType> {
  return lazy(loader);
}
