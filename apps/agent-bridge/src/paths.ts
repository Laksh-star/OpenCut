import { mkdir, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const isWithin = (root: string, candidate: string) => {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== ".." && !isAbsolute(pathFromRoot))
  );
};

export const getWorkspaceRoot = async () => {
  const configuredRoot = process.env.OPENCUT_AGENT_ROOT ?? process.cwd();
  return realpath(resolve(configuredRoot));
};

export const resolveInputPath = async (root: string, requestedPath: string) => {
  const candidate = resolve(root, requestedPath);
  const resolvedPath = await realpath(candidate);
  if (!isWithin(root, resolvedPath)) {
    throw new Error(`Path is outside OPENCUT_AGENT_ROOT: ${requestedPath}`);
  }
  const fileStats = await stat(resolvedPath);
  if (!fileStats.isFile()) {
    throw new Error(`Expected a file: ${requestedPath}`);
  }
  return resolvedPath;
};

export const resolveOutputPath = async (root: string, requestedPath: string) => {
  const candidate = resolve(root, requestedPath);
  if (!isWithin(root, candidate)) {
    throw new Error(`Path is outside OPENCUT_AGENT_ROOT: ${requestedPath}`);
  }

  const parent = dirname(candidate);
  let existingAncestor = parent;
  while (true) {
    try {
      existingAncestor = await realpath(existingAncestor);
      break;
    } catch (error: unknown) {
      const code = error instanceof Error && "code" in error ? String(error.code) : undefined;
      if (code !== "ENOENT") throw error;
      const nextAncestor = dirname(existingAncestor);
      if (nextAncestor === existingAncestor) throw error;
      existingAncestor = nextAncestor;
    }
  }
  if (!isWithin(root, existingAncestor)) {
    throw new Error(`Output directory is outside OPENCUT_AGENT_ROOT: ${requestedPath}`);
  }
  await mkdir(parent, { recursive: true });
  const resolvedParent = await realpath(parent);
  if (!isWithin(root, resolvedParent)) {
    throw new Error(`Output directory is outside OPENCUT_AGENT_ROOT: ${requestedPath}`);
  }

  try {
    const existingTarget = await realpath(candidate);
    if (!isWithin(root, existingTarget)) {
      throw new Error(`Output target resolves outside OPENCUT_AGENT_ROOT: ${requestedPath}`);
    }
  } catch (error: unknown) {
    const code =
      error instanceof Error && "code" in error ? String(error.code) : undefined;
    if (code !== "ENOENT") {
      throw error;
    }
  }
  return candidate;
};
