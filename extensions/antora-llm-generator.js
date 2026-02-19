"use strict";

const fs = require("node:fs");
const ospath = require("node:path");
const downdoc = require("downdoc");
const { minimatch } = require("minimatch");

const compareText = (a, b) =>
  String(a || "").localeCompare(String(b || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });

const toMarkdownPath = (outPath) =>
  outPath.endsWith(".html") ? `${outPath.slice(0, -5)}.md` : `${outPath}.md`;

const toString = (value) => {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString();
  return "";
};

const toUrl = (siteUrl, path) => (siteUrl ? `${siteUrl}/${path}` : `/${path}`);

const normalizeRecord = (record) => ({
  component: record.component || "ROOT",
  version: record.version || "",
  title: record.title || "Untitled",
  markdownPath: record.markdownPath,
  markdown: record.markdown || "",
  includeInFull: record.includeInFull !== false,
});

const pushToMap = (map, key, value) => {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
};

const sortRecords = (records) =>
  [...records].sort((a, b) => compareText(a.markdownPath, b.markdownPath));

const buildMeta = (componentInfos = []) => {
  const componentOrder = new Map();
  const componentTitles = new Map();
  const componentDescriptions = new Map();
  const versionOrder = new Map();
  const versionLabels = new Map();

  componentInfos.forEach((component, componentIndex) => {
    const componentName = component.name;
    if (!componentName) return;
    componentOrder.set(componentName, componentIndex);
    componentTitles.set(componentName, component.title || componentName);
    if (component.description) {
      componentDescriptions.set(componentName, String(component.description).trim());
    }

    const versionOrderForComponent = new Map();
    const versionLabelForComponent = new Map();
    (component.versions || []).forEach((versionInfo, versionIndex) => {
      const version = versionInfo.version || "";
      versionOrderForComponent.set(version, versionIndex);
      versionLabelForComponent.set(
        version,
        versionInfo.displayVersion || version || "unversioned",
      );
    });
    versionOrder.set(componentName, versionOrderForComponent);
    versionLabels.set(componentName, versionLabelForComponent);
  });

  return {
    componentOrder,
    componentTitles,
    componentDescriptions,
    versionOrder,
    versionLabels,
  };
};

const compareComponents = (a, b, meta) => {
  const aIsRoot = a === "ROOT";
  const bIsRoot = b === "ROOT";
  if (aIsRoot && !bIsRoot) return -1;
  if (!aIsRoot && bIsRoot) return 1;

  const aOrder = meta.componentOrder.get(a);
  const bOrder = meta.componentOrder.get(b);
  if (aOrder != null && bOrder != null) return aOrder - bOrder;
  if (aOrder != null) return -1;
  if (bOrder != null) return 1;
  return compareText(a, b);
};

const compareVersions = (component, a, b, meta) => {
  const orders = meta.versionOrder.get(component);
  const aOrder = orders?.get(a);
  const bOrder = orders?.get(b);
  if (aOrder != null && bOrder != null) return aOrder - bOrder;
  if (aOrder != null) return -1;
  if (bOrder != null) return 1;
  return compareText(a, b);
};

const componentTitle = (component, meta) =>
  meta.componentTitles.get(component) || component;

const versionLabel = (component, version, meta) =>
  meta.versionLabels.get(component)?.get(version) || version || "unversioned";

const buildIndexText = (lines, title, description = "") => {
  const contentLines = [`# ${title}`, ""];
  if (description) {
    contentLines.push(description, "");
  }
  if (lines.length) {
    contentLines.push(...lines);
  } else {
    contentLines.push("- (no pages)");
  }
  return `${contentLines.join("\n")}\n`;
};

const buildFullText = (title, records, description = "") => {
  const fullRecords = sortRecords(records).filter((record) => record.includeInFull);
  if (!fullRecords.length) {
    if (!description) return `# ${title}\n\n`;
    return `# ${title}\n\n${description}\n\n`;
  }

  const sections = [`# ${title}`];
  if (description) {
    sections.push(description);
  }
  for (const record of fullRecords) {
    sections.push(`## ${record.title}`);
    sections.push(record.markdown.trim());
  }
  return `${sections.join("\n\n")}\n`;
};

const decodeEdnString = (value) =>
  value
    .replace(/\\\\/g, "\\")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const extractManifestDescription = (manifestContents) => {
  const match = manifestContents.match(/:description\s+"((?:[^"\\]|\\.)*)"/m);
  if (!match) return "";
  return decodeEdnString(match[1]);
};

const readComponentDescriptionFromManifest = (page) => {
  const worktree = page.src?.origin?.worktree;
  if (!worktree) return "";
  const startPath = page.src?.origin?.startPath || "doc";
  const manifestPath = ospath.join(worktree, startPath, "manifest.edn");
  if (!fs.existsSync(manifestPath)) return "";
  const manifestContents = fs.readFileSync(manifestPath, "utf8");
  return extractManifestDescription(manifestContents);
};

function generateLlmsArtifacts({
  siteTitle,
  siteUrl,
  componentInfos,
  componentDescriptions = new Map(),
  records,
}) {
  const normalizedSiteUrl = (siteUrl || "").replace(/\/$/, "");
  const meta = buildMeta(componentInfos);
  const mergedComponentDescriptions = new Map(meta.componentDescriptions);
  for (const [component, description] of componentDescriptions.entries()) {
    if (description) mergedComponentDescriptions.set(component, description);
  }
  const normalizedRecords = records
    .filter((record) => record.markdownPath)
    .map(normalizeRecord);

  const componentToVersions = new Map();
  const byComponent = new Map();
  const byComponentVersion = new Map();
  const rootRecords = [];

  for (const record of normalizedRecords) {
    if (record.component === "ROOT") {
      rootRecords.push(record);
      continue;
    }

    pushToMap(byComponent, record.component, record);
    if (!componentToVersions.has(record.component)) {
      componentToVersions.set(record.component, new Set());
    }
    componentToVersions.get(record.component).add(record.version);

    const componentVersionKey = `${record.component}::${record.version}`;
    pushToMap(byComponentVersion, componentVersionKey, record);
  }

  const artifacts = new Map();

  // Root hierarchical index.
  const rootLines = [];
  for (const record of sortRecords(rootRecords)) {
    rootLines.push(`- [${record.title}](${toUrl(normalizedSiteUrl, record.markdownPath)})`);
  }

  const sortedComponents = [...byComponent.keys()].sort((a, b) =>
    compareComponents(a, b, meta),
  );
  for (const component of sortedComponents) {
    rootLines.push(
      `- [${componentTitle(component, meta)}](${toUrl(normalizedSiteUrl, `${component}/llms.txt`)})`,
    );
    const versions = [...(componentToVersions.get(component) || [])].sort((a, b) =>
      compareVersions(component, a, b, meta),
    );
    for (const version of versions) {
      const versionPath = version ? `${component}/${version}/llms.txt` : `${component}/llms.txt`;
      rootLines.push(
        `  - [${versionLabel(component, version, meta)}](${toUrl(normalizedSiteUrl, versionPath)})`,
      );
      const versionKey = `${component}::${version}`;
      const versionRecords = sortRecords(byComponentVersion.get(versionKey) || []);
      for (const record of versionRecords) {
        rootLines.push(
          `    - [${record.title}](${toUrl(normalizedSiteUrl, record.markdownPath)})`,
        );
      }
    }
  }

  const rootIndex = buildIndexText(rootLines, siteTitle);
  const rootFull = buildFullText(siteTitle, normalizedRecords);
  artifacts.set("llms.txt", rootIndex);
  artifacts.set("llms-full.txt", rootFull);
  artifacts.set("llm.txt", rootIndex);
  artifacts.set("llm-full.txt", rootFull);

  // Component-level hierarchical indexes + full files.
  for (const component of sortedComponents) {
    const versions = [...(componentToVersions.get(component) || [])].sort((a, b) =>
      compareVersions(component, a, b, meta),
    );

    const componentLines = [];
    for (const version of versions) {
      const versionPath = version ? `${component}/${version}/llms.txt` : `${component}/llms.txt`;
      componentLines.push(
        `- [${versionLabel(component, version, meta)}](${toUrl(normalizedSiteUrl, versionPath)})`,
      );
      const versionKey = `${component}::${version}`;
      const versionRecords = sortRecords(byComponentVersion.get(versionKey) || []);
      for (const record of versionRecords) {
        componentLines.push(
          `  - [${record.title}](${toUrl(normalizedSiteUrl, record.markdownPath)})`,
        );
      }
    }

    artifacts.set(
      `${component}/llms.txt`,
      buildIndexText(
        componentLines,
        componentTitle(component, meta),
        mergedComponentDescriptions.get(component) || "",
      ),
    );
    artifacts.set(
      `${component}/llms-full.txt`,
      buildFullText(
        componentTitle(component, meta),
        byComponent.get(component) || [],
        mergedComponentDescriptions.get(component) || "",
      ),
    );
  }

  // Version-level indexes + full files.
  for (const [key, versionRecords] of byComponentVersion.entries()) {
    const [component, version] = key.split("::");
    if (!version) continue; // Unversioned content already lives at component scope.

    const versionLines = sortRecords(versionRecords).map(
      (record) => `- [${record.title}](${toUrl(normalizedSiteUrl, record.markdownPath)})`,
    );
    const versionTitle = `${componentTitle(component, meta)} ${versionLabel(component, version, meta)}`;

    artifacts.set(
      `${component}/${version}/llms.txt`,
      buildIndexText(
        versionLines,
        versionTitle,
        mergedComponentDescriptions.get(component) || "",
      ),
    );
    artifacts.set(
      `${component}/${version}/llms-full.txt`,
      buildFullText(
        versionTitle,
        versionRecords,
        mergedComponentDescriptions.get(component) || "",
      ),
    );
  }

  return artifacts;
}

module.exports.register = function register(context, vars) {
  const config = vars?.config || {};
  const logger = context.getLogger("antora-llm-generator");
  const { playbook } = context.getVariables();
  const siteTitle = playbook.site?.title || "Documentation";
  const siteUrl = playbook.site?.url?.replace(/\/$/, "") || "";

  const skipPaths = Array.isArray(config.skippaths) ? config.skippaths : [];
  const shouldSkipPath = (path) =>
    skipPaths.some((pattern) => minimatch(path, pattern));

  context.on("beforeProcess", () => {
    const { siteAsciiDocConfig = {} } = context.getVariables();
    if (!siteAsciiDocConfig.keepSource) {
      context.updateVariables({
        siteAsciiDocConfig: { ...siteAsciiDocConfig, keepSource: true },
      });
    }
  });

  logger.info(`Configured skip paths: ${JSON.stringify(skipPaths)}`);

  context.on("navigationBuilt", ({ contentCatalog, siteCatalog }) => {
    logger.info("Assembling content for LLM text files.");

    const emittedMarkdownPaths = new Set();
    const componentDescriptions = new Map();
    const records = [];
    const pages = contentCatalog.findBy({ family: "page" });

    for (const page of pages) {
      if (!page.out) continue;

      if (shouldSkipPath(page.out.path)) {
        logger.debug(`Skipping page matching skip pattern: ${page.out.path}`);
        continue;
      }

      if (page.asciidoc.attributes["page-llms-ignore"]) {
        logger.debug(
          `Skipping page with 'page-llms-ignore' attribute: ${page.src.path}`,
        );
        continue;
      }

      const source = page.src?.contents;
      if (!source) {
        logger.debug(`Skipping page with unavailable source: ${page.src.path}`);
        continue;
      }

      const markdown = downdoc(toString(source)).trim();
      if (!markdown) {
        logger.debug(`Skipping page with empty markdown output: ${page.src.path}`);
        continue;
      }

      const markdownPath = toMarkdownPath(page.out.path);

      if (!emittedMarkdownPaths.has(markdownPath)) {
        siteCatalog.addFile({
          out: { path: markdownPath },
          contents: Buffer.from(`${markdown}\n`),
        });
        emittedMarkdownPaths.add(markdownPath);
      } else {
        logger.debug(`Skipping duplicate markdown output path: ${markdownPath}`);
      }

      records.push({
        component: page.src?.component || "ROOT",
        version: page.src?.version || "",
        title: page.title || "Untitled",
        markdownPath,
        markdown,
        includeInFull: !page.asciidoc.attributes["page-llms-full-ignore"],
      });

      const componentName = page.src?.component || "ROOT";
      if (componentName !== "ROOT" && !componentDescriptions.has(componentName)) {
        try {
          const description = readComponentDescriptionFromManifest(page);
          if (description) componentDescriptions.set(componentName, description);
        } catch (err) {
          logger.debug(
            `Unable to read manifest description for ${componentName}: ${err.message}`,
          );
        }
      }
    }

    const artifacts = generateLlmsArtifacts({
      siteTitle,
      siteUrl,
      componentInfos: contentCatalog.getComponents(),
      componentDescriptions,
      records,
    });

    for (const [path, content] of artifacts.entries()) {
      siteCatalog.addFile({
        out: { path },
        contents: Buffer.from(content),
      });
    }

    logger.info(`Generated ${artifacts.size} LLM text files.`);
  });
};

module.exports._test = {
  extractManifestDescription,
  generateLlmsArtifacts,
};
