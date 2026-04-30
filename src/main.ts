import { createAppController } from "./app-controller.js";

const appElement = document.getElementById("app");
/* istanbul ignore next -- index.html always provides #app */
if (!appElement) throw new Error("Missing #app element");

const cleanupApp = createAppController(appElement);
window.addEventListener("beforeunload", cleanupApp, { once: true });
import.meta.hot?.dispose(cleanupApp);
