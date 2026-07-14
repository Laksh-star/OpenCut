import { readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { parseEditPlan, type EditPlan } from "./schema.ts";

export const readEditPlan = async (path: string) => {
  const contents = await readFile(path, "utf8");
  return parseEditPlan(JSON.parse(contents));
};

export const writeEditPlan = async (path: string, plan: EditPlan) => {
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${Date.now()}.tmp`
  );
  await writeFile(temporaryPath, `${JSON.stringify(plan, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  await rename(temporaryPath, path);
};
