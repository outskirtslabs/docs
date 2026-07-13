#!/usr/bin/env bb

(ns run-clojure-tests
  (:require [clojure.test :as test]
            [gen-home-test]
            [tasks-test]))

(let [{:keys [fail error]} (test/run-tests 'gen-home-test 'tasks-test)]
  (when (pos? (+ fail error))
    (System/exit 1)))
