(ns tasks-test
  (:require [babashka.fs :as fs]
            [babashka.process :as p]
            [clojure.string :as str]
            [clojure.test :refer [deftest is testing]]
            [tasks]))

(defn- with-temp-docs-root
  [f]
  (let [tmp-dir (fs/create-temp-dir {:prefix "tasks-test-"})]
    (try
      (f (str tmp-dir))
      (finally
        (fs/delete-tree tmp-dir)))))

(deftest parse-projects-reads-refs-hash
  (with-temp-docs-root
    (fn [docs-root]
      (let [projects-file (fs/path docs-root "pkgs" "projects.nix")
            content (str "{\n"
                         "  \"demo\" = {\n"
                         "    url = \"https://github.com/outskirtslabs/demo.git\";\n"
                         "    rev = \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\";\n"
                         "    hash = \"sha256-old\";\n"
                         "    refs_hash = \"sha256-refs\";\n"
                         "    branches = [ \"HEAD\" \"v{0..9}*\" ];\n"
                         "    start_path = \"doc\";\n"
                         "  };\n"
                         "}\n")]
        (fs/create-dirs (fs/parent projects-file))
        (spit (str projects-file) content)
        (is (= {"demo" {:url "https://github.com/outskirtslabs/demo.git"
                        :rev "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                        :hash "sha256-old"
                        :refs-hash "sha256-refs"
                        :branches ["HEAD" "v{0..9}*"]
                        :start-path "doc"}}
               (#'tasks/parse-projects docs-root)))))))

(deftest update-projects-reuses-hash-only-when-rev-and-refs-hash-match
  (testing "does not prefetch when both rev and refs_hash are unchanged"
    (let [prefetch-calls (atom 0)
          written (atom nil)]
      (with-redefs [tasks/parse-projects (fn [_]
                                           {"demo" {:url "https://github.com/outskirtslabs/demo.git"
                                                    :rev "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
                                                    :hash "sha256-existing"
                                                    :refs-hash "sha256-same-refs"
                                                    :branches ["HEAD"]
                                                    :start-path "doc"}})
                    tasks/remote-head-rev (fn [_] "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
                    tasks/remote-refs-hash (fn [_] "sha256-same-refs")
                    tasks/prefetch-hash (fn [& _]
                                          (swap! prefetch-calls inc)
                                          "sha256-new")
                    tasks/render-projects-nix (fn [projects]
                                                (reset! written projects)
                                                "rendered")
                    spit (fn [& _] nil)
                    println (fn [& _] nil)]
        (tasks/update-projects)
        (is (= 0 @prefetch-calls))
        (is (= "sha256-existing" (get-in @written ["demo" :hash]))))))
  (testing "prefetches when refs_hash changed but rev is unchanged"
    (let [prefetch-calls (atom 0)
          written (atom nil)]
      (with-redefs [tasks/parse-projects (fn [_]
                                           {"demo" {:url "https://github.com/outskirtslabs/demo.git"
                                                    :rev "cccccccccccccccccccccccccccccccccccccccc"
                                                    :hash "sha256-existing"
                                                    :refs-hash "sha256-old-refs"
                                                    :branches ["HEAD"]
                                                    :start-path "doc"}})
                    tasks/remote-head-rev (fn [_] "cccccccccccccccccccccccccccccccccccccccc")
                    tasks/remote-refs-hash (fn [_] "sha256-new-refs")
                    tasks/prefetch-hash (fn [& _]
                                          (swap! prefetch-calls inc)
                                          "sha256-recomputed")
                    tasks/render-projects-nix (fn [projects]
                                                (reset! written projects)
                                                "rendered")
                    spit (fn [& _] nil)
                    println (fn [& _] nil)]
        (tasks/update-projects)
        (is (= 1 @prefetch-calls))
        (is (= "sha256-recomputed" (get-in @written ["demo" :hash])))
        (is (= "sha256-new-refs" (get-in @written ["demo" :refs-hash])))))))

(deftest remote-refs-hash-sorts-before-hashing
  (with-redefs [p/shell (fn [& _]
                          {:out (str "2222222222222222222222222222222222222222\trefs/tags/v1.0.0\n"
                                     "1111111111111111111111111111111111111111\trefs/heads/main\n")
                           :err ""
                           :exit 0})]
    (is (= (#'tasks/sha256-sri
            (str/join "\n" ["1111111111111111111111111111111111111111\trefs/heads/main"
                            "2222222222222222222222222222222222222222\trefs/tags/v1.0.0"]))
           (#'tasks/remote-refs-hash "https://github.com/outskirtslabs/demo.git")))))

(deftest nix-source-hash-expr-uses-flake-locked-nixpkgs
  (let [expr (#'tasks/nix-source-hash-expr "/tmp/docs-root" "https://github.com/outskirtslabs/demo.git" "dddddddddddddddddddddddddddddddddddddddd")]
    (is (str/includes? expr "flake = builtins.getFlake \"/tmp/docs-root\";"))
    (is (str/includes? expr "pkgs = import flake.inputs.nixpkgs.outPath {};"))
    (is (not (str/includes? expr "builtins.getFlake \"nixpkgs\"")))))

(deftest render-projects-nix-uses-valid-nix-comment
  (let [rendered (#'tasks/render-projects-nix
                  {"demo" {:url "https://github.com/outskirtslabs/demo.git"
                           :rev "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                           :hash "sha256-old"
                           :refs-hash "sha256-refs"
                           :branches ["HEAD"]
                           :start-path "doc"}})]
    (is (str/includes? rendered "# This file is automatically generated"))
    (is (not (str/includes? rendered ";; This file is automatically generated")))))
