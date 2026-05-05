import { createElement, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";

import { createAppController } from "./app-controller.js";

const REACT_SHELL_QUERY_PARAM = "react-shell";

interface DesktopBridgeRequest {
	method: string;
	url: string;
	headers: Array<[string, string]>;
	body?: ArrayBuffer;
}

interface DesktopBridgeResponse {
	status: number;
	headers: Array<[string, string]>;
	body?: ArrayBuffer;
}

interface DesktopRuntimeInfo {
	platform: string;
	mode: "desktop";
	request?: (request: DesktopBridgeRequest) => Promise<DesktopBridgeResponse>;
}

type DesktopWindow = Window & {
	ejayDesktop?: DesktopRuntimeInfo;
};

function isDesktopBridgeAvailable(): boolean {
	const bridge = (window as DesktopWindow).ejayDesktop;
	return !!bridge && bridge.mode === "desktop" && typeof bridge.request === "function";
}

function shouldBridgeRuntimePath(pathname: string): boolean {
	return (
		pathname.startsWith("/mix/") ||
		pathname.startsWith("/output/") ||
		pathname.startsWith("/data/") ||
		pathname === "/__path-config" ||
		pathname === "/__category-config" ||
		pathname === "/__sample-move"
	);
}

function installDesktopFetchBridge(): void {
	if (!isDesktopBridgeAvailable()) return;

	const bridge = (window as DesktopWindow).ejayDesktop;
	if (!bridge?.request) return;
	const requestDesktop = bridge.request;

	const originalFetch = globalThis.fetch.bind(globalThis);
	globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const request = new Request(input, init);
		const requestUrl = new URL(request.url);
		if (!shouldBridgeRuntimePath(requestUrl.pathname)) {
			return await originalFetch(request);
		}

		const method = request.method.toUpperCase();
		const body = method === "GET" || method === "HEAD"
			? undefined
			: await request.arrayBuffer();

		const bridged = await requestDesktop({
			method,
			url: `${requestUrl.pathname}${requestUrl.search}`,
			headers: Array.from(request.headers.entries()),
			body,
		});
		const responseBody = (
			bridged.status === 204 ||
			bridged.status === 205 ||
			bridged.status === 304
		)
			? null
			: (bridged.body ?? null);

		return new Response(responseBody, {
			status: bridged.status,
			headers: bridged.headers,
		});
	};
}

function ReactShellHost() {
	const hostRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const host = hostRef.current;
		/* istanbul ignore next -- ref is assigned before first effect execution */
		if (!host) return;
		return createAppController(host);
	}, []);

	return createElement("div", {
		className: "react-shell-root min-h-screen",
		ref: hostRef,
	});
}

function mountReactShell(rootElement: HTMLElement): () => void {
	const root = createRoot(rootElement);
	root.render(createElement(ReactShellHost));
	return () => {
		root.unmount();
	};
}

const appElement = document.getElementById("app");
/* istanbul ignore next -- index.html always provides #app */
if (!appElement) throw new Error("Missing #app element");

installDesktopFetchBridge();

const reactShellEnabled = /^(1|true)$/i.test(
	new URLSearchParams(window.location.search).get(REACT_SHELL_QUERY_PARAM) ?? "",
);

const cleanupApp = reactShellEnabled
	? mountReactShell(appElement)
	: createAppController(appElement);

window.addEventListener("beforeunload", cleanupApp, { once: true });
import.meta.hot?.dispose(cleanupApp);
