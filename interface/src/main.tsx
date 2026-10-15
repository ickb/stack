import { createRoot } from "react-dom/client";
import Interface from "./app/Interface.tsx";

const rootElement = document.getElementById("wallet-app");
if (rootElement === null) {
  throw new Error("Missing wallet app root");
}
createRoot(rootElement).render(
  <div className="ickb-app-content">
    <Interface />
  </div>,
);
