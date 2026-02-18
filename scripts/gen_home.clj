#!/usr/bin/env bb

(ns gen-home
  (:require [babashka.fs :as fs]
            [babashka.process :as p]
            [clojure.edn :as edn]
            [clojure.string :as str]))

(defn- warn!
  [msg]
  (binding [*out* *err*]
    (println (str "WARN: " msg))))

(defn- run!
  ([cmd] (run! {} cmd))
  ([opts cmd]
   (let [{:keys [out err exit]} (p/shell (merge {:out :string :err :string :continue true} opts) cmd)]
     (if (zero? exit)
       out
       (throw (ex-info (str "Command failed: " cmd) {:cmd cmd :exit exit :err err}))))))

(defn- run-lines!
  ([cmd] (run-lines! {} cmd))
  ([opts cmd]
   (->> (run! opts cmd)
        str/split-lines
        (remove str/blank?))))

(defn- html-escape
  [s]
  (-> (str s)
      (str/replace "&" "&amp;")
      (str/replace "<" "&lt;")
      (str/replace ">" "&gt;")
      (str/replace "\"" "&quot;")))

(defn- parse-playbook-sources
  [docs-root]
  (let [playbook-file (str (fs/path docs-root "playbook.yml"))
        rows (run-lines! (str "yq -r '.content.sources[] | [.url, (.start_path // \"doc\")] | @tsv' " playbook-file))]
    (->> rows
         (map (fn [line]
                (let [[url start-path] (str/split line #"\t" 2)]
                  {:url url
                   :start-path (or start-path "doc")})))
         (remove #(= "." (:url %))))))

(defn- resolve-local-repo
  [docs-root {:keys [url]}]
  (cond
    (str/includes? url "://")
    nil

    (str/starts-with? url "/")
    (str (fs/absolutize url))

    :else
    (str (fs/absolutize (fs/path docs-root url)))))

(defn- load-manifest
  [manifest-file]
  (when (fs/exists? manifest-file)
    (edn/read-string (slurp manifest-file))))

(defn- valid-project?
  [manifest]
  (and (string? (get-in manifest [:docs :component]))
       (string? (get-in manifest [:docs :title]))
       (string? (get-in manifest [:project :description]))
       (vector? (get-in manifest [:project :platforms]))
       (string? (get-in manifest [:project :created]))
       (keyword? (get-in manifest [:project :status]))))

(defn- valid-iso-date?
  [s]
  (try
    (java.time.LocalDate/parse s)
    true
    (catch Exception _
      false)))

(defn- tag->semver
  [tag]
  (when-let [[_ major minor patch] (re-matches #"v(\d+)\.(\d+)\.(\d+)" tag)]
    {:major (parse-long major)
     :minor (parse-long minor)
     :patch (parse-long patch)}))

(defn- release-branch-exists?
  [repo-root major minor]
  (let [branch (format "v%d.%d.x" major minor)
        local-exit (:exit (p/shell {:continue true}
                                   "git" "-C" repo-root "show-ref" "--verify" "--quiet"
                                   (str "refs/heads/" branch)))]
    (zero? local-exit)))

(defn- collect-tagged-releases
  [repo-root component display-name]
  (let [tags (run-lines! (str "git -C " repo-root " tag --list 'v*'"))]
    (->> tags
         (map (fn [tag]
                (when-let [{:keys [major minor patch]} (tag->semver tag)]
                  (if (release-branch-exists? repo-root major minor)
                    {:date (str/trim (run! (str "git -C " repo-root " log -1 --format=%cs " tag)))
                     :name display-name
                     :component component
                     :version tag
                     :major major
                     :minor minor
                     :patch patch
                     :url (format "../%s/%d.%d/" component major minor)}
                    (do
                      (warn! (format "Skipping %s %s because branch v%d.%d.x is missing"
                                     component tag major minor))
                      nil)))))
         (remove nil?))))

(defn- collect-releases
  [{:keys [repo-root component name status created]}]
  (let [tagged (collect-tagged-releases repo-root component name)]
    (if (seq tagged)
      tagged
      (if (and (contains? #{:experimental :maturing :static} status)
               (valid-iso-date? created))
        [{:date created
          :name name
          :component component
          :version (clojure.core/name status)
          :major -1
          :minor -1
          :patch -1
          :url (format "../%s/next/" component)}]
        []))))

(defn- tagged-release?
  [release]
  (boolean (re-matches #"v\d+\.\d+\.\d+" (:version release))))

(defn- latest-tagged-release
  [releases component]
  (->> releases
       (filter #(= component (:component %)))
       (filter tagged-release?)
       (sort (fn [a b]
               (let [v1 [(:major a) (:minor a) (:patch a)]
                     v2 [(:major b) (:minor b) (:patch b)]]
                 (compare v2 v1))))
       first))

(defn- parse-github-repo
  [repo-url]
  (when (string? repo-url)
    (or (when-let [[_ owner repo] (re-matches #"https://github\.com/([^/]+)/([^/]+?)(?:\.git)?/?$" (str/trim repo-url))]
          {:owner owner :repo repo})
        (when-let [[_ owner repo] (re-matches #"git@github\.com:([^/]+)/([^/]+?)(?:\.git)?$" (str/trim repo-url))]
          {:owner owner :repo repo}))))

(defn- url-http-status
  [url]
  (try
    (let [{:keys [out exit]} (p/shell {:continue true :out :string :err :string}
                                      "curl" "-L" "-s" "-o" "/dev/null" "-w" "%{http_code}" url)]
      (when (zero? exit)
        (str/trim out)))
    (catch Exception e
      (warn! (format "Could not check URL %s (%s)" url (.getMessage e)))
      nil)))

(def release-url-exists?
  (memoize (fn [url]
             (= "200" (url-http-status url)))))

(defn- latest-version-url
  [repo-url tag]
  (when (and (string? tag) (not (str/blank? tag)))
    (when-let [{:keys [owner repo]} (parse-github-repo repo-url)]
      (let [base (format "https://github.com/%s/%s" owner repo)
            release-url (format "%s/releases/tag/%s" base tag)
            tag-url (format "%s/tree/%s" base tag)]
        (if (release-url-exists? release-url)
          release-url
          tag-url)))))

(defn- platform-tags-html
  [platforms]
  (->> platforms
       (map (fn [platform]
              (format "<span class=\"platform-tag\">%s</span>" (html-escape (name platform)))))
       (str/join " ")))

(defn- release-row-html
  [{:keys [date name url version]}]
  (str "<tr>\n"
       "<td class=\"release-date\">" (html-escape date) "</td>\n"
       "<td class=\"release-lib\"><a href=\"" (html-escape url) "\">" (html-escape name) "</a></td>\n"
       "<td class=\"release-version\">" (html-escape version) "</td>\n"
       "</tr>"))

(defn- release-row-adoc
  [{:keys [date name url version]}]
  (str "| " date "\n"
       "| link:" url "[" name "]\n"
       "| `" version "`"))

(defn- desktop-lib-row-html
  [lib]
  (let [{:keys [url platforms latest latest-url status description]} lib
        display-name (:name lib)
        status-name (clojure.core/name status)]
    (str "<tr>\n"
         "<td class=\"lib-name\"><a href=\"" (html-escape url) "\">" (html-escape display-name) "</a></td>\n"
         "<td>" (platform-tags-html platforms) "</td>\n"
         "<td class=\"lib-version\">"
         (if latest
           (if latest-url
             (str "<a href=\"" (html-escape latest-url) "\">" (html-escape latest) "</a>")
             (html-escape latest))
           "&mdash;")
         "</td>\n"
         "<td><span class=\"status-badge status-" (html-escape status-name) "\">" (html-escape status-name) "</span></td>\n"
         "<td class=\"lib-desc\">" (html-escape description) "</td>\n"
         "</tr>")))

(defn- mobile-lib-entry-html
  [lib]
  (let [{:keys [url platforms latest latest-url status description]} lib
        display-name (:name lib)
        status-name (clojure.core/name status)]
    (str "<div class=\"project-entry\">\n"
         "<div class=\"project-header\">\n"
         "<a href=\"" (html-escape url) "\" class=\"project-name\">" (html-escape display-name) "</a>\n"
         "<span class=\"project-meta\">\n"
         (platform-tags-html platforms)
         (if latest
           (if latest-url
             (str "\n<span class=\"project-version\"><a href=\"" (html-escape latest-url) "\">" (html-escape latest) "</a></span>")
             (str "\n<span class=\"project-version\">" (html-escape latest) "</span>"))
           "")
         "\n<span class=\"status-badge status-" (html-escape status-name) "\">" (html-escape status-name) "</span>\n"
         "</span>\n"
         "</div>\n"
         "<div class=\"project-desc\">" (html-escape description) "</div>\n"
         "</div>")))

(defn- sort-releases
  [releases]
  (sort (fn [a b]
          (let [date-cmp (compare (:date b) (:date a))]
            (if (zero? date-cmp)
              (let [name-cmp (compare (:name a) (:name b))]
                (if (zero? name-cmp)
                  (compare [(:major b) (:minor b) (:patch b)]
                           [(:major a) (:minor a) (:patch a)])
                  name-cmp))
              date-cmp)))
        releases))

(defn- render-partial
  [releases libraries]
  (let [release-rows (if (seq releases)
                       (->> releases (map release-row-html) (str/join "\n"))
                       (str "<tr>\n"
                            "<td class=\"release-date\">&mdash;</td>\n"
                            "<td class=\"release-lib\">No releases yet</td>\n"
                            "<td class=\"release-version\">&mdash;</td>\n"
                            "</tr>"))
        desktop-lib-rows (->> libraries (map desktop-lib-row-html) (str/join "\n"))
        mobile-lib-rows (->> libraries (map mobile-lib-entry-html) (str/join "\n\n"))]
    (str "== Releases\n\n"
         "++++\n"
         "<div class=\"releases-scroll\">\n"
         "<table class=\"releases-table\">\n"
         release-rows "\n"
         "</table>\n"
         "</div>\n"
         "<div class=\"releases-footer\">\n"
         "<a href=\"recent\">View all releases</a>\n"
         "</div>\n"
         "++++\n\n"
         "== Project Docs\n\n"
         "An assortment of general intersest documentation for the OSS project collector.\n\n"
         "// * xref:support.adoc[Support]\n"
         "* xref:open-source-vital-signs.adoc[Open Source Vital Signs]\n"
         "* xref:security-policy.adoc[Security Policy]\n"
         "* xref:contributing-guide.adoc[Contributing Guide]\n\n"
         "== Libraries\n\n"
         "++++\n"
         "<div class=\"libs-desktop\">\n"
         "<div class=\"project-table\">\n"
         "<table>\n"
         "<thead>\n"
         "<tr>\n"
         "<th>Library</th>\n"
         "<th>Platform/s</th>\n"
         "<th>Latest</th>\n"
         "<th>Status</th>\n"
         "<th>Description</th>\n"
         "</tr>\n"
         "</thead>\n"
         "<tbody>\n"
         desktop-lib-rows "\n"
         "</tbody>\n"
         "</table>\n"
         "</div>\n"
         "</div>\n"
         "<div class=\"libs-mobile\">\n"
         "<div class=\"project-catalog\">\n\n"
         mobile-lib-rows "\n\n"
         "</div>\n"
         "</div>\n"
         "++++\n")))

(defn- render-recent-page
  [releases]
  (if (seq releases)
    (str "= Recent Releases\n\n"
         "Full release feed across all tracked projects.\n\n"
         "[cols=\"1,2,1\",options=\"header\",stripes=hover]\n"
         "|===\n"
         "| Date | Library | Version\n\n"
         (->> releases
              (map release-row-adoc)
              (str/join "\n\n"))
         "\n\n|===\n")
    "= Recent Releases\n\nNo releases yet.\n"))

(defn -main
  [& _args]
  (let [docs-root (str (fs/absolutize "."))
        sources (parse-playbook-sources docs-root)
        projects (->> sources
                      (map (fn [{:keys [start-path] :as source}]
                             (let [repo-root (resolve-local-repo docs-root source)]
                               (cond
                                 (nil? repo-root)
                                 (do
                                   (warn! (format "Skipping remote source %s" (:url source)))
                                   nil)

                                 (not (fs/exists? repo-root))
                                 (do
                                   (warn! (format "Skipping missing source directory %s" repo-root))
                                   nil)

                                 :else
                                 (let [manifest-file (str (fs/path repo-root start-path "manifest.edn"))
                                       manifest (load-manifest manifest-file)]
                                   (if (nil? manifest)
                                     (do
                                       (warn! (format "Missing manifest: %s" manifest-file))
                                       nil)
                                     (if-not (valid-project? manifest)
                                       (do
                                         (warn! (format "Invalid manifest format: %s" manifest-file))
                                         nil)
                                       {:repo-root repo-root
                                        :component (get-in manifest [:docs :component])
                                        :name (get-in manifest [:docs :title])
                                        :description (get-in manifest [:project :description])
                                        :platforms (get-in manifest [:project :platforms])
                                        :created (get-in manifest [:project :created])
                                        :repo-url (get-in manifest [:repo :url])
                                        :status (get-in manifest [:project :status])})))))))
                      (remove nil?)
                      vec)
        releases (->> projects
                      (mapcat collect-releases)
                      sort-releases
                      vec)
        libraries (->> projects
                       (map (fn [{:keys [component name description platforms repo-url status]}]
                              (let [latest-release-entry (latest-tagged-release releases component)]
                                {:name name
                                 :component component
                                 :description description
                                 :platforms platforms
                                 :status status
                                 :latest (some-> latest-release-entry :version)
                                 :latest-url (when-let [version (some-> latest-release-entry :version)]
                                               (latest-version-url repo-url version))
                                 :url (if latest-release-entry
                                        (:url latest-release-entry)
                                        (format "../%s/next/" component))})))
                       (sort-by (comp str/lower-case :name))
                       vec)
        partial-content (render-partial releases libraries)
        recent-content (render-recent-page releases)
        partial-dir (str (fs/path docs-root "components" "home" "modules" "ROOT" "partials"))
        partial-file (str (fs/path partial-dir "home-project-catalog.adoc"))
        pages-dir (str (fs/path docs-root "components" "home" "modules" "ROOT" "pages"))
        recent-file (str (fs/path pages-dir "recent.adoc"))]
    (fs/create-dirs partial-dir)
    (fs/create-dirs pages-dir)
    (spit partial-file partial-content)
    (spit recent-file recent-content)
    (println "Generated" recent-file "with" (count releases) "release rows.")
    (println "Generated" partial-file "with" (count releases) "releases and" (count libraries) "libraries.")))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
