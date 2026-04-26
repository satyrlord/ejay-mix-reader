declare module "istanbul-lib-coverage" {
  export function createCoverageMap(data?: unknown): { merge(other: unknown): void };
}

declare module "istanbul-lib-report" {
  export function createContext(options: { dir: string; coverageMap: unknown }): object;
}

declare module "istanbul-reports" {
  export function create(name: string): { execute(context: unknown): void };
}
