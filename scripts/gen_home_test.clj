(ns gen-home-test
  (:require [babashka.fs :as fs]
            [babashka.process :as p]
            [clojure.string :as str]
            [clojure.test :refer [deftest is testing]]
            [gen-home]))

(defn- git!
  [repo & args]
  (apply p/shell {:out :string :err :string} "git" "-C" repo args))

(defn- with-temp-repo
  [f]
  (let [repo (str (fs/create-temp-dir {:prefix "gen-home-test-"}))]
    (try
      (git! repo "init" "--quiet")
      (git! repo "config" "user.name" "Gen Home Test")
      (git! repo "config" "user.email" "gen-home-test@example.com")
      (spit (str (fs/path repo "README")) "test\n")
      (git! repo "add" "README")
      (git! repo "commit" "--quiet" "-m" "initial")
      (f repo)
      (finally
        (fs/delete-tree repo)))))

(defn- release-summary
  [repo]
  (->> (#'gen-home/collect-tagged-releases repo "demo" "Demo" nil)
       (mapv #(select-keys % [:component :name :version :major :minor :patch :url]))))

(deftest tagged-releases-support-version-line-and-exact-doc-branches
  (testing "uses an exact-version docs branch when no version-line branch exists"
    (with-temp-repo
      (fn [repo]
        (git! repo "tag" "v0.0.1")
        (git! repo "branch" "v0.0.1")
        (is (= [{:component "demo"
                 :name "Demo"
                 :version "v0.0.1"
                 :major 0
                 :minor 0
                 :patch 1
                 :url "../demo/0.0.1/"}]
               (release-summary repo))))))

  (testing "preserves version-line branch URLs when both branch styles exist"
    (with-temp-repo
      (fn [repo]
        (git! repo "tag" "v1.2.3")
        (git! repo "branch" "v1.2.x")
        (git! repo "branch" "v1.2.3")
        (is (= [{:component "demo"
                 :name "Demo"
                 :version "v1.2.3"
                 :major 1
                 :minor 2
                 :patch 3
                 :url "../demo/1.2/"}]
               (release-summary repo))))))

  (testing "skips a release and names both supported branch styles when neither exists"
    (with-temp-repo
      (fn [repo]
        (git! repo "tag" "v2.3.4")
        (let [releases (atom nil)
              writer (java.io.StringWriter.)
              _ (binding [*err* writer]
                  (reset! releases (release-summary repo)))
              warnings (str writer)]
          (is (empty? @releases))
          (is (str/includes? warnings "branch v2.3.x"))
          (is (str/includes? warnings "exact branch v2.3.4")))))))

(deftest namespaced-releases-use-only-the-configured-prefix
  (with-temp-repo
    (fn [repo]
      (doseq [tag ["engine/v0.0.2" "engine/v0.0.10" "engine-provider/v9.0.0"
                   "v8.0.0" "engine/vinvalid"]]
        (git! repo "tag" tag))
      (doseq [branch ["docs/v0.0.2" "docs/v0.0.10" "docs/v9.0.0" "docs/v8.0.0"]]
        (git! repo "branch" branch))
      (let [releases (#'gen-home/collect-releases
                      {:repo-root repo :component "demo" :name "Demo"
                       :release-tag-prefix "engine/"})
            latest (#'gen-home/latest-tagged-release releases "demo")]
        (is (= #{"engine/v0.0.2" "engine/v0.0.10"} (set (map :tag releases))))
        (is (= {:component "demo" :name "Demo" :version "v0.0.10"
                :tag "engine/v0.0.10" :major 0 :minor 0 :patch 10
                :url "../demo/0.0.10/"}
               (dissoc latest :date)))
        (with-redefs [gen-home/release-url-exists? (constantly true)]
          (is (= "https://github.com/example/demo/releases/tag/engine/v0.0.10"
                 (#'gen-home/latest-version-url "https://github.com/example/demo" (:tag latest)))))))))

(deftest absent-prefix-keeps-unprefixed-release-discovery
  (with-temp-repo
    (fn [repo]
      (git! repo "tag" "v1.0.0")
      (git! repo "tag" "engine/v2.0.0")
      (git! repo "branch" "v1.0.0")
      (git! repo "branch" "docs/v2.0.0")
      (is (= ["v1.0.0"]
             (mapv :version (#'gen-home/collect-releases
                             {:repo-root repo :component "demo" :name "Demo"})))))))

(deftest manifest-prefix-reaches-the-rendered-catalog
  (with-temp-repo
    (fn [repo]
      (let [site (str (fs/path repo "site"))
            script (str (fs/absolutize "scripts/gen_home.clj"))]
        (git! repo "tag" "engine/v0.0.1")
        (git! repo "tag" "engine-provider/v9.0.0")
        (git! repo "branch" "docs/v0.0.1")
        (fs/create-dirs (fs/path repo "doc"))
        (fs/create-dirs site)
        (spit (str (fs/path repo "doc/manifest.edn"))
              (pr-str {:docs {:component "demo" :title "Demo"}
                       :project {:description "Demo project" :platforms [:clj]
                                 :created "2026-01-01" :status :experimental}
                       :repo {:release-tag-prefix "engine/"}}))
        (spit (str (fs/path site "playbook.yml"))
              (str "content:\n  sources:\n    - url: " repo "\n      start_path: doc\n"))
        (p/shell {:dir site :out :string :err :string} "bb" "--config" "/dev/null" script)
        (let [catalog (slurp (str (fs/path site "components/home/modules/ROOT/partials/home-project-catalog.adoc")))]
          (is (str/includes? catalog "../demo/0.0.1/"))
          (is (str/includes? catalog "<td class=\"release-version\">v0.0.1</td>"))
          (is (not (str/includes? catalog "v9.0.0"))))))))
