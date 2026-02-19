"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { _test } = require("./antora-llm-generator");

test("generates hierarchical llms indexes for root and component scopes", () => {
  const artifacts = _test.generateLlmsArtifacts({
    siteTitle: "Outskirts Labs Docs",
    siteUrl: "http://localhost:8084",
    componentDescriptions: new Map([["ol.client-ip", "Read client IPs from requests."]]),
    componentInfos: [
      {
        name: "ol.client-ip",
        title: "client-ip",
        versions: [
          { version: "next", displayVersion: "next" },
          { version: "0.1", displayVersion: "0.1" },
        ],
      },
      {
        name: "ol.sfv",
        title: "ol.sfv",
        versions: [{ version: "0.1", displayVersion: "0.1" }],
      },
    ],
    records: [
      {
        component: "ROOT",
        version: "",
        title: "Outskirts Labs Developer Docs",
        markdownPath: "index.md",
        markdown: "# Home",
        includeInFull: true,
      },
      {
        component: "ROOT",
        version: "",
        title: "Security Policy",
        markdownPath: "security-policy.md",
        markdown: "# Security",
        includeInFull: true,
      },
      {
        component: "ol.client-ip",
        version: "next",
        title: "client-ip",
        markdownPath: "ol.client-ip/next/index.md",
        markdown: "# next",
        includeInFull: true,
      },
      {
        component: "ol.client-ip",
        version: "next",
        title: "Usage Guide",
        markdownPath: "ol.client-ip/next/usage.md",
        markdown: "# usage next",
        includeInFull: true,
      },
      {
        component: "ol.client-ip",
        version: "0.1",
        title: "client-ip",
        markdownPath: "ol.client-ip/0.1/index.md",
        markdown: "# release",
        includeInFull: true,
      },
      {
        component: "ol.sfv",
        version: "0.1",
        title: "ol.sfv",
        markdownPath: "ol.sfv/0.1/index.md",
        markdown: "# sfv",
        includeInFull: true,
      },
    ],
  });

  const rootIndex = artifacts.get("llms.txt");
  assert.ok(rootIndex);
  assert.match(rootIndex, /- \[Outskirts Labs Developer Docs\]\(http:\/\/localhost:8084\/index\.md\)/);
  assert.match(rootIndex, /- \[client-ip\]\(http:\/\/localhost:8084\/ol\.client-ip\/llms\.txt\)/);
  assert.match(rootIndex, /  - \[next\]\(http:\/\/localhost:8084\/ol\.client-ip\/next\/llms\.txt\)/);
  assert.match(rootIndex, /    - \[Usage Guide\]\(http:\/\/localhost:8084\/ol\.client-ip\/next\/usage\.md\)/);

  const componentIndex = artifacts.get("ol.client-ip/llms.txt");
  assert.ok(componentIndex);
  assert.match(componentIndex, /# client-ip\n\nRead client IPs from requests\.\n\n/);
  assert.match(componentIndex, /- \[0\.1\]\(http:\/\/localhost:8084\/ol\.client-ip\/0\.1\/llms\.txt\)/);
  assert.match(componentIndex, /  - \[client-ip\]\(http:\/\/localhost:8084\/ol\.client-ip\/0\.1\/index\.md\)/);

  const versionIndex = artifacts.get("ol.client-ip/0.1/llms.txt");
  assert.ok(versionIndex);
  assert.match(versionIndex, /# client-ip 0\.1\n\nRead client IPs from requests\.\n\n/);
  assert.match(versionIndex, /- \[client-ip\]\(http:\/\/localhost:8084\/ol\.client-ip\/0\.1\/index\.md\)/);
});

test("extracts project description from manifest.edn", () => {
  const manifest = `{:manifest/version 1
 :project {:id "h2o-zig"
           :description "libh2o packaged for Zig with cross-compilation support for Linux and macOS"}
 :docs {:component "h2o-zig"}}`;

  assert.equal(
    _test.extractManifestDescription(manifest),
    "libh2o packaged for Zig with cross-compilation support for Linux and macOS",
  );
});

test("generates llms-full per scope and honors includeInFull", () => {
  const artifacts = _test.generateLlmsArtifacts({
    siteTitle: "Docs",
    siteUrl: "",
    componentDescriptions: new Map([["ol.client-ip", "short desc"]]),
    componentInfos: [
      {
        name: "ol.client-ip",
        title: "client-ip",
        versions: [{ version: "0.1", displayVersion: "0.1" }],
      },
    ],
    records: [
      {
        component: "ol.client-ip",
        version: "0.1",
        title: "Visible",
        markdownPath: "ol.client-ip/0.1/index.md",
        markdown: "visible body",
        includeInFull: true,
      },
      {
        component: "ol.client-ip",
        version: "0.1",
        title: "Index only",
        markdownPath: "ol.client-ip/0.1/usage.md",
        markdown: "hidden body",
        includeInFull: false,
      },
    ],
  });

  const rootFull = artifacts.get("llms-full.txt");
  const componentFull = artifacts.get("ol.client-ip/llms-full.txt");
  const versionFull = artifacts.get("ol.client-ip/0.1/llms-full.txt");

  assert.ok(rootFull);
  assert.ok(componentFull);
  assert.ok(versionFull);

  assert.match(rootFull, /visible body/);
  assert.doesNotMatch(rootFull, /hidden body/);
  assert.match(componentFull, /# client-ip\n\nshort desc\n\n/);
  assert.match(componentFull, /visible body/);
  assert.doesNotMatch(componentFull, /hidden body/);
  assert.match(versionFull, /# client-ip 0\.1\n\nshort desc\n\n/);
  assert.match(versionFull, /visible body/);
  assert.doesNotMatch(versionFull, /hidden body/);
});
