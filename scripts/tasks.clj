#!/usr/bin/env bb

(ns tasks
  (:require [babashka.fs :as fs]
            [babashka.process :as p]
            [borkdude.rewrite-edn :as r]
            [clojure.string :as str]))

(def bb-tasks-dep 'outskirtslabs/bb-tasks)

(defn- normalize-branches
  [branches]
  (cond
    (nil? branches) ["HEAD"]
    (string? branches) [branches]
    (sequential? branches) (mapv str branches)
    :else ["HEAD"]))

(defn- normalize-git-url
  [url]
  (let [url (str/trim (str url))]
    (cond
      (str/blank? url)
      url

      (re-matches #"git@github\.com:([^/]+)/([^/]+?)(?:\.git)?$" url)
      (let [[_ owner repo] (re-matches #"git@github\.com:([^/]+)/([^/]+?)(?:\.git)?$" url)]
        (str "https://github.com/" owner "/" repo ".git"))

      (re-matches #"https://github\.com/([^/]+)/([^/]+?)(?:\.git)?/?$" url)
      (let [[_ owner repo] (re-matches #"https://github\.com/([^/]+)/([^/]+?)(?:\.git)?/?$" url)]
        (str "https://github.com/" owner "/" repo ".git"))

      :else
      url)))

(defn- remote-head-rev
  [url]
  (let [{:keys [out err exit]} (p/shell {:out :string :err :string :continue true}
                                        "git" "ls-remote" url "HEAD")
        line (some-> out str/trim str/split-lines first)
        rev (some-> line (str/split #"\s+") first str/trim)]
    (when-not (zero? exit)
      (throw (ex-info "Command failed: git ls-remote <url> HEAD"
                      {:url url :exit exit :err err})))
    (when-not (and rev (re-matches #"[0-9a-f]{40}" rev))
      (throw (ex-info "Could not parse HEAD revision from git ls-remote output"
                      {:url url :output out})))
    rev))

(defn- hash-mismatch-got
  [text]
  (let [re #"got:\s*(sha256-[A-Za-z0-9+/=]+)"]
    (some-> (re-find re text) second)))

(declare nix-string)

(defn- nix-source-hash-expr
  [url rev]
  (str "let\n"
       "  pkgs = import (builtins.getFlake \"nixpkgs\").outPath {};\n"
       "  repoUrl = " (nix-string url) ";\n"
       "in pkgs.fetchgit {\n"
       "  url = repoUrl;\n"
       "  rev = " (nix-string rev) ";\n"
       "  hash = " (nix-string "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=") ";\n"
       "  leaveDotGit = true;\n"
       "  deepClone = true;\n"
       "  fetchTags = true;\n"
       "  postFetch = ''\n"
       "    cd \"$out\"\n"
       "    ${pkgs.gitMinimal}/bin/git remote add origin ${repoUrl}\n"
       "    ${pkgs.gitMinimal}/bin/git fetch origin '+refs/heads/*:refs/heads/*'\n"
       "    rm -f .git/FETCH_HEAD\n"
       "    ${pkgs.gitMinimal}/bin/git reflog expire --expire=all --all || true\n"
       "    ${pkgs.gitMinimal}/bin/git repack -a -d -f --depth=50 --window=250\n"
       "    ${pkgs.gitMinimal}/bin/git prune-packed\n"
       "    find .git/objects -type f -name '*.keep' -delete\n"
       "    find .git/objects -type f -name '*.bitmap' -delete\n"
       "  '';\n"
       "}\n"))

(defn- prefetch-hash
  [url rev]
  (let [expr (nix-source-hash-expr url rev)
        {:keys [out err exit]} (p/shell {:out :string :err :string :continue true}
                                        "nix" "build" "--impure" "--no-link" "--expr" expr)
        combined (str out "\n" err)
        got-hash (hash-mismatch-got combined)]
    (if got-hash
      got-hash
      (throw (ex-info "Could not determine fetchgit hash"
                      {:url url
                       :rev rev
                       :exit exit
                       :out out
                       :err err})))))

(defn- prefetch-npm-deps-hash
  [lock-file]
  (let [{:keys [out err exit]} (p/shell {:out :string :err :string :continue true}
                                        "nix" "run" "nixpkgs#prefetch-npm-deps" "--" lock-file)
        hash (some-> out str/trim not-empty)]
    (when-not (zero? exit)
      (throw (ex-info "Command failed: prefetch-npm-deps" {:lock-file lock-file :exit exit :err err})))
    (when-not (and hash (str/starts-with? hash "sha256-"))
      (throw (ex-info "Unexpected prefetch-npm-deps output" {:lock-file lock-file :output out})))
    hash))

(defn- set-npm-deps-hash
  [nix-file npm-deps-hash]
  (let [content (slurp nix-file)
        pattern #"(?m)^(\s*npmDepsHash\s*=\s*\")([^\"]+)(\";\s*)$"
        matches (re-seq pattern content)]
    (when (empty? matches)
      (throw (ex-info "Could not find npmDepsHash in nix file" {:nix-file nix-file})))
    (when (> (count matches) 1)
      (throw (ex-info "Found multiple npmDepsHash entries in nix file" {:nix-file nix-file :count (count matches)})))
    (let [current-hash (nth (first matches) 2)
          updated-content (str/replace-first content pattern (str "$1" npm-deps-hash "$3"))]
      (when (not= content updated-content)
        (spit nix-file updated-content))
      {:updated? (not= current-hash npm-deps-hash)
       :current-hash current-hash
       :new-hash npm-deps-hash})))

(defn- body-field
  [body field]
  (some-> (re-find (re-pattern (str "(?m)^\\s*" field "\\s*=\\s*\"([^\"]+)\";")) body)
          second))

(defn- body-string-list
  [body field]
  (when-let [list-body (some-> (re-find (re-pattern (str "(?ms)^\\s*" field "\\s*=\\s*\\[(.*?)\\];")) body)
                               second)]
    (->> (re-seq #"\"([^\"]+)\"" list-body)
         (mapv second))))

(defn- parse-projects
  [docs-root]
  (let [projects-file (str (fs/path docs-root "pkgs" "projects.nix"))]
    (if-not (fs/exists? projects-file)
      {}
      (let [content (slurp projects-file)
            project-re #"(?ms)^\s*\"([^\"]+)\"\s*=\s*\{(.*?)^\s*\};"]
        (->> (re-seq project-re content)
             (map (fn [[_ key body]]
                    [key
                     {:url (some-> (body-field body "url") normalize-git-url)
                      :rev (body-field body "rev")
                      :hash (body-field body "hash")
                      :branches (normalize-branches (body-string-list body "branches"))
                      :start-path (or (body-field body "start_path") "doc")}]))
             (into {}))))))

(defn- nix-escape
  [s]
  (-> (str s)
      (str/replace "\\" "\\\\")
      (str/replace "\"" "\\\"")))

(defn- nix-string
  [s]
  (str "\"" (nix-escape s) "\""))

(defn- nix-string-list
  [xs]
  (str "[ " (str/join " " (map nix-string xs)) " ]"))

(defn- render-project
  [[project-name {:keys [url rev hash branches start-path]}]]
  (str "  " (nix-string project-name) " = {\n"
       "    url = " (nix-string url) ";\n"
       "    rev = " (nix-string rev) ";\n"
       "    hash = " (nix-string hash) ";\n"
       "    branches = " (nix-string-list branches) ";\n"
       "    start_path = " (nix-string start-path) ";\n"
       "  };"))

(defn- render-projects-nix
  [projects]
  (str "{\n"
       (str/join "\n\n"
                 (map render-project
                      (sort-by first projects)))
       "\n}\n"))

(defn update-projects
  "Update `pkgs/projects.nix` by polling each configured project URL's remote HEAD.

  Hashes are computed via the same `fetchgit` + `postFetch` pipeline used by
  `pkgs/docs-site.nix` (inside `prefetch-hash`), not plain `nix-prefetch-git`.
  We intentionally normalize `.git` internals there (`rm .git/FETCH_HEAD`,
  expire reflogs, repack/prune, remove volatile `*.bitmap`/`*.keep`) because
  `leaveDotGit = true` makes `.git` part of the fixed-output hash and those
  files can otherwise vary across runs/machines.

  Performance: when a project's remote HEAD `rev` is unchanged, we reuse the
  existing hash from `pkgs/projects.nix` instead of recomputing it."
  []
  (let [docs-root (str (fs/absolutize "."))
        existing-projects (parse-projects docs-root)
        projects (->> existing-projects
                      (map (fn [[project-name {:keys [url rev hash branches start-path]}]]
                             (when (str/blank? url)
                               (throw (ex-info "Project entry is missing required url"
                                               {:project project-name})))
                             (let [remote-url (normalize-git-url url)
                                   latest-rev (remote-head-rev remote-url)
                                   latest-hash (if (and (= latest-rev rev)
                                                        (not (str/blank? hash)))
                                                 hash
                                                 (prefetch-hash remote-url latest-rev))]
                               [project-name
                                {:url remote-url
                                 :rev latest-rev
                                 :hash latest-hash
                                 :branches branches
                                 :start-path start-path}])))
                      (into {}))
        out-file (str (fs/path docs-root "pkgs" "projects.nix"))]
    (when (empty? existing-projects)
      (throw (ex-info "Refusing to update: no projects were parsed from pkgs/projects.nix"
                      {:file out-file})))
    (spit out-file (render-projects-nix projects))
    (println "Updated" out-file "with" (count projects) "projects.")))

(defn- local-head-rev
  [repo-dir]
  (let [repo-dir (str (fs/absolutize repo-dir))
        {:keys [out err exit]} (p/shell {:out :string :err :string :continue true}
                                        "git" "-C" repo-dir "rev-parse" "HEAD")
        rev (some-> out str/trim)]
    (when-not (zero? exit)
      (throw (ex-info "Command failed: git rev-parse HEAD"
                      {:repo-dir repo-dir :exit exit :err err})))
    (when-not (and rev (re-matches #"[0-9a-f]{40}" rev))
      (throw (ex-info "Could not parse local HEAD revision"
                      {:repo-dir repo-dir :output out})))
    rev))

(defn- update-bb-edn-bb-tasks-sha
  [bb-edn-file target-sha]
  (let [bb-edn-file (str (fs/absolutize bb-edn-file))]
    (when-not (fs/exists? bb-edn-file)
      (throw (ex-info "bb.edn file does not exist" {:file bb-edn-file})))
    (let [content (slurp bb-edn-file)
          root (r/parse-string content)
          data (r/sexpr root)
          dep (get-in data [:deps bb-tasks-dep])]
      (when-not (map? dep)
        (throw (ex-info "Could not find outskirtslabs/bb-tasks dep in bb.edn"
                        {:file bb-edn-file :dep bb-tasks-dep})))
      (let [current-sha (:git/sha dep)
            updated? (not= current-sha target-sha)]
        (when updated?
          (spit bb-edn-file
                (str (r/assoc-in root [:deps bb-tasks-dep :git/sha] target-sha))))
        {:file bb-edn-file
         :updated? updated?
         :old-sha current-sha
         :new-sha target-sha}))))

(defn update-bb-tasks-sha
  "Update `:git/sha` for the `outskirtslabs/bb-tasks` dep in one or more
  project `bb.edn` files to match local `../bb-tasks` HEAD.

  Usage: bb bb-tasks:sha ../client-ip/bb.edn ../h2o-zig/bb.edn"
  [& bb-edn-files]
  (when (empty? bb-edn-files)
    (throw (ex-info "Expected at least one bb.edn path. Usage: bb bb-tasks:sha <path/to/bb.edn> ..."
                    {})))
  (let [target-sha (local-head-rev "../bb-tasks")
        results (mapv #(update-bb-edn-bb-tasks-sha % target-sha) bb-edn-files)
        updated-count (count (filter :updated? results))]
    (doseq [{:keys [file updated? old-sha new-sha]} results]
      (if updated?
        (println "Updated" file "from" (or old-sha "<none>") "to" new-sha)
        (println "Already up to date:" file "=>" new-sha)))
    (println "Updated" updated-count "of" (count results) "file(s).")))

(defn dist-prepare
  []
  (let [docs-root (str (fs/absolutize "."))
        lock-file (str (fs/path docs-root "package-lock.json"))
        nix-file (str (fs/path docs-root "pkgs" "docs-site.nix"))]
    (when-not (fs/exists? lock-file)
      (throw (ex-info "Missing package-lock.json" {:file lock-file})))
    (when-not (fs/exists? nix-file)
      (throw (ex-info "Missing pkgs/docs-site.nix" {:file nix-file})))
    (let [npm-deps-hash (prefetch-npm-deps-hash lock-file)
          {:keys [updated? current-hash new-hash]} (set-npm-deps-hash nix-file npm-deps-hash)]
      (if updated?
        (println "Updated" nix-file "npmDepsHash from" current-hash "to" new-hash)
        (println "npmDepsHash already up to date in" nix-file "=>" new-hash)))))
