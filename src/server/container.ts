import { ActivityService } from './activities/activity-service.ts';
import { RegistryImporter } from './activities/registry-importer.ts';
import type { AppConfig } from './config.ts';
import { openDatabase, type Db } from './db/database.ts';
import { DigestService } from './digest/digest-service.ts';
import { ClaudeNarrator, TemplateNarrator, type DigestNarrator } from './digest/narrative.ts';
import { GoogleAuthService } from './drive/google-auth.ts';
import { GoogleDriveGateway } from './drive/google-drive.ts';
import { LocalFolderGateway } from './drive/local-drive.ts';
import type { DriveGateway } from './drive/types.ts';
import { OnboardingService } from './onboarding/onboarding-service.ts';
import { ActivitiesRepo } from './repositories/activities-repo.ts';
import { ConflictsRepo } from './repositories/conflicts-repo.ts';
import { KvRepo } from './repositories/kv-repo.ts';
import { loadMembersFile, MembersRepo } from './repositories/members-repo.ts';
import { SourcesRepo } from './repositories/sources-repo.ts';
import { SuggestionsRepo } from './repositories/suggestions-repo.ts';
import { SyncRunsRepo } from './repositories/sync-runs-repo.ts';
import { ClaudeAnalyzer, createAnthropicClient } from './suggestions/claude-analyzer.ts';
import type { MinutesAnalyzer } from './suggestions/contract.ts';
import { HeuristicAnalyzer } from './suggestions/heuristic-analyzer.ts';
import { ReviewService } from './suggestions/review-service.ts';
import { SuggestionService } from './suggestions/suggestion-service.ts';
import { SyncScheduler } from './sync/scheduler.ts';
import { SyncService, type Logger } from './sync/sync-service.ts';

/** Composition root: builds every dependency once. Tests override the outside world (Drive, LLM). */

export interface ContainerOverrides {
  gateway?: DriveGateway;
  analyzer?: MinutesAnalyzer;
  narrator?: DigestNarrator;
  logger?: Logger;
}

export interface Container {
  config: AppConfig;
  db: Db;
  logger: Logger;
  gateway: DriveGateway;
  auth: GoogleAuthService | null;
  repos: {
    members: MembersRepo;
    sources: SourcesRepo;
    activities: ActivitiesRepo;
    suggestions: SuggestionsRepo;
    conflicts: ConflictsRepo;
    syncRuns: SyncRunsRepo;
    kv: KvRepo;
  };
  activityService: ActivityService;
  suggestionService: SuggestionService;
  reviewService: ReviewService;
  registryImporter: RegistryImporter;
  digestService: DigestService;
  narrator: DigestNarrator;
  onboardingService: OnboardingService;
  sync: SyncService;
  scheduler: SyncScheduler;
  close(): void;
}

export const silentLogger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

export function createContainer(config: AppConfig, overrides: ContainerOverrides = {}): Container {
  const logger = overrides.logger ?? silentLogger;
  const db = openDatabase(config.databaseFile);
  const kv = new KvRepo(db);
  const members = new MembersRepo(db);
  members.upsertAll(loadMembersFile(config.membersFile));
  const sources = new SourcesRepo(db);
  const activities = new ActivitiesRepo(db, sources, members);
  const suggestions = new SuggestionsRepo(db, sources, members);
  const conflicts = new ConflictsRepo(db, sources);
  const syncRuns = new SyncRunsRepo(db);
  syncRuns.closeInterrupted();

  const auth = config.google && config.appSecret ? new GoogleAuthService(config.google, kv, config.appSecret) : null;
  const gateway =
    overrides.gateway ??
    (config.google && auth
      ? new GoogleDriveGateway(() => auth.driveApi(), config.google.folderId)
      : new LocalFolderGateway(config.localDriveDir));

  const anthropic = config.ai.provider === 'claude' && config.ai.apiKey ? createAnthropicClient(config.ai.apiKey) : null;
  const heuristic = new HeuristicAnalyzer();
  const analyzer = overrides.analyzer ?? (anthropic ? new ClaudeAnalyzer(anthropic, config.ai.model) : heuristic);
  const nameOf = (id: string) => members.displayName(id);
  const narrator =
    overrides.narrator ?? (anthropic ? new ClaudeNarrator(anthropic, config.ai.model, nameOf) : new TemplateNarrator(nameOf));

  const suggestionService = new SuggestionService(db, suggestions, activities, members, conflicts, analyzer, heuristic);
  const registryImporter = new RegistryImporter(db, activities, members, sources, conflicts, kv, suggestionService);
  const sync = new SyncService({
    gateway,
    sources,
    kv,
    syncRuns,
    conflicts,
    suggestionService,
    registryImporter,
    registryFileNameFallback: config.registryFileNameFallback,
    onAuthError: () => auth?.invalidate(),
    logger,
  });
  const scheduler = new SyncScheduler(sync, config.syncIntervalSeconds, logger);

  return {
    config,
    db,
    logger,
    gateway,
    auth,
    repos: { members, sources, activities, suggestions, conflicts, syncRuns, kv },
    activityService: new ActivityService(db, activities, members),
    suggestionService,
    reviewService: new ReviewService(db, suggestions, activities, members),
    registryImporter,
    digestService: new DigestService(activities, suggestions, sources, members, conflicts),
    narrator,
    onboardingService: new OnboardingService(sources, activities, registryImporter),
    sync,
    scheduler,
    close: () => {
      scheduler.stop();
      db.close();
    },
  };
}
