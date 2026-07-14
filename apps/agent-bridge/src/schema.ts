import { z } from "zod/v4";

const identifierSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);

export const assetSchema = z.object({
  id: identifierSchema,
  path: z.string().min(1),
  kind: z.enum(["video", "captions"]),
});

export const clipSchema = z
  .object({
    id: identifierSchema,
    assetId: identifierSchema,
    sourceStart: z.number().min(0),
    sourceEnd: z.number().positive(),
    speed: z.number().min(0.25).max(4).default(1),
    volume: z.number().min(0).max(2).default(1),
    includeAudio: z.boolean().default(true),
  })
  .superRefine((clip, context) => {
    if (clip.sourceEnd <= clip.sourceStart) {
      context.addIssue({
        code: "custom",
        message: "sourceEnd must be greater than sourceStart",
        path: ["sourceEnd"],
      });
    }
  });

export const editPlanSchema = z
  .object({
    version: z.literal("1"),
    project: z.object({
      name: z.string().min(1).max(120),
      width: z.number().int().min(320).max(7_680),
      height: z.number().int().min(240).max(4_320),
      frameRate: z.number().min(1).max(120).default(30),
      background: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .default("#000000"),
    }),
    assets: z.array(assetSchema).min(1),
    timeline: z.object({
      clips: z.array(clipSchema).min(1),
      captionsAssetId: identifierSchema.optional(),
    }),
    output: z.object({
      path: z.string().min(1),
      overwrite: z.boolean().default(false),
    }),
  })
  .superRefine((plan, context) => {
    const assetIds = new Set<string>();
    for (const [index, asset] of plan.assets.entries()) {
      if (assetIds.has(asset.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate asset id: ${asset.id}`,
          path: ["assets", index, "id"],
        });
      }
      assetIds.add(asset.id);
    }

    const clipIds = new Set<string>();
    for (const [index, clip] of plan.timeline.clips.entries()) {
      if (clipIds.has(clip.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate clip id: ${clip.id}`,
          path: ["timeline", "clips", index, "id"],
        });
      }
      clipIds.add(clip.id);

      const asset = plan.assets.find((candidate) => candidate.id === clip.assetId);
      if (!asset) {
        context.addIssue({
          code: "custom",
          message: `Unknown asset id: ${clip.assetId}`,
          path: ["timeline", "clips", index, "assetId"],
        });
      } else if (asset.kind !== "video") {
        context.addIssue({
          code: "custom",
          message: `Clip asset must be a video: ${clip.assetId}`,
          path: ["timeline", "clips", index, "assetId"],
        });
      }
    }

    if (plan.timeline.captionsAssetId) {
      const captions = plan.assets.find(
        (asset) => asset.id === plan.timeline.captionsAssetId
      );
      if (!captions) {
        context.addIssue({
          code: "custom",
          message: `Unknown captions asset id: ${plan.timeline.captionsAssetId}`,
          path: ["timeline", "captionsAssetId"],
        });
      } else if (captions.kind !== "captions") {
        context.addIssue({
          code: "custom",
          message: "captionsAssetId must reference a captions asset",
          path: ["timeline", "captionsAssetId"],
        });
      }
    }

    if (!plan.output.path.toLowerCase().endsWith(".mp4")) {
      context.addIssue({
        code: "custom",
        message: "The MVP renderer currently supports .mp4 output only",
        path: ["output", "path"],
      });
    }
  });

export type EditPlan = z.infer<typeof editPlanSchema>;

export const parseEditPlan = (value: unknown): EditPlan => editPlanSchema.parse(value);
