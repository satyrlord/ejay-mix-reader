import { readdirSync, readFileSync } from "fs";
import { dirname, relative, resolve } from "path";
import { fileURLToPath } from "url";

import * as ts from "typescript";
import { describe, it } from "vitest";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCAN_DIRS = [resolve(REPO_ROOT, "src"), resolve(REPO_ROOT, "scripts")];
const TS_DIRECTIVE = /\/\/\s*@ts-(?:ignore|expect-error)\b|\/\*\s*@ts-(?:ignore|expect-error)\b/g;

interface Violation {
  file: string;
  line: number;
  column: number;
  detail: string;
}

function listTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolutePath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTypeScriptFiles(absolutePath));
      continue;
    }

    if (entry.isFile() && /\.d?ts$/i.test(entry.name)) {
      files.push(absolutePath);
    }
  }

  return files.sort();
}

function scanFile(filePath: string): { anyViolations: Violation[]; directiveViolations: Violation[] } {
  const sourceText = readFileSync(filePath, "utf-8");
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);

  const anyViolations: Violation[] = [];
  const directiveViolations: Violation[] = [];

  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      anyViolations.push({
        file: filePath,
        line: position.line + 1,
        column: position.character + 1,
        detail: node.getText(sourceFile),
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  for (const match of sourceText.matchAll(TS_DIRECTIVE)) {
    const index = match.index;
    if (index === undefined) continue;

    const position = sourceFile.getLineAndCharacterOfPosition(index);
    directiveViolations.push({
      file: filePath,
      line: position.line + 1,
      column: position.character + 1,
      detail: match[0],
    });
  }

  return { anyViolations, directiveViolations };
}

function scanProject(): { anyViolations: Violation[]; directiveViolations: Violation[] } {
  const anyViolations: Violation[] = [];
  const directiveViolations: Violation[] = [];

  for (const dir of SCAN_DIRS) {
    for (const filePath of listTypeScriptFiles(dir)) {
      const fileViolations = scanFile(filePath);
      anyViolations.push(...fileViolations.anyViolations);
      directiveViolations.push(...fileViolations.directiveViolations);
    }
  }

  return { anyViolations, directiveViolations };
}

function describeViolations(violations: Violation[]): string {
  return violations
    .map((violation) => {
      const relativePath = relative(REPO_ROOT, violation.file).replace(/\\/g, "/");
      return `${relativePath}:${violation.line}:${violation.column} ${violation.detail}`;
    })
    .join("\n");
}

function expectNoViolations(kind: string, violations: Violation[]): void {
  if (violations.length === 0) return;

  throw new Error(`Found forbidden ${kind}:\n${describeViolations(violations)}`);
}

describe("type-safety guard", () => {
  it("keeps src/ and scripts/ free of any types", () => {
    const { anyViolations } = scanProject();
    expectNoViolations("`any` types", anyViolations);
  });

  it("keeps src/ and scripts/ free of ts-ignore and ts-expect-error directives", () => {
    const { directiveViolations } = scanProject();
    expectNoViolations("TypeScript suppression directives", directiveViolations);
  });
});