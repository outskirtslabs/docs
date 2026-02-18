#!/usr/bin/env bb

(ns tasks
  (:require [babashka.fs :as fs]
            [babashka.process :as p]
            [clj-yaml.core :as yaml]
            [clojure.string :as str]))

(defn- warn!
  [msg]
  (binding [*out* *err*]
    (println (str "WARN: " msg))))

(defn- map-get
  [m k]
  (or (get m k) (get m (name k))))

(defn- normalize-branches
  [branches]
  (cond
    (nil? branches) ["HEAD"]
    (string? branches) [branches]
    (sequential? branches) (mapv str branches)
    :else ["HEAD"]))

(defn- parse-playbook-sources
  [docs-root]
  (let [playbook-file (str (fs/path docs-root "playbook.yml"))
        playbook (yaml/parse-string (slurp playbook-file))
        sources (or (get-in playbook [:content :sources]) [])]
    (->> sources
         (map (fn [source]
                {:url (map-get source :url)
                 :start-path (or (map-get source :start_path) "doc")
                 :branches (normalize-branches (map-get source :branches))}))
         (remove #(= "." (:url %))))))

(defn- local-source->repo-root
  [docs-root url]
  (cond
    (str/includes? url "://")
    nil

    (str/starts-with? url "/")
    (str (fs/absolutize url))

    :else
    (str (fs/absolutize (fs/path docs-root url)))))

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

(defn- repo-remote-url
  [repo-root]
  (let [{:keys [out exit]} (p/shell {:out :string :err :string :continue true}
                                    "git" "-C" repo-root "remote" "get-url" "upstream")
        upstream (when (zero? exit) (not-empty (str/trim out)))
        {:keys [out exit]} (p/shell {:out :string :err :string :continue true}
                                    "git" "-C" repo-root "remote" "get-url" "origin")
        origin (when (zero? exit) (not-empty (str/trim out)))]
    (normalize-git-url (or upstream origin ""))))

(defn- repo-rev
  [repo-root]
  (let [{:keys [out err exit]} (p/shell {:out :string :err :string :continue true}
                                        "git" "-C" repo-root "rev-parse" "HEAD")]
    (if (zero? exit)
      (str/trim out)
      (throw (ex-info "Command failed: git rev-parse HEAD" {:repo-root repo-root :exit exit :err err})))))

(defn- antora-component-name
  [repo-root start-path]
  (let [antora-file (str (fs/path repo-root start-path "antora.yml"))]
    (when (fs/exists? antora-file)
      (some-> (yaml/parse-string (slurp antora-file))
              (map-get :name)
              str
              str/trim
              not-empty))))

(defn- repo-fallback-name
  [repo-root]
  (str (fs/file-name repo-root)))

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

(defn- existing-projects-by-url
  [docs-root]
  (let [projects-file (str (fs/path docs-root "pkgs" "projects.nix"))]
    (if-not (fs/exists? projects-file)
      {}
      (let [content (slurp projects-file)
            project-re #"(?ms)^\s*\"([^\"]+)\"\s*=\s*\{(.*?)^\s*\};"]
        (->> (re-seq project-re content)
             (keep (fn [[_ key body]]
                     (let [url (body-field body "url")
                           rev (body-field body "rev")
                           hash (body-field body "hash")]
                       (when (and url rev hash)
                         [(normalize-git-url url)
                          {:key key
                           :rev rev
                           :hash hash}]))))
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
  "Update `pkgs/projects.nix` from local playbook sources.

  Hashes are computed via the same `fetchgit` + `postFetch` pipeline used by
  `pkgs/docs-site.nix` (inside `prefetch-hash`), not plain `nix-prefetch-git`.
  We intentionally normalize `.git` internals there (`rm .git/FETCH_HEAD`,
  expire reflogs, repack/prune, remove volatile `*.bitmap`/`*.keep`) because
  `leaveDotGit = true` makes `.git` part of the fixed-output hash and those
  files can otherwise vary across runs/machines.

  Performance: when a project's `rev` is unchanged, we reuse the existing hash
  from `pkgs/projects.nix` instead of recomputing it."
  []
  (let [docs-root (str (fs/absolutize "."))
        existing-by-url (existing-projects-by-url docs-root)
        sources (parse-playbook-sources docs-root)
        projects (->> sources
                      (map (fn [{:keys [url start-path branches]}]
                             (let [repo-root (local-source->repo-root docs-root url)]
                               (cond
                                 (nil? repo-root)
                                 (do
                                   (warn! (format "Skipping remote source %s" url))
                                   nil)

                                 (not (fs/exists? repo-root))
                                 (do
                                   (warn! (format "Skipping missing source directory %s" repo-root))
                                   nil)

                                 :else
                                 (let [remote-url (repo-remote-url repo-root)]
                                   (when (str/blank? remote-url)
                                     (throw (ex-info "Could not determine git remote URL"
                                                     {:repo-root repo-root :source-url url})))
                                   (let [existing (get existing-by-url remote-url)
                                         rev (repo-rev repo-root)
                                         hash (if (and (= rev (:rev existing))
                                                       (not (str/blank? (:hash existing))))
                                                (:hash existing)
                                                (prefetch-hash remote-url rev))
                                         component-name (antora-component-name repo-root start-path)
                                         project-name (or (:key existing)
                                                          component-name
                                                          (repo-fallback-name repo-root))]
                                     [project-name
                                      {:url remote-url
                                       :rev rev
                                       :hash hash
                                       :branches branches
                                       :start-path start-path}]))))))
                      (remove nil?)
                      (into {}))
        out-file (str (fs/path docs-root "pkgs" "projects.nix"))]
    (spit out-file (render-projects-nix projects))
    (println "Updated" out-file "with" (count projects) "projects.")))

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
