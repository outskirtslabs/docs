#!/usr/bin/env bb
;; Generate AsciiDoc API reference pages from Clojure source using clj-kondo.
;;
;; Usage:
;;   bb scripts/gen-api-docs.clj '{:project-root "/path/to/project" ...}'

(require '[babashka.pods :as pods])
(pods/load-pod 'clj-kondo/clj-kondo "2024.11.14")
(require '[pod.borkdude.clj-kondo :as clj-kondo])

(require '[babashka.fs :as fs]
         '[clojure.edn :as edn]
         '[clojure.string :as str]
         '[clojure.pprint :as pp])

;; ---------------------------------------------------------------------------
;; CLI
;; ---------------------------------------------------------------------------

(def opts (edn/read-string (first *command-line-args*)))

(assert (:project-root opts) ":project-root is required")
(assert (:source-paths opts) ":source-paths is required")
(assert (:antora-start-path opts) ":antora-start-path is required")
(assert (:github-repo opts) ":github-repo is required")
(assert (:git-branch opts) ":git-branch is required")

(def project-root (str (fs/absolutize (:project-root opts))))
(def source-paths (mapv #(str (fs/path project-root %)) (:source-paths opts)))
(def antora-module-root (str (fs/path project-root (:antora-start-path opts) "modules" "ROOT")))
(def pages-dir (str (fs/path antora-module-root "pages" "api")))
(def partials-dir (str (fs/path antora-module-root "partials")))
(def github-repo (:github-repo opts))
(def git-branch (:git-branch opts))

;; ---------------------------------------------------------------------------
;; clj-kondo analysis
;; ---------------------------------------------------------------------------

(println "Analyzing" (str/join ", " source-paths) "...")

(def analysis
  (let [result (clj-kondo/run!
                {:lint source-paths
                 :config {:skip-comments true
                          :output {:analysis
                                   {:arglists true
                                    :var-definitions {:meta [:no-doc :skip-wiki :arglists]}
                                    :namespace-definitions {:meta [:no-doc :skip-wiki]}}}}})]
    (:analysis result)))

(def ns-defs (:namespace-definitions analysis))
(def var-defs (:var-definitions analysis))

;; ---------------------------------------------------------------------------
;; Filtering
;; ---------------------------------------------------------------------------

(defn skip-ns? [ns-def]
  (or (get-in ns-def [:meta :no-doc])
      (get-in ns-def [:meta :skip-wiki])))

(defn skip-var? [v]
  (or (:private v)
      (get-in v [:meta :no-doc])
      (get-in v [:meta :skip-wiki])
      ;; filter out defrecord factory fns (map->X, ->X for records)
      (and (= 'clojure.core/deftype (:defined-by v))
           (let [n (str (:name v))]
             (or (str/starts-with? n "->")
                 (str/starts-with? n "map->"))))
      ;; filter out deftype class names (they have no arglists and defined-by deftype)
      (and (= 'clojure.core/deftype (:defined-by v))
           (nil? (:arglist-strs v)))))

(def kept-ns-names
  (->> ns-defs
       (remove skip-ns?)
       (map :name)
       set))

(def public-vars
  (->> var-defs
       (remove skip-var?)
       (filter #(contains? kept-ns-names (:ns %)))
       (sort-by (juxt :ns :row))))

(def vars-by-ns (group-by :ns public-vars))

(def kept-ns-defs
  (->> ns-defs
       (remove skip-ns?)
       (filter #(contains? kept-ns-names (:name %)))
       (sort-by :name)))

;; ---------------------------------------------------------------------------
;; Protocol member grouping
;; ---------------------------------------------------------------------------

(defn protocol-var? [v]
  (= 'clojure.core/defprotocol (:defined-by v)))

(defn group-protocol-members
  "Given vars for a namespace, return a seq of maps:
   - regular vars as-is (with :kind :var)
   - protocol vars with :kind :protocol and :members [...]"
  [vars]
  ;; Both the protocol name and its methods have defined-by = defprotocol.
  ;; The protocol name var has NO arglist-strs; the methods DO.
  ;; We use file row proximity to group methods under their protocol.
  (let [protocol-defs (->> vars
                           (filter protocol-var?)
                           (remove :arglist-strs))
        protocol-name-set (set (map :name protocol-defs))
        protocol-methods (->> vars
                              (filter protocol-var?)
                              (filter :arglist-strs)
                              (remove #(contains? protocol-name-set (:name %))))
        method-name-set (set (map :name protocol-methods))
        ;; For each protocol, find methods that are in the same row range
        protos-with-members
        (for [p protocol-defs]
          (let [members (->> protocol-methods
                             (filter #(= (:filename %) (:filename p)))
                             (filter #(and (>= (:row %) (:row p))
                                           (<= (:row %) (:end-row p))))
                             (sort-by :row))]
            (assoc p :kind :protocol :members members)))
        proto-map (into {} (map (fn [p] [(:name p) p]) protos-with-members))
        ;; Regular vars (not protocols, not protocol methods)
        regular (->> vars
                     (remove protocol-var?)
                     (map #(assoc % :kind :var)))]
    ;; Return in source order: regular vars + protocols (at their position)
    (->> (concat regular (vals proto-map))
         (sort-by :row))))

;; ---------------------------------------------------------------------------
;; Naming helpers
;; ---------------------------------------------------------------------------

(defn ns->slug
  "ol.client-ip.core -> ol-client-ip-core"
  [ns-sym]
  (str/replace (str ns-sym) #"\." "-"))

(defn var->anchor
  "Munge a var name for use as an AsciiDoc anchor ID.
   Uses Clojure munge rules then replaces underscores with hyphens."
  [var-name]
  (-> (str var-name)
      (munge)
      (str/replace "_" "-")))

(defn filename-relative
  "Get filename relative to project root."
  [abs-path]
  (str (fs/relativize project-root abs-path)))

(defn source-url
  "Build GitHub source URL with line range."
  [v]
  (let [rel (filename-relative (:filename v))]
    (str github-repo "/blob/" git-branch "/" rel
         "#L" (:row v) "-L" (:end-row v))))

;; ---------------------------------------------------------------------------
;; Docstring processing
;; ---------------------------------------------------------------------------

(defn convert-fenced-code-blocks
  "Convert markdown fenced code blocks to AsciiDoc listing blocks."
  [s]
  (if (nil? s) ""
      (-> s
          ;; ```lang ... ``` -> [source,lang]\n----\n...\n----
          (str/replace #"(?m)```(\w+)\n([\s\S]*?)```"
                       (fn [[_ lang body]]
                         (str "[source," lang "]\n----\n" (str/trimr body) "\n----")))
          ;; ``` ... ``` (no lang)
          (str/replace #"(?m)```\n([\s\S]*?)```"
                       (fn [[_ body]]
                         (str "----\n" (str/trimr body) "\n----"))))))

(defn resolve-var-references
  "Resolve [[var-name]] and `var-name` wikilink patterns to AsciiDoc xrefs.
   Only resolves references that match known vars/namespaces."
  [s current-ns all-vars-by-ns all-ns-names]
  (if (nil? s) ""
      (let [;; Build lookup: unqualified name -> set of namespaces containing it
            var-index (reduce (fn [idx [ns-sym vars]]
                                (reduce (fn [idx2 v]
                                          (update idx2 (str (:name v)) (fnil conj #{}) ns-sym))
                                        idx vars))
                              {} all-vars-by-ns)
            ns-name-set (set (map str all-ns-names))
            resolve-ref (fn [ref-text]
                          (cond
                            ;; Qualified: ns/var
                            (str/includes? ref-text "/")
                            (let [[ns-part var-part] (str/split ref-text #"/" 2)
                                  ns-sym (symbol ns-part)]
                              (if (contains? all-vars-by-ns ns-sym)
                                (str "xref:api/" (ns->slug ns-sym) ".adoc#" (var->anchor var-part)
                                     "[`" ref-text "`]")
                                (str "`" ref-text "`")))
                            ;; Namespace reference
                            (contains? ns-name-set ref-text)
                            (str "xref:api/" (ns->slug (symbol ref-text)) ".adoc[`" ref-text "`]")
                            ;; Same-namespace var
                            (contains? var-index ref-text)
                            (let [nses (get var-index ref-text)]
                              (if (contains? nses current-ns)
                                (str "<<" (var->anchor ref-text) ",`" ref-text "`>>")
                                ;; Pick first matching ns
                                (let [target-ns (first nses)]
                                  (str "xref:api/" (ns->slug target-ns) ".adoc#" (var->anchor ref-text)
                                       "[`" ref-text "`]"))))
                            :else (str "`" ref-text "`")))]
        (-> s
            ;; [[var-name]] wiki links
            (str/replace #"\[\[([^\]]+)\]\]" (fn [[_ ref]] (resolve-ref ref)))
            ;; `var-name` that look like var references (simple heuristic:
            ;; single backtick-wrapped names that contain only valid clojure identifier chars)
            ;; But be careful not to replace backticks inside [source] blocks
            ;; For simplicity, only replace outside of ---- blocks
            ;; Actually, let's just handle [[...]] for now since that's the convention
            ))))

(defn convert-md-headings
  "Convert markdown headings (## Foo) to AsciiDoc (=== Foo).
   Bumps heading level by 2 so ## becomes ==== (level 4) to nest under var == headings."
  [s]
  (if (nil? s) ""
      (-> s
          (str/replace #"(?m)^#### " "====== ")
          (str/replace #"(?m)^### " "===== ")
          (str/replace #"(?m)^## " "==== ")
          (str/replace #"(?m)^# " "=== "))))

(defn process-docstring [s current-ns all-vars-by-ns all-ns-names]
  (-> s
      (convert-fenced-code-blocks)
      (convert-md-headings)
      (resolve-var-references current-ns all-vars-by-ns all-ns-names)
      ;; Trim leading indentation (common in Clojure docstrings)
      (str/replace #"(?m)^  " "")))

;; ---------------------------------------------------------------------------
;; AsciiDoc rendering
;; ---------------------------------------------------------------------------

(defn render-arglist
  "Render an arglist string as (var-name args...)."
  [var-name arglist-str]
  ;; arglist-str is like "[request strategy]" -- we strip brackets
  (let [args (-> arglist-str
                 (str/replace #"^\[" "")
                 (str/replace #"\]$" "")
                 str/trim)]
    (if (str/blank? args)
      (str "(" var-name ")")
      (str "(" var-name " " args ")"))))

(defn render-arglists-block [var-name arglist-strs]
  (when (seq arglist-strs)
    (let [lines (map #(render-arglist (str var-name) %) arglist-strs)]
      (str "[source,clojure]\n----\n"
           (str/join "\n" lines)
           "\n----"))))

(defn render-meta-line [v]
  (let [parts (cond-> []
                (= 'clojure.core/defmacro (:defined-by v))
                (conj "macro")
                (= :protocol (:kind v))
                (conj "protocol")
                (:deprecated v)
                (conj "deprecated")
                (get-in v [:meta :added])
                (conj (str "added in " (get-in v [:meta :added]))))]
    (when (seq parts)
      (str "_" (str/join " | " parts) "_"))))

(defn render-var-entry [v current-ns]
  (let [anchor (var->anchor (str (:name v)))
        name-str (str (:name v))
        arglists (:arglist-strs v)
        doc-str (when (:doc v)
                  (process-docstring (:doc v) current-ns vars-by-ns (map :name kept-ns-defs)))
        meta-line (render-meta-line v)
        src-link (str "[.api-source]\nlink:" (source-url v) "[source,window=_blank]")]
    (str/join "\n"
              (filterv some?
                       [(str "[#" anchor "]")
                        (str "== " name-str)
                        ""
                        (render-arglists-block name-str arglists)
                        ""
                        doc-str
                        ""
                        meta-line
                        ""
                        src-link]))))

(defn render-protocol-member [m]
  (let [anchor (var->anchor (str (:name m)))
        name-str (str (:name m))
        arglists (:arglist-strs m)
        doc-str (when (:doc m)
                  (process-docstring (:doc m) (:ns m) vars-by-ns (map :name kept-ns-defs)))]
    (str/join "\n"
              (filterv some?
                       [(str "[#" anchor "]")
                        (str "=== " name-str)
                        ""
                        (render-arglists-block name-str arglists)
                        ""
                        doc-str]))))

(defn render-protocol-entry [v current-ns]
  (let [anchor (var->anchor (str (:name v)))
        name-str (str (:name v))
        doc-str (when (:doc v)
                  (process-docstring (:doc v) current-ns vars-by-ns (map :name kept-ns-defs)))
        meta-line "_protocol_"
        src-link (str "[.api-source]\nlink:" (source-url v) "[source,window=_blank]")
        members-str (when (seq (:members v))
                      (str/join "\n\n'''\n\n"
                                (map render-protocol-member (:members v))))]
    (str/join "\n"
              (filterv some?
                       [(str "[#" anchor "]")
                        (str "== " name-str)
                        ""
                        doc-str
                        ""
                        meta-line
                        ""
                        src-link
                        ""
                        (when members-str (str "\n" members-str))]))))

(defn render-ns-page [ns-def vars]
  (let [ns-name (str (:name ns-def))
        grouped (group-protocol-members vars)
        doc-str (when (:doc ns-def)
                  (process-docstring (:doc ns-def) (:name ns-def) vars-by-ns (map :name kept-ns-defs)))
        meta-line (when (get-in ns-def [:meta :added])
                    (str "_added in " (get-in ns-def [:meta :added]) "_"))
        entries (map (fn [v]
                       (if (= :protocol (:kind v))
                         (render-protocol-entry v (:name ns-def))
                         (render-var-entry v (:name ns-def))))
                     grouped)]
    (str "= " ns-name "\n"
         (when doc-str (str "\n" doc-str "\n"))
         (when meta-line (str "\n" meta-line "\n"))
         "\n"
         (str/join "\n\n'''\n\n" entries)
         "\n")))

;; ---------------------------------------------------------------------------
;; Nav rendering
;; ---------------------------------------------------------------------------

(defn render-nav []
  (let [entries (->> kept-ns-defs
                     (sort-by :name)
                     (map (fn [ns-def]
                            (let [slug (ns->slug (:name ns-def))]
                              (str "* xref:api/" slug ".adoc[" (:name ns-def) "]")))))]
    (str ".API Reference\n"
         (str/join "\n" entries)
         "\n")))

;; ---------------------------------------------------------------------------
;; File writing
;; ---------------------------------------------------------------------------

;; Clean up old generated files
(when (fs/exists? pages-dir)
  (fs/delete-tree pages-dir))
(fs/create-dirs pages-dir)
(fs/create-dirs partials-dir)

;; Write namespace pages
(doseq [ns-def kept-ns-defs]
  (let [vars (get vars-by-ns (:name ns-def))
        slug (ns->slug (:name ns-def))
        file (str (fs/path pages-dir (str slug ".adoc")))
        content (render-ns-page ns-def vars)]
    (println "  Writing" file)
    (spit file content)))

;; Write nav partial
(let [nav-file (str (fs/path partials-dir "api-nav.adoc"))
      content (render-nav)]
  (println "  Writing" nav-file)
  (spit nav-file content))

(println "Done. Generated" (count kept-ns-defs) "namespace pages.")
