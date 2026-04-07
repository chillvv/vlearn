
import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import "./styles/index.css";

const rawRemoveChild = Node.prototype.removeChild;
Node.prototype.removeChild = function removeChildPatched<T extends Node>(child: T): T {
  if (child && child.parentNode !== this) return child;
  return rawRemoveChild.call(this, child) as T;
};

const rawInsertBefore = Node.prototype.insertBefore;
Node.prototype.insertBefore = function insertBeforePatched<T extends Node>(newNode: T, referenceNode: Node | null): T {
  if (referenceNode && referenceNode.parentNode !== this) {
    return this.appendChild(newNode) as T;
  }
  return rawInsertBefore.call(this, newNode, referenceNode) as T;
};

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason as { message?: string; stack?: string } | string | undefined;
  const message = String(typeof reason === "string" ? reason : reason?.message || "").toLowerCase();
  const stack = String(typeof reason === "string" ? "" : reason?.stack || "").toLowerCase();
  if ((message.includes("context invalidated") || message.includes("extension context invalidated")) && stack.includes("chrome-extension://")) {
    event.preventDefault();
  }
});

window.addEventListener("error", (event) => {
  const target = event.target as HTMLScriptElement | null;
  const source = String(target?.src || "").toLowerCase();
  if (source.startsWith("chrome-extension://")) {
    event.preventDefault();
  }
}, true);

createRoot(document.getElementById("root")!).render(<App />);
  
