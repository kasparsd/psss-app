#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
node --test Extensions/Browser/tests/*.test.js
