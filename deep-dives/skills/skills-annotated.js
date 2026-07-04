// ============================================================================
// Claude Code Skills system — annotated extraction
// Source: Claude Code v2.1.201 (extracted from the native Bun binary), webcrack --no-jsx + prettier
// Date extracted: 2026-07-04
//
// Identifiers below are RENAMED from the mangled source for readability.
// Every renamed symbol carries a `// deobfuscated.js:NNNNN` line reference to
// the original. Renames are inferred from string literals, telemetry event
// names, Zod schema .describe() text, and call-site usage; anything not
// fully certain is flagged `/* uncertain */`. Full evidence + line-cited
// excerpts are in the companion README.md.
//
// SCOPE: loading, frontmatter parsing, nested/contextual discovery, name-
// collision handling, the Skill tool, and the disableBundledSkills /
// reload-skills / token-accounting surface area. Not every helper is
// reproduced — this is the ~20% of the machinery that explains the other 80%.
// ============================================================================

// ----------------------------------------------------------------------------
// 1. Frontmatter schema (Zod) — deobfuscated.js:185368-185448
// ----------------------------------------------------------------------------
// Base fields shared by skills AND legacy .claude/commands entries.
var baseFrontmatterSchema = He(() => A.object({          // was XYd
  name: strOrNum().optional(),
  description: strOrNum().optional(),
  model: strOrNum().optional(),                            // "inherit" => use parent model
  "allowed-tools": strOrList().optional(),
  "disallowed-tools": strOrList().optional(),               // cleared on the user's NEXT message
  disallowedTools: strOrList().optional(),                   // "canonical (normalized) alias" of disallowed-tools
  "argument-hint": strOrNum().optional(),
  arguments: strOrList().optional(),                         // @internal typed variant of argument-hint
  "disable-model-invocation": boolLike().optional(),         // model can't call via Skill tool; still /typable
  "user-invocable": boolLike().optional(),                   // false => hidden from user, model-only
  effort: strOrNum().optional(),                             // low|medium|high|max, or an integer
  shell: strOrNum().optional(),                              // bash|powershell for `!`-blocks
  version: strOrNum().optional()                             // @internal bookkeeping
}));

// Skill-specific extension of the base schema.
var skillFrontmatterSchema = He(() => baseFrontmatterSchema().extend({   // was Oto
  when_to_use: strOrNum().optional(),         // folded into the tool description
  paths: strOrList().optional(),               // glob(s) -> CONDITIONAL skill, loads only when matched
  hooks: A.unknown().optional(),               // same shape as settings.json hooks
  context: A.enum(["inline", "fork"]).nullable().optional(),  // inline = expand in-conversation (default);
                                                                // fork = spawn a subagent
  agent: strOrNum().optional(),                // agent type to spawn when context: fork
  fallback: boolLike().optional(),             // @internal: yield to same-suffix plugin/MCP skill once it loads
  created_by: strOrNum().optional(),           // @internal provenance ("dream-proposal")
  improved_by: strOrNum().optional(),
  // ...remaining keys (mcpServers, agents, outputStyles, themes, workflows,
  // channels, monitors, settings, userConfig, defaultEnabled, experimental,
  // dependencies, metadata, displayName, author, homepage, repository,
  // license, keywords) are all `@internal`, accepted but not consumed by
  // the skill loader itself.
}));

var agentFrontmatterSchema = He(() => A.object({ /* ... */ }));   // was JYd  — separate schema, agents ≠ skills
var outputStyleFrontmatterSchema = He(() => A.object({ /* ... */ })); // was QYd

// Per-file-type strict schemas, used ONLY for shadow-mode telemetry (never
// blocks or mutates parsing — see shadowValidateFrontmatter below).
var strictSchemasByType = {                                       // was ZYd
  skill: He(() => skillFrontmatterSchema().strict()),
  agent: He(() => agentFrontmatterSchema().strict()),
  "output-style": He(() => outputStyleFrontmatterSchema().strict())
};

function foldKey(key) {                                            // was t7d, deobfuscated.js:185451
  return key.replace(/[-_]/g, "").toLowerCase();
}
var allKnownFrontmatterKeys;                                       // was e7d, deobfuscated.js:185458
// = ["name","description","model","allowed-tools","argument-hint",
//    "arguments","disable-model-invocation","user-invocable","effort",
//    "shell","version","when_to_use","paths","hooks","context","agent",
//    ...40+ keys spanning skills/agents/commands/output-styles/plugins]
var foldedKeyToCanonical;                                           // was ngy, deobfuscated.js:185459
// = new Map(allKnownFrontmatterKeys.map(k => [foldKey(k), k]));
// /* uncertain */ — this map exists to support kebab/snake/camelCase
// acceptance (changelog 2.1.186), but I could not find ANY call site that
// reads it. See parseFrontmatter() below: its `normalizeKeys` option is
// never referenced inside the function body either. Flagging as possibly
// vestigial rather than asserting it's wired up.

function shadowValidateFrontmatter(fileType, frontmatter) {         // was N5e, deobfuscated.js:185340
  try {
    let result = strictSchemasByType[fileType]().safeParse(frontmatter);
    if (result.success) return;
    for (let issue of result.error.issues) {
      if (issue.code === "unrecognized_keys") {
        for (let key of issue.keys) {
          emitOnce("tengu_frontmatter_shadow_unknown_key", fileType, key);
        }
      } else {
        emitOnce("tengu_frontmatter_shadow_mismatch", fileType, `${issue.path[0]}:${issue.code}`);
      }
    }
  } catch {}
  // Telemetry-only: does not reject or alter the parsed frontmatter object.
}

// ----------------------------------------------------------------------------
// 2. Generic YAML frontmatter parser — deobfuscated.js:185503-185537
// ----------------------------------------------------------------------------
function parseFrontmatter(rawText, filePath, opts) {                // was fm
  let match = rawText.match(frontmatterBlockRegex);                 // was Ure
  if (!match) return { frontmatter: {}, content: rawText };
  let yamlBlock = match[1] || "";
  let content = rawText.slice(match[0].length);
  let frontmatter = {};
  let parseError;
  try {
    frontmatter = asPlainObject(bunYamlParse(yamlBlock));           // was mVi(F4(...))
  } catch {
    try {
      // Repair pass: quote bare YAML-special values, de-tab indentation,
      // then retry. Handles hand-written frontmatter that isn't strict YAML.
      let repaired = quoteUnsafeScalars(yamlBlock).replace(/^\t+/gm, m => "  ".repeat(m.length));  // was r7d
      frontmatter = asPlainObject(bunYamlParse(repaired));
    } catch (e) {
      parseError = e instanceof Error ? e.message : String(e);
      log(`Failed to parse YAML frontmatter in ${filePath}: ${parseError}`, { level: "warn" });
    }
  }
  return { frontmatter, content, ...(parseError !== undefined && { parseError }) };
  // opts.normalizeKeys is accepted but NOT read anywhere in this body.
}

// ----------------------------------------------------------------------------
// 3. Frontmatter -> internal skill fields — deobfuscated.js:386009-386046
// ----------------------------------------------------------------------------
function buildSkillFields(frontmatter, markdownContent, skillName, kindLabel = "Skill") {  // was avo
  let userDescription = deriveDescription(frontmatter.description, skillName);              // was mU
  let description = userDescription ?? autoDeriveFromContent(markdownContent, kindLabel);    // was afe
  let userInvocable = frontmatter["user-invocable"] === undefined
    ? true
    : coerceBool(frontmatter["user-invocable"]);                                            // was Nct
  let model = typeof frontmatter.model === "string" && frontmatter.model.trim()
    ? (frontmatter.model.trim() === "inherit" ? undefined : resolveModelAlias(frontmatter.model.trim()))
    : undefined;
  let effort = frontmatter.effort !== undefined ? parseEffort(frontmatter.effort) : undefined; // was OU
  if (frontmatter.effort !== undefined && effort === undefined) {
    log(`Skill ${skillName} has invalid effort '${frontmatter.effort}'. Valid options: ${validEfforts.join(", ")}`);
  }
  return {
    displayName: frontmatter.name != null ? String(frontmatter.name) : undefined,
    description,
    hasUserSpecifiedDescription: userDescription !== null,
    allowedTools: parseToolList(frontmatter["allowed-tools"]),                                // was pZ
    disallowedTools: parseToolList(frontmatter["disallowed-tools"] ?? frontmatter.disallowedTools),
    argumentHint: frontmatter["argument-hint"] != null ? String(frontmatter["argument-hint"]) : undefined,
    whenToUse: frontmatter.when_to_use != null ? String(frontmatter.when_to_use) : undefined,
    model,
    disableModelInvocation: coerceBool(frontmatter["disable-model-invocation"]),
    userInvocable,
    hooks: parseHooks(frontmatter, skillName),                                                // was M9p
    executionContext: frontmatter.context === "fork" ? "fork" : undefined,                     // default: inline
    agent: frontmatter.agent != null ? String(frontmatter.agent) : undefined,
    effort,
    fallback: coerceBool(frontmatter.fallback)                                                 // was B5e
  };
}

function parsePathGlobs(frontmatter) {                                // was $9p, deobfuscated.js:385999
  if (!frontmatter.paths) return;
  let globs = expandBraces(frontmatter.paths)                         // was bjt
    .map(g => g.endsWith("/**") ? g.slice(0, -3) : g)
    .filter(g => g.length > 0);
  if (globs.length === 0 || globs.every(g => g === "**")) return;      // "**" alone == unconditional
  return globs;
}

// ----------------------------------------------------------------------------
// 4. Single-directory SKILL.md reader — deobfuscated.js:386165-386324
// ----------------------------------------------------------------------------
const SKILL_MD_SIZE_LIMIT_BYTES = 1000000;   // was Fq, deobfuscated.js:351070 — 1 MB, also used as the .claude-plugin/plugin.json read cap

async function loadSkillsFromDir(dirPath, source) {                   // was nyt
  let fs = getFs();
  let entries;
  try {
    entries = await fs.readdir(dirPath);
  } catch (e) {
    if (!isEnoent(e)) {
      log(`Failed to read skills directory ${dirPath}: ${e}`, { level: "error" });
      recordFailure("skill_load_dir", "skill_load_readdir_failed");
    }
    return [];
  }
  // /mnt/* transient-empty-readdir retry (mount race), deobfuscated.js:386179-386200
  if (entries.length === 0 && dirPath.startsWith("/mnt/")) {
    await sleep(250);
    /* retry readdir once, telemetry either way */
  }

  // Disabled-plugin skip-set (only when scanning THE canonical userSettings
  // or projectSettings skills root): plugin name "@<PS>" disabled in
  // enabledPlugins => its skill dir is skipped, deobfuscated.js:386202-386213.
  let disabledPluginNames = computeDisabledPluginSkillDirs(dirPath, source);

  let results = await Promise.all(entries.map(async entry => {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) return null;
    let skillDir = path.join(dirPath, entry.name);
    let skillMdPath = path.join(skillDir, "SKILL.md");

    if (disabledPluginNames.size > 0) {
      // Resolve the dir's plugin identity via .claude-plugin/plugin.json
      // (bounded read, size-capped) and skip if that plugin is disabled.
      /* ... */
    }

    let stat = await fs.stat(skillMdPath).catch(() => null);
    if (stat !== null && !stat.isFile()) {
      log(`[skills] skipping ${skillMdPath}: not a regular file`, { level: "warn" });
      return null;
    }
    if ((stat?.size ?? 0) > SKILL_MD_SIZE_LIMIT_BYTES) {
      log(`[skills] skipping ${skillMdPath}: exceeds byte limit`, { level: "warn" });
      return null;                                            // hard per-file size cap
    }

    let raw = await fs.readFile(skillMdPath, { encoding: "utf-8" });
    let { frontmatter, content, parseError } = parseFrontmatter(raw, skillMdPath, { normalizeKeys: true });
    if (parseError) {
      log(`[skills] YAML frontmatter in ${skillMdPath} failed to parse and was ignored: ${parseError}`, { level: "error" });
    }
    let markdown = postProcessMarkdown(skillMdPath, content);          // was xHe
    shadowValidateFrontmatter("skill", frontmatter);
    let fields = buildSkillFields(frontmatter, markdown, entry.name);
    let paths = parsePathGlobs(frontmatter);
    return {
      skill: createSkillCommand({                                      // was f8t
        ...fields,
        skillName: entry.name,
        markdownContent: markdown,
        contentHash: Bun.hash(raw).toString(36),
        source,                                                        // "policySettings"|"userSettings"|"projectSettings"
        baseDir: skillDir,
        loadedFrom: "skills",
        paths
      }),
      filePath: skillMdPath
    };
  }));

  return results.filter(r => r !== null)
    .sort((a, b) => a.skill.name.localeCompare(b.skill.name));
}

// ----------------------------------------------------------------------------
// 5. createSkillCommand — deobfuscated.js:386051-~386130
// ----------------------------------------------------------------------------
function createSkillCommand({ skillName, allowedTools, disallowedTools, baseDir, /* ...+20 more */ }) {  // was f8t
  // ${CLAUDE_SKILL_DIR} and ${CLAUDE_PROJECT_DIR} placeholder substitution in
  // allowed-tools happens HERE, not in the frontmatter parser, so it can use
  // the resolved baseDir / project root at load time.
  if (baseDir && allowedTools.length > 0) {
    allowedTools = allowedTools.map(t => t.replace(/\$\{CLAUDE_SKILL_DIR\}/g, () => baseDir));
  }
  if (allowedTools.length > 0) {
    let projectDir = getProjectDir();                                  // was cl()
    allowedTools = allowedTools.map(t => t.replace(/\$\{CLAUDE_PROJECT_DIR\}/g, () => projectDir));
  }
  return {
    type: "prompt",           // discriminator: "prompt" (skill/markdown-backed) vs "local"/"local-jsx" (TS command)
    name: skillName,
    /* ...description, allowedTools, disallowedTools, argNames, whenToUse,
        version, model, disableModelInvocation, userInvocable, hooks,
        executionContext, agent, paths, effort, createdBy, declaredFields,
        fallback, source, baseDir, loadedFrom, mcpResourceRoot, contentHash */
  };
}

// ----------------------------------------------------------------------------
// 6. Ancestor-directory scan (closest-first) — deobfuscated.js:784472-784504
// ----------------------------------------------------------------------------
// Used for BOTH skills and agents/routines: walks from cwd up toward $HOME
// (or up to the nearest git root, whichever is reached first), collecting
// every level's `.claude/<subdir>` that actually exists on disk.
function getAncestorConfigDirs(subdirName, cwd) {                       // was A6e
  let home = path.resolve(os.homedir()).normalize("NFC");
  let gitRootCutoff = findGitRootCutoff(cwd);                            // was Vwm
  let dirs = [];
  let current = path.resolve(cwd);
  while (true) {
    if (samePath(current, home)) break;
    let candidate = path.join(current, ".claude", subdirName);
    try {
      fs.statSync(candidate);
      dirs.push(candidate);                     // closest (cwd-nearest) pushed FIRST
    } catch { /* ENOENT: fine, keep walking; ENFILE: log and skip */ }
    if (gitRootCutoff && samePath(current, gitRootCutoff)) break;
    let parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return dirs;   // [closest, ..., farthest]
}

// Depth-based comparator: MORE path separators in baseDir == deeper/closer to
// a file being touched. Used to order project-scope entries so that, when
// written into a Map in this order, the deepest (last-written) entry wins.
// This is the literal "closest-directory-wins" mechanism — but it is used
// for AGENTS ($en, deobfuscated.js:639674) and ROUTINES (vpA, 747730), NOT
// for skills. Skills use a different, softer scheme (§8 below).
function sortByDepthAscending(a, b) {                                    // was STt, deobfuscated.js:784468
  let sepCount = p => p === undefined ? Infinity : (p.match(/[/\\]/g)?.length ?? 0);
  return sepCount(a.baseDir) - sepCount(b.baseDir);
}

// ----------------------------------------------------------------------------
// 7. True contextual discovery (2.1.178) — deobfuscated.js:386540-386608
// ----------------------------------------------------------------------------
// Triggered when the model touches (reads/edits) files during the session.
// Walks from EACH touched file's directory up toward the project root,
// registering any nested `.claude/skills` dir found along the way as a
// "dynamic skill dir" for this session (once per dir, gitignore-respecting).
async function discoverNestedSkillDirs(touchedFilePaths, projectRoot) {   // was ryt
  let root = projectRoot.endsWith(path.sep) ? projectRoot.slice(0, -1) : projectRoot;
  let discovered = [];
  for (let filePath of touchedFilePaths) {
    let dir = path.dirname(filePath);
    while (dir.startsWith(root + path.sep)) {
      let candidate = path.join(dir, ".claude", "skills");
      if (!sessionState().dynamicSkillDirs.has(candidate)) {
        sessionState().dynamicSkillDirs.add(candidate);
        try {
          await fs.stat(candidate);
          if (await isGitignored(dir, root)) { dir = path.dirname(dir); continue; }
          discovered.push(candidate);
        } catch {}
      }
      let parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return discovered;
}

async function registerDiscoveredSkills(dirs) {                          // was q$e, deobfuscated.js:386574
  if (dirs.length === 0) return;
  let loaded = await Promise.all(dirs.map(d => loadSkillsFromDir(d, "projectSettings")));
  for (let dirResults of loaded) {
    for (let { skill } of dirResults) {
      if (skill.type === "prompt") {
        sessionState().dynamicSkills.set(dynamicSkillKey(skill), skill);   // key: `${skillRoot}\0${name}`
      }
    }
  }
  notifySkillsChanged();                                                  // was uvo.emit()
}

// paths:-conditional activation — a skill declared with `paths:` glob(s)
// sits in `conditionalSkills` until a touched file matches, at which point
// it's promoted into `dynamicSkills` (386612-386648, was oyt).

// ----------------------------------------------------------------------------
// 8. Master skill loader — deobfuscated.js:386709-386792
// ----------------------------------------------------------------------------
var loadAllSkills = memoize(async (touchedFiles) => {                     // was b6e
  let managedDir = path.join(homeDir(), "skills");                        // policySettings root
  let userDir = path.join(getPolicyOrHomeDir(), ".claude", "skills");      // was K0()
  let ancestorProjectDirs = getAncestorConfigDirs("skills", touchedFiles); // §6, closest-first
  let additionalDirs = getAdditionalDirs();                                // --add-dir dirs
  let policyOnly = isPluginOnlyPolicy();                                   // was HA("skills")
  let projectEnabled = settingsAllow("projectSettings") && !policyOnly;

  if (isReducedMode(/* ... */)) return [];      // e.g. headless/minimal-context modes skip skill scanning
  if (isDisabledMode()) {
    // dirs-only mode: just the additional dirs' skills, nothing else
    return (await Promise.all(additionalDirs.map(d => loadSkillsFromDir(path.join(d, ".claude", "skills"), "projectSettings")))).flat().map(r => r.skill);
  }

  let [policySkills, userSkills, ancestorSkillsNested, additionalDirSkills, legacyCommandSkills] =
    await Promise.all([
      allowPolicySkills() ? loadSkillsFromDir(managedDir, "policySettings") : [],
      (settingsAllow("userSettings") && !policyOnly) ? loadSkillsFromDir(userDir, "userSettings") : [],
      projectEnabled ? Promise.all(ancestorProjectDirs.map(d => loadSkillsFromDir(d, "projectSettings"))) : [],
      projectEnabled ? Promise.all(additionalDirs.map(d => loadSkillsFromDir(path.join(d, ".claude", "skills"), "projectSettings"))) : [],
      policyOnly ? [] : loadLegacyCommandsDirAsSkills(touchedFiles, projectEnabled ? additionalDirs : [])  // was j9p
    ]);

  let combined = [...policySkills, ...userSkills, ...ancestorSkillsNested.flat(), ...additionalDirSkills.flat(), ...legacyCommandSkills];

  // Dedup by PHYSICAL FILE (realpath), not by name — two dirs can define the
  // same `name` and both survive this stage; name collisions are resolved
  // one layer up in mergeStaticAndDynamicSkills() (§9).
  let seenByRealpath = new Map();
  let unique = [];
  for (let { skill, filePath } of combined) {
    if (skill.type !== "prompt") continue;
    let realPath = await resolveRealpath(filePath);                        // was P9p
    if (realPath === null) { unique.push(skill); continue; }
    if (seenByRealpath.has(realPath)) {
      log(`Skipping duplicate skill '${skill.name}' from ${skill.source} (same file already loaded from ${seenByRealpath.get(realPath)})`);
      continue;
    }
    seenByRealpath.set(realPath, skill.source);
    unique.push(skill);
  }

  // Split conditional (paths:) from unconditional skills; stash conditionals
  // in session state to be activated later by discoverNestedSkillDirs/oyt.
  let [unconditional, conditional] = partition(unique, s => !(s.paths?.length && !activatedConditionalNames().has(s.name)));
  for (let c of conditional) sessionState().conditionalSkills.set(c.name, c);

  return unconditional;
}, touchedFiles => `${sessionMode()}:${touchedFiles}`);   // cache key includes session mode ("cli" vs sub-mode)

// ----------------------------------------------------------------------------
// 9. Merge static + dynamic/contextual skills, resolve name collisions
//    — deobfuscated.js:775281-775402
// ----------------------------------------------------------------------------
async function mergeStaticAndDynamicSkills(touchedFiles) {                 // was OA
  let staticSkills = (await getVisibleCommands(touchedFiles)).filter(visibleAndAllowed);  // was dhr-derived
  let dynamicSkills = getDynamicSkills().filter(visibleAndAllowed);         // was _qa()
  let staticNames = new Set();
  let staticSkillRoots = new Set();
  for (let s of staticSkills) {
    staticNames.add(s.name);
    if (s.type === "prompt" && s.skillRoot) staticSkillRoots.add(s.skillRoot);
  }

  let merged = [];
  for (let dyn of dynamicSkills) {
    if (dyn.type === "prompt" && dyn.fallback) continue;   // fallback stubs never compete for the bare name

    let relPathFromCwd = relativeSkillRootPath(dyn, touchedFiles);          // was STm; null if outside project
    let collides = staticNames.has(dyn.name);

    if (!collides /* and no earlier same-name dynamic skill already emitted */) {
      merged.push(dyn);                                                     // no collision: keep the bare name
      continue;
    }
    if (!relPathFromCwd) continue;                                         // collision, no path context: drop it

    // Collision WITH path context: qualify the name as "relpath:name" and
    // rewrite the description to say it's the preferred, scoped variant.
    // Both the unscoped static skill AND the qualified nested skill remain
    // invocable — this is NOT a silent closest-wins overwrite.
    let qualifiedName = `${relPathFromCwd}:${dyn.name}`;                    // was KJo
    merged.push({
      ...dyn,
      name: qualifiedName,
      unqualifiedName: dyn.name,
      description: `${dyn.description} (scoped to ${relPathFromCwd}/ — use this instead of the unscoped "${dyn.name}" skill when the files being changed are under ${relPathFromCwd}/)`
    });
  }
  return dropShadowedBundledSkills([...staticSkills, ...merged]);           // was XV(...)
}

// Drops a `fallback: true` stub if a plugin/MCP skill with the same suffix
// (`<plugin>:<name>` / `<server>:<name>`) is also loaded — genuine silent
// drop, unlike the collision handling above.
function dropShadowedFallbackSkills(skills) { /* was XV, deobfuscated.js:775425 */ }
// Drops duplicate `source: "bundled"` entries by exact name (memoized).
function dropShadowedBundledSkills(skills) { /* was AXe, deobfuscated.js:775457 */ }

// ----------------------------------------------------------------------------
// 10. disableBundledSkills / CLAUDE_CODE_DISABLE_BUNDLED_SKILLS
//     — deobfuscated.js:311803-311816, 742723-742728
// ----------------------------------------------------------------------------
function bundledSkillsDisabled(settings) {                                  // was Mz
  return !!process.env.CLAUDE_CODE_DISABLE_BUNDLED_SKILLS
    || (settings ?? getSettings()).disableBundledSkills === true;
}
function shouldHideBuiltinFromModel(skill, settings) {                      // was sGn
  return skill.type === "prompt" && skill.source === "builtin" && bundledSkillsDisabled(settings);
}
function getBundledSkills() {                                               // was FYo
  if (bundledSkillsDisabled()) return [];    // source:"bundled" skills REMOVED ENTIRELY
  return [...hardcodedBundledSkillsArray];   // was Mgc
}
// Contrast: source:"builtin" (hardcoded TS command objects, e.g. /compact)
// are NOT removed — visibility() (was xse, 775478) just demotes them from
// "on" to "user-invocable-only" when shouldHideBuiltinFromModel() is true,
// so they stay /typable by the user but disappear from the model's listing.

// ----------------------------------------------------------------------------
// 11. /reload-skills — deobfuscated.js:739616-739668
// ----------------------------------------------------------------------------
var reloadSkillsCommand = {                                                 // was Ngm
  type: "local",
  name: "reload-skills",
  description: "Pick up skills added or changed on disk during this session",
  supportsNonInteractive: true,
  thinClientDispatch: "post-text"
};
async function handleReloadSkills(input, ctx) {                             // was Ogm
  let before = await getVisibleSkills(getProjectDir());                     // was vw(n)
  clearAllSkillCaches();                                                    // was vR() -> gV/F5n/V4a/E6e
  invalidatePluginCache();                                                  // was zq()
  let after = await getVisibleSkills(getProjectDir());
  notifySubscribers();
  let addedCount = countNotIn(after, before);
  let removedCount = countNotIn(before, after);
  let safeModeNote = isSafeMode() ? " (custom skills are disabled in safe mode)" : "";
  return { type: "text", value: `Reloaded skills: ${after.length} skills available (${addedCount} added, ${removedCount} removed)${safeModeNote}` };
}

// ----------------------------------------------------------------------------
// 12. The Skill tool — deobfuscated.js:298547, 589751-590119
// ----------------------------------------------------------------------------
var SKILL_TOOL_NAME = "Skill";                                              // was Fh

var skillToolInputSchema = He(() => A.object({                              // was Cjf
  skill: A.string().describe("The name of a skill from the available-skills list. Do not guess names."),
  args: A.string().optional().describe("Optional arguments for the skill")
}));

var SkillTool = defineTool({                                                // was qHt = _s({...})
  name: SKILL_TOOL_NAME,
  searchHint: "invoke a slash-command skill",
  isEnabled: () => !isRemoteSurface(),                                       // was !cF()
  maxResultSizeChars: 100000,
  get inputSchema() { return skillToolInputSchema(); },
  description: async ({ skill }) => `Execute skill: ${skill}`,
  prompt: async () => getAvailableSkillsListing(getProjectDir()),            // was $5n(cl()) — the tool-prompt text

  async validateInput({ skill: rawName }, ctx) {
    let name = rawName.trim();
    if (!name) return { result: false, message: `Invalid skill format: ${rawName}`, errorCode: 1 };
    let unprefixed = name.startsWith("/") ? name.substring(1) : name;
    let registry = await getRegistryForSession(ctx);                        // was kjo(t)
    let found = findCommand(unprefixed, registry);                          // was hb(o, i)
    if (!found) {
      let suggestion = fuzzySuggest(unprefixed, registry, { maxEditDistance: 2 });  // was GOe
      return { result: false, message: suggestion ? `Unknown skill: ${unprefixed}. Did you mean ${suggestion}?` : `Unknown skill: ${unprefixed}`, errorCode: 2 };
    }
    // Recursion guard: a forked skill can't re-invoke itself via the Skill
    // tool from inside its own subagent — it should just run its body.
    if (found.type === "prompt" && found.context === "fork" && ctx.options.spawnedBySkill === unqualifiedName(found)) {
      return { result: false, message: `Skill ${unprefixed} is already executing in this forked context — you are the subagent running it. Execute the instructions in the skill body directly instead of re-invoking the ${SKILL_TOOL_NAME} tool.`, errorCode: 9 };
    }
    let denial = checkSkillInvocationPolicy(found, { commandName: unprefixed, /* ... */ });  // was eZt
    if (denial) return { result: false, message: denial.message, errorCode: denial.errorCode };
    return { result: true };
  },

  async checkPermissions({ skill, args }, ctx) { /* allow/deny rule matching, then interactive "ask" fallback with a
                                                     one-shot "always allow this skill" suggestion */ },

  async call({ skill: rawName, args }, ctx, permCtx, toolUse, streamCb) {
    let name = rawName.trim();
    let unprefixed = name.startsWith("/") ? name.substring(1) : name;
    let registry = await getRegistryForSession(ctx);
    let found = findCommand(unprefixed, registry);

    if (found?.type === "prompt" && found.context === "fork") {
      // FORK: spawn a real subagent (§13) and stream its result back as one tool result.
      return await executeForkedSkill(found, unprefixed, args, ctx, permCtx, toolUse, streamCb);   // was wjf
    }

    // INLINE (default): expand the skill body into new messages appended to
    // THIS conversation turn — no subagent, just prompt injection + optional
    // contextLayers (allowed-tools / model / effort overrides scoped to the
    // rest of this turn).
    let expansion = await processPromptSlashCommand(unprefixed, args || "", registry, ctx);
    if (!expansion.shouldQuery) throw new Error("Command processing failed");
    return {
      data: { success: true, commandName: unprefixed, allowedTools: expansion.allowedTools, model: expansion.model },
      newMessages: buildNewMessages(expansion.messages, toolUse.toolUseId),
      ...(expansion.allowedTools?.length || expansion.model || expansion.effort !== undefined
        ? { contextLayers: buildContextLayers(expansion) } : {})
    };
  },

  mapToolResultToToolResultBlockParam(result, toolUseId) {
    if ("status" in result && result.status === "forked") {
      return { type: "tool_result", tool_use_id: toolUseId, content: `Skill "${result.commandName}" completed (forked execution).\n\nResult:\n${result.result}` };
    }
    return { type: "tool_result", tool_use_id: toolUseId, content: `Launching skill: ${result.commandName}` };
  }
});

// ----------------------------------------------------------------------------
// 13. Fork execution: context:"fork" spawns a genuine subagent
//     — deobfuscated.js:589560-~589660
// ----------------------------------------------------------------------------
async function executeForkedSkill(skill, name, args, ctx, canUseTool, toolUse, parentSpawnedBy, onEvent) {  // was wjf
  let subAgentId = newAgentId();                                            // was $0()
  emitInvocationTelemetry({ execution_context: "fork", /* ... */ });
  let { modifiedGetAppState, contextLayers, baseAgent, promptMessages } = await buildForkedAgentContext(skill, args || "", ctx);  // was QQt
  let effort = skill.getEffort?.(args || "") ?? skill.effort;
  let agentDefinition = effort !== undefined ? { ...baseAgent, effort } : baseAgent;

  // Runs the FULL agent query loop as a real subagent — same machinery as
  // the Agent/Task tool, not a lightweight in-process expansion.
  for await (let event of runAgentQuery({                                    // was EB()
    agentDefinition,
    promptMessages,
    toolUseContext: { ...ctx, getAppState: modifiedGetAppState, permissionLayers: [...(ctx.permissionLayers ?? []), ...contextLayers] },
    canUseTool,
    querySource: "agent:custom",
    spawnedBySkill: unqualifiedName(skill),          // enables the recursion guard in validateInput above
    model: skill.model,
    override: { agentId: subAgentId, agentContext: { agentType: "subagent", subagentName: agentDefinition.agentType, parentAgentId: ctx.agentId, depth: currentDepth(ctx.agentContext) + 1 } }
  })) {
    if (event.type === "api_metrics") { onEvent?.(event); continue; }
    /* accumulate messages / forward progress ... */
  }
  return { data: { success: true, commandName: name, status: "forked", agentId: subAgentId, result: /* final subagent output */ "" } };
}

// ----------------------------------------------------------------------------
// 14. Stacked invocation (2.1.199) — deobfuscated.js:587970-588020, 588195
// ----------------------------------------------------------------------------
var MAX_STACKED_SKILLS = 5;                                                 // was jFl, deobfuscated.js:588195

function parseStackedLeadingSkills(trailingText, initialArgs, registry, denyFilter) {  // was GFl
  if (initialArgs === undefined && denyFilter === undefined) {
    return { stacked: [], trailingArgs: trailingText, capped: false };
  }
  let stacked = [];
  let remaining = trailingText;
  let capped = false;
  for (let i = 0; ; i++) {
    let trimmed = remaining.trimStart();
    if (!trimmed.startsWith("/")) break;
    if (i >= MAX_STACKED_SKILLS) { capped = true; break; }                  // 6th leading "/name" stops the scan

    let parsed = parseLeadingSlashCommand(trimmed);                          // was Eee
    if (!parsed) break;
    let found = findCommand(parsed.commandName, registry);                   // was hb

    // Only plain prompt-type skills can stack: no fork-context skills, none
    // whose args might themselves contain slash commands, none hidden from
    // users, none already excluded by the caller's deny filter.
    if (!found || found.type !== "prompt" || found.context === "fork"
        || found.argsMayContainSlashCommands || found.userInvocable === false
        || !isVisible(found) || isDenyRuleBlocked(found)) break;

    remaining = parsed.args;
    if (denyFilter?.(found)) continue;
    stacked.push(found);
  }
  return { stacked, trailingArgs: remaining, capped };
}
// Caller behavior on capped=true: appends a literal warning message
// `Stacked command limit (5) reached — remaining input passed as arguments`
// (deobfuscated.js:587913-587915). Each stacked skill executes independently
// and its messages are appended in order; the first user message keeps the
// full original stacked input (`stackedOriginalInput`) for transcript replay,
// subsequent ones are tagged `stackedExpansion: true`.

// ----------------------------------------------------------------------------
// 15. Skill-listing token budget (feeds the Skill tool's `prompt` AND /context)
//     — deobfuscated.js:364090-364206, 620792-620854
// ----------------------------------------------------------------------------
const LISTING_CHAR_BUDGET_CEILING = 200000;                                 // was u3p
const DEFAULT_LISTING_BUDGET_FRACTION = 0.01;                               // was c3p, settings.skillListingBudgetFraction overrides
const DEFAULT_BYTES_PER_TOKEN = 4;                                          // was D4a
const MAX_DESCRIPTION_CHARS = 1536;                                         // was d3p — matches changelog's 250->1536 cap raise
const MIN_VIABLE_DESCRIPTION_CHARS = 20;                                    // was mAo — below this, degrade to names-only

function computeListingCharBudget(overrideBytesPerToken, bytesPerToken = DEFAULT_BYTES_PER_TOKEN) {  // was W8e
  if (Number(process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET)) return Number(process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET);
  let fraction = getSettings().skillListingBudgetFraction ?? DEFAULT_LISTING_BUDGET_FRACTION;
  return Math.max(1, Math.floor((overrideBytesPerToken ?? LISTING_CHAR_BUDGET_CEILING) * bytesPerToken * fraction));
}

// Escalating budget modes, in order of increasing pressure:
//   "fits"        — every skill's full "- name: description" entry fits
//   "priority"    — a priority fn is available; drop lowest-priority ENTIRE
//                    entries first (keeps others at full description length)
//   "truncate"    — no priority fn; shrink every non-exempt description to
//                    an equal per-skill share of the remaining budget
//   "names-only"  — that equal share drops below MIN_VIABLE_DESCRIPTION_CHARS;
//                    show bare "- name" for every non-exempt entry
function allocateListingBudget(skills, bytesOverride, forceIncluded, priorityFn, bytesPerToken) { /* was M5n, deobfuscated.js:364111 */ }

async function getSkillTokenAccounting(touchedFiles, tokenizer, model, awArgs, mcpSkills, forceMode) {  // was ZVf, deobfuscated.js:620792
  let allSkills = await getVisibleSkills(getProjectDir());
  let toolOverheadTokens = await tokenize([SkillTool], tokenizer, model);    // fixed cost of exposing the tool + its rendered listing
  let budgetResult = allocateListingBudget(allSkills, /* ... */);
  return {
    skillTokens: toolOverheadTokens,
    skillInfo: {
      totalSkills: allSkills.length,
      includedSkills: /* count after visibility filtering */ 0,
      skillFrontmatter: allSkills.map(s => ({
        name: userFacingName(s),
        source: s.type === "prompt" ? s.source : "plugin",
        tokens: estimateTokensFromChars(renderListingEntry(s, budgetResult), bytesPerToken)  // char/byte-ratio estimate, was Rf(...)
      }))
    }
  };
}
