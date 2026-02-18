#!/usr/bin/env bb

(ns setup-webhook
  (:require [babashka.fs :as fs]
            [babashka.process :as p]
            [clojure.string :as str]))

(def default-webhook-url "https://docs.outskirtslabs.com/_deploy/update-docs")
(def default-webhook-event "push")

(defn- setup-usage []
  (str
   "Usage: bb webhook:setup [owner/repo]\n\n"
   "Create or update the docs webhook for a GitHub repository.\n\n"
   "Environment:\n"
   "  WEBHOOK_SECRET    Required. Secret used for webhook signing.\n"
   "  WEBHOOK_URL       Optional. Default: " default-webhook-url "\n"
   "  WEBHOOK_EVENT     Optional. Default: " default-webhook-event "\n"
   "  SEND_PING         Optional. Default: 1 (set 0/false/no to skip)\n\n"
   "If owner/repo is omitted, the script tries to infer it from git remotes\n"
   "in the current directory (prefers upstream, then origin).\n"))

(defn- remove-usage []
  (str
   "Usage: bb webhook:remove [owner/repo]\n\n"
   "Delete docs webhook(s) for a GitHub repository.\n\n"
   "Environment:\n"
   "  WEBHOOK_URL       Optional. Default: " default-webhook-url "\n\n"
   "If owner/repo is omitted, the script tries to infer it from git remotes\n"
   "in the current directory (prefers upstream, then origin).\n"))

(defn- fail
  [msg & [data]]
  (throw (ex-info msg (or data {}))))

(defn- run-cmd
  [& argv]
  (apply p/shell (concat [{:out :string :err :string :continue true}] argv)))

(defn- run-cmd-checked
  [& argv]
  (let [{:keys [out err exit]} (apply run-cmd argv)]
    (when-not (zero? exit)
      (fail (format "Command failed: %s" (str/join " " argv))
            {:argv argv :exit exit :out out :err err}))
    {:out out :err err :exit exit}))

(defn- parse-repo-from-remote
  [remote-url]
  (cond
    (nil? remote-url) nil
    (str/blank? remote-url) nil

    (re-matches #"git@github\.com:([^/]+)/([^/]+?)(?:\.git)?$" remote-url)
    (let [[_ owner repo] (re-matches #"git@github\.com:([^/]+)/([^/]+?)(?:\.git)?$" remote-url)]
      (str owner "/" repo))

    (re-matches #"https://github\.com/([^/]+)/([^/]+?)(?:\.git)?/?$" remote-url)
    (let [[_ owner repo] (re-matches #"https://github\.com/([^/]+)/([^/]+?)(?:\.git)?/?$" remote-url)]
      (str owner "/" repo))

    :else nil))

(defn- infer-repo-from-git
  []
  (let [repo-root (fs/absolutize ".")
        git-dir (fs/path repo-root ".git")]
    (when-not (fs/exists? git-dir)
      (fail "Current directory is not a git repository" {:path (str repo-root)}))
    (let [remote-url (some identity
                           (for [remote ["upstream" "origin"]]
                             (let [{:keys [out exit]} (run-cmd "git" "remote" "get-url" remote)]
                               (when (zero? exit) (str/trim out)))))
          repo (parse-repo-from-remote remote-url)]
      (when (nil? repo)
        (fail "Could not infer owner/repo from git remote"
              {:remote-url remote-url :path (str repo-root)}))
      repo)))

(defn- normalize-repo
  [repo]
  (let [repo (str/trim (str repo))]
    (cond
      (str/blank? repo)
      (infer-repo-from-git)

      (re-matches #"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+" repo)
      repo

      :else
      (or (parse-repo-from-remote repo)
          (fail "Invalid repository format" {:repo repo})))))

(defn- env-bool
  [k default]
  (let [v (some-> (System/getenv k) str/trim str/lower-case)]
    (cond
      (nil? v) default
      (contains? #{"0" "false" "no"} v) false
      (contains? #{"1" "true" "yes"} v) true
      :else default)))

(defn- webhook-payload-argv
  [webhook-url webhook-event webhook-secret]
  ["-f" "name=web"
   "-F" "active=true"
   "-F" (str "events[]=" webhook-event)
   "-f" (str "config[url]=" webhook-url)
   "-f" "config[content_type]=json"
   "-f" (str "config[secret]=" webhook-secret)
   "-f" "config[insecure_ssl]=0"])

(defn- matching-hook-ids
  [repo webhook-url]
  (let [hook-lines (-> (:out (run-cmd-checked "gh" "api" (str "repos/" repo "/hooks?per_page=100")
                                              "--jq" ".[] | select(.name==\"web\") | \"\\(.id)\\t\\(.config.url)\""))
                       str/split-lines)]
    (->> hook-lines
         (remove str/blank?)
         (keep (fn [line]
                 (let [[hook-id existing-url] (str/split line #"\t" 2)]
                   (when (= existing-url webhook-url)
                     hook-id))))
         vec)))

(defn setup
  [& args]
  (let [arg (first args)]
    (when (or (= arg "-h") (= arg "--help"))
      (println (setup-usage))
      (System/exit 0))
    (when (> (count args) 1)
      (fail "Expected at most one argument: owner/repo" {:args args}))
    (run-cmd-checked "gh" "--version")
    (let [repo (normalize-repo (or arg ""))
          webhook-secret (or (System/getenv "WEBHOOK_SECRET")
                             (fail "WEBHOOK_SECRET is required"))
          webhook-url (or (System/getenv "WEBHOOK_URL") default-webhook-url)
          webhook-event (or (System/getenv "WEBHOOK_EVENT") default-webhook-event)
          send-ping? (env-bool "SEND_PING" true)
          matches (matching-hook-ids repo webhook-url)]
      (when (> (count matches) 1)
        (fail "Multiple matching hooks found for repository and URL"
              {:repo repo :webhook-url webhook-url :hook-ids matches}))
      (let [hook-id (if (= 1 (count matches))
                      (let [hook-id (first matches)]
                        (apply run-cmd-checked (concat ["gh" "api" "--method" "PATCH"
                                                        (str "repos/" repo "/hooks/" hook-id)]
                                                       (webhook-payload-argv webhook-url webhook-event webhook-secret)))
                        hook-id)
                      (-> (:out (apply run-cmd-checked (concat ["gh" "api" "--method" "POST"
                                                                (str "repos/" repo "/hooks")]
                                                               (webhook-payload-argv webhook-url webhook-event webhook-secret)
                                                               ["--jq" ".id"])))
                          str/trim))
            action (if (= 1 (count matches)) "updated" "created")]
        (println (format "%s webhook %s for %s" action hook-id repo))
        (println (format "url: %s" webhook-url))
        (println (format "event: %s" webhook-event))
        (when send-ping?
          (run-cmd-checked "gh" "api" "--method" "POST" (str "repos/" repo "/hooks/" hook-id "/pings"))
          (println "ping sent"))))))

(defn remove-webhook
  [& args]
  (let [arg (first args)]
    (when (or (= arg "-h") (= arg "--help"))
      (println (remove-usage))
      (System/exit 0))
    (when (> (count args) 1)
      (fail "Expected at most one argument: owner/repo" {:args args}))
    (run-cmd-checked "gh" "--version")
    (let [repo (normalize-repo (or arg ""))
          webhook-url (or (System/getenv "WEBHOOK_URL") default-webhook-url)
          matches (matching-hook-ids repo webhook-url)]
      (if (empty? matches)
        (println (format "no matching webhook found for %s at %s" repo webhook-url))
        (do
          (doseq [hook-id matches]
            (run-cmd-checked "gh" "api" "--method" "DELETE" (str "repos/" repo "/hooks/" hook-id))
            (println (format "removed webhook %s for %s" hook-id repo)))
          (println (format "url: %s" webhook-url)))))))
