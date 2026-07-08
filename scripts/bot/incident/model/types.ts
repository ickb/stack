import type { FileHandle } from "node:fs/promises";

export interface CollectorRunArgs {
  help?: false;
  logDir?: string;
  logRoot?: string;
  since: string;
  until: string;
}

export type ParsedCollectorArgs = CollectorRunArgs | { help: true };

export interface CollectIncidentOptions {
  argv?: string[];
  dependencies?: IncidentDependencies;
  envLogRoot?: string;
  now?: () => Date;
  root?: string;
}

export type CollectIncidentResult =
  | { help: string; incidentDir?: undefined; incidentId?: undefined; summary?: undefined }
  | {
      help?: undefined;
      incidentDir: string;
      incidentId: string;
      summary: CompleteIncidentSummary;
    };

export interface IncidentPaths {
  logDir: string;
  logRoot: string;
  logRootSource: string;
}

export type SourceKind = "botEvents" | "launches" | "stderr";

export interface SourceFile {
  kind: SourceKind;
  name: string;
  output: string;
}

export interface SourceWindow {
  since: Date;
  until: Date;
}

export interface SourceStats {
  emptyLines: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  malformedLines: number;
  outsideWindowLines: number;
  selectedLines: number;
  selectedUndatedLines: number;
  timestampedLines: number;
  totalLines: number;
  undatedLines: number;
  undatedTailIncluded: boolean;
  undatedTailLimit: number | null;
}

export type SourceSummary =
  | { included: false; path: string; reason: "missing" }
  | ({ included: true; output: string; path: string } & SourceStats);

export interface FilteredSource {
  stats: SourceStats;
  text: string;
}

export type JsonFilteredSource = FilteredSource & { summary: IncidentSummary };

export interface JsonSourceFilterOptions {
  dependencies: IncidentDependencies;
  filePath: string;
  kind: Exclude<SourceKind, "stderr">;
  sourceName: string;
  summary: IncidentSummary;
  window: SourceWindow;
}

export interface StderrSourceFilterOptions {
  dependencies: IncidentDependencies;
  filePath: string;
  sourceName: string;
  window: SourceWindow;
}

export interface ReferencedArtifactOptions {
  artifact: ArtifactRef;
  dependencies: IncidentDependencies;
  outputs: Map<string, string>;
  paths: IncidentPaths;
  summary: IncidentSummary;
}

export interface SourceCollectionOptions {
  dependencies: IncidentDependencies;
  outputs: Map<string, string>;
  paths: IncidentPaths;
  summary: IncidentSummary;
  window: SourceWindow;
}

export interface SourceCollectionResult {
  outputs: Map<string, string>;
  summary: IncidentSummary;
}

export interface SourceFileSummary {
  name: string;
  output: string;
  path: string;
  selectedLines: number;
}

export type CountMap = Record<string, number>;
export type GroupedTextMap = Record<string, string[]>;

export interface TimestampSummary {
  firstTimestamp: string | null;
  lastTimestamp: string | null;
}

export type BotEventsSummary = TimestampSummary & {
  countsByType: CountMap;
  failureReasons: CountMap;
  skipReasons: CountMap;
  txHashesByOutcome: GroupedTextMap;
};

export type LaunchesSummary = TimestampSummary & {
  countsByType: CountMap;
  exitCodes: CountMap;
  signals: CountMap;
};

export interface ArtifactRef {
  hash: string;
  kind: string;
  path: string;
}

export type ArtifactMismatch = ArtifactRef & {
  actualHash: string;
};

export interface CompressionSummary {
  command: string;
  created: false;
  reason: string;
}

export interface IncidentSummary {
  artifacts: {
    included: ArtifactRef[];
    mismatched: ArtifactMismatch[];
    missing: ArtifactRef[];
  };
  botEvents: BotEventsSummary;
  compression?: CompressionSummary;
  createdAt: string;
  incidentDir?: string;
  incidentId?: string;
  launches: LaunchesSummary;
  logDir: string;
  logRoot: string;
  logRootSource: string;
  scriptVersion: number;
  sourceFiles: SourceFileSummary[];
  sources: Record<string, SourceSummary>;
  stderr: TimestampSummary;
  version: number;
  window: {
    since: string;
    until: string;
  };
}

export type CompleteIncidentSummary = IncidentSummary & {
  compression: CompressionSummary;
  incidentDir: string;
  incidentId: string;
};

export interface StatLike {
  isDirectory: () => boolean;
  isFile: () => boolean;
  isSymbolicLink: () => boolean;
}

export interface DirentLike {
  isFile: () => boolean;
  name: string;
}

export type IncidentFileHandle = Pick<FileHandle, "close" | "readableWebStream"> & {
  chmod?: FileHandle["chmod"];
  readFile?: FileHandle["readFile"];
  stat: () => Promise<StatLike>;
  writeFile?: FileHandle["writeFile"];
};

export type DecoderInput = Exclude<
  Parameters<InstanceType<typeof TextDecoder>["decode"]>[0],
  undefined
>;
export type SourceStream = AsyncIterable<DecoderInput>;

export interface IncidentDependencies {
  lstat?: (path: string) => Promise<StatLike>;
  mkdir?: (
    path: string,
    options?: { mode?: number; recursive?: boolean },
  ) => Promise<unknown>;
  open?: (path: string, flags: number, mode?: number) => Promise<IncidentFileHandle>;
  readdir?: (path: string, options: { withFileTypes: true }) => Promise<DirentLike[]>;
  realpath?: (path: string) => Promise<string>;
  spawnSync?: (
    command: string,
    args: string[],
    options: { encoding: "utf8"; timeout: number },
  ) => { error?: Error; status: number | null; stdout: string };
}

export interface VersionMetadata {
  botPackage: null | { name: string | null; version: string | null };
  gitCommit: string | null;
  nodeVersion: string;
  package: {
    packageManager: unknown;
    private: boolean;
  };
  script: {
    name: string;
    version: number;
  };
}

export interface WritableLike {
  write: (chunk: string) => unknown;
}
