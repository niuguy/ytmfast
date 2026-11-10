//! YouTube Music's web player, run and driven by the app: the browser it runs in
//! (`chrome`), the DevTools connection (`cdp`), the bridge's protocol
//! (`bridge`), the session that keeps them (`session`), the process's one
//! engine (`engine`), the one-time login import (`import`), where files live
//! (`paths`) and what the bridge answers (`model`).

pub mod bridge;
pub mod cdp;
pub mod chrome;
pub mod demo;
pub mod engine;
pub mod import;
pub mod model;
pub mod paths;
pub mod session;

pub use model::*;
pub use session::{Session, Snapshot};
