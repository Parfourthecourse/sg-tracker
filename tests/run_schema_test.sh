#!/bin/sh
# Resets a scratch database and runs the SQL checks. Needs local postgres on port 5433.
set -e
cd "$(dirname "$0")/.."
psql -h /tmp -p 5433 -U postgres -d postgres -X -q -c "drop database if exists sgtest" -c "create database sgtest"
psql -h /tmp -p 5433 -U postgres -d sgtest -X -f tests/schema.test.sql
