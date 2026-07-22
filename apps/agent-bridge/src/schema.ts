import { z } from "zod/v4";

const identifierSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);

export const assetSchema = z.object({
  id: identifierSchema,
  path: z.string().min(1),
  kind: z.enum(["video", "audio", "captions"]),
});

const clipShape = {
  id: identifierSchema,
  assetId: identifierSchema,
  sourceStart: z.number().min(0),
  sourceEnd: z.number().positive(),
  speed: z.number().min(0.25).max(4).default(1),
  volume: z.number().min(0).max(2).default(1),
  includeAudio: z.boolean().default(true),
};

const validateSourceRange = (
  clip: { sourceStart: number; sourceEnd: number },
  context: z.RefinementCtx,
) => {
  if (clip.sourceEnd <= clip.sourceStart) {
    context.addIssue({
      code: "custom",
      message: "sourceEnd must be greater than sourceStart",
      path: ["sourceEnd"],
    });
  }
};

export const clipSchema = z.object(clipShape).superRefine(validateSourceRange);

export const overlayClipSchema = z
  .object({
    ...clipShape,
    timelineStart: z.number().min(0),
    x: z.number().int().min(0).default(0),
    y: z.number().int().min(0).default(0),
    width: z.number().int().min(1),
    height: z.number().int().min(1),
    opacity: z.number().min(0).max(1).default(1),
    fit: z.enum(["contain", "cover", "stretch"]).default("contain"),
    includeAudio: z.boolean().default(false),
  })
  .superRefine(validateSourceRange);

export const audioClipSchema = z
  .object({
    id: identifierSchema,
    assetId: identifierSchema,
    timelineStart: z.number().min(0),
    sourceStart: z.number().min(0),
    sourceEnd: z.number().positive(),
    speed: z.number().min(0.25).max(4).default(1),
    volume: z.number().min(0).max(2).default(1),
  })
  .superRefine(validateSourceRange);

const projectSchema = z.object({
  name: z.string().min(1).max(120),
  width: z.number().int().min(320).max(7_680),
  height: z.number().int().min(240).max(4_320),
  frameRate: z.number().min(1).max(120).default(30),
  background: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#000000"),
});

const outputSchema = z.object({
  path: z.string().min(1),
  overwrite: z.boolean().default(false),
});

const validateOutput = (outputPath: string, context: z.RefinementCtx) => {
  if (!outputPath.toLowerCase().endsWith(".mp4")) {
    context.addIssue({
      code: "custom",
      message: "The renderer currently supports .mp4 output only",
      path: ["output", "path"],
    });
  }
};

const validateAssets = (
  assets: Array<z.infer<typeof assetSchema>>,
  context: z.RefinementCtx,
) => {
  const ids = new Set<string>();
  for (const [index, asset] of assets.entries()) {
    if (ids.has(asset.id)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate asset id: ${asset.id}`,
        path: ["assets", index, "id"],
      });
    }
    ids.add(asset.id);
  }
};

const findAsset = (
  assets: Array<z.infer<typeof assetSchema>>,
  assetId: string,
  allowedKinds: Array<z.infer<typeof assetSchema>["kind"]>,
  context: z.RefinementCtx,
  path: Array<string | number>,
) => {
  const asset = assets.find((candidate) => candidate.id === assetId);
  if (!asset) {
    context.addIssue({ code: "custom", message: `Unknown asset id: ${assetId}`, path });
  } else if (!allowedKinds.includes(asset.kind)) {
    context.addIssue({
      code: "custom",
      message: `Asset ${assetId} must be one of: ${allowedKinds.join(", ")}`,
      path,
    });
  }
};

const validateCaptions = (
  assets: Array<z.infer<typeof assetSchema>>,
  captionsAssetId: string | undefined,
  context: z.RefinementCtx,
) => {
  if (!captionsAssetId) return;
  const captions = assets.find((asset) => asset.id === captionsAssetId);
  if (!captions) {
    context.addIssue({
      code: "custom",
      message: `Unknown captions asset id: ${captionsAssetId}`,
      path: ["timeline", "captionsAssetId"],
    });
  } else if (captions.kind !== "captions") {
    context.addIssue({
      code: "custom",
      message: "captionsAssetId must reference a captions asset",
      path: ["timeline", "captionsAssetId"],
    });
  }
};

export const editPlanV1Schema = z
  .object({
    version: z.literal("1"),
    project: projectSchema,
    assets: z.array(assetSchema).min(1),
    timeline: z.object({
      clips: z.array(clipSchema).min(1),
      captionsAssetId: identifierSchema.optional(),
    }),
    output: outputSchema,
  })
  .superRefine((plan, context) => {
    validateAssets(plan.assets, context);
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
      findAsset(plan.assets, clip.assetId, ["video"], context, ["timeline", "clips", index, "assetId"]);
    }
    validateCaptions(plan.assets, plan.timeline.captionsAssetId, context);
    validateOutput(plan.output.path, context);
  });

const overlayTrackSchema = z.object({
  id: identifierSchema,
  zIndex: z.number().int().min(1).max(100).default(1),
  clips: z.array(overlayClipSchema).min(1),
});

const audioTrackSchema = z.object({
  id: identifierSchema,
  role: z.enum(["music", "effects", "voiceover"]).default("effects"),
  clips: z.array(audioClipSchema).min(1),
});

const transitionSchema = z.object({
  id: identifierSchema,
  fromClipId: identifierSchema,
  toClipId: identifierSchema,
  type: z.enum(["fade", "wipeleft", "wiperight", "slideleft", "slideright"]).default("fade"),
  duration: z.number().min(0.1).max(3).default(0.5),
});

const titleCardSchema = z.object({
  id: identifierSchema,
  template: z.enum(["intro", "outro", "lower-third"]).default("intro"),
  timelineStart: z.number().min(0),
  duration: z.number().min(0.5).max(30),
  title: z.string().trim().min(1).max(160),
  subtitle: z.string().trim().min(1).max(240).optional(),
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#111827"),
  textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#FFFFFF"),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#FBBF24"),
  x: z.number().int().min(0).optional(),
  y: z.number().int().min(0).optional(),
  width: z.number().int().min(1).optional(),
  height: z.number().int().min(1).optional(),
  opacity: z.number().min(0).max(1).default(1),
  fontScale: z.number().min(0.5).max(2).default(1),
});

const captionStyleSchema = z.object({
  mode: z.enum(["selectable", "burn-in", "both"]).default("burn-in"),
  preset: z.enum(["clean", "bold", "minimal"]).default("clean"),
  fontSize: z.number().int().min(20).max(120).optional(),
  textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#FFFFFF"),
  outlineColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#000000"),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#000000"),
  backgroundOpacity: z.number().min(0).max(1).default(0.72),
  marginV: z.number().int().min(12).max(480).default(56),
  alignment: z.enum(["bottom", "middle", "top"]).default("bottom"),
});

const audioMixSchema = z.object({
  ducking: z.object({
    enabled: z.boolean().default(true),
    targetTrackIds: z.array(identifierSchema).default([]),
    threshold: z.number().min(0.001).max(1).default(0.04),
    ratio: z.number().min(1).max(20).default(8),
    attackMs: z.number().min(0.01).max(2_000).default(20),
    releaseMs: z.number().min(0.01).max(9_000).default(250),
  }).optional(),
}).optional();

export const editPlanV2Schema = z
  .object({
    version: z.literal("2"),
    project: projectSchema,
    assets: z.array(assetSchema).min(1),
    timeline: z.object({
      clips: z.array(clipSchema).min(1),
      overlayTracks: z.array(overlayTrackSchema).default([]),
      audioTracks: z.array(audioTrackSchema).default([]),
      transitions: z.array(transitionSchema).default([]),
      titleCards: z.array(titleCardSchema).default([]),
      captionsAssetId: identifierSchema.optional(),
      captionStyle: captionStyleSchema.optional(),
      audioMix: audioMixSchema,
    }),
    output: outputSchema,
  })
  .superRefine((plan, context) => {
    validateAssets(plan.assets, context);
    const clipIds = new Set<string>();
    const trackIds = new Set<string>();
    const validateClipId = (id: string, path: Array<string | number>) => {
      if (clipIds.has(id)) {
        context.addIssue({ code: "custom", message: `Duplicate clip id: ${id}`, path });
      }
      clipIds.add(id);
    };
    const validateTrackId = (id: string, path: Array<string | number>) => {
      if (trackIds.has(id)) {
        context.addIssue({ code: "custom", message: `Duplicate track id: ${id}`, path });
      }
      trackIds.add(id);
    };

    for (const [index, clip] of plan.timeline.clips.entries()) {
      validateClipId(clip.id, ["timeline", "clips", index, "id"]);
      findAsset(plan.assets, clip.assetId, ["video"], context, ["timeline", "clips", index, "assetId"]);
    }

    for (const [trackIndex, track] of plan.timeline.overlayTracks.entries()) {
      validateTrackId(track.id, ["timeline", "overlayTracks", trackIndex, "id"]);
      const sorted = [...track.clips].sort((a, b) => a.timelineStart - b.timelineStart);
      for (const [clipIndex, clip] of track.clips.entries()) {
        validateClipId(clip.id, ["timeline", "overlayTracks", trackIndex, "clips", clipIndex, "id"]);
        findAsset(plan.assets, clip.assetId, ["video"], context, ["timeline", "overlayTracks", trackIndex, "clips", clipIndex, "assetId"]);
        if (clip.x + clip.width > plan.project.width || clip.y + clip.height > plan.project.height) {
          context.addIssue({
            code: "custom",
            message: `Overlay clip ${clip.id} must fit inside the project canvas`,
            path: ["timeline", "overlayTracks", trackIndex, "clips", clipIndex],
          });
        }
      }
      for (let index = 1; index < sorted.length; index += 1) {
        const previous = sorted[index - 1]!;
        const current = sorted[index]!;
        const previousEnd = previous.timelineStart + (previous.sourceEnd - previous.sourceStart) / previous.speed;
        if (current.timelineStart < previousEnd) {
          context.addIssue({
            code: "custom",
            message: `Overlay track ${track.id} contains overlapping clips`,
            path: ["timeline", "overlayTracks", trackIndex, "clips"],
          });
          break;
        }
      }
    }

    for (const [trackIndex, track] of plan.timeline.audioTracks.entries()) {
      validateTrackId(track.id, ["timeline", "audioTracks", trackIndex, "id"]);
      for (const [clipIndex, clip] of track.clips.entries()) {
        validateClipId(clip.id, ["timeline", "audioTracks", trackIndex, "clips", clipIndex, "id"]);
        findAsset(plan.assets, clip.assetId, ["audio", "video"], context, ["timeline", "audioTracks", trackIndex, "clips", clipIndex, "assetId"]);
      }
    }

    const transitionBoundaries = new Set<string>();
    for (const [index, transition] of plan.timeline.transitions.entries()) {
      const fromIndex = plan.timeline.clips.findIndex((clip) => clip.id === transition.fromClipId);
      const toIndex = plan.timeline.clips.findIndex((clip) => clip.id === transition.toClipId);
      if (fromIndex < 0 || toIndex !== fromIndex + 1) {
        context.addIssue({
          code: "custom",
          message: `Transition ${transition.id} must connect adjacent primary clips`,
          path: ["timeline", "transitions", index],
        });
        continue;
      }
      const boundary = `${transition.fromClipId}->${transition.toClipId}`;
      if (transitionBoundaries.has(boundary)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate transition boundary: ${boundary}`,
          path: ["timeline", "transitions", index],
        });
      }
      transitionBoundaries.add(boundary);
      const fromClip = plan.timeline.clips[fromIndex]!;
      const toClip = plan.timeline.clips[toIndex]!;
      const shortestClip = Math.min(
        (fromClip.sourceEnd - fromClip.sourceStart) / fromClip.speed,
        (toClip.sourceEnd - toClip.sourceStart) / toClip.speed,
      );
      if (transition.duration >= shortestClip) {
        context.addIssue({
          code: "custom",
          message: `Transition ${transition.id} must be shorter than both connected clips`,
          path: ["timeline", "transitions", index, "duration"],
        });
      }
    }

    const titleIds = new Set<string>();
    for (const [index, title] of plan.timeline.titleCards.entries()) {
      if (clipIds.has(title.id) || titleIds.has(title.id)) {
        context.addIssue({ code: "custom", message: `Duplicate timeline id: ${title.id}`, path: ["timeline", "titleCards", index, "id"] });
      }
      const titleX = title.x ?? 0;
      const titleY = title.y ?? 0;
      const titleWidth = title.width ?? plan.project.width;
      const titleHeight = title.height ?? plan.project.height;
      if (titleX + titleWidth > plan.project.width || titleY + titleHeight > plan.project.height) {
        context.addIssue({
          code: "custom",
          message: `Title card ${title.id} layout must fit inside the project canvas`,
          path: ["timeline", "titleCards", index],
        });
      }
      titleIds.add(title.id);
    }

    if (plan.timeline.captionStyle && !plan.timeline.captionsAssetId) {
      context.addIssue({
        code: "custom",
        message: "captionStyle requires captionsAssetId",
        path: ["timeline", "captionStyle"],
      });
    }

    const ducking = plan.timeline.audioMix?.ducking;
    if (ducking?.enabled) {
      const trackIds = new Set(plan.timeline.audioTracks.map((track) => track.id));
      const targets = ducking.targetTrackIds.length > 0
        ? ducking.targetTrackIds
        : plan.timeline.audioTracks.filter((track) => track.role === "music").map((track) => track.id);
      if (targets.length === 0) {
        context.addIssue({
          code: "custom",
          message: "Enabled ducking requires a targetTrackIds entry or a music-role track",
          path: ["timeline", "audioMix", "ducking"],
        });
      }
      for (const [index, id] of ducking.targetTrackIds.entries()) {
        if (!trackIds.has(id)) {
          context.addIssue({
            code: "custom",
            message: `Unknown ducking target track id: ${id}`,
            path: ["timeline", "audioMix", "ducking", "targetTrackIds", index],
          });
        }
      }
    }

    validateCaptions(plan.assets, plan.timeline.captionsAssetId, context);
    validateOutput(plan.output.path, context);
  });

export const editPlanSchema = z.discriminatedUnion("version", [editPlanV1Schema, editPlanV2Schema]);

export type EditPlanV1 = z.infer<typeof editPlanV1Schema>;
export type EditPlanV2 = z.infer<typeof editPlanV2Schema>;
export type EditPlan = z.infer<typeof editPlanSchema>;
export type PrimaryClip = EditPlanV1["timeline"]["clips"][number];

export const parseEditPlan = (value: unknown): EditPlan => editPlanSchema.parse(value);

export const upgradeEditPlanToV2 = (value: unknown): EditPlanV2 => {
  const plan = parseEditPlan(value);
  if (plan.version === "2") return plan;
  return editPlanV2Schema.parse({
    ...plan,
    version: "2",
    timeline: { ...plan.timeline, overlayTracks: [], audioTracks: [] },
  });
};

export const getPlanDuration = (plan: EditPlan) => {
  const sequentialDuration = plan.timeline.clips.reduce(
    (total, clip) => total + (clip.sourceEnd - clip.sourceStart) / clip.speed,
    0,
  );
  if (plan.version === "1") return sequentialDuration;
  const primaryDuration = sequentialDuration - plan.timeline.transitions.reduce(
    (total, transition) => total + transition.duration,
    0,
  );
  const overlayEnds = plan.timeline.overlayTracks.flatMap((track) =>
    track.clips.map((clip) => clip.timelineStart + (clip.sourceEnd - clip.sourceStart) / clip.speed),
  );
  const audioEnds = plan.timeline.audioTracks.flatMap((track) =>
    track.clips.map((clip) => clip.timelineStart + (clip.sourceEnd - clip.sourceStart) / clip.speed),
  );
  const titleEnds = plan.timeline.titleCards.map((card) => card.timelineStart + card.duration);
  return Math.max(primaryDuration, ...overlayEnds, ...audioEnds, ...titleEnds);
};
