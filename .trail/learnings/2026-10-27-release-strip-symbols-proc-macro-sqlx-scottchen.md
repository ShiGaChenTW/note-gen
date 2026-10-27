---
title: release 打包失敗：strip=symbols 剝壞 proc-macro 動態庫（sqlx-macros）
author: Scottchen
date: 2026-10-27
branch: chore/backlog-init
cost: { minutes: 8, tokens: 22481 }
id: l-406e93bc
scope: repo
status: active
src: agent
---

## Decided
- `tauri build --bundles app` 要加環境變數 `CARGO_PROFILE_RELEASE_BUILD_OVERRIDE_STRIP=none`，只對編譯期元件（proc-macro、build script）關閉 strip；app 本體仍照 `Cargo.toml` 的 `[profile.release] strip = "symbols"` 剝離。完整指令：`CARGO_PROFILE_RELEASE_BUILD_OVERRIDE_STRIP=none CARGO_TARGET_DIR=<主 repo>/src-tauri/target npx -y pnpm@10 tauri build --bundles app`。
- 不改 repo 的 `Cargo.toml`：strip 設定是上游的，改了每次同步都會衝突。

## Tried and ruled out
- 以為是主 repo 的 Rust 快取損毀，`cargo clean --release -p sqlx-macros -p sqlx`（刪 57 檔）後重建：重建出的 `libsqlx_macros-*.dylib` 一樣壞，所以不是舊快取，是 strip 本身。
- 同步時 `cargo check` 通過，不能代表 release 打包能過：check 用 dev profile，沒有 strip，驗不到這個問題。

## Watch out
- 症狀：`error: .../libsqlx_macros-*.dylib: dlopen(...) mis-aligned LINKEDIT string pool`，接著 `sqlx` 出現 E0432 unresolved imports（`Encode`、`Decode`、`FromRow`、`Type`）。錯誤指向 sqlx，根因在 strip。
- 環境：rustc 1.99.1／cargo 1.99.1，Command Line Tools（沒有完整 Xcode），macOS Darwin 27。10-25 同樣流程曾成功，之後工具鏈或系統更新才出現；工具鏈再變動時可能不需要這個變數，先不加試一次再說。
- 同步上游後的驗證要含一次 release 打包，不要只跑 tsc／vitest／`cargo check`。
