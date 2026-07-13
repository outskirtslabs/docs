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
  (->> (#'gen-home/collect-tagged-releases repo "demo" "Demo")
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
