import { createRoot } from "react-dom/client";
import { InterfaceRoot } from "./app/loadInterface.tsx";

const rootElement = document.getElementById("wallet-app");
if (rootElement === null) {
  throw new Error("Missing wallet app root");
}
const root = createRoot(rootElement);
root.render(<InterfaceRoot />);
