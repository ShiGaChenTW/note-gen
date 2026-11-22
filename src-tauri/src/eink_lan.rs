// Fork（almanac ALMNC-50）：電子紙的區網服務。
//
// 給電子紙（Xteink X4 Pro＋CrossPoint）在區網下載休眠畫面與今日簡報，和本機 MCP（local_mcp.rs）分開、預設關閉。
// 只提供這幾個資源（白名單，路由完全由程式寫死，不拿請求內容去拼檔案路徑）：
//   GET /eink/sleep.bmp                       休眠畫面（外掛用，token：?token= 或 Authorization: Bearer）
//   GET /eink/today.epub                      今日簡報（外掛用，同上）
//   GET /opds                                 OPDS 書目：今日簡報＋過去 7 天（HTTP Basic，帳號 almanac、密碼＝token）
//   GET /opds/books/almanac-YYYY-MM-DD.epub   OPDS 下載（HTTP Basic）
// 其他路徑一律 404；token 錯或沒帶回 401，同一個 IP 連錯 5 次就 10 分鐘內一律回 429。
//
// 內容怎麼來（橋接設計）：EPUB 與 BMP 的產生器是 TypeScript（src/lib/eink/epub、src/lib/eink/sleep），
// 所以由前端產生後推進這裡的快取（eink_lan_publish），伺服器只送「最後一份完整的位元組」：
//   - 請求進來時快取太舊（休眠畫面 2 分鐘、今日簡報 10 分鐘）或過了當天（validUntil），就發事件
//     eink-lan-refresh 請前端重算，最多等 6 秒；前端只在今日簡報的資料真的變了才重做 EPUB。
//   - 一律整份送出並帶 Content-Length：CrossPoint 先下載到 dest.part，回應完整且是 2xx 才換掉舊檔
//     （crosspoint-reader develop@ca1a8c1 src/util/PluginEvents.cpp、src/util/PluginHttp.cpp requestToFile）。
//   - 沒有當天可用的內容就回 503；Mac 睡眠或 app 關閉時根本連不上。兩種情況電子紙都沿用舊圖，不會留下壞檔。
//   - 今日簡報整份送完後發事件 eink-lan-downloaded，前端才呼叫 commitSent（ALMNC-47 的「真的送出才算已送」）。
//   - 每天的 EPUB 另存一份在 app 資料夾 eink-lan/（檔名只由驗證過的日期組成），保留最新 8 天給 OPDS。
//
// 綁定位址：只綁這台 Mac 的區網 IPv4（RFC 1918／link-local），不綁 0.0.0.0，免得 VPN 或其他介面也聽得到；
// 找不到區網 IP 就不啟動並回報錯誤。token 只在記憶體裡比對（先各自 SHA-256 再逐位元比較），不寫進任何 log。
use axum::{
    body::{Body, Bytes},
    extract::{ConnectInfo, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode, Uri},
    response::{IntoResponse, Response},
    Router,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeSet, HashMap, VecDeque},
    net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket},
    path::PathBuf,
    pin::Pin,
    sync::{Arc, Mutex},
    task::{Context, Poll},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State as TauriState};
use tokio::sync::{oneshot, Notify};

const MAX_FAILURES: usize = 5;
const FAILURE_WINDOW: Duration = Duration::from_secs(10 * 60);
const LOCKOUT: Duration = Duration::from_secs(10 * 60);
const MAX_TRACKED_IPS: usize = 1024;
const SLEEP_FRESH: Duration = Duration::from_secs(2 * 60);
const EPUB_FRESH: Duration = Duration::from_secs(10 * 60);
const REFRESH_WAIT: Duration = Duration::from_secs(6);
/// 前端推進來的單一檔案上限（EPUB 產生器盡量壓在 1 MB 內；OPDS 下載沒有 1 MB 限制，留點餘裕）。
const MAX_PUBLISH_BYTES: usize = 8 * 1024 * 1024;
const ARCHIVE_KEEP: usize = 8;
const CHUNK_BYTES: usize = 16 * 1024;
pub const OPDS_USER: &str = "almanac";
const ARCHIVE_DIR: &str = "eink-lan";

pub const EVENT_REFRESH: &str = "eink-lan-refresh";
pub const EVENT_DOWNLOADED: &str = "eink-lan-downloaded";

// ---------------------------------------------------------------------------
// 路由白名單（純函式，有路徑穿越測試）
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Eq)]
enum Route {
    Sleep,
    TodayEpub,
    OpdsRoot,
    OpdsBook(String),
}

/// 只認得寫死的幾條路徑；`..`、編碼過的 `%2e%2e`、重複斜線、多一層目錄都對不上而回 None（404）。
fn route(path: &str) -> Option<Route> {
    match path {
        "/eink/sleep.bmp" => Some(Route::Sleep),
        "/eink/today.epub" => Some(Route::TodayEpub),
        "/opds" | "/opds/" => Some(Route::OpdsRoot),
        _ => {
            let name = path.strip_prefix("/opds/books/")?;
            let date = name.strip_prefix("almanac-")?.strip_suffix(".epub")?;
            is_valid_date(date).then(|| Route::OpdsBook(date.to_string()))
        }
    }
}

/// YYYY-MM-DD，只有數字與兩個連字號。
fn is_valid_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    if !bytes
        .iter()
        .enumerate()
        .all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit())
    {
        return false;
    }
    let month: u32 = value[5..7].parse().unwrap_or(0);
    let day: u32 = value[8..10].parse().unwrap_or(0);
    (1..=12).contains(&month) && (1..=31).contains(&day)
}

fn archive_file_name(date: &str) -> String {
    format!("almanac-{date}.epub")
}

// ---------------------------------------------------------------------------
// 驗證：token、HTTP Basic、常數時間比較
// ---------------------------------------------------------------------------

/// 先各自做 SHA-256 再逐位元比較：長度不同也花一樣的時間，不會從回應時間猜出 token。
fn constant_time_eq(a: &str, b: &str) -> bool {
    let left = Sha256::digest(a.as_bytes());
    let right = Sha256::digest(b.as_bytes());
    left.iter()
        .zip(right.iter())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}

pub fn is_valid_token(value: &str) -> bool {
    (32..=128).contains(&value.len()) && value.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// 外掛的 token：網址參數 `token=`，或標頭 `Authorization: Bearer …`（ALMNC-44 確認哪種可行前兩種都收）。
fn plugin_token(uri: &Uri, headers: &HeaderMap) -> Option<String> {
    if let Some(value) = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
    {
        return Some(value.trim().to_string());
    }
    let query = uri.query()?;
    url::form_urlencoded::parse(query.as_bytes())
        .find(|(key, _)| key == "token")
        .map(|(_, value)| value.into_owned())
}

/// HTTP Basic 的帳號密碼。
fn basic_credentials(headers: &HeaderMap) -> Option<(String, String)> {
    let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let encoded = value
        .strip_prefix("Basic ")
        .or_else(|| value.strip_prefix("basic "))?;
    let decoded = STANDARD.decode(encoded.trim()).ok()?;
    let text = String::from_utf8(decoded).ok()?;
    let (user, password) = text.split_once(':')?;
    Some((user.to_string(), password.to_string()))
}

// ---------------------------------------------------------------------------
// 連錯幾次後暫時拒絕
// ---------------------------------------------------------------------------

#[derive(Default)]
struct FailureEntry {
    failures: VecDeque<Instant>,
    locked_until: Option<Instant>,
}

struct FailureLimiter {
    max_failures: usize,
    window: Duration,
    lockout: Duration,
    entries: HashMap<IpAddr, FailureEntry>,
}

impl FailureLimiter {
    fn new(max_failures: usize, window: Duration, lockout: Duration) -> Self {
        Self {
            max_failures,
            window,
            lockout,
            entries: HashMap::new(),
        }
    }

    /// 還在封鎖中就回傳剩下的時間。
    fn locked(&mut self, ip: IpAddr, now: Instant) -> Option<Duration> {
        let entry = self.entries.get_mut(&ip)?;
        match entry.locked_until {
            Some(until) if until > now => Some(until - now),
            Some(_) => {
                self.entries.remove(&ip);
                None
            }
            None => None,
        }
    }

    /// 記一次失敗；這次剛好達到上限就開始封鎖並回 true。
    fn record_failure(&mut self, ip: IpAddr, now: Instant) -> bool {
        if self.entries.len() >= MAX_TRACKED_IPS && !self.entries.contains_key(&ip) {
            let window = self.window;
            self.entries.retain(|_, entry| {
                entry.locked_until.is_some_and(|until| until > now)
                    || entry
                        .failures
                        .back()
                        .is_some_and(|last| now.duration_since(*last) < window)
            });
        }
        let entry = self.entries.entry(ip).or_default();
        while entry
            .failures
            .front()
            .is_some_and(|first| now.duration_since(*first) >= self.window)
        {
            entry.failures.pop_front();
        }
        entry.failures.push_back(now);
        if entry.failures.len() >= self.max_failures {
            entry.locked_until = Some(now + self.lockout);
            entry.failures.clear();
            return true;
        }
        false
    }

    fn record_success(&mut self, ip: IpAddr) {
        self.entries.remove(&ip);
    }
}

// ---------------------------------------------------------------------------
// 快取與每日存檔
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AssetKind {
    Sleep,
    Epub,
}

#[derive(Clone)]
struct Asset {
    bytes: Bytes,
    date: String,
    hash: String,
    title: String,
    /// 推進來的時間（毫秒，OPDS 的 updated 用）
    published_at_ms: u64,
    /// 推進來的時間（單調時鐘，判斷新不新鮮用）
    published: Instant,
    /// 過了這個時間（毫秒）就不是「今天」的內容了：前端給的本地隔天零點
    valid_until_ms: u64,
}

struct Archive {
    dir: Option<PathBuf>,
    /// 日期 → OPDS 顯示的標題
    entries: std::collections::BTreeMap<String, ArchiveEntry>,
}

#[derive(Clone)]
struct ArchiveEntry {
    title: String,
    published_at_ms: u64,
}

impl Archive {
    fn new() -> Self {
        Self {
            dir: None,
            entries: Default::default(),
        }
    }

    /// 讀資料夾裡已存的 almanac-YYYY-MM-DD.epub（其他檔名一律忽略）。
    fn load(&mut self, dir: PathBuf) {
        let _ = std::fs::create_dir_all(&dir);
        if let Ok(read) = std::fs::read_dir(&dir) {
            for item in read.flatten() {
                let name = item.file_name();
                let Some(name) = name.to_str() else { continue };
                let Some(date) = name
                    .strip_prefix("almanac-")
                    .and_then(|rest| rest.strip_suffix(".epub"))
                else {
                    continue;
                };
                if !is_valid_date(date) {
                    continue;
                }
                let modified = item
                    .metadata()
                    .and_then(|meta| meta.modified())
                    .ok()
                    .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                    .map(|elapsed| elapsed.as_millis() as u64)
                    .unwrap_or(0);
                self.entries.insert(
                    date.to_string(),
                    ArchiveEntry {
                        title: date.to_string(),
                        published_at_ms: modified,
                    },
                );
            }
        }
        self.dir = Some(dir);
        self.prune();
    }

    /// 先寫暫存檔再改名，存到一半當掉也不會留下半個 EPUB。
    fn store(&mut self, date: &str, title: &str, bytes: &[u8], published_at_ms: u64) -> Result<(), String> {
        if !is_valid_date(date) {
            return Err("invalid date".into());
        }
        if let Some(dir) = &self.dir {
            let target = dir.join(archive_file_name(date));
            let temp = dir.join(format!(".{}.tmp", archive_file_name(date)));
            std::fs::write(&temp, bytes).map_err(|error| error.to_string())?;
            std::fs::rename(&temp, &target).map_err(|error| {
                let _ = std::fs::remove_file(&temp);
                error.to_string()
            })?;
        }
        self.entries.insert(
            date.to_string(),
            ArchiveEntry {
                title: title.to_string(),
                published_at_ms,
            },
        );
        self.prune();
        Ok(())
    }

    fn prune(&mut self) {
        while self.entries.len() > ARCHIVE_KEEP {
            let Some(oldest) = self.entries.keys().next().cloned() else { break };
            self.entries.remove(&oldest);
            if let Some(dir) = &self.dir {
                let _ = std::fs::remove_file(dir.join(archive_file_name(&oldest)));
            }
        }
    }

    /// 只讀清單裡有的日期；路徑由驗證過的日期組成。
    fn read(&self, date: &str) -> Option<Vec<u8>> {
        if !is_valid_date(date) || !self.entries.contains_key(date) {
            return None;
        }
        std::fs::read(self.dir.as_ref()?.join(archive_file_name(date))).ok()
    }

    fn dates(&self) -> BTreeSet<String> {
        self.entries.keys().cloned().collect()
    }
}

// ---------------------------------------------------------------------------
// 共用核心（伺服器與指令都用；測試不需要 AppHandle）
// ---------------------------------------------------------------------------

pub trait LanHooks: Send + Sync {
    /// 請前端重算某種內容
    fn refresh(&self, kind: AssetKind);
    /// 今日簡報整份送出去了（前端收到後呼叫 commitSent）
    fn downloaded(&self, kind: AssetKind, date: &str, hash: &str);
}

struct NoHooks;
impl LanHooks for NoHooks {
    fn refresh(&self, _kind: AssetKind) {}
    fn downloaded(&self, _kind: AssetKind, _date: &str, _hash: &str) {}
}

struct Core {
    token: Mutex<Option<String>>,
    assets: Mutex<HashMap<AssetKind, Asset>>,
    archive: Mutex<Archive>,
    limiter: Mutex<FailureLimiter>,
    published: Notify,
    hooks: Mutex<Arc<dyn LanHooks>>,
    refresh_wait: Duration,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

impl Core {
    fn new() -> Self {
        Self {
            token: Mutex::new(None),
            assets: Mutex::new(HashMap::new()),
            archive: Mutex::new(Archive::new()),
            limiter: Mutex::new(FailureLimiter::new(MAX_FAILURES, FAILURE_WINDOW, LOCKOUT)),
            published: Notify::new(),
            hooks: Mutex::new(Arc::new(NoHooks)),
            refresh_wait: REFRESH_WAIT,
        }
    }

    fn hooks(&self) -> Arc<dyn LanHooks> {
        self.hooks.lock().map(|hooks| hooks.clone()).unwrap_or_else(|_| Arc::new(NoHooks))
    }

    fn token_matches(&self, candidate: &str) -> bool {
        let token = self.token.lock().ok().and_then(|token| token.clone());
        match token {
            Some(token) => constant_time_eq(&token, candidate),
            None => false,
        }
    }

    fn publish(&self, kind: AssetKind, date: &str, hash: &str, title: &str, valid_until_ms: u64, bytes: Vec<u8>) -> Result<(), String> {
        if !is_valid_date(date) {
            return Err("invalid date".into());
        }
        if bytes.is_empty() || bytes.len() > MAX_PUBLISH_BYTES {
            return Err(format!("invalid size: {}", bytes.len()));
        }
        let hash: String = hash.chars().filter(|c| c.is_ascii_hexdigit()).take(64).collect();
        let title: String = title.chars().filter(|c| !c.is_control()).take(120).collect();
        let published_at_ms = now_ms();
        if kind == AssetKind::Epub {
            self.archive
                .lock()
                .map_err(|_| "archive unavailable".to_string())?
                .store(date, &title, &bytes, published_at_ms)?;
        }
        let asset = Asset {
            bytes: Bytes::from(bytes),
            date: date.to_string(),
            hash,
            title,
            published_at_ms,
            published: Instant::now(),
            valid_until_ms,
        };
        self.assets
            .lock()
            .map_err(|_| "cache unavailable".to_string())?
            .insert(kind, asset);
        self.published.notify_waiters();
        Ok(())
    }

    fn current(&self, kind: AssetKind) -> Option<Asset> {
        self.assets.lock().ok()?.get(&kind).cloned()
    }

    /// 取得當天可用的內容；太舊就請前端重算並等一下。沒有當天的內容回 None（→ 503，電子紙沿用舊檔）。
    async fn fresh(&self, kind: AssetKind, max_age: Duration) -> Option<Asset> {
        let requested = Instant::now();
        let stale = |asset: &Option<Asset>| match asset {
            Some(asset) => asset.published.elapsed() > max_age || now_ms() >= asset.valid_until_ms,
            None => true,
        };
        if stale(&self.current(kind)) {
            let wait = async {
                loop {
                    let notified = self.published.notified();
                    tokio::pin!(notified);
                    notified.as_mut().enable();
                    if self.current(kind).is_some_and(|asset| asset.published >= requested) {
                        return;
                    }
                    notified.await;
                }
            };
            self.hooks().refresh(kind);
            let _ = tokio::time::timeout(self.refresh_wait, wait).await;
        }
        self.current(kind).filter(|asset| now_ms() < asset.valid_until_ms)
    }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/// 一塊一塊交給 hyper（hyper 有背壓：前一塊寫出去才來要下一塊）。
/// 有 Content-Length 時 hyper 送滿長度就不再要下一塊，直接把 body 丟掉；
/// 所以「整份送完」＝ body 被丟掉時每一塊都已經交出去。中途斷線時 body 被丟掉但還有沒交出的塊，不算送完。
struct CompletionStream {
    chunks: VecDeque<Bytes>,
    on_complete: Option<Box<dyn FnOnce() + Send>>,
}

impl futures_util::Stream for CompletionStream {
    type Item = Result<Bytes, std::io::Error>;

    fn poll_next(mut self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        Poll::Ready(self.chunks.pop_front().map(Ok))
    }
}

impl Drop for CompletionStream {
    fn drop(&mut self) {
        if self.chunks.is_empty() {
            if let Some(done) = self.on_complete.take() {
                done();
            }
        }
    }
}

fn file_response(bytes: Bytes, content_type: &'static str, file_name: Option<&str>, on_complete: Option<Box<dyn FnOnce() + Send>>) -> Response {
    let length = bytes.len();
    let body = match on_complete {
        Some(done) => {
            let mut chunks = VecDeque::new();
            let mut offset = 0;
            while offset < length {
                let end = (offset + CHUNK_BYTES).min(length);
                chunks.push_back(bytes.slice(offset..end));
                offset = end;
            }
            Body::from_stream(CompletionStream {
                chunks,
                on_complete: Some(done),
            })
        }
        None => Body::from(bytes),
    };
    let mut response = Response::new(body);
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    headers.insert(header::CONTENT_LENGTH, HeaderValue::from(length));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    if let Some(name) = file_name {
        if let Ok(value) = HeaderValue::from_str(&format!("attachment; filename=\"{name}\"")) {
            headers.insert(header::CONTENT_DISPOSITION, value);
        }
    }
    response
}

fn status(code: StatusCode) -> Response {
    let mut response = (code, code.canonical_reason().unwrap_or("")).into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

fn unauthorized(basic: bool) -> Response {
    let mut response = status(StatusCode::UNAUTHORIZED);
    if basic {
        response.headers_mut().insert(
            header::WWW_AUTHENTICATE,
            HeaderValue::from_static("Basic realm=\"almanac\", charset=\"UTF-8\""),
        );
    }
    response
}

fn xml_escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for c in value.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            c if c.is_control() => {}
            c => out.push(c),
        }
    }
    out
}

/// 毫秒 → RFC 3339（UTC）。
fn rfc3339(ms: u64) -> String {
    let secs = (ms / 1000) as i64;
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    // Howard Hinnant 的 civil_from_days
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

struct FeedEntry {
    date: String,
    title: String,
    updated_ms: u64,
}

/// OPDS 1.2 取書書目（Atom）。連結用伺服器上的絕對路徑，由閱讀器對書目網址解析。
fn opds_feed(entries: &[FeedEntry]) -> String {
    let updated = entries.iter().map(|entry| entry.updated_ms).max().unwrap_or(0);
    let mut xml = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    xml.push_str("<feed xmlns=\"http://www.w3.org/2005/Atom\" xmlns:opds=\"http://opds-spec.org/2010/catalog\">\n");
    xml.push_str("  <id>urn:almanac:eink:opds</id>\n  <title>Almanac</title>\n");
    xml.push_str(&format!("  <updated>{}</updated>\n", rfc3339(updated)));
    xml.push_str("  <author><name>NoteGen</name></author>\n");
    xml.push_str("  <link rel=\"self\" href=\"/opds\" type=\"application/atom+xml;profile=opds-catalog;kind=acquisition\"/>\n");
    xml.push_str("  <link rel=\"start\" href=\"/opds\" type=\"application/atom+xml;profile=opds-catalog;kind=acquisition\"/>\n");
    for entry in entries {
        let title = if entry.title.is_empty() { entry.date.as_str() } else { entry.title.as_str() };
        xml.push_str("  <entry>\n");
        xml.push_str(&format!("    <id>urn:almanac:briefing:{}</id>\n", entry.date));
        xml.push_str(&format!("    <title>{}</title>\n", xml_escape(title)));
        xml.push_str(&format!("    <updated>{}</updated>\n", rfc3339(entry.updated_ms)));
        xml.push_str("    <author><name>NoteGen</name></author>\n");
        xml.push_str(&format!(
            "    <link rel=\"http://opds-spec.org/acquisition\" href=\"/opds/books/{}\" type=\"application/epub+zip\"/>\n",
            archive_file_name(&entry.date)
        ));
        xml.push_str("  </entry>\n");
    }
    xml.push_str("</feed>\n");
    xml
}

#[derive(Clone)]
struct HttpState {
    core: Arc<Core>,
}

fn epub_download(core: &Arc<Core>, asset: Asset, file_name: String) -> Response {
    let hooks = core.hooks();
    let (date, hash) = (asset.date.clone(), asset.hash.clone());
    file_response(
        asset.bytes,
        "application/epub+zip",
        Some(&file_name),
        Some(Box::new(move || hooks.downloaded(AssetKind::Epub, &date, &hash))),
    )
}

async fn handle(
    State(state): State<HttpState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
) -> Response {
    let core = state.core;
    let ip = peer.ip();
    if let Some(remaining) = core.limiter.lock().ok().and_then(|mut limiter| limiter.locked(ip, Instant::now())) {
        let mut response = status(StatusCode::TOO_MANY_REQUESTS);
        if let Ok(value) = HeaderValue::from_str(&remaining.as_secs().max(1).to_string()) {
            response.headers_mut().insert(header::RETRY_AFTER, value);
        }
        return response;
    }
    let Some(route) = route(uri.path()) else {
        return status(StatusCode::NOT_FOUND);
    };
    if method != Method::GET && method != Method::HEAD {
        return status(StatusCode::METHOD_NOT_ALLOWED);
    }

    let basic = matches!(route, Route::OpdsRoot | Route::OpdsBook(_));
    let authorized = if basic {
        basic_credentials(&headers)
            .is_some_and(|(user, password)| constant_time_eq(&user, OPDS_USER) & core.token_matches(&password))
    } else {
        plugin_token(&uri, &headers).is_some_and(|token| core.token_matches(&token))
    };
    if let Ok(mut limiter) = core.limiter.lock() {
        if authorized {
            limiter.record_success(ip);
        } else {
            limiter.record_failure(ip, Instant::now());
        }
    }
    if !authorized {
        return unauthorized(basic);
    }

    match route {
        Route::Sleep => match core.fresh(AssetKind::Sleep, SLEEP_FRESH).await {
            Some(asset) => file_response(asset.bytes, "image/bmp", None, None),
            None => status(StatusCode::SERVICE_UNAVAILABLE),
        },
        Route::TodayEpub => match core.fresh(AssetKind::Epub, EPUB_FRESH).await {
            Some(asset) => {
                let name = archive_file_name(&asset.date);
                epub_download(&core, asset, name)
            }
            None => status(StatusCode::SERVICE_UNAVAILABLE),
        },
        Route::OpdsRoot => {
            let today = core.fresh(AssetKind::Epub, EPUB_FRESH).await;
            let mut entries: Vec<FeedEntry> = Vec::new();
            if let Some(asset) = &today {
                entries.push(FeedEntry {
                    date: asset.date.clone(),
                    title: asset.title.clone(),
                    updated_ms: asset.published_at_ms,
                });
            }
            if let Ok(archive) = core.archive.lock() {
                for (date, entry) in archive.entries.iter().rev() {
                    if entries.iter().any(|existing| &existing.date == date) {
                        continue;
                    }
                    entries.push(FeedEntry {
                        date: date.clone(),
                        title: entry.title.clone(),
                        updated_ms: entry.published_at_ms,
                    });
                }
            }
            entries.truncate(ARCHIVE_KEEP);
            let mut response = Response::new(Body::from(opds_feed(&entries)));
            response.headers_mut().insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/atom+xml;profile=opds-catalog;kind=acquisition; charset=utf-8"),
            );
            response
                .headers_mut()
                .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            response
        }
        Route::OpdsBook(date) => {
            let name = archive_file_name(&date);
            // 今天的那本走快取（才會在送完後記成已送）；過去的從存檔讀
            if let Some(cached) = core.current(AssetKind::Epub).filter(|asset| asset.date == date) {
                let asset = core
                    .fresh(AssetKind::Epub, EPUB_FRESH)
                    .await
                    .filter(|fresh| fresh.date == date)
                    .unwrap_or(cached);
                return epub_download(&core, asset, name);
            }
            let bytes = core.archive.lock().ok().and_then(|archive| archive.read(&date));
            match bytes {
                Some(bytes) => file_response(Bytes::from(bytes), "application/epub+zip", Some(&name), None),
                None => status(StatusCode::NOT_FOUND),
            }
        }
    }
}

fn router(core: Arc<Core>) -> Router {
    Router::new().fallback(handle).with_state(HttpState { core })
}

struct ServerHandle {
    address: SocketAddr,
    shutdown: oneshot::Sender<()>,
}

async fn serve(core: Arc<Core>, address: SocketAddr) -> Result<ServerHandle, String> {
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .map_err(|error| error.to_string())?;
    let address = listener.local_addr().map_err(|error| error.to_string())?;
    let (shutdown, receiver) = oneshot::channel::<()>();
    let app = router(core).into_make_service_with_connect_info::<SocketAddr>();
    tokio::spawn(async move {
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = receiver.await;
            })
            .await;
    });
    Ok(ServerHandle { address, shutdown })
}

/// 這台 Mac 在區網的 IPv4：用 UDP connect 問系統「往外走哪張網卡」（不會真的送出封包），只接受私有／link-local 位址。
fn detect_lan_ipv4() -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket.connect((Ipv4Addr::new(192, 0, 2, 1), 9)).ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(ip) if is_lan_ipv4(ip) => Some(ip),
        _ => None,
    }
}

fn is_lan_ipv4(ip: Ipv4Addr) -> bool {
    ip.is_private() || ip.is_link_local()
}

// ---------------------------------------------------------------------------
// Tauri 狀態與指令
// ---------------------------------------------------------------------------

pub struct EinkLanState {
    core: Arc<Core>,
    server: tokio::sync::Mutex<Option<ServerHandle>>,
    error: Mutex<Option<String>>,
    initialized: Mutex<bool>,
}

impl EinkLanState {
    pub fn new() -> Self {
        Self {
            core: Arc::new(Core::new()),
            server: tokio::sync::Mutex::new(None),
            error: Mutex::new(None),
            initialized: Mutex::new(false),
        }
    }
}

struct TauriHooks {
    app: AppHandle,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadedPayload {
    kind: AssetKind,
    date: String,
    hash: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RefreshPayload {
    kind: AssetKind,
}

impl LanHooks for TauriHooks {
    fn refresh(&self, kind: AssetKind) {
        let _ = self.app.emit(EVENT_REFRESH, RefreshPayload { kind });
    }
    fn downloaded(&self, kind: AssetKind, date: &str, hash: &str) {
        let _ = self.app.emit(
            EVENT_DOWNLOADED,
            DownloadedPayload {
                kind,
                date: date.to_string(),
                hash: hash.to_string(),
            },
        );
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetView {
    date: String,
    size: usize,
    published_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EinkLanStatus {
    running: bool,
    /// 實際綁定的位址，例如 192.168.1.5:37424
    address: Option<String>,
    /// 現在偵測到的區網 IP（和 address 不同時，設定頁提示重新套用）
    lan_ip: Option<String>,
    error: Option<String>,
    sleep: Option<AssetView>,
    epub: Option<AssetView>,
    archived: Vec<String>,
}

fn asset_view(asset: Option<Asset>) -> Option<AssetView> {
    asset.map(|asset| AssetView {
        date: asset.date,
        size: asset.bytes.len(),
        published_at: asset.published_at_ms,
    })
}

async fn build_status(state: &EinkLanState) -> EinkLanStatus {
    let server = state.server.lock().await;
    EinkLanStatus {
        running: server.is_some(),
        address: server.as_ref().map(|handle| handle.address.to_string()),
        lan_ip: detect_lan_ipv4().map(|ip| ip.to_string()),
        error: state.error.lock().ok().and_then(|error| error.clone()),
        sleep: asset_view(state.core.current(AssetKind::Sleep)),
        epub: asset_view(state.core.current(AssetKind::Epub)),
        archived: state
            .core
            .archive
            .lock()
            .map(|archive| archive.dates().into_iter().collect())
            .unwrap_or_default(),
    }
}

fn ensure_initialized(app: &AppHandle, state: &EinkLanState) {
    let Ok(mut initialized) = state.initialized.lock() else { return };
    if *initialized {
        return;
    }
    *initialized = true;
    if let Ok(mut hooks) = state.core.hooks.lock() {
        *hooks = Arc::new(TauriHooks { app: app.clone() });
    }
    if let Ok(dir) = app.path().app_data_dir() {
        if let Ok(mut archive) = state.core.archive.lock() {
            archive.load(dir.join(ARCHIVE_DIR));
        }
    }
}

fn set_error(state: &EinkLanState, error: Option<String>) {
    if let Ok(mut slot) = state.error.lock() {
        *slot = error;
    }
}

/// 套用設定：關閉就停掉服務；開啟就綁到區網 IP 的指定埠（IP 或埠變了才重綁）。
#[tauri::command]
pub async fn eink_lan_configure(
    app: AppHandle,
    state: TauriState<'_, EinkLanState>,
    enabled: bool,
    port: u16,
    token: String,
) -> Result<EinkLanStatus, String> {
    ensure_initialized(&app, &state);
    let mut server = state.server.lock().await;
    if !enabled {
        if let Some(handle) = server.take() {
            let _ = handle.shutdown.send(());
        }
        if let Ok(mut slot) = state.core.token.lock() {
            *slot = None;
        }
        drop(server);
        set_error(&state, None);
        return Ok(build_status(&state).await);
    }
    if port < 1024 {
        drop(server);
        set_error(&state, Some("port must be 1024 or higher".into()));
        return Ok(build_status(&state).await);
    }
    if !is_valid_token(&token) {
        drop(server);
        set_error(&state, Some("invalid token".into()));
        return Ok(build_status(&state).await);
    }
    if let Ok(mut slot) = state.core.token.lock() {
        *slot = Some(token);
    }
    let Some(ip) = detect_lan_ipv4() else {
        if let Some(handle) = server.take() {
            let _ = handle.shutdown.send(());
        }
        drop(server);
        set_error(&state, Some("no LAN IPv4 address".into()));
        return Ok(build_status(&state).await);
    };
    let address = SocketAddr::new(IpAddr::V4(ip), port);
    if server.as_ref().is_some_and(|handle| handle.address == address) {
        drop(server);
        set_error(&state, None);
        return Ok(build_status(&state).await);
    }
    if let Some(handle) = server.take() {
        let _ = handle.shutdown.send(());
    }
    match serve(state.core.clone(), address).await {
        Ok(handle) => {
            *server = Some(handle);
            drop(server);
            set_error(&state, None);
        }
        Err(error) => {
            drop(server);
            set_error(&state, Some(error));
        }
    }
    Ok(build_status(&state).await)
}

#[tauri::command]
pub async fn eink_lan_status(app: AppHandle, state: TauriState<'_, EinkLanState>) -> Result<EinkLanStatus, String> {
    ensure_initialized(&app, &state);
    Ok(build_status(&state).await)
}

/// 前端把產生好的休眠畫面或今日簡報推進快取（bytes 是 base64）。
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn eink_lan_publish(
    app: AppHandle,
    state: TauriState<'_, EinkLanState>,
    kind: AssetKind,
    date: String,
    hash: String,
    title: String,
    valid_until: u64,
    bytes: String,
) -> Result<(), String> {
    ensure_initialized(&app, &state);
    let bytes = STANDARD.decode(bytes.as_bytes()).map_err(|_| "invalid bytes".to_string())?;
    state.core.publish(kind, &date, &hash, &title, valid_until, bytes)
}

// ---------------------------------------------------------------------------
// 測試
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::sync::atomic::{AtomicUsize, Ordering};

    const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef";

    #[derive(Default)]
    struct RecordingHooks {
        refreshes: AtomicUsize,
        downloads: Mutex<Vec<(AssetKind, String, String)>>,
    }
    impl LanHooks for RecordingHooks {
        fn refresh(&self, _kind: AssetKind) {
            self.refreshes.fetch_add(1, Ordering::SeqCst);
        }
        fn downloaded(&self, kind: AssetKind, date: &str, hash: &str) {
            self.downloads
                .lock()
                .unwrap()
                .push((kind, date.to_string(), hash.to_string()));
        }
    }

    fn tomorrow_ms() -> u64 {
        now_ms() + 86_400_000
    }

    fn core_with(hooks: Arc<RecordingHooks>) -> Arc<Core> {
        let mut core = Core::new();
        core.refresh_wait = Duration::from_millis(200);
        *core.token.lock().unwrap() = Some(TOKEN.to_string());
        *core.hooks.lock().unwrap() = hooks;
        Arc::new(core)
    }

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("almanac-eink-lan-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    // ---- 路由白名單與路徑穿越 ----

    #[test]
    fn routes_only_the_allow_list() {
        assert_eq!(route("/eink/sleep.bmp"), Some(Route::Sleep));
        assert_eq!(route("/eink/today.epub"), Some(Route::TodayEpub));
        assert_eq!(route("/opds"), Some(Route::OpdsRoot));
        assert_eq!(route("/opds/"), Some(Route::OpdsRoot));
        assert_eq!(
            route("/opds/books/almanac-2026-11-21.epub"),
            Some(Route::OpdsBook("2026-11-21".into()))
        );
        for path in [
            "/",
            "/eink",
            "/eink/",
            "/eink/sleep.BMP",
            "/eink/other.bmp",
            "/eink/sleep.bmp/",
            "/mcp",
            "/opds/books/",
            "/opds/books/almanac-2026-13-01.epub",
            "/opds/books/almanac-2026-11-00.epub",
            "/opds/books/almanac-2026-11-2a.epub",
            "/opds/books/notes.md",
            "/opds/books/almanac-2026-11-21.epub/extra",
        ] {
            assert_eq!(route(path), None, "{path}");
        }
    }

    #[test]
    fn path_traversal_never_matches() {
        for path in [
            "/eink/../eink/sleep.bmp",
            "/eink/../../etc/passwd",
            "/eink/%2e%2e/%2e%2e/etc/passwd",
            "/eink/%2E%2E/sleep.bmp",
            "/eink/..%2fsleep.bmp",
            "/eink//sleep.bmp",
            "//eink/sleep.bmp",
            "/eink/./sleep.bmp",
            "/opds/books/../../../Users/me/vault/secret.md",
            "/opds/books/almanac-..%2f..%2fsecret.epub",
            "/opds/books/almanac-2026-11-21.epub%00.md",
            "/opds/books//etc/passwd",
            "/Users/me/vault/note.md",
            "/etc/passwd",
            "C:\\Windows\\win.ini",
        ] {
            assert_eq!(route(path), None, "{path}");
        }
    }

    #[test]
    fn archive_reads_only_known_dates() {
        let dir = temp_dir();
        std::fs::write(dir.join("secret.md"), b"vault").unwrap();
        let mut archive = Archive::new();
        archive.load(dir.clone());
        archive.store("2026-11-21", "t", b"epub", 1).unwrap();
        assert_eq!(archive.read("2026-11-21").as_deref(), Some(&b"epub"[..]));
        assert_eq!(archive.read("2026-11-20"), None);
        assert_eq!(archive.read("../secret"), None);
        assert_eq!(archive.read("secret.md"), None);
        assert!(archive.store("../../x", "t", b"x", 1).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn archive_keeps_newest_eight_days() {
        let dir = temp_dir();
        let mut archive = Archive::new();
        archive.load(dir.clone());
        for day in 1..=10 {
            archive
                .store(&format!("2026-11-{day:02}"), "t", b"x", day)
                .unwrap();
        }
        let dates: Vec<String> = archive.dates().into_iter().collect();
        assert_eq!(dates.len(), 8);
        assert_eq!(dates.first().unwrap(), "2026-11-03");
        assert!(!dir.join("almanac-2026-11-01.epub").exists());
        assert!(dir.join("almanac-2026-11-10.epub").exists());
        // 重開 app 讀回同樣的清單；暫存檔不算
        std::fs::write(dir.join(".almanac-2026-11-11.epub.tmp"), b"half").unwrap();
        let mut reloaded = Archive::new();
        reloaded.load(dir.clone());
        assert_eq!(reloaded.dates().len(), 8);
        let _ = std::fs::remove_dir_all(dir);
    }

    // ---- 驗證 ----

    #[test]
    fn constant_time_compare() {
        assert!(constant_time_eq(TOKEN, TOKEN));
        assert!(!constant_time_eq(TOKEN, &TOKEN[1..]));
        assert!(!constant_time_eq(TOKEN, ""));
        assert!(!constant_time_eq("a", "b"));
    }

    #[test]
    fn token_from_query_or_bearer() {
        let empty = HeaderMap::new();
        let uri: Uri = format!("/eink/sleep.bmp?token={TOKEN}").parse().unwrap();
        assert_eq!(plugin_token(&uri, &empty).as_deref(), Some(TOKEN));
        let uri: Uri = "/eink/sleep.bmp".parse().unwrap();
        assert_eq!(plugin_token(&uri, &empty), None);
        let mut headers = HeaderMap::new();
        headers.insert(header::AUTHORIZATION, format!("Bearer {TOKEN}").parse().unwrap());
        assert_eq!(plugin_token(&uri, &headers).as_deref(), Some(TOKEN));
    }

    #[test]
    fn basic_credentials_parse() {
        let mut headers = HeaderMap::new();
        let encoded = STANDARD.encode(format!("almanac:{TOKEN}"));
        headers.insert(header::AUTHORIZATION, format!("Basic {encoded}").parse().unwrap());
        assert_eq!(
            basic_credentials(&headers),
            Some(("almanac".to_string(), TOKEN.to_string()))
        );
        headers.insert(header::AUTHORIZATION, "Basic !!!".parse().unwrap());
        assert_eq!(basic_credentials(&headers), None);
    }

    #[test]
    fn token_format() {
        assert!(is_valid_token(TOKEN));
        assert!(!is_valid_token("short"));
        assert!(!is_valid_token(&"G".repeat(48)));
    }

    // ---- 連錯幾次後暫時拒絕 ----

    #[test]
    fn limiter_locks_after_five_failures_and_expires() {
        let ip: IpAddr = "192.168.1.30".parse().unwrap();
        let other: IpAddr = "192.168.1.31".parse().unwrap();
        let mut limiter = FailureLimiter::new(5, Duration::from_secs(600), Duration::from_secs(600));
        let start = Instant::now();
        for i in 0..4 {
            assert!(!limiter.record_failure(ip, start + Duration::from_secs(i)));
            assert!(limiter.locked(ip, start + Duration::from_secs(i)).is_none());
        }
        assert!(limiter.record_failure(ip, start + Duration::from_secs(5)));
        assert!(limiter.locked(ip, start + Duration::from_secs(6)).is_some());
        assert!(limiter.locked(other, start + Duration::from_secs(6)).is_none());
        assert!(limiter.locked(ip, start + Duration::from_secs(606)).is_none());
    }

    #[test]
    fn limiter_forgets_old_failures_and_resets_on_success() {
        let ip: IpAddr = "10.0.0.2".parse().unwrap();
        let mut limiter = FailureLimiter::new(5, Duration::from_secs(60), Duration::from_secs(600));
        let start = Instant::now();
        for i in 0..4 {
            limiter.record_failure(ip, start + Duration::from_secs(i));
        }
        // 窗口外的失敗不算
        assert!(!limiter.record_failure(ip, start + Duration::from_secs(120)));
        limiter.record_success(ip);
        for i in 0..4 {
            assert!(!limiter.record_failure(ip, start + Duration::from_secs(200 + i)));
        }
    }

    // ---- 快取 ----

    #[test]
    fn publish_rejects_bad_input() {
        let core = core_with(Arc::new(RecordingHooks::default()));
        assert!(core.publish(AssetKind::Sleep, "../x", "ab", "", tomorrow_ms(), vec![1]).is_err());
        assert!(core.publish(AssetKind::Sleep, "2026-11-21", "ab", "", tomorrow_ms(), vec![]).is_err());
        assert!(core
            .publish(AssetKind::Sleep, "2026-11-21", "ab", "", tomorrow_ms(), vec![0; MAX_PUBLISH_BYTES + 1])
            .is_err());
        assert!(core.publish(AssetKind::Sleep, "2026-11-21", "ab", "", tomorrow_ms(), vec![1]).is_ok());
    }

    #[tokio::test]
    async fn stale_asset_asks_for_refresh_and_expired_day_is_not_served() {
        let hooks = Arc::new(RecordingHooks::default());
        let core = core_with(hooks.clone());
        // 沒有內容：請前端重算，等不到就 None
        assert!(core.fresh(AssetKind::Sleep, SLEEP_FRESH).await.is_none());
        assert_eq!(hooks.refreshes.load(Ordering::SeqCst), 1);
        // 新鮮的內容直接給，不再請重算
        core.publish(AssetKind::Sleep, "2026-11-21", "aa", "", tomorrow_ms(), vec![1, 2]).unwrap();
        assert!(core.fresh(AssetKind::Sleep, SLEEP_FRESH).await.is_some());
        assert_eq!(hooks.refreshes.load(Ordering::SeqCst), 1);
        // 過了當天（validUntil）就不給
        core.publish(AssetKind::Sleep, "2026-11-20", "bb", "", now_ms() - 1, vec![1]).unwrap();
        assert!(core.fresh(AssetKind::Sleep, SLEEP_FRESH).await.is_none());
    }

    #[tokio::test]
    async fn waits_for_publish_after_refresh() {
        let hooks = Arc::new(RecordingHooks::default());
        let mut raw = Core::new();
        raw.refresh_wait = Duration::from_secs(3);
        *raw.hooks.lock().unwrap() = hooks.clone();
        let core = Arc::new(raw);
        let publisher = core.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            publisher
                .publish(AssetKind::Sleep, "2026-11-21", "cc", "", tomorrow_ms(), vec![9])
                .unwrap();
        });
        let asset = core.fresh(AssetKind::Sleep, SLEEP_FRESH).await.expect("published");
        assert_eq!(asset.hash, "cc");
    }

    #[test]
    fn opds_feed_lists_entries_and_escapes() {
        let feed = opds_feed(&[FeedEntry {
            date: "2026-11-21".into(),
            title: "今日簡報 <&>".into(),
            updated_ms: 1_795_000_000_000,
        }]);
        assert!(feed.contains("href=\"/opds/books/almanac-2026-11-21.epub\""));
        assert!(feed.contains("今日簡報 &lt;&amp;&gt;"));
        assert!(feed.contains("http://opds-spec.org/acquisition"));
    }

    #[test]
    fn rfc3339_formats_utc() {
        assert_eq!(rfc3339(0), "1970-01-01T00:00:00Z");
        assert_eq!(rfc3339(1_763_683_200_000), "2025-11-21T00:00:00Z");
    }

    #[test]
    fn lan_ip_filter() {
        assert!(is_lan_ipv4("192.168.1.5".parse().unwrap()));
        assert!(is_lan_ipv4("10.1.2.3".parse().unwrap()));
        assert!(is_lan_ipv4("172.16.0.9".parse().unwrap()));
        assert!(is_lan_ipv4("169.254.3.3".parse().unwrap()));
        assert!(!is_lan_ipv4("8.8.8.8".parse().unwrap()));
        assert!(!is_lan_ipv4("127.0.0.1".parse().unwrap()));
        assert!(!is_lan_ipv4("0.0.0.0".parse().unwrap()));
    }

    // ---- 真的開一個伺服器（只綁 127.0.0.1），用 HTTP 客戶端打 ----

    async fn start(core: Arc<Core>) -> SocketAddr {
        let handle = serve(core, SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0))
            .await
            .expect("bind");
        let address = handle.address;
        // 丟掉 sender 會觸發關機；測試期間讓它一直開著
        std::mem::forget(handle.shutdown);
        address
    }

    /// 原始 HTTP 請求（reqwest 會先把 `..` 正規化掉，穿越測試要送原樣的路徑）。
    fn raw_get(address: SocketAddr, target: &str, auth: Option<&str>) -> (u16, Vec<u8>) {
        let mut stream = std::net::TcpStream::connect(address).unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let auth = auth.map(|value| format!("Authorization: {value}\r\n")).unwrap_or_default();
        write!(
            stream,
            "GET {target} HTTP/1.1\r\nHost: {address}\r\n{auth}Connection: close\r\n\r\n"
        )
        .unwrap();
        let mut response = Vec::new();
        let _ = stream.read_to_end(&mut response);
        let text = String::from_utf8_lossy(&response);
        let code = text
            .split_whitespace()
            .nth(1)
            .and_then(|code| code.parse().ok())
            .unwrap_or(0);
        let body = response
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .map(|index| response[index + 4..].to_vec())
            .unwrap_or_default();
        (code, body)
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn real_server_auth_routes_and_downloads() {
        let hooks = Arc::new(RecordingHooks::default());
        let core = core_with(hooks.clone());
        let bmp = vec![b'B'; 40_000];
        let epub = vec![b'E'; 50_000];
        core.publish(AssetKind::Sleep, "2026-11-21", "b39aa0", "", tomorrow_ms(), bmp.clone()).unwrap();
        core.publish(AssetKind::Epub, "2026-11-21", "e9b0ab", "今日簡報 2026-11-21", tomorrow_ms(), epub.clone())
            .unwrap();
        let address = start(core.clone()).await;
        let base = format!("http://{address}");
        let client = reqwest::Client::new();

        // 200：token 放網址參數或 Bearer 標頭都可以；帶 Content-Length、內容完整
        let ok = client
            .get(format!("{base}/eink/sleep.bmp?token={TOKEN}"))
            .send()
            .await
            .unwrap();
        assert_eq!(ok.status(), 200);
        assert_eq!(ok.headers()[header::CONTENT_LENGTH], bmp.len().to_string().as_str());
        assert_eq!(ok.headers()[header::CONTENT_TYPE], "image/bmp");
        assert_eq!(ok.bytes().await.unwrap().to_vec(), bmp);
        let bearer = client
            .get(format!("{base}/eink/sleep.bmp"))
            .bearer_auth(TOKEN)
            .send()
            .await
            .unwrap();
        assert_eq!(bearer.status(), 200);

        // 今日簡報整份送完才發 downloaded（給 commitSent）
        let book = client
            .get(format!("{base}/eink/today.epub?token={TOKEN}"))
            .send()
            .await
            .unwrap();
        assert_eq!(book.status(), 200);
        assert_eq!(book.headers()[header::CONTENT_LENGTH], epub.len().to_string().as_str());
        assert_eq!(book.bytes().await.unwrap().to_vec(), epub);
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(
            hooks.downloads.lock().unwrap().clone(),
            vec![(AssetKind::Epub, "2026-11-21".to_string(), "e9b0ab".to_string())]
        );

        // OPDS：Basic 驗證；書目列出今天；下載今天那本也算送出
        let feed = client
            .get(format!("{base}/opds"))
            .basic_auth(OPDS_USER, Some(TOKEN))
            .send()
            .await
            .unwrap();
        assert_eq!(feed.status(), 200);
        let xml = feed.text().await.unwrap();
        assert!(xml.contains("almanac-2026-11-21.epub"));
        assert!(xml.contains("今日簡報 2026-11-21"));
        let opds_book = client
            .get(format!("{base}/opds/books/almanac-2026-11-21.epub"))
            .basic_auth(OPDS_USER, Some(TOKEN))
            .send()
            .await
            .unwrap();
        assert_eq!(opds_book.status(), 200);
        assert_eq!(opds_book.bytes().await.unwrap().len(), epub.len());
        let unknown_day = client
            .get(format!("{base}/opds/books/almanac-2026-11-01.epub"))
            .basic_auth(OPDS_USER, Some(TOKEN))
            .send()
            .await
            .unwrap();
        assert_eq!(unknown_day.status(), 404);

        // 401：沒帶、帶錯、用錯驗證方式；OPDS 回 WWW-Authenticate
        let missing = client.get(format!("{base}/eink/sleep.bmp")).send().await.unwrap();
        assert_eq!(missing.status(), 401);
        let opds_missing = client.get(format!("{base}/opds")).send().await.unwrap();
        assert_eq!(opds_missing.status(), 401);
        assert!(opds_missing.headers().contains_key(header::WWW_AUTHENTICATE));
        // 404：不在白名單的路徑（不需要驗證也不算失敗）
        let (code, _) = raw_get(address, "/eink/../eink/sleep.bmp", None);
        assert_eq!(code, 404);
        let (code, _) = raw_get(address, &format!("/eink/%2e%2e/sleep.bmp?token={TOKEN}"), None);
        assert_eq!(code, 404);
        let (code, _) = raw_get(address, "/opds/books/../../../etc/passwd", None);
        assert_eq!(code, 404);
        let (code, _) = raw_get(address, "/mcp", None);
        assert_eq!(code, 404);
        // 只收 GET/HEAD
        let post = client
            .post(format!("{base}/eink/sleep.bmp?token={TOKEN}"))
            .send()
            .await
            .unwrap();
        assert_eq!(post.status(), 405);
        drop(core);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn real_server_locks_out_after_repeated_failures() {
        let core = core_with(Arc::new(RecordingHooks::default()));
        core.publish(AssetKind::Sleep, "2026-11-21", "aa", "", tomorrow_ms(), vec![1, 2, 3]).unwrap();
        let address = start(core).await;
        let base = format!("http://{address}");
        let client = reqwest::Client::new();
        for _ in 0..4 {
            let wrong = client
                .get(format!("{base}/eink/sleep.bmp?token={}", "f".repeat(48)))
                .send()
                .await
                .unwrap();
            assert_eq!(wrong.status(), 401);
        }
        let fifth = client
            .get(format!("{base}/opds"))
            .basic_auth(OPDS_USER, Some("nope"))
            .send()
            .await
            .unwrap();
        assert_eq!(fifth.status(), 401);
        // 封鎖中：連正確的 token 也拒絕
        let locked = client
            .get(format!("{base}/eink/sleep.bmp?token={TOKEN}"))
            .send()
            .await
            .unwrap();
        assert_eq!(locked.status(), 429);
        assert!(locked.headers().contains_key(header::RETRY_AFTER));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn real_server_without_content_returns_503_and_no_commit() {
        let hooks = Arc::new(RecordingHooks::default());
        let core = core_with(hooks.clone());
        let address = start(core).await;
        let client = reqwest::Client::new();
        let sleep = client
            .get(format!("http://{address}/eink/sleep.bmp?token={TOKEN}"))
            .send()
            .await
            .unwrap();
        assert_eq!(sleep.status(), 503);
        let book = client
            .get(format!("http://{address}/eink/today.epub?token={TOKEN}"))
            .send()
            .await
            .unwrap();
        assert_eq!(book.status(), 503);
        assert!(hooks.refreshes.load(Ordering::SeqCst) >= 2);
        assert!(hooks.downloads.lock().unwrap().is_empty());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn aborted_download_does_not_commit() {
        let hooks = Arc::new(RecordingHooks::default());
        let core = core_with(hooks.clone());
        core.publish(AssetKind::Epub, "2026-11-21", "b16", "", tomorrow_ms(), vec![7; 4 * 1024 * 1024])
            .unwrap();
        let address = start(core).await;
        {
            let mut stream = std::net::TcpStream::connect(address).unwrap();
            write!(
                stream,
                "GET /eink/today.epub?token={TOKEN} HTTP/1.1\r\nHost: x\r\n\r\n"
            )
            .unwrap();
            let mut first = [0u8; 1024];
            let _ = stream.read(&mut first);
            // 只讀一點就斷線
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert!(hooks.downloads.lock().unwrap().is_empty());
    }
}
