---
title: "src-tauri desktop-only Rust modules: declare in main.rs only"
author: Scottchen
date: 2026-10-26
branch: feat/52-local-git-versions
cost: { minutes: 1, tokens: 1308 }
touches:
  - src-tauri/src/main.rs
  - src-tauri/src/lib.rs
  - src-tauri/src/git_versions.rs
---

## Decided
src-tauri has two separate Tauri entry points sharing the same src/ directory:
main.rs is the desktop binary (its own tauri::Builder, invoke_handler, RunEvent::Exit
handling), and lib.rs is the mobile (android/ios) cdylib entry (#[cfg_attr(mobile,
tauri::mobile_entry_point)]). Each declares its own `mod ...;` tree and duplicates
shared modules (backup, self_hosted_files, etc. appear as `mod` in both files).
For issue #52 (local git version control, desktop-only per ADR 0003), the new
git_versions.rs module and its `mod git_versions;` + command registration were
added only to main.rs, not lib.rs — so Android/iOS builds never see git2 at all
(no vendored-libgit2 build cost, no accidental mobile exposure of a desktop-only
feature). Also added git2 as a dependency only under
`[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]`
in Cargo.toml, with `default-features = false, features = ["vendored-libgit2"]`
since only local repo ops (init/add/commit/log/diff) are needed — no https/ssh
transports, so openssl/libssh2 aren't pulled in.

## Watch out
Before adding a new desktop-only Rust tauri::command, check which file(s) declare
its `mod` — main.rs alone is enough to keep it off mobile; adding it to lib.rs too
would pull it (and its dependencies) into the android/ios build.
