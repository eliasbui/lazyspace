//! Long operations off the main thread: copying, moving, trashing, folder sizes, hashing, syncing, archives. Each job
//! runs on a thread of its own with a `Ctx` that reports progress, asks the page a question and waits for the answer,
//! and sees a cancel. A job always ends with `jobs.finished`, cancelled or not, so the page can clear its row.

use crate::{App, Proxy, UserEvent, ipc::event, tr};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{Receiver, RecvTimeoutError, Sender, channel},
    },
    thread,
    time::{Duration, Instant},
};
use tao::window::WindowId;

/// How often progress may go to the page.
const PROGRESS_EVERY: Duration = Duration::from_millis(100);

/// A question a job asks the user, as the page shows it.
#[derive(Debug, Clone, PartialEq)]
pub enum Question {
    /// An item of that name is already where a copy or move goes. `folder` when both are folders, which can merge.
    Conflict { name: String, folder: bool, source: Value, target: Value },
    Password { what: String },
    Confirm { text: String },
}

impl Question {
    /// The kind of question, as an answer for all of them is remembered.
    fn kind(&self) -> &'static str {
        match self {
            Question::Conflict { folder: true, .. } => "conflict-folder",
            Question::Conflict { .. } => "conflict",
            Question::Password { .. } => "password",
            Question::Confirm { .. } => "confirm",
        }
    }

    fn to_json(&self) -> Value {
        match self {
            Question::Conflict { name, folder, source, target } => json!({ "type": "conflict", "name": name, "folder": folder, "source": source, "target": target }),
            Question::Password { what } => json!({ "type": "password", "what": what }),
            Question::Confirm { text } => json!({ "type": "confirm", "text": text }),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Answer {
    Replace,
    Skip,
    KeepBoth,
    Merge,
    Stop,
    Yes,
    No,
    Text(String),
}

/// What a job's thread holds: its id, the way to the page, the cancel and the answers.
pub struct Ctx {
    pub id: u64,
    window: Option<WindowId>,
    cancel: Arc<AtomicBool>,
    proxy: Proxy,
    answers: Receiver<(Answer, bool)>,
    remembered: RefCell<HashMap<&'static str, Answer>>,
    last_progress: Cell<Option<Instant>>,
}

impl Ctx {
    pub fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    pub fn cancel_flag(&self) -> &AtomicBool {
        &self.cancel
    }

    /// Reports how far the job is, at most ten times a second; the last step (`done == total`) always goes.
    pub fn progress(&self, done: u64, total: u64, current: &str) {
        let now = Instant::now();
        if done < total && self.last_progress.get().is_some_and(|last| now - last < PROGRESS_EVERY) {
            return;
        }
        self.last_progress.set(Some(now));
        self.post(event("jobs.progress", json!({ "id": self.id, "done": done, "total": total, "current": current })));
    }

    /// Asks the page and waits for the answer. An answer given "for all" is kept and given again to the next question
    /// of the same kind without asking. A cancel while waiting answers `Stop`.
    pub fn ask(&self, question: Question) -> Answer {
        if let Some(answer) = self.remembered.borrow().get(question.kind()) {
            return answer.clone();
        }
        self.post(event("jobs.ask", json!({ "id": self.id, "question": question.to_json() })));
        loop {
            if self.cancelled() {
                return Answer::Stop;
            }
            match self.answers.recv_timeout(Duration::from_millis(200)) {
                Ok((answer, all)) => {
                    if all {
                        self.remembered.borrow_mut().insert(question.kind(), answer.clone());
                    }
                    return answer;
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return Answer::Stop,
            }
        }
    }

    /// Sends the page of the job's window an event of the job's own (a hash as soon as it is worked out).
    pub fn emit(&self, name: &str, data: Value) {
        self.post(event(name, data));
    }

    fn post(&self, message: Value) {
        self.proxy.send(UserEvent::Post { window: self.window, message });
    }
}

struct Handle {
    cancel: Arc<AtomicBool>,
    answers: Sender<(Answer, bool)>,
    kind: &'static str,
    title: String,
}

/// The jobs that run, by id; it lives on the main thread in the App.
#[derive(Default)]
pub struct Jobs {
    next: u64,
    running: HashMap<u64, Handle>,
}

/// What runs on the main thread once a job is over, with its result: refreshing views, keeping an undo.
pub type Then = Box<dyn FnOnce(&mut App, &Result<Value, String>) + Send>;

impl Jobs {
    /// Starts `work` on a thread of its own and tells the page of `window` it started; `then` runs on the main thread
    /// when it ends, before the page is told.
    pub fn spawn(
        &mut self,
        proxy: &Proxy,
        window: Option<WindowId>,
        kind: &'static str,
        title: String,
        work: impl FnOnce(&Ctx) -> Result<Value, String> + Send + 'static,
        then: Option<Then>,
    ) -> u64 {
        self.next += 1;
        let id = self.next;
        let cancel = Arc::new(AtomicBool::new(false));
        let (answers, receiver) = channel();
        self.running.insert(id, Handle { cancel: cancel.clone(), answers, kind, title: title.clone() });
        proxy.send(UserEvent::Post { window, message: event("jobs.started", json!({ "id": id, "kind": kind, "title": title })) });
        let ctx = Ctx { id, window, cancel, proxy: proxy.clone(), answers: receiver, remembered: RefCell::new(HashMap::new()), last_progress: Cell::new(None) };
        let proxy = proxy.clone();
        thread::Builder::new()
            .name(format!("job-{kind}-{id}"))
            .spawn(move || {
                let result = work(&ctx);
                let cancelled = ctx.cancelled();
                proxy.send(UserEvent::Main(Box::new(move |app: &mut App| {
                    app.jobs.running.remove(&id);
                    if let Some(then) = then {
                        then(app, &result);
                    }
                    let finished = match &result {
                        Ok(data) => json!({ "id": id, "ok": true, "data": data }),
                        Err(_) if cancelled => json!({ "id": id, "ok": false, "cancelled": true }),
                        Err(error) => json!({ "id": id, "ok": false, "error": error }),
                    };
                    match window {
                        Some(window) => app.post(window, event("jobs.finished", finished)),
                        None => app.post_all(event("jobs.finished", finished)),
                    }
                })));
            })
            .expect("a thread for the job");
        id
    }

    pub fn cancel(&self, id: u64) -> Result<(), String> {
        let handle = self.running.get(&id).ok_or_else(|| tr("Việc này đã xong", "That job is over").to_owned())?;
        handle.cancel.store(true, Ordering::Relaxed);
        Ok(())
    }

    pub fn answer(&self, id: u64, answer: Answer, all: bool) -> Result<(), String> {
        let handle = self.running.get(&id).ok_or_else(|| tr("Việc này đã xong", "That job is over").to_owned())?;
        handle.answers.send((answer, all)).map_err(|_| tr("Việc này đã xong", "That job is over").to_owned())
    }

    pub fn list(&self) -> Value {
        let mut list: Vec<Value> = self.running.iter().map(|(id, h)| json!({ "id": id, "kind": h.kind, "title": h.title })).collect();
        list.sort_by_key(|j| j["id"].as_u64());
        Value::Array(list)
    }
}

/// A Ctx with no page behind it, for a test or for work done on the spot, and the end that answers it.
#[cfg(test)]
pub fn test_ctx() -> (Ctx, Sender<(Answer, bool)>, Arc<AtomicBool>) {
    let cancel = Arc::new(AtomicBool::new(false));
    let (answers, receiver) = channel();
    let ctx = Ctx { id: 1, window: None, cancel: cancel.clone(), proxy: Proxy::none(), answers: receiver, remembered: RefCell::new(HashMap::new()), last_progress: Cell::new(None) };
    (ctx, answers, cancel)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conflict() -> Question {
        Question::Conflict { name: "a.txt".into(), folder: false, source: Value::Null, target: Value::Null }
    }

    #[test]
    fn ask_blocks_until_answered_and_apply_all_skips_later_asks() {
        let (ctx, answers, _) = test_ctx();
        let answerer = thread::spawn(move || {
            thread::sleep(Duration::from_millis(50));
            answers.send((Answer::KeepBoth, true)).unwrap();
            answers
        });
        let started = Instant::now();
        assert_eq!(ctx.ask(conflict()), Answer::KeepBoth);
        assert!(started.elapsed() >= Duration::from_millis(40), "the job waited for the answer");
        let answers = answerer.join().unwrap();
        // Remembered for every conflict of the kind; a different kind is asked again.
        assert_eq!(ctx.ask(conflict()), Answer::KeepBoth);
        answers.send((Answer::Merge, false)).unwrap();
        assert_eq!(ctx.ask(Question::Conflict { name: "d".into(), folder: true, source: Value::Null, target: Value::Null }), Answer::Merge);
    }

    #[test]
    fn a_cancel_while_waiting_answers_stop() {
        let (ctx, _answers, cancel) = test_ctx();
        let canceller = thread::spawn(move || {
            thread::sleep(Duration::from_millis(50));
            cancel.store(true, Ordering::Relaxed);
        });
        assert_eq!(ctx.ask(conflict()), Answer::Stop);
        assert!(ctx.cancelled());
        canceller.join().unwrap();
    }

    #[test]
    fn answers_are_read_as_the_page_sends_them() {
        let answer: Answer = serde_json::from_value(json!("keepBoth")).unwrap();
        assert_eq!(answer, Answer::KeepBoth);
        let answer: Answer = serde_json::from_value(json!({ "text": "secret" })).unwrap();
        assert_eq!(answer, Answer::Text("secret".into()));
        assert!(serde_json::from_value::<Answer>(json!("explode")).is_err());
    }
}
