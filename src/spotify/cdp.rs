//! A Chrome DevTools Protocol client for one browser: calls answered by id
//! through a pending map, events handed to whoever listens, and page
//! commands routed to an attached target's flat session.
//!
//! Calls never block the caller: [`Cdp::send`] queues the message and the
//! reply closure runs when the answer arrives (on the reader's thread), or
//! with [`CdpError::Timeout`] once [`Cdp::expire`] finds it overdue.
//! [`Cdp::call`] waits, for the few setup calls that must.
//!
//! Two transports carry the same messages:
//!
//! - On Unix, `--remote-debugging-pipe`: the browser reads commands from its
//!   fd 3 and writes answers to its fd 4, NUL-separated. No port is opened,
//!   so nothing else on the machine can attach to the browser.
//! - On Windows, a loopback WebSocket from `--remote-debugging-port=0`
//!   (std cannot hand a child extra descriptors there). No
//!   `--remote-allow-origins` is passed, so web pages cannot connect to it;
//!   this client sends no `Origin` header, which Chromium accepts.

use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};

use serde_json::{Value, json};

/// Why a call has no answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CdpError {
    /// The connection to the browser ended.
    Closed,
    /// No answer before its deadline.
    Timeout(String),
    /// The browser answered with an error.
    Protocol(String),
}

impl std::fmt::Display for CdpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CdpError::Closed => f.write_str("the browser went away"),
            CdpError::Timeout(method) => write!(f, "{method} timed out"),
            CdpError::Protocol(message) => f.write_str(message),
        }
    }
}

/// What a call's answer is handed to.
pub type Reply = Box<dyn FnOnce(Result<Value, CdpError>) + Send>;

struct Pending {
    method: String,
    deadline: Instant,
    reply: Reply,
}

type PendingMap = Arc<Mutex<HashMap<u64, Pending>>>;

/// An event of the browser or of an attached page: its method, params and
/// the flat session it came from.
#[derive(Debug, Clone, PartialEq)]
pub struct CdpEvent {
    pub method: String,
    pub params: Value,
    pub session: Option<String>,
}

/// The method of the event sent when the connection ends.
pub const CLOSED: &str = "spotish.closed";

/// A connection to one browser.
pub struct Cdp {
    out: mpsc::Sender<String>,
    pending: PendingMap,
    next_id: AtomicU64,
    closed: Arc<AtomicBool>,
}

impl Cdp {
    fn new(out: mpsc::Sender<String>, pending: PendingMap, closed: Arc<AtomicBool>) -> Cdp {
        Cdp { out, pending, next_id: AtomicU64::new(1), closed }
    }

    /// Talks over the browser's debugging pipe: `reader` is the browser's
    /// fd 4, `writer` its fd 3 (our ends).
    pub fn over_pipe(
        reader: impl Read + Send + 'static,
        writer: impl Write + Send + 'static,
        events: mpsc::Sender<CdpEvent>,
    ) -> Result<Cdp, String> {
        let (out, queued) = mpsc::channel::<String>();
        let pending: PendingMap = Arc::default();
        let closed = Arc::new(AtomicBool::new(false));
        std::thread::Builder::new()
            .name("spotish-cdp-write".into())
            .spawn(move || {
                let mut writer = writer;
                while let Ok(message) = queued.recv() {
                    let mut bytes = message.into_bytes();
                    bytes.push(0);
                    if writer.write_all(&bytes).and_then(|_| writer.flush()).is_err() {
                        break;
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        {
            let pending = pending.clone();
            let closed = closed.clone();
            std::thread::Builder::new()
                .name("spotish-cdp-read".into())
                .spawn(move || {
                    let mut reader = BufReader::with_capacity(1 << 16, reader);
                    let mut message = Vec::new();
                    loop {
                        message.clear();
                        match reader.read_until(0, &mut message) {
                            Ok(0) | Err(_) => break,
                            Ok(_) => {
                                if message.last() == Some(&0) {
                                    message.pop();
                                }
                                dispatch(&String::from_utf8_lossy(&message), &pending, &events);
                            }
                        }
                    }
                    end(&closed, &pending, &events);
                })
                .map_err(|e| e.to_string())?;
        }
        Ok(Cdp::new(out, pending, closed))
    }

    /// Talks over the browser's DevTools WebSocket (`ws://127.0.0.1:…`).
    ///
    /// A thread reads, blocked until a message arrives; another writes each
    /// message as it is queued, on a clone of the same TCP stream (a client
    /// socket of its own over it: the reader only reads, the writer only
    /// writes). Neither wakes while nothing happens, and nothing waits for
    /// the other.
    pub fn over_websocket(url: &str, events: mpsc::Sender<CdpEvent>) -> Result<Cdp, String> {
        use tungstenite::{Message, WebSocket, protocol::Role, stream::MaybeTlsStream};
        let (mut socket, _) = tungstenite::connect(url).map_err(|e| format!("connect {url}: {e}"))?;
        let stream = match socket.get_mut() {
            MaybeTlsStream::Plain(stream) => {
                let _ = stream.set_nodelay(true);
                stream.set_read_timeout(None).map_err(|e| e.to_string())?;
                stream.try_clone().map_err(|e| e.to_string())?
            }
            _ => return Err(format!("{url}: not a plain loopback connection")),
        };
        let (out, queued) = mpsc::channel::<String>();
        let pending: PendingMap = Arc::default();
        let closed = Arc::new(AtomicBool::new(false));
        std::thread::Builder::new()
            .name("spotish-cdp-write".into())
            .spawn(move || {
                let shutdown = stream.try_clone();
                let mut writer = WebSocket::from_raw_socket(stream, Role::Client, None);
                while let Ok(text) = queued.recv() {
                    if writer.send(Message::text(text)).is_err() {
                        break;
                    }
                }
                // Dropped (or the connection broke): the reader, blocked in
                // its read, ends with the connection.
                if let Ok(stream) = shutdown {
                    let _ = stream.shutdown(std::net::Shutdown::Both);
                }
            })
            .map_err(|e| e.to_string())?;
        {
            let pending = pending.clone();
            let closed = closed.clone();
            std::thread::Builder::new()
                .name("spotish-cdp-read".into())
                .spawn(move || {
                    loop {
                        match socket.read() {
                            Ok(Message::Text(text)) => dispatch(&text, &pending, &events),
                            Ok(Message::Close(_)) => break,
                            Ok(_) => {}
                            Err(e) => {
                                log::warn!("devtools connection ended: {e}");
                                break;
                            }
                        }
                    }
                    end(&closed, &pending, &events);
                })
                .map_err(|e| e.to_string())?;
        }
        Ok(Cdp::new(out, pending, closed))
    }

    /// Whether the connection is gone.
    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::SeqCst)
    }

    /// Sends `method` (to the page of `session`, or the browser) and hands
    /// its answer to `reply`, without waiting. Returns the call's id.
    pub fn send(&self, session: Option<&str>, method: &str, params: Value, timeout: Duration, reply: Reply) -> u64 {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        if self.is_closed() {
            reply(Err(CdpError::Closed));
            return id;
        }
        let mut message = json!({ "id": id, "method": method, "params": params });
        if let Some(session) = session {
            message["sessionId"] = Value::String(session.to_owned());
        }
        self.pending
            .lock()
            .unwrap()
            .insert(id, Pending { method: method.to_owned(), deadline: Instant::now() + timeout, reply });
        if self.out.send(message.to_string()).is_err()
            && let Some(p) = self.pending.lock().unwrap().remove(&id)
        {
            (p.reply)(Err(CdpError::Closed));
        }
        // The reader may have ended between the check and the insert.
        if self.is_closed()
            && let Some(p) = self.pending.lock().unwrap().remove(&id)
        {
            (p.reply)(Err(CdpError::Closed));
        }
        id
    }

    /// Sends `method` and waits for its answer (setup and shutdown only).
    pub fn call(
        &self,
        session: Option<&str>,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, CdpError> {
        let (tx, rx) = mpsc::channel();
        let id = self.send(
            session,
            method,
            params,
            timeout,
            Box::new(move |result| {
                let _ = tx.send(result);
            }),
        );
        match rx.recv_timeout(timeout + Duration::from_millis(50)) {
            Ok(result) => result,
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                Err(CdpError::Timeout(method.to_owned()))
            }
        }
    }

    /// Answers every call past its deadline with [`CdpError::Timeout`].
    pub fn expire(&self) {
        let now = Instant::now();
        let overdue: Vec<Pending> = {
            let mut pending = self.pending.lock().unwrap();
            let ids: Vec<u64> = pending.iter().filter(|(_, p)| p.deadline <= now).map(|(id, _)| *id).collect();
            ids.into_iter().filter_map(|id| pending.remove(&id)).collect()
        };
        for p in overdue {
            (p.reply)(Err(CdpError::Timeout(p.method)));
        }
    }

    /// How many calls wait for an answer.
    pub fn waiting(&self) -> usize {
        self.pending.lock().unwrap().len()
    }
}

/// The text of a `Runtime.evaluate` answer's exception, if it threw.
pub fn exception_text(result: &Value) -> Option<String> {
    let details = result.get("exceptionDetails")?;
    let text = details
        .pointer("/exception/description")
        .and_then(Value::as_str)
        .or_else(|| details.pointer("/exception/value").and_then(Value::as_str))
        .or_else(|| details.get("text").and_then(Value::as_str))
        .unwrap_or("an exception");
    Some(text.to_owned())
}

fn end(closed: &AtomicBool, pending: &Mutex<HashMap<u64, Pending>>, events: &mpsc::Sender<CdpEvent>) {
    closed.store(true, Ordering::SeqCst);
    let drained: Vec<Pending> = pending.lock().unwrap().drain().map(|(_, p)| p).collect();
    for p in drained {
        (p.reply)(Err(CdpError::Closed));
    }
    let _ = events.send(CdpEvent { method: CLOSED.into(), params: Value::Null, session: None });
}

fn dispatch(text: &str, pending: &Mutex<HashMap<u64, Pending>>, events: &mpsc::Sender<CdpEvent>) {
    let Ok(message) = serde_json::from_str::<Value>(text) else {
        log::warn!("devtools sent a message that is not JSON ({} bytes)", text.len());
        return;
    };
    if let Some(id) = message.get("id").and_then(Value::as_u64) {
        let waiting = pending.lock().unwrap().remove(&id);
        if let Some(p) = waiting {
            let result = match message.get("error") {
                Some(error) => {
                    Err(CdpError::Protocol(error.get("message").and_then(Value::as_str).unwrap_or("error").to_owned()))
                }
                None => Ok(message.get("result").cloned().unwrap_or(Value::Null)),
            };
            (p.reply)(result);
        }
    } else if let Some(method) = message.get("method").and_then(Value::as_str) {
        let _ = events.send(CdpEvent {
            method: method.to_owned(),
            params: message.get("params").cloned().unwrap_or(Value::Null),
            session: message.get("sessionId").and_then(Value::as_str).map(str::to_owned),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fake browser on the other end of a pair of in-memory pipes.
    struct Wire {
        to_browser: mpsc::Receiver<Vec<u8>>,
        from_browser: mpsc::Sender<Vec<u8>>,
    }

    struct ChanWriter(mpsc::Sender<Vec<u8>>);
    impl Write for ChanWriter {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.send(buf.to_vec()).map_err(|_| std::io::ErrorKind::BrokenPipe)?;
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    struct ChanReader {
        rx: mpsc::Receiver<Vec<u8>>,
        buf: Vec<u8>,
    }
    impl Read for ChanReader {
        fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
            if self.buf.is_empty() {
                match self.rx.recv() {
                    Ok(bytes) => self.buf = bytes,
                    Err(_) => return Ok(0),
                }
            }
            let n = out.len().min(self.buf.len());
            out[..n].copy_from_slice(&self.buf[..n]);
            self.buf.drain(..n);
            Ok(n)
        }
    }

    fn connect() -> (Cdp, Wire, mpsc::Receiver<CdpEvent>) {
        let (to_browser_tx, to_browser) = mpsc::channel();
        let (from_browser, from_browser_rx) = mpsc::channel();
        let (events, heard) = mpsc::channel();
        let cdp =
            Cdp::over_pipe(ChanReader { rx: from_browser_rx, buf: Vec::new() }, ChanWriter(to_browser_tx), events)
                .unwrap();
        (cdp, Wire { to_browser, from_browser }, heard)
    }

    fn sent(wire: &Wire) -> Value {
        let mut bytes = wire.to_browser.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_eq!(bytes.pop(), Some(0), "messages end in NUL");
        serde_json::from_slice(&bytes).unwrap()
    }

    #[test]
    fn answers_calls_by_id_out_of_order() {
        let (cdp, wire, _heard) = connect();
        let (tx, rx) = mpsc::channel();
        for n in 0..2 {
            let tx = tx.clone();
            cdp.send(
                Some("S"),
                "Runtime.evaluate",
                json!({ "n": n }),
                Duration::from_secs(5),
                Box::new(move |r| {
                    tx.send((n, r)).unwrap();
                }),
            );
        }
        let first = sent(&wire);
        let second = sent(&wire);
        assert_eq!(first["sessionId"], "S");
        assert_eq!(first["params"]["n"], 0);
        // The second is answered first.
        wire.from_browser
            .send(format!("{}\0", json!({ "id": second["id"], "result": { "v": 2 } })).into_bytes())
            .unwrap();
        wire.from_browser
            .send(format!("{}\0", json!({ "id": first["id"], "error": { "message": "nope" } })).into_bytes())
            .unwrap();
        assert_eq!(rx.recv_timeout(Duration::from_secs(2)).unwrap(), (1, Ok(json!({ "v": 2 }))));
        assert_eq!(rx.recv_timeout(Duration::from_secs(2)).unwrap(), (0, Err(CdpError::Protocol("nope".into()))));
        assert_eq!(cdp.waiting(), 0);
    }

    #[test]
    fn delivers_events_split_across_reads() {
        let (_cdp, wire, heard) = connect();
        let event = format!("{}\0", json!({ "method": "Page.loadEventFired", "params": {}, "sessionId": "S" }));
        let (a, b) = event.split_at(10);
        wire.from_browser.send(a.as_bytes().to_vec()).unwrap();
        wire.from_browser.send(b.as_bytes().to_vec()).unwrap();
        let got = heard.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_eq!(got.method, "Page.loadEventFired");
        assert_eq!(got.session.as_deref(), Some("S"));
    }

    #[test]
    fn expires_overdue_calls_and_closes() {
        let (cdp, wire, heard) = connect();
        let (tx, rx) = mpsc::channel();
        cdp.send(None, "Browser.getVersion", json!({}), Duration::ZERO, Box::new(move |r| tx.send(r).unwrap()));
        let _ = sent(&wire);
        cdp.expire();
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(2)).unwrap(),
            Err(CdpError::Timeout("Browser.getVersion".into()))
        );

        let (tx, rx) = mpsc::channel();
        cdp.send(None, "Browser.close", json!({}), Duration::from_secs(5), Box::new(move |r| tx.send(r).unwrap()));
        drop(wire);
        assert_eq!(rx.recv_timeout(Duration::from_secs(2)).unwrap(), Err(CdpError::Closed));
        assert!(heard.iter().any(|e| e.method == CLOSED));
        assert!(cdp.is_closed());
        assert_eq!(cdp.call(None, "X", json!({}), Duration::from_secs(1)), Err(CdpError::Closed));
    }

    #[test]
    fn talks_over_a_websocket_without_polling() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        // A fake browser: answers each call with its id, then sends an event.
        let browser = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut ws = tungstenite::accept(stream).unwrap();
            for _ in 0..2 {
                let message = ws.read().unwrap();
                let call: Value = serde_json::from_str(message.to_text().unwrap()).unwrap();
                ws.send(tungstenite::Message::text(json!({ "id": call["id"], "result": { "n": call["params"]["n"] } }).to_string()))
                    .unwrap();
            }
            ws.send(tungstenite::Message::text(json!({ "method": "Page.loadEventFired", "params": {} }).to_string()))
                .unwrap();
            // Until the client goes.
            while ws.read().is_ok() {}
        });
        let (events, heard) = mpsc::channel();
        let cdp = Cdp::over_websocket(&format!("ws://127.0.0.1:{port}/devtools/browser/x"), events).unwrap();
        for n in 0..2 {
            assert_eq!(cdp.call(None, "Runtime.evaluate", json!({ "n": n }), Duration::from_secs(2)), Ok(json!({ "n": n })));
        }
        assert_eq!(heard.recv_timeout(Duration::from_secs(2)).unwrap().method, "Page.loadEventFired");
        drop(cdp);
        // The writer goes with the client and shuts the connection: both ends finish.
        assert_eq!(heard.recv_timeout(Duration::from_secs(2)).unwrap().method, CLOSED);
        browser.join().unwrap();
    }

    #[test]
    fn reads_exceptions() {
        let thrown = json!({ "exceptionDetails": { "exception": { "description": "Error: E_AD: ad\n  at x" } } });
        assert_eq!(exception_text(&thrown).as_deref(), Some("Error: E_AD: ad\n  at x"));
        assert_eq!(exception_text(&json!({ "result": { "value": 1 } })), None);
    }
}
