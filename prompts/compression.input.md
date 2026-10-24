---
id: compression.input
title: Memory cluster compression input
version: 1
stage: compression
role: user
variables: [count, contents]
note: contents is a 1-based numbered list, one memory per line, built by the caller.
---
Merge these {{count}} memories into one:
{{contents}}
