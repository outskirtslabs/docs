"use strict";

const downdoc = require("downdoc");
const { minimatch } = require("minimatch");

module.exports.register = function register(context, vars) {
  const config = vars?.config || {};
  const logger = context.getLogger("antora-llm-generator");
  const { playbook } = context.getVariables();
  const siteTitle = playbook.site?.title || "Documentation";
  const siteUrl = playbook.site?.url?.replace(/\/$/, "") || "";

  const skipPaths = Array.isArray(config.skippaths) ? config.skippaths : [];

  const shouldSkipPath = (path) =>
    skipPaths.some((pattern) => minimatch(path, pattern));

  const toMarkdownPath = (outPath) =>
    outPath.endsWith(".html") ? `${outPath.slice(0, -5)}.md` : `${outPath}.md`;

  const toString = (value) => {
    if (typeof value === "string") return value;
    if (Buffer.isBuffer(value)) return value.toString();
    return "";
  };

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

    let indexContent = `# ${siteTitle}\n\n`;
    let fullContent = "";
    const emittedMarkdownPaths = new Set();
    const pages = contentCatalog.findBy({ family: "page" });

    for (const page of pages) {
      if (!page.out) continue;

      if (shouldSkipPath(page.out.path)) {
        logger.warn(`Skipping page matching skip pattern: ${page.out.path}`);
        continue;
      }

      if (page.asciidoc.attributes["page-llms-ignore"]) {
        logger.warn(
          `Skipping page with 'page-llms-ignore' attribute: ${page.src.path}`,
        );
        continue;
      }

      const pageTitle = page.title || "Untitled";
      const source = page.src?.contents;
      if (!source) {
        logger.warn(`Skipping page with unavailable source: ${page.src.path}`);
        continue;
      }

      const markdown = downdoc(toString(source)).trim();
      if (!markdown) {
        logger.warn(`Skipping page with empty markdown output: ${page.src.path}`);
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
        logger.warn(`Skipping duplicate markdown output path: ${markdownPath}`);
      }

      const pageUrl = siteUrl ? `${siteUrl}/${markdownPath}` : `/${markdownPath}`;
      indexContent += `\n- [${pageTitle}](${pageUrl})`;

      if (page.asciidoc.attributes["page-llms-full-ignore"]) {
        logger.warn(
          `Skipping page with 'page-llms-full-ignore' attribute: ${page.src.path}`,
        );
        continue;
      }

      fullContent += `\n\n${markdown}`;
    }

    siteCatalog.addFile({
      out: { path: "llms-full.txt" },
      contents: Buffer.from(fullContent),
    });

    siteCatalog.addFile({
      out: { path: "llm-full.txt" },
      contents: Buffer.from(fullContent),
    });

    siteCatalog.addFile({
      out: { path: "llm.txt" },
      contents: Buffer.from(indexContent),
    });

    siteCatalog.addFile({
      out: { path: "llms.txt" },
      contents: Buffer.from(indexContent),
    });

    logger.info("llm.txt and llm-full.txt have been generated.");
  });
};
