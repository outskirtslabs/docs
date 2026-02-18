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

(defn- json-field
  [json k]
  (some-> (re-find (re-pattern (str "\"" (java.util.regex.Pattern/quote k) "\"\\s*:\\s*\"([^\"]+)\"")) json)
          second))

(defn- prefetch-hash
  [url rev]
  (let [{:keys [out err exit]} (p/shell {:out :string :err :string :continue true}
                                        "nix" "run" "nixpkgs#nix-prefetch-git" "--"
                                        "--url" url
                                        "--rev" rev
                                        "--deepClone"
                                        "--leave-dotGit"
                                        "--fetch-tags"
                                        "--quiet")
        hash (json-field out "hash")]
    (when-not (zero? exit)
      (throw (ex-info "Command failed: nix-prefetch-git" {:url url :rev rev :exit exit :err err})))
    (when-not hash
      (throw (ex-info "Could not parse hash from nix-prefetch-git output" {:url url :rev rev :output out})))
    hash))

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

(defn update-projects!
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

(defn update-projects
  []
  (update-projects!))
