//! 本機 git 版本管理（Issue #52）：vault 層級的本機 git repo，只在桌面版編譯進去
//! （此模組只在 `main.rs` 宣告，行動版的 `lib.rs` 不會引用到）。
//!
//! 只負責 init/偵測既有 repo、commit、log、讀取某版內容、diff，與既有 REST 同步互不干擾。
//! commit 以 trailer 區分「提示詞版本」（#54 起會用到）與「自動快照」。

use git2::{DiffOptions, ErrorCode, IndexAddOption, Oid, Repository, Signature};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Component, Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager, State};

const TRAILER_KEY: &str = "NoteGen-Version-Kind";
const FALLBACK_SNAPSHOT_SUMMARY: &str = "Auto snapshot";

// 只追蹤文字筆記格式；附件與其他檔案不進入版本記錄（ADR 0003）。
const DEFAULT_GITIGNORE: &str = "\
# NoteGen 版本管理：只追蹤 .md / .canvas / .base，其餘檔案（包含附件）不進入版本記錄。
*
!*/
!*.md
!*.canvas
!*.base
!.gitignore
";

// 未指定路徑時（自動快照）只 stage 文字筆記；沿用既有 repo 時它的 .gitignore 可能沒排除附件（ADR 0003）。
const TRACKED_PATHSPECS: [&str; 4] = ["*.md", "*.canvas", "*.base", ".gitignore"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum VersionKind {
    PromptVersion,
    AutoSnapshot,
}

impl VersionKind {
    fn as_str(self) -> &'static str {
        match self {
            VersionKind::PromptVersion => "prompt-version",
            VersionKind::AutoSnapshot => "auto-snapshot",
        }
    }

    fn from_str(value: &str) -> Option<Self> {
        match value {
            "prompt-version" => Some(VersionKind::PromptVersion),
            "auto-snapshot" => Some(VersionKind::AutoSnapshot),
            _ => None,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitVersionDetect {
    pub has_existing_repo: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitVersionEnableResult {
    pub reused_existing: bool,
    pub created_gitignore: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitVersionStatus {
    pub is_repo: bool,
    pub has_commits: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitVersionCommitInfo {
    pub id: String,
    pub kind: VersionKind,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitVersionLogEntry {
    pub id: String,
    pub short_id: String,
    pub summary: String,
    pub kind: Option<VersionKind>,
    pub author_name: String,
    pub time_seconds: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitVersionDiff {
    pub old_content: Option<String>,
    pub new_content: Option<String>,
}

#[derive(Default, Clone)]
struct GitVersionContext {
    workspace_root: Option<PathBuf>,
    auto_snapshot_enabled: bool,
    snapshot_summary: String,
}

/// 由前端在啟用/切換工作區/關閉自動快照時更新；`RunEvent::Exit` 用它做關閉前的最後一次快照，
/// 此時無法再呼叫前端取得多語系文案，所以文案由前端先行寫入這裡。
#[derive(Default)]
pub struct GitVersionState(Mutex<GitVersionContext>);

fn canonical_workspace_root(value: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(value)
        .canonicalize()
        .map_err(|error| format!("Failed to resolve workspace directory: {error}"))?;
    if !root.is_dir() {
        return Err("Workspace path is not a directory".to_string());
    }
    Ok(root)
}

fn validate_relative_path(value: &str) -> Result<String, String> {
    let normalized = value.trim().replace('\\', "/");
    if normalized.is_empty() {
        return Err("Path must not be empty".to_string());
    }
    let path = Path::new(&normalized);
    if path.is_absolute() {
        return Err("Path must be relative".to_string());
    }
    for component in path.components() {
        match component {
            Component::Normal(_) => {}
            _ => return Err("Path contains an unsafe component".to_string()),
        }
    }
    Ok(normalized)
}

fn open_repo(workspace_root: &Path) -> Result<Repository, String> {
    Repository::open(workspace_root)
        .map_err(|error| format!("Failed to open git repository: {error}"))
}

fn has_git_repo(workspace_root: &Path) -> bool {
    Repository::open(workspace_root).is_ok()
}

fn format_commit_message(summary: &str, kind: VersionKind) -> String {
    format!("{summary}\n\n{TRAILER_KEY}: {}", kind.as_str())
}

/// commit() 寫入的訊息都是我們自己格式化的，所以用「最後一段」反解析是安全的；
/// 非本功能建立的 commit（例如既有 obsidian-git 的歷史、手動 commit）解析不出 kind，回 None。
fn split_trailer(full_message: &str) -> (String, Option<VersionKind>) {
    if let Some(index) = full_message.rfind("\n\n") {
        let (summary, trailer_block) = full_message.split_at(index);
        let trailer_block = trailer_block.trim_start_matches("\n\n");
        let prefix = format!("{TRAILER_KEY}: ");
        let kind = trailer_block
            .lines()
            .find_map(|line| line.strip_prefix(&prefix))
            .and_then(|value| VersionKind::from_str(value.trim()));
        if let Some(kind) = kind {
            return (summary.trim_end().to_string(), Some(kind));
        }
    }
    (full_message.trim_end().to_string(), None)
}

fn commit_internal(
    root: &Path,
    summary: &str,
    kind: VersionKind,
    paths: Option<&[String]>,
    allow_empty: bool,
) -> Result<Option<GitVersionCommitInfo>, String> {
    let repo = open_repo(root)?;
    let mut index = repo
        .index()
        .map_err(|error| format!("Failed to read git index: {error}"))?;

    match paths {
        Some(paths) if !paths.is_empty() => {
            let validated = paths
                .iter()
                .map(|value| validate_relative_path(value))
                .collect::<Result<Vec<_>, _>>()?;
            let specs: Vec<&str> = validated.iter().map(String::as_str).collect();
            index
                .add_all(specs.iter(), IndexAddOption::DEFAULT, None)
                .map_err(|error| format!("Failed to stage changes: {error}"))?;
            index
                .update_all(specs.iter(), None)
                .map_err(|error| format!("Failed to stage removals: {error}"))?;
        }
        _ => {
            index
                .add_all(TRACKED_PATHSPECS.iter(), IndexAddOption::DEFAULT, None)
                .map_err(|error| format!("Failed to stage changes: {error}"))?;
            index
                .update_all(TRACKED_PATHSPECS.iter(), None)
                .map_err(|error| format!("Failed to stage removals: {error}"))?;
        }
    }

    index
        .write()
        .map_err(|error| format!("Failed to write git index: {error}"))?;
    let tree_id = index
        .write_tree()
        .map_err(|error| format!("Failed to write git tree: {error}"))?;
    let tree = repo
        .find_tree(tree_id)
        .map_err(|error| format!("Failed to read git tree: {error}"))?;

    let parent_commit = repo.head().ok().and_then(|head| head.peel_to_commit().ok());
    let unchanged = match &parent_commit {
        Some(parent) => parent.tree_id() == tree_id,
        None => tree.is_empty(),
    };
    // 自動快照可能已經把這次修改收進 HEAD；「確認為新版本」仍要留下一筆標記用的
    // prompt-version commit，即使樹內容和上一筆相同（#56）。
    if unchanged && !allow_empty {
        return Ok(None);
    }

    let signature = repo
        .signature()
        .or_else(|_| Signature::now("NoteGen", "notegen@local"))
        .map_err(|error| format!("Failed to build commit signature: {error}"))?;
    let message = format_commit_message(summary, kind);
    let parents: Vec<&git2::Commit> = parent_commit.iter().collect();
    let oid = repo
        .commit(Some("HEAD"), &signature, &signature, &message, &tree, &parents)
        .map_err(|error| format!("Failed to create commit: {error}"))?;

    Ok(Some(GitVersionCommitInfo {
        id: oid.to_string(),
        kind,
    }))
}

fn commit_touches_path(repo: &Repository, commit: &git2::Commit, path: &str) -> Result<bool, String> {
    let tree = commit
        .tree()
        .map_err(|error| format!("Failed to read commit tree: {error}"))?;

    // 提示詞版本一定是針對這個 path 明確確認的（#56 的 allow_empty 可能讓樹內容和上一筆
    // 完全相同），不能只靠 diff 判斷有沒有「touch」，否則這種標記用的 commit 會從歷史裡消失。
    let (_, kind) = split_trailer(commit.message().unwrap_or_default());
    if kind == Some(VersionKind::PromptVersion) {
        return Ok(tree.get_path(Path::new(path)).is_ok());
    }

    let parent_tree = commit
        .parents()
        .next()
        .map(|parent| parent.tree())
        .transpose()
        .map_err(|error| format!("Failed to read parent tree: {error}"))?;
    let mut options = DiffOptions::new();
    options.pathspec(path);
    let diff = repo
        .diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut options))
        .map_err(|error| format!("Failed to diff commit: {error}"))?;
    Ok(diff.deltas().len() > 0)
}

fn to_log_entry(commit: &git2::Commit) -> GitVersionLogEntry {
    let (summary, kind) = split_trailer(commit.message().unwrap_or_default());
    let id = commit.id().to_string();
    GitVersionLogEntry {
        short_id: id.chars().take(7).collect(),
        id,
        summary,
        kind,
        author_name: commit.author().name().unwrap_or_default().to_string(),
        time_seconds: commit.time().seconds(),
    }
}

fn read_blob_at_commit(repo: &Repository, commit_id: &str, path: &str) -> Result<Option<String>, String> {
    let oid = Oid::from_str(commit_id).map_err(|error| format!("Invalid commit id: {error}"))?;
    let commit = repo
        .find_commit(oid)
        .map_err(|error| format!("Failed to read commit: {error}"))?;
    let tree = commit
        .tree()
        .map_err(|error| format!("Failed to read commit tree: {error}"))?;
    match tree.get_path(Path::new(path)) {
        Ok(entry) => {
            let object = entry
                .to_object(repo)
                .map_err(|error| format!("Failed to read tree entry: {error}"))?;
            let blob = object
                .as_blob()
                .ok_or_else(|| "Path does not point to a file".to_string())?;
            String::from_utf8(blob.content().to_vec())
                .map(Some)
                .map_err(|_| "File content is not valid UTF-8".to_string())
        }
        Err(error) if error.code() == ErrorCode::NotFound => Ok(None),
        Err(error) => Err(format!("Failed to read file from commit: {error}")),
    }
}

#[tauri::command]
pub fn git_version_detect(workspace_root: String) -> Result<GitVersionDetect, String> {
    let root = canonical_workspace_root(&workspace_root)?;
    Ok(GitVersionDetect {
        has_existing_repo: has_git_repo(&root),
    })
}

#[tauri::command]
pub fn git_version_enable(workspace_root: String) -> Result<GitVersionEnableResult, String> {
    let root = canonical_workspace_root(&workspace_root)?;
    let reused_existing = has_git_repo(&root);
    if !reused_existing {
        Repository::init(&root).map_err(|error| format!("Failed to initialize git repository: {error}"))?;
    }

    // 沿用既有 repo 時完全不碰它的設定，包括 .gitignore。
    let gitignore_path = root.join(".gitignore");
    let created_gitignore = if !reused_existing && !gitignore_path.exists() {
        fs::write(&gitignore_path, DEFAULT_GITIGNORE)
            .map_err(|error| format!("Failed to write default .gitignore: {error}"))?;
        true
    } else {
        false
    };

    Ok(GitVersionEnableResult {
        reused_existing,
        created_gitignore,
    })
}

#[tauri::command]
pub fn git_version_status(workspace_root: String) -> Result<GitVersionStatus, String> {
    let root = canonical_workspace_root(&workspace_root)?;
    let Ok(repo) = Repository::open(&root) else {
        return Ok(GitVersionStatus {
            is_repo: false,
            has_commits: false,
        });
    };
    let has_commits = repo.head().is_ok();
    Ok(GitVersionStatus {
        is_repo: true,
        has_commits,
    })
}

#[tauri::command]
pub fn git_version_commit(
    workspace_root: String,
    summary: String,
    kind: VersionKind,
    paths: Option<Vec<String>>,
    allow_empty: bool,
) -> Result<Option<GitVersionCommitInfo>, String> {
    let root = canonical_workspace_root(&workspace_root)?;
    commit_internal(&root, &summary, kind, paths.as_deref(), allow_empty)
}

#[tauri::command]
pub fn git_version_log(
    workspace_root: String,
    path: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<GitVersionLogEntry>, String> {
    let root = canonical_workspace_root(&workspace_root)?;
    let repo = open_repo(&root)?;
    let path = path.map(|value| validate_relative_path(&value)).transpose()?;
    let limit = limit.unwrap_or(50).max(1) as usize;

    let mut revwalk = repo
        .revwalk()
        .map_err(|error| format!("Failed to walk git history: {error}"))?;
    if revwalk.push_head().is_err() {
        return Ok(Vec::new());
    }
    revwalk
        .set_sorting(git2::Sort::TIME)
        .map_err(|error| format!("Failed to sort git history: {error}"))?;

    let mut entries = Vec::new();
    for oid in revwalk {
        let oid = oid.map_err(|error| format!("Failed to read git history: {error}"))?;
        let commit = repo
            .find_commit(oid)
            .map_err(|error| format!("Failed to read commit: {error}"))?;
        if let Some(path) = &path {
            if !commit_touches_path(&repo, &commit, path)? {
                continue;
            }
        }
        entries.push(to_log_entry(&commit));
        if entries.len() >= limit {
            break;
        }
    }
    Ok(entries)
}

#[tauri::command]
pub fn git_version_show(
    workspace_root: String,
    commit_id: String,
    path: String,
) -> Result<Option<String>, String> {
    let root = canonical_workspace_root(&workspace_root)?;
    let repo = open_repo(&root)?;
    let path = validate_relative_path(&path)?;
    read_blob_at_commit(&repo, &commit_id, &path)
}

#[tauri::command]
pub fn git_version_diff(
    workspace_root: String,
    commit_id: String,
    path: String,
) -> Result<GitVersionDiff, String> {
    let root = canonical_workspace_root(&workspace_root)?;
    let repo = open_repo(&root)?;
    let path = validate_relative_path(&path)?;
    let new_content = read_blob_at_commit(&repo, &commit_id, &path)?;
    let oid = Oid::from_str(&commit_id).map_err(|error| format!("Invalid commit id: {error}"))?;
    let commit = repo
        .find_commit(oid)
        .map_err(|error| format!("Failed to read commit: {error}"))?;
    let old_content = match commit.parent_id(0) {
        Ok(parent_id) => read_blob_at_commit(&repo, &parent_id.to_string(), &path)?,
        Err(_) => None,
    };
    Ok(GitVersionDiff {
        old_content,
        new_content,
    })
}

/// 前端在啟用/停用版本管理、切換工作區、或切換自動快照開關時呼叫，
/// 讓 `flush_pending_snapshot_on_exit` 在應用程式關閉時知道要不要、對哪個工作區做最後一次快照。
#[tauri::command]
pub fn git_version_set_auto_snapshot_context(
    state: State<GitVersionState>,
    workspace_root: Option<String>,
    auto_snapshot_enabled: bool,
    snapshot_summary: String,
) {
    let resolved_root = workspace_root.and_then(|value| canonical_workspace_root(&value).ok());
    let mut context = state.0.lock().unwrap_or_else(|error| error.into_inner());
    *context = GitVersionContext {
        workspace_root: resolved_root,
        auto_snapshot_enabled,
        snapshot_summary,
    };
}

/// 由 `main.rs` 在 `tauri::RunEvent::Exit` 呼叫；此時已經無法再對前端發訊息要多語系文案，
/// 所以文案改用前端先透過 `git_version_set_auto_snapshot_context` 存進來的值。
pub fn flush_pending_snapshot_on_exit(app: &AppHandle) {
    let Some(state) = app.try_state::<GitVersionState>() else {
        return;
    };
    let context = state.0.lock().unwrap_or_else(|error| error.into_inner()).clone();
    if !context.auto_snapshot_enabled {
        return;
    }
    let Some(root) = context.workspace_root else {
        return;
    };
    let summary = if context.snapshot_summary.is_empty() {
        FALLBACK_SNAPSHOT_SUMMARY
    } else {
        &context.snapshot_summary
    };
    if let Err(error) = commit_internal(&root, summary, VersionKind::AutoSnapshot, None, false) {
        eprintln!("[git-versions] exit snapshot failed: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use uuid::Uuid;

    struct TempWorkspace {
        path: PathBuf,
    }

    impl TempWorkspace {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("notegen-git-versions-{}", Uuid::new_v4()));
            fs::create_dir_all(&path).unwrap();
            Self { path }
        }

        fn root(&self) -> String {
            self.path.to_string_lossy().into_owned()
        }
    }

    impl Drop for TempWorkspace {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn detect_reports_no_existing_repo_for_a_plain_directory() {
        let workspace = TempWorkspace::new();
        let detected = git_version_detect(workspace.root()).unwrap();
        assert!(!detected.has_existing_repo);
    }

    #[test]
    fn enable_creates_repo_and_default_gitignore_for_a_new_vault() {
        let workspace = TempWorkspace::new();
        let result = git_version_enable(workspace.root()).unwrap();
        assert!(!result.reused_existing);
        assert!(result.created_gitignore);
        assert!(workspace.path.join(".git").is_dir());
        let gitignore = fs::read_to_string(workspace.path.join(".gitignore")).unwrap();
        assert!(gitignore.contains("!*.md"));
        assert!(gitignore.contains("!*.canvas"));
        assert!(gitignore.contains("!*.base"));
    }

    #[test]
    fn enable_reuses_existing_repo_without_touching_its_gitignore() {
        let workspace = TempWorkspace::new();
        Repository::init(&workspace.path).unwrap();
        fs::write(workspace.path.join(".gitignore"), "custom-rule\n").unwrap();

        let result = git_version_enable(workspace.root()).unwrap();
        assert!(result.reused_existing);
        assert!(!result.created_gitignore);
        let gitignore = fs::read_to_string(workspace.path.join(".gitignore")).unwrap();
        assert_eq!(gitignore, "custom-rule\n");
    }

    #[test]
    fn status_reports_repo_without_commits_before_first_snapshot() {
        let workspace = TempWorkspace::new();
        git_version_enable(workspace.root()).unwrap();
        let status = git_version_status(workspace.root()).unwrap();
        assert!(status.is_repo);
        assert!(!status.has_commits);
    }

    #[test]
    fn commit_ignores_attachments_and_tags_kind_via_trailer() {
        let workspace = TempWorkspace::new();
        git_version_enable(workspace.root()).unwrap();
        fs::write(workspace.path.join("note.md"), "# hello\n").unwrap();
        fs::write(workspace.path.join("image.png"), [0u8, 1, 2]).unwrap();

        let commit = git_version_commit(
            workspace.root(),
            "第一篇筆記".to_string(),
            VersionKind::AutoSnapshot,
            None,
            false,
        )
        .unwrap()
        .expect("expected a commit because note.md changed");
        assert_eq!(commit.kind, VersionKind::AutoSnapshot);

        let repo = open_repo(&workspace.path).unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        let tree = head.tree().unwrap();
        assert!(tree.get_path(Path::new("note.md")).is_ok());
        assert!(tree.get_path(Path::new("image.png")).is_err());

        let log = git_version_log(workspace.root(), None, None).unwrap();
        assert_eq!(log.len(), 1);
        assert_eq!(log[0].summary, "第一篇筆記");
        assert_eq!(log[0].kind, Some(VersionKind::AutoSnapshot));
    }

    #[test]
    fn commit_tracks_notes_in_nested_folders_but_still_ignores_their_attachments() {
        let workspace = TempWorkspace::new();
        git_version_enable(workspace.root()).unwrap();
        fs::create_dir_all(workspace.path.join("日記/assets")).unwrap();
        fs::write(workspace.path.join("日記/2026-10-26.md"), "今天\n").unwrap();
        fs::write(workspace.path.join("日記/assets/photo.png"), [0u8, 1, 2]).unwrap();

        let commit = git_version_commit(
            workspace.root(),
            "日記".to_string(),
            VersionKind::AutoSnapshot,
            None,
            false,
        )
        .unwrap()
        .expect("nested note changed");

        let repo = open_repo(&workspace.path).unwrap();
        let head_commit = repo.find_commit(Oid::from_str(&commit.id).unwrap()).unwrap();
        let tree = head_commit.tree().unwrap();
        assert!(tree.get_path(Path::new("日記/2026-10-26.md")).is_ok());
        assert!(tree.get_path(Path::new("日記/assets/photo.png")).is_err());
    }

    #[test]
    fn auto_snapshot_in_reused_repo_only_stages_text_notes() {
        let workspace = TempWorkspace::new();
        Repository::init(&workspace.path).unwrap();
        fs::write(workspace.path.join(".gitignore"), "custom-rule\n").unwrap();
        git_version_enable(workspace.root()).unwrap();
        fs::create_dir_all(workspace.path.join("assets")).unwrap();
        fs::write(workspace.path.join("assets/note.md"), "# hi\n").unwrap();
        fs::write(workspace.path.join("assets/photo.png"), [0u8, 1, 2]).unwrap();

        let commit = git_version_commit(
            workspace.root(),
            "snapshot".to_string(),
            VersionKind::AutoSnapshot,
            None,
            false,
        )
        .unwrap()
        .expect("note changed");

        let repo = open_repo(&workspace.path).unwrap();
        let tree = repo
            .find_commit(Oid::from_str(&commit.id).unwrap())
            .unwrap()
            .tree()
            .unwrap();
        assert!(tree.get_path(Path::new("assets/note.md")).is_ok());
        assert!(tree.get_path(Path::new("assets/photo.png")).is_err());
    }

    #[test]
    fn commit_is_a_noop_when_nothing_changed() {
        let workspace = TempWorkspace::new();
        git_version_enable(workspace.root()).unwrap();
        fs::write(workspace.path.join("note.md"), "# hello\n").unwrap();
        git_version_commit(
            workspace.root(),
            "first".to_string(),
            VersionKind::AutoSnapshot,
            None,
            false,
        )
        .unwrap();

        let second = git_version_commit(
            workspace.root(),
            "second".to_string(),
            VersionKind::AutoSnapshot,
            None,
            false,
        )
        .unwrap();
        assert!(second.is_none());
    }

    #[test]
    fn commit_with_explicit_paths_only_stages_those_paths() {
        let workspace = TempWorkspace::new();
        git_version_enable(workspace.root()).unwrap();
        fs::write(workspace.path.join("a.md"), "a\n").unwrap();
        fs::write(workspace.path.join("b.md"), "b\n").unwrap();

        git_version_commit(
            workspace.root(),
            "只存 a".to_string(),
            VersionKind::PromptVersion,
            Some(vec!["a.md".to_string()]),
            false,
        )
        .unwrap()
        .expect("a.md changed");

        let repo = open_repo(&workspace.path).unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        let tree = head.tree().unwrap();
        assert!(tree.get_path(Path::new("a.md")).is_ok());
        assert!(tree.get_path(Path::new("b.md")).is_err());
    }

    #[test]
    fn commit_without_allow_empty_is_still_a_noop_when_nothing_changed_for_that_path() {
        // 自動快照已經把這篇筆記的修改收進 HEAD 之後，「確認為新版本」沒傳 allow_empty
        // 就應該照舊是 no-op：不留下重複的 commit（#56）。
        let workspace = TempWorkspace::new();
        git_version_enable(workspace.root()).unwrap();
        fs::write(workspace.path.join("a.md"), "a\n").unwrap();
        git_version_commit(
            workspace.root(),
            "自動快照".to_string(),
            VersionKind::AutoSnapshot,
            None,
            false,
        )
        .unwrap()
        .expect("a.md changed");

        let noop = git_version_commit(
            workspace.root(),
            "確認為新版本".to_string(),
            VersionKind::PromptVersion,
            Some(vec!["a.md".to_string()]),
            false,
        )
        .unwrap();
        assert!(noop.is_none());
    }

    #[test]
    fn commit_with_allow_empty_still_commits_when_auto_snapshot_already_caught_up() {
        // 同一種情境：有 allow_empty 時要留下一筆新的 prompt-version commit 當確認標記，
        // 即使樹內容和上一筆（自動快照）相同（#56）。
        let workspace = TempWorkspace::new();
        git_version_enable(workspace.root()).unwrap();
        fs::write(workspace.path.join("a.md"), "a\n").unwrap();
        let first = git_version_commit(
            workspace.root(),
            "自動快照".to_string(),
            VersionKind::AutoSnapshot,
            None,
            false,
        )
        .unwrap()
        .expect("a.md changed");

        let confirmed = git_version_commit(
            workspace.root(),
            "確認為新版本".to_string(),
            VersionKind::PromptVersion,
            Some(vec!["a.md".to_string()]),
            true,
        )
        .unwrap()
        .expect("allow_empty should still create a commit");
        assert_ne!(confirmed.id, first.id);
        assert_eq!(confirmed.kind, VersionKind::PromptVersion);

        let log = git_version_log(workspace.root(), Some("a.md".to_string()), None).unwrap();
        assert_eq!(log[0].summary, "確認為新版本");
        assert_eq!(log[0].kind, Some(VersionKind::PromptVersion));
    }

    #[test]
    fn log_filters_commits_by_path() {
        let workspace = TempWorkspace::new();
        git_version_enable(workspace.root()).unwrap();
        fs::write(workspace.path.join("a.md"), "a\n").unwrap();
        git_version_commit(workspace.root(), "a1".to_string(), VersionKind::AutoSnapshot, None, false)
            .unwrap();
        fs::write(workspace.path.join("b.md"), "b\n").unwrap();
        git_version_commit(workspace.root(), "b1".to_string(), VersionKind::AutoSnapshot, None, false)
            .unwrap();
        fs::write(workspace.path.join("a.md"), "a2\n").unwrap();
        git_version_commit(workspace.root(), "a2".to_string(), VersionKind::AutoSnapshot, None, false)
            .unwrap();

        let log = git_version_log(workspace.root(), Some("a.md".to_string()), None).unwrap();
        let summaries: Vec<_> = log.iter().map(|entry| entry.summary.clone()).collect();
        assert_eq!(summaries, vec!["a2".to_string(), "a1".to_string()]);
    }

    #[test]
    fn show_and_diff_return_content_at_a_commit() {
        let workspace = TempWorkspace::new();
        git_version_enable(workspace.root()).unwrap();
        fs::write(workspace.path.join("note.md"), "v1\n").unwrap();
        let first = git_version_commit(workspace.root(), "v1".to_string(), VersionKind::AutoSnapshot, None, false)
            .unwrap()
            .unwrap();
        fs::write(workspace.path.join("note.md"), "v2\n").unwrap();
        let second = git_version_commit(workspace.root(), "v2".to_string(), VersionKind::AutoSnapshot, None, false)
            .unwrap()
            .unwrap();

        let shown = git_version_show(workspace.root(), first.id.clone(), "note.md".to_string())
            .unwrap();
        assert_eq!(shown, Some("v1\n".to_string()));

        let diff = git_version_diff(workspace.root(), second.id, "note.md".to_string()).unwrap();
        assert_eq!(diff.old_content, Some("v1\n".to_string()));
        assert_eq!(diff.new_content, Some("v2\n".to_string()));

        let diff_at_root = git_version_diff(workspace.root(), first.id, "note.md".to_string()).unwrap();
        assert_eq!(diff_at_root.old_content, None);
        assert_eq!(diff_at_root.new_content, Some("v1\n".to_string()));
    }

    #[test]
    fn show_returns_none_for_missing_path() {
        let workspace = TempWorkspace::new();
        git_version_enable(workspace.root()).unwrap();
        fs::write(workspace.path.join("note.md"), "v1\n").unwrap();
        let commit = git_version_commit(workspace.root(), "v1".to_string(), VersionKind::AutoSnapshot, None, false)
            .unwrap()
            .unwrap();

        let missing = git_version_show(workspace.root(), commit.id, "missing.md".to_string()).unwrap();
        assert_eq!(missing, None);
    }

    #[test]
    fn validate_relative_path_rejects_traversal_and_absolute_paths() {
        assert!(validate_relative_path("../escape.md").is_err());
        assert!(validate_relative_path("/etc/passwd").is_err());
        assert!(validate_relative_path("notes/a.md").is_ok());
    }

    #[test]
    fn split_trailer_round_trips_through_format_commit_message() {
        let message = format_commit_message("摘要", VersionKind::PromptVersion);
        let (summary, kind) = split_trailer(&message);
        assert_eq!(summary, "摘要");
        assert_eq!(kind, Some(VersionKind::PromptVersion));
    }

    #[test]
    fn split_trailer_returns_none_kind_for_foreign_commits() {
        let (summary, kind) = split_trailer("manual commit message");
        assert_eq!(summary, "manual commit message");
        assert_eq!(kind, None);
    }
}
