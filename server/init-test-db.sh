#!/bin/sh
set -eu
createdb --username "$POSTGRES_USER" ps3_test
