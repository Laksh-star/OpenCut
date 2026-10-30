import { describe, expect, test } from "bun:test";

import { deriveProjectPaths } from "../src/service.ts";
import { parseEditPlan } from "../src/schema.ts";

const plan = parseEditPlan({
  version: "1",
  project: { name: "Approval demo", width: 1280, height: 720 },
  assets: [{ id: "source", path: "projects/demo/source.mp4", kind: "video" }],
  timeline: {
    clips: [
      {
        id: "opening",
        assetId: "source",
        sourceStart: 0,
        sourceEnd: 5,
      },
    ],
  },
  output: { path: "projects/demo/renders/output.mp4", overwrite: true },
});

describe("approved project paths", () => {
  test("stores the project record and approved plan beside the renders directory", () => {
    expect(deriveProjectPaths(plan)).toEqual({
      editPlanPath: "projects/demo/approved-edit-plan.json",
      projectRecordPath: "projects/demo/opencut.project.json",
    });
  });
});
